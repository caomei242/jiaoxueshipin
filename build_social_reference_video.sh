#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ -x "/Users/gd/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]]; then
  NODE_BIN="${NODE_BIN:-/Users/gd/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}"
else
  NODE_BIN="${NODE_BIN:-$(command -v node)}"
fi

REFERENCE_VIDEO="${REFERENCE_VIDEO:-/Users/gd/Desktop/ai优化商品图.mp4}"
OUTPUT_DIR="${SOCIAL_REFERENCE_OUTPUT_DIR:-/Users/gd/Desktop/主业/客户教程视频/稿定商品-AI优化商品图/2026-06-11-social-reference-v1}"
VOICE="${VOICE:-Tingting}"
RATE="${SAY_RATE:-230}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --reference)
      REFERENCE_VIDEO="$2"
      shift 2
      ;;
    --output)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --voice)
      VOICE="$2"
      shift 2
      ;;
    --rate)
      RATE="$2"
      shift 2
      ;;
    *)
      echo "unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "required command not found: $1" >&2
    exit 127
  fi
}

require_command "$NODE_BIN"
require_command say
require_command afconvert
require_command swift

if [[ ! -f "$REFERENCE_VIDEO" ]]; then
  echo "reference video not found: $REFERENCE_VIDEO" >&2
  exit 2
fi

if ! say -v '?' | awk '{print $1}' | grep -qx "$VOICE"; then
  echo "voice '$VOICE' not found, falling back to system default" >&2
  VOICE=""
fi

mkdir -p "$OUTPUT_DIR/reference-frames" "$OUTPUT_DIR/videos"

swift - "$REFERENCE_VIDEO" "$OUTPUT_DIR/reference-frames" <<'SWIFT'
import AVFoundation
import AppKit
import Foundation

func writeFrame(asset: AVAsset, at seconds: Double, to outURL: URL) throws {
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.requestedTimeToleranceBefore = .zero
    generator.requestedTimeToleranceAfter = .zero
    generator.maximumSize = CGSize(width: 1920, height: 1080)
    let time = CMTime(seconds: seconds, preferredTimescale: 600)
    let cgImage = try generator.copyCGImage(at: time, actualTime: nil)
    let rep = NSBitmapImageRep(cgImage: cgImage)
    guard let data = rep.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "frame", code: 1)
    }
    try data.write(to: outURL)
}

let input = CommandLine.arguments[1]
let outDir = URL(fileURLWithPath: CommandLine.arguments[2])
try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
let asset = AVURLAsset(url: URL(fileURLWithPath: input))
let duration = CMTimeGetSeconds(asset.duration)
let times = [0.0, 2.5, 5.0, 8.5, 12.0, 16.0, 20.0, min(24.5, max(0, duration - 0.4))]
for (idx, t) in times.enumerated() {
    let outURL = outDir.appendingPathComponent(String(format: "reference-frame-%02d-%.1fs.png", idx + 1, t))
    try writeFrame(asset: asset, at: t, to: outURL)
}
SWIFT

render_output="$("$NODE_BIN" "$ROOT_DIR/scripts/render_social_reference_frames.mjs" \
  --output "$OUTPUT_DIR" \
  --reference-frames "$OUTPUT_DIR/reference-frames")"

manifest_path="$("$NODE_BIN" --input-type=module - "$render_output" <<'NODE'
const data = JSON.parse(process.argv[2] || '{}');
console.log(data.manifestPath);
NODE
)"

"$NODE_BIN" --input-type=module - "$manifest_path" <<'NODE' |
import fs from 'node:fs';
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const scene of manifest.scenes) {
  const text = String(scene.voiceover || '')
    .replaceAll('SKU', 'S K U')
    .replaceAll('AI', 'A I');
  console.log(`${scene.index}\t${scene.audioPath}\t${text}`);
}
NODE
while IFS=$'\t' read -r scene_index audio_path text; do
  [[ -n "${audio_path:-}" ]] || continue
  mkdir -p "$(dirname "$audio_path")"
  aiff_path="${audio_path%.m4a}.aiff"
  rm -f "$aiff_path" "$audio_path"
  if [[ -n "$VOICE" ]]; then
    say -v "$VOICE" -r "$RATE" -o "$aiff_path" "$text"
  else
    say -r "$RATE" -o "$aiff_path" "$text"
  fi
  afconvert -f m4af -d aac "$aiff_path" "$audio_path"
  rm -f "$aiff_path"
  printf 'voiceover scene=%s audio=%s\n' "$scene_index" "$audio_path"
done

video_path="$("$NODE_BIN" --input-type=module - "$manifest_path" <<'NODE'
import fs from 'node:fs';
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
console.log(manifest.outputVideo);
NODE
)"

tmp_video_path="$OUTPUT_DIR/videos/.ai-image-social-reference-horizontal.$$.mp4"
rm -f "$tmp_video_path"
swift "$ROOT_DIR/compose_video.swift" "$manifest_path" "$tmp_video_path"
mv "$tmp_video_path" "$video_path"

printf 'social-reference-video=%s\n' "$video_path"
