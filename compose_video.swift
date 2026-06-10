#!/usr/bin/env swift

import AppKit
import AVFoundation
import CoreVideo
import Foundation

struct Manifest: Decodable {
    let width: Int
    let height: Int
    let scenes: [Scene]
    let outputVideo: String?
}

struct Scene: Decodable {
    let framePath: String
    let framePaths: [String]?
    let audioPath: String?
    let duration: Double
}

enum ComposeError: Error, CustomStringConvertible {
    case usage
    case invalidManifest(String)
    case invalidScene(Int, String)
    case imageLoadFailed(String)
    case imageDrawFailed(String)
    case assetWriterFailed(String)
    case exportSessionUnavailable
    case exportFailed(String)
    case audioRenderFailed(String)
    case fileOperationFailed(String)

    var description: String {
        switch self {
        case .usage:
            return "Usage: swift compose_video.swift manifest.json output.mp4"
        case .invalidManifest(let message):
            return "Invalid manifest: \(message)"
        case .invalidScene(let index, let message):
            return "Invalid scene \(index): \(message)"
        case .imageLoadFailed(let path):
            return "Failed to load PNG frame: \(path)"
        case .imageDrawFailed(let path):
            return "Failed to draw PNG frame into video buffer: \(path)"
        case .assetWriterFailed(let message):
            return "Failed to write silent video: \(message)"
        case .exportSessionUnavailable:
            return "Failed to create AVAssetExportSession for MP4 export"
        case .exportFailed(let message):
            return "Failed to export MP4: \(message)"
        case .audioRenderFailed(let message):
            return "Failed to render continuous audio: \(message)"
        case .fileOperationFailed(let message):
            return "File operation failed: \(message)"
        }
    }
}

let frameRate: Int32 = 30
let timescale: CMTimeScale = 600

func stderr(_ message: String) {
    FileHandle.standardError.write(Data((message + "\n").utf8))
}

func resolvePath(_ path: String, relativeTo baseDirectory: URL) -> URL {
    let url = URL(fileURLWithPath: NSString(string: path).expandingTildeInPath)
    if url.path.hasPrefix("/") {
        return url
    }
    return baseDirectory.appendingPathComponent(path)
}

func loadManifest(from manifestURL: URL) throws -> Manifest {
    let data = try Data(contentsOf: manifestURL)
    let decoder = JSONDecoder()
    let manifest = try decoder.decode(Manifest.self, from: data)
    guard manifest.width > 0, manifest.height > 0 else {
        throw ComposeError.invalidManifest("width and height must be positive")
    }
    guard !manifest.scenes.isEmpty else {
        throw ComposeError.invalidManifest("scenes must not be empty")
    }
    return manifest
}

func makePixelBuffer(from imageURL: URL, width: Int, height: Int) throws -> CVPixelBuffer {
    guard let image = NSImage(contentsOf: imageURL) else {
        throw ComposeError.imageLoadFailed(imageURL.path)
    }

    let attributes: [CFString: Any] = [
        kCVPixelBufferCGImageCompatibilityKey: true,
        kCVPixelBufferCGBitmapContextCompatibilityKey: true,
        kCVPixelBufferIOSurfacePropertiesKey: [:]
    ]

    var optionalBuffer: CVPixelBuffer?
    let status = CVPixelBufferCreate(
        kCFAllocatorDefault,
        width,
        height,
        kCVPixelFormatType_32ARGB,
        attributes as CFDictionary,
        &optionalBuffer
    )
    guard status == kCVReturnSuccess, let buffer = optionalBuffer else {
        throw ComposeError.imageDrawFailed(imageURL.path)
    }

    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }

    guard
        let baseAddress = CVPixelBufferGetBaseAddress(buffer),
        let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
        let context = CGContext(
            data: baseAddress,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue
        )
    else {
        throw ComposeError.imageDrawFailed(imageURL.path)
    }

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
    NSColor.black.setFill()
    NSRect(x: 0, y: 0, width: width, height: height).fill()
    image.draw(
        in: NSRect(x: 0, y: 0, width: width, height: height),
        from: NSRect(origin: .zero, size: image.size),
        operation: .copy,
        fraction: 1.0
    )
    NSGraphicsContext.restoreGraphicsState()

    return buffer
}

func waitUntilReady(_ input: AVAssetWriterInput) {
    while !input.isReadyForMoreMediaData {
        Thread.sleep(forTimeInterval: 0.005)
    }
}

func padAudioTrack(_ track: AVMutableCompositionTrack, until targetTime: CMTime) {
    let currentDuration = track.timeRange.duration
    if currentDuration.isValid && CMTimeCompare(currentDuration, targetTime) < 0 {
        track.insertEmptyTimeRange(
            CMTimeRange(start: currentDuration, duration: targetTime - currentDuration)
        )
    }
}

func silenceBuffer(format: AVAudioFormat, frameCount: AVAudioFrameCount) throws -> AVAudioPCMBuffer {
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else {
        throw ComposeError.audioRenderFailed("could not allocate silence buffer")
    }
    buffer.frameLength = frameCount
    return buffer
}

func writeSilence(to file: AVAudioFile, format: AVAudioFormat, frames: AVAudioFramePosition) throws {
    var remaining = frames
    while remaining > 0 {
        let chunk = AVAudioFrameCount(min(remaining, 8192))
        try file.write(from: try silenceBuffer(format: format, frameCount: chunk))
        remaining -= AVAudioFramePosition(chunk)
    }
}

func readAudioBuffer(from audioURL: URL, targetFormat: AVAudioFormat) throws -> AVAudioPCMBuffer {
    let inputFile = try AVAudioFile(forReading: audioURL)
    let inputFormat = inputFile.processingFormat
    guard let inputBuffer = AVAudioPCMBuffer(
        pcmFormat: inputFormat,
        frameCapacity: AVAudioFrameCount(inputFile.length)
    ) else {
        throw ComposeError.audioRenderFailed("could not allocate input buffer for \(audioURL.path)")
    }
    try inputFile.read(into: inputBuffer)

    if inputFormat.sampleRate == targetFormat.sampleRate &&
        inputFormat.channelCount == targetFormat.channelCount &&
        inputFormat.commonFormat == targetFormat.commonFormat {
        return inputBuffer
    }

    guard let converter = AVAudioConverter(from: inputFormat, to: targetFormat) else {
        throw ComposeError.audioRenderFailed("could not create converter for \(audioURL.path)")
    }
    let ratio = targetFormat.sampleRate / inputFormat.sampleRate
    let outputCapacity = AVAudioFrameCount(ceil(Double(inputBuffer.frameLength) * ratio) + 1024)
    guard let outputBuffer = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: outputCapacity) else {
        throw ComposeError.audioRenderFailed("could not allocate converted buffer for \(audioURL.path)")
    }

    var didProvideInput = false
    var conversionError: NSError?
    let status = converter.convert(to: outputBuffer, error: &conversionError) { _, outStatus in
        if didProvideInput {
            outStatus.pointee = .endOfStream
            return nil
        }
        didProvideInput = true
        outStatus.pointee = .haveData
        return inputBuffer
    }
    if let conversionError {
        throw ComposeError.audioRenderFailed(conversionError.localizedDescription)
    }
    if status == .error {
        throw ComposeError.audioRenderFailed("conversion failed for \(audioURL.path)")
    }
    return outputBuffer
}

func writeClippedBuffer(_ buffer: AVAudioPCMBuffer, maxFrames: AVAudioFramePosition, to file: AVAudioFile) throws -> AVAudioFramePosition {
    let originalLength = buffer.frameLength
    let framesToWrite = AVAudioFrameCount(min(AVAudioFramePosition(originalLength), maxFrames))
    guard framesToWrite > 0 else { return 0 }
    buffer.frameLength = framesToWrite
    try file.write(from: buffer)
    buffer.frameLength = originalLength
    return AVAudioFramePosition(framesToWrite)
}

func renderContinuousAudio(
    manifest: Manifest,
    manifestDirectory: URL,
    to outputURL: URL,
    duration: CMTime
) throws -> URL? {
    let audioScenes = manifest.scenes.filter { scene in
        guard let audioPath = scene.audioPath, !audioPath.isEmpty else { return false }
        let audioURL = resolvePath(audioPath, relativeTo: manifestDirectory)
        return FileManager.default.fileExists(atPath: audioURL.path)
    }
    if audioScenes.isEmpty {
        return nil
    }

    let sampleRate = 22050.0
    guard let outputFormat = AVAudioFormat(
        commonFormat: .pcmFormatFloat32,
        sampleRate: sampleRate,
        channels: 1,
        interleaved: false
    ) else {
        throw ComposeError.audioRenderFailed("could not create output audio format")
    }
    let outputFile = try AVAudioFile(forWriting: outputURL, settings: outputFormat.settings)
    let totalFrames = AVAudioFramePosition(ceil(CMTimeGetSeconds(duration) * sampleRate))
    var cursorFrames: AVAudioFramePosition = 0
    var sceneStartSeconds = 0.0

    for scene in manifest.scenes {
        let sceneStartFrames = AVAudioFramePosition(round(sceneStartSeconds * sampleRate))
        if cursorFrames < sceneStartFrames {
            try writeSilence(to: outputFile, format: outputFormat, frames: sceneStartFrames - cursorFrames)
            cursorFrames = sceneStartFrames
        }

        if let audioPath = scene.audioPath, !audioPath.isEmpty {
            let audioURL = resolvePath(audioPath, relativeTo: manifestDirectory)
            if FileManager.default.fileExists(atPath: audioURL.path) {
                let sourceBuffer = try readAudioBuffer(from: audioURL, targetFormat: outputFormat)
                let maxSceneFrames = AVAudioFramePosition(floor(scene.duration * sampleRate))
                let written = try writeClippedBuffer(sourceBuffer, maxFrames: maxSceneFrames, to: outputFile)
                cursorFrames += written
            }
        }

        sceneStartSeconds += scene.duration
    }

    if cursorFrames < totalFrames {
        try writeSilence(to: outputFile, format: outputFormat, frames: totalFrames - cursorFrames)
    }
    return outputURL
}

func writeSilentVideo(manifest: Manifest, manifestDirectory: URL, to outputURL: URL) throws -> CMTime {
    let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mov)
    let videoSettings: [String: Any] = [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: manifest.width,
        AVVideoHeightKey: manifest.height
    ]
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
    input.expectsMediaDataInRealTime = false

    let sourceAttributes: [String: Any] = [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
        kCVPixelBufferWidthKey as String: manifest.width,
        kCVPixelBufferHeightKey as String: manifest.height
    ]
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(
        assetWriterInput: input,
        sourcePixelBufferAttributes: sourceAttributes
    )

    guard writer.canAdd(input) else {
        throw ComposeError.assetWriterFailed("video input cannot be added")
    }
    writer.add(input)

    guard writer.startWriting() else {
        throw ComposeError.assetWriterFailed(writer.error?.localizedDescription ?? "writer did not start")
    }
    writer.startSession(atSourceTime: .zero)

    var cursor = CMTime.zero
    let frameDuration = CMTime(value: 1, timescale: frameRate)

    for (index, scene) in manifest.scenes.enumerated() {
        guard scene.duration > 0 else {
            throw ComposeError.invalidScene(index, "duration must be positive")
        }
        let framePathSequence = (scene.framePaths?.isEmpty == false ? scene.framePaths! : [scene.framePath])
        let pixelBuffers = try framePathSequence.map { framePath in
            let frameURL = resolvePath(framePath, relativeTo: manifestDirectory)
            return try makePixelBuffer(from: frameURL, width: manifest.width, height: manifest.height)
        }
        let sceneDuration = CMTime(seconds: scene.duration, preferredTimescale: timescale)
        let frameCount = max(1, Int(ceil(scene.duration * Double(frameRate))))

        for frameIndex in 0..<frameCount {
            waitUntilReady(input)
            let nominalTime = cursor + CMTimeMultiply(frameDuration, multiplier: Int32(frameIndex))
            let presentationTime = min(nominalTime, cursor + sceneDuration - CMTime(value: 1, timescale: timescale))
            let progress = Double(frameIndex) / Double(max(1, frameCount - 1))
            let bufferIndex: Int
            if pixelBuffers.count >= 3 {
                if progress < 0.18 {
                    bufferIndex = 0
                } else if progress < 0.32 {
                    bufferIndex = 1
                } else {
                    bufferIndex = 2
                }
            } else if pixelBuffers.count == 2 {
                bufferIndex = progress < 0.26 ? 0 : 1
            } else {
                bufferIndex = 0
            }
            guard adaptor.append(pixelBuffers[bufferIndex], withPresentationTime: presentationTime) else {
                throw ComposeError.assetWriterFailed(writer.error?.localizedDescription ?? "failed to append frame")
            }
        }
        cursor = cursor + sceneDuration
    }

    input.markAsFinished()

    let semaphore = DispatchSemaphore(value: 0)
    writer.finishWriting {
        semaphore.signal()
    }
    semaphore.wait()

    if writer.status != .completed {
        throw ComposeError.assetWriterFailed(writer.error?.localizedDescription ?? "writer finished with status \(writer.status.rawValue)")
    }
    return cursor
}

func addAudioTracks(
    from manifest: Manifest,
    manifestDirectory: URL,
    to composition: AVMutableComposition
) async throws {
    var cursor = CMTime.zero
    var compositionTrack: AVMutableCompositionTrack?

    for scene in manifest.scenes {
        let sceneDuration = CMTime(seconds: scene.duration, preferredTimescale: timescale)
        defer {
            cursor = cursor + sceneDuration
        }

        guard let audioPath = scene.audioPath, !audioPath.isEmpty else {
            continue
        }
        let audioURL = resolvePath(audioPath, relativeTo: manifestDirectory)
        guard FileManager.default.fileExists(atPath: audioURL.path) else {
            stderr("warning: missing audio, scene will remain silent: \(audioURL.path)")
            continue
        }

        let asset = AVURLAsset(url: audioURL)
        let audioTracks = try await asset.loadTracks(withMediaType: .audio)
        guard let sourceTrack = audioTracks.first else {
            stderr("warning: no audio track, scene will remain silent: \(audioURL.path)")
            continue
        }
        if compositionTrack == nil {
            compositionTrack = composition.addMutableTrack(
                withMediaType: .audio,
                preferredTrackID: kCMPersistentTrackID_Invalid
            )
        }
        guard let compositionTrack else {
            throw ComposeError.exportFailed("could not create composition audio track")
        }

        padAudioTrack(compositionTrack, until: cursor)

        let assetDuration = try await asset.load(.duration)
        let audioDuration = min(assetDuration, sceneDuration)
        if audioDuration > .zero {
            try compositionTrack.insertTimeRange(
                CMTimeRange(start: .zero, duration: audioDuration),
                of: sourceTrack,
                at: cursor
            )
        }
    }
    if let compositionTrack {
        padAudioTrack(compositionTrack, until: cursor)
    }
}

func exportMP4(
    silentVideoURL: URL,
    audioURL: URL?,
    manifest: Manifest,
    manifestDirectory: URL,
    outputURL: URL,
    duration: CMTime
) async throws {
    let composition = AVMutableComposition()
    let silentAsset = AVURLAsset(url: silentVideoURL)
    let sourceVideoTracks = try await silentAsset.loadTracks(withMediaType: .video)

    guard
        let sourceVideoTrack = sourceVideoTracks.first,
        let videoTrack = composition.addMutableTrack(
            withMediaType: .video,
            preferredTrackID: kCMPersistentTrackID_Invalid
        )
    else {
        throw ComposeError.exportFailed("silent MOV does not contain a readable video track")
    }

    try videoTrack.insertTimeRange(
        CMTimeRange(start: .zero, duration: duration),
        of: sourceVideoTrack,
        at: .zero
    )
    videoTrack.preferredTransform = try await sourceVideoTrack.load(.preferredTransform)

    if let audioURL {
        let audioAsset = AVURLAsset(url: audioURL)
        let audioTracks = try await audioAsset.loadTracks(withMediaType: .audio)
        if let audioTrack = audioTracks.first,
           let compositionAudioTrack = composition.addMutableTrack(
            withMediaType: .audio,
            preferredTrackID: kCMPersistentTrackID_Invalid
           ) {
            try compositionAudioTrack.insertTimeRange(
                CMTimeRange(start: .zero, duration: duration),
                of: audioTrack,
                at: .zero
            )
        }
    }

    guard let export = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
        throw ComposeError.exportSessionUnavailable
    }
    export.outputURL = outputURL
    export.outputFileType = .mp4
    export.shouldOptimizeForNetworkUse = true
    export.timeRange = CMTimeRange(start: .zero, duration: duration)

    do {
        try await export.export(to: outputURL, as: .mp4)
    } catch {
        throw ComposeError.exportFailed(error.localizedDescription)
    }
}

func removeIfExists(_ url: URL) throws {
    if FileManager.default.fileExists(atPath: url.path) {
        do {
            try FileManager.default.removeItem(at: url)
        } catch {
            throw ComposeError.fileOperationFailed("could not remove \(url.path): \(error.localizedDescription)")
        }
    }
}

func run() async throws {
    let args = CommandLine.arguments
    guard args.count == 3 else {
        throw ComposeError.usage
    }

    let manifestURL = URL(fileURLWithPath: NSString(string: args[1]).expandingTildeInPath)
    let outputURL = URL(fileURLWithPath: NSString(string: args[2]).expandingTildeInPath)
    let manifestDirectory = manifestURL.deletingLastPathComponent()
    let outputDirectory = outputURL.deletingLastPathComponent()
    let tempId = UUID().uuidString
    let tempURL = outputDirectory.appendingPathComponent(".compose-video-\(tempId).silent.mov")
    let tempAudioURL = outputDirectory.appendingPathComponent(".compose-video-\(tempId).audio.caf")

    try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)
    try removeIfExists(outputURL)
    try removeIfExists(tempURL)
    try removeIfExists(tempAudioURL)

    do {
        let manifest = try loadManifest(from: manifestURL)
        let duration = try writeSilentVideo(manifest: manifest, manifestDirectory: manifestDirectory, to: tempURL)
        let audioURL = try renderContinuousAudio(
            manifest: manifest,
            manifestDirectory: manifestDirectory,
            to: tempAudioURL,
            duration: duration
        )
        try await exportMP4(
            silentVideoURL: tempURL,
            audioURL: audioURL,
            manifest: manifest,
            manifestDirectory: manifestDirectory,
            outputURL: outputURL,
            duration: duration
        )
        try removeIfExists(tempURL)
        try removeIfExists(tempAudioURL)
        print("video=\(outputURL.path)")
    } catch {
        try? removeIfExists(tempURL)
        try? removeIfExists(tempAudioURL)
        throw error
    }
}

do {
    try await run()
} catch let error as ComposeError {
    stderr(error.description)
    exit(1)
} catch {
    stderr("compose_video.swift failed: \(error.localizedDescription)")
    exit(1)
}
