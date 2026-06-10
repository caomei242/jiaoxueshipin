#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../lib/config.mjs';
import { ensureDir, outputPath, readJson, writeJson } from '../lib/fs-utils.mjs';
import { sharp } from '../lib/sharp-loader.mjs';
import { estimateDuration, formatSrtTime, splitLines } from '../lib/text-utils.mjs';

const flags = parseArgs(process.argv.slice(2));
const scriptsPath = outputPath(flags.outputDir, 'scripts', 'tutorial-scripts.json');
const storyboardDir = outputPath(flags.outputDir, 'storyboard');
const layoutPath = path.join(storyboardDir, 'browser-layout.json');
const reviewPath = path.join(storyboardDir, 'review-overrides.json');
const frameDir = outputPath(flags.outputDir, 'frames', 'storyboard-nanny-horizontal');
const manifestDir = outputPath(flags.outputDir, 'manifests');

await fs.rm(frameDir, { recursive: true, force: true });
await ensureDir(frameDir);
await ensureDir(manifestDir);

const scripts = await readJson(scriptsPath);
let layout = { scenes: [] };
try {
  layout = await readJson(layoutPath);
} catch {
  // Browser layout is optional; defaults still render a storyboard-style frame.
}
let reviewState = { scenes: {} };
try {
  reviewState = await readJson(reviewPath);
} catch {
  // Review state is optional; the exported browser layout is enough for fresh boards.
}
const layoutByKey = new Map((layout.scenes || []).map(scene => [scene.sceneKey, scene]));

function escapeXml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function htmlId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '-');
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isRect(rect) {
  return rect &&
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 3 &&
    rect.height > 3;
}

function sceneKey(variant, scene) {
  return scene.sceneKey || `${variant.style}-${scene.index}`;
}

function svgText(lines, x, y, size, color, weight = 700, lineHeight = 1.35, anchor = 'middle') {
  return lines.map((line, index) =>
    `<text x="${x}" y="${y + index * size * lineHeight}" fill="${color}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" font-family="PingFang SC, Hiragino Sans GB, Arial, sans-serif">${escapeXml(line)}</text>`
  ).join('\n');
}

function rectInScreenshotPixels(rect, meta, scene) {
  if (!isRect(rect)) return null;
  const dpr = scene.devicePixelRatio || 1;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const shouldApplyDpr = dpr > 1 &&
    right * dpr <= meta.width + 4 &&
    bottom * dpr <= meta.height + 4;
  const scale = shouldApplyDpr ? dpr : 1;
  return {
    x: rect.x * scale,
    y: rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale
  };
}

function defaultTargetBox(scene, meta) {
  const rect = rectInScreenshotPixels(scene.focusRect, meta, scene);
  if (!rect) return null;
  const padX = clamp(rect.width * 0.28, 24, 82);
  const padY = clamp(rect.height * 0.9, 16, 58);
  const left = clamp(rect.x - padX, 0, meta.width);
  const top = clamp(rect.y - padY, 0, meta.height);
  const right = clamp(rect.x + rect.width + padX, left + 8, meta.width);
  const bottom = clamp(rect.y + rect.height + padY, top + 8, meta.height);
  return {
    left: left / meta.width * 100,
    top: top / meta.height * 100,
    width: (right - left) / meta.width * 100,
    height: (bottom - top) / meta.height * 100
  };
}

function defaultMouseFromBox(box) {
  if (!box) return null;
  return {
    left: clamp(box.left + box.width + Math.max(2.5, Math.min(8, box.width * 0.18)), 1, 94),
    top: clamp(box.top + box.height + Math.max(2, Math.min(7, box.height * 0.48)), 2, 92)
  };
}

function pctBoxToFrame(box, placement) {
  if (!box) return null;
  return {
    x: placement.x + box.left / 100 * placement.width,
    y: placement.y + box.top / 100 * placement.height,
    width: box.width / 100 * placement.width,
    height: box.height / 100 * placement.height
  };
}

function pctPointToFrame(point, placement) {
  if (!point) return null;
  return {
    x: placement.x + point.left / 100 * placement.width,
    y: placement.y + point.top / 100 * placement.height
  };
}

function cursorSvg(point) {
  if (!point) return '';
  return `
    <g transform="translate(${point.x} ${point.y}) rotate(-13) scale(.48)" filter="url(#shadow)">
      <path d="M3 4 L3 78 L24 57 L41 96 L60 87 L43 50 L70 50 Z" fill="#fff" stroke="#101828" stroke-width="5" stroke-linejoin="round"/>
    </g>
  `;
}

async function maybeZoomImage(scene, key) {
  if (scene.zoomImage) {
    try {
      await fs.access(scene.zoomImage);
      return scene.zoomImage;
    } catch {
      // Fall back to generated storyboard zoom crops.
    }
  }
  const names = [
    `${htmlId(key)}-${scene.id}.png`,
    `${htmlId(key)}-${scene.sceneId || scene.id}.png`
  ];
  for (const name of names) {
    const file = path.join(storyboardDir, 'zooms', name);
    try {
      await fs.access(file);
      return file;
    } catch {
      // Continue.
    }
  }
  return null;
}

async function zoomBufferForMode(file, width, height, mode, cropPosition) {
  if (mode !== 'crop') {
    return sharp(file)
      .resize({ width, fit: 'inside', withoutEnlargement: false })
      .png()
      .toBuffer();
  }
  const meta = await sharp(file).metadata();
  const srcWidth = meta.width || width;
  const srcHeight = meta.height || height;
  const scale = Math.max(width / srcWidth, height / srcHeight);
  const resizedWidth = Math.max(width, Math.ceil(srcWidth * scale));
  const resizedHeight = Math.max(height, Math.ceil(srcHeight * scale));
  const resized = await sharp(file)
    .resize({ width: resizedWidth, height: resizedHeight, fit: 'fill' })
    .png()
    .toBuffer();
  const posX = clamp(cropPosition?.x ?? 50, 0, 100);
  const posY = clamp(cropPosition?.y ?? 50, 0, 100);
  const left = clamp(Math.round((resizedWidth - width) * posX / 100), 0, Math.max(0, resizedWidth - width));
  const top = clamp(Math.round((resizedHeight - height) * posY / 100), 0, Math.max(0, resizedHeight - height));
  return sharp(resized)
    .extract({ left, top, width, height })
    .png()
    .toBuffer();
}

async function writeCompanionFiles(scripts) {
  const scriptDir = outputPath(flags.outputDir, 'scripts');
  for (const variant of scripts.variants) {
    const md = [
      `# ${variant.styleName}口播稿`,
      '',
      `总时长约 ${variant.totalDuration} 秒`,
      '',
      ...variant.scenes.flatMap(scene => [
        `## ${scene.index}. ${scene.title}`,
        '',
        `操作：${scene.action}`,
        '',
        scene.voiceover,
        ''
      ])
    ].join('\n');
    await fs.writeFile(path.join(scriptDir, `${variant.style}-voiceover.md`), md, 'utf8');

    const srt = variant.scenes.map(scene => [
      String(scene.index),
      `${formatSrtTime(scene.start)} --> ${formatSrtTime(scene.end)}`,
      scene.subtitle || '',
      ''
    ].join('\n')).join('\n');
    await fs.writeFile(path.join(scriptDir, `${variant.style}.srt`), srt, 'utf8');
  }
}

function recalcVariant(variant) {
  let cursor = 0;
  for (const [index, scene] of variant.scenes.entries()) {
    scene.index = index + 1;
    scene.duration = estimateDuration(scene.voiceover || scene.subtitle || '', 4.2, 12);
    scene.start = Number(cursor.toFixed(2));
    scene.end = Number((cursor + scene.duration).toFixed(2));
    cursor += scene.duration;
  }
  variant.totalDuration = Number(cursor.toFixed(2));
}

function sceneFromLayout(variant, local) {
  if (!local?.sceneKey || !local?.screenshot) return null;
  return {
    index: Number(local.index) || 1,
    id: local.sceneId || local.sceneKey,
    sceneKey: local.sceneKey,
    style: local.style || variant.style,
    styleName: variant.styleName,
    title: local.title || local.sceneKey,
    action: local.action || '',
    subtitle: local.subtitle || '',
    voiceover: local.voiceover || local.subtitle || '',
    duration: estimateDuration(local.voiceover || local.subtitle || '', 4.2, 12),
    screenshot: local.screenshot,
    devicePixelRatio: local.devicePixelRatio || 1,
    focusRect: local.focusRect || null,
    sourceDescription: local.sourceDescription || '',
    zoomImage: local.zoomImage || '',
    zoomDeleted: Boolean(local.zoomDeleted),
    zoomMode: local.zoomMode === 'crop' ? 'crop' : 'full',
    zoomCropPosition: local.zoomCropPosition || null,
    reviewStatus: local.reviewStatus || 'pass',
    reviewNote: local.reviewNote || ''
  };
}

function reviewStatusFor(key, local, scene) {
  if (local.reviewStatusStored) return local.reviewStatus || 'pass';
  const savedStatus = reviewState.scenes?.[key]?.reviewStatus;
  return savedStatus || local.reviewStatus || scene.reviewStatus || 'pass';
}

function applyBrowserLayout(scripts) {
  if (flags.style !== 'all') {
    scripts.variants = scripts.variants.filter(variant => variant.style === flags.style);
  }
  for (const variant of scripts.variants) {
    const layoutScenes = (layout.scenes || []).filter(local => local.style === variant.style);
    const baseByKey = new Map(variant.scenes.map(scene => [sceneKey(variant, scene), scene]));
    const sourceScenes = layoutScenes.length
      ? layoutScenes
        .map(local => ({ local, scene: baseByKey.get(local.sceneKey) || sceneFromLayout(variant, local) }))
        .filter(item => item.scene)
      : variant.scenes.map(scene => ({
        scene,
        local: layoutByKey.get(sceneKey(variant, scene)) || {}
      }));
    const scenes = [];
    for (const { scene, local } of sourceScenes) {
      const key = sceneKey(variant, scene);
      const merged = {
        ...scene,
        sceneKey: key,
        action: local.action ?? scene.action,
        subtitle: local.subtitle ?? scene.subtitle,
        voiceover: local.voiceover ?? scene.voiceover,
        screenshot: local.screenshot || scene.screenshot,
        zoomImage: local.zoomImage || scene.zoomImage,
        reviewStatus: reviewStatusFor(key, local, scene),
        reviewNote: local.reviewNote ?? scene.reviewNote ?? '',
        storyboardLayout: {
          targetBox: local.targetBox || null,
          mouseMarker: local.mouseMarker || null,
          subtitleBox: local.subtitleBox || null,
          zoomInset: local.zoomInset || null,
          zoomMode: local.zoomMode === 'crop' ? 'crop' : 'full',
          zoomCropPosition: local.zoomCropPosition || null,
          zoomDeleted: Boolean(local.zoomDeleted),
          zoomHidden: Boolean(local.zoomHidden)
        }
      };
      if (merged.reviewStatus !== 'remove') scenes.push(merged);
    }
    variant.scenes = scenes;
    recalcVariant(variant);
  }
}

async function renderFrame(scene, variant, framePath) {
  const width = 1920;
  const height = 1080;
  const meta = await sharp(scene.screenshot).metadata();
  const fgScale = Math.min(width / meta.width, height / meta.height);
  const fgWidth = Math.round(meta.width * fgScale);
  const fgHeight = Math.round(meta.height * fgScale);
  const placement = {
    x: Math.round((width - fgWidth) / 2),
    y: Math.round((height - fgHeight) / 2),
    width: fgWidth,
    height: fgHeight
  };

  const background = await sharp(scene.screenshot)
    .resize({ width, height, fit: 'cover', position: 'center' })
    .blur(18)
    .modulate({ brightness: 0.78, saturation: 0.82 })
    .png()
    .toBuffer();
  const foreground = await sharp(scene.screenshot)
    .resize({ width: fgWidth, height: fgHeight, fit: 'fill' })
    .png()
    .toBuffer();

  const defaultBox = defaultTargetBox(scene, meta);
  const targetBox = scene.storyboardLayout?.targetBox || defaultBox;
  const target = pctBoxToFrame(targetBox, placement);
  const mouse = pctPointToFrame(scene.storyboardLayout?.mouseMarker || defaultMouseFromBox(targetBox), placement);
  const zoomFile = (scene.storyboardLayout?.zoomDeleted || scene.storyboardLayout?.zoomHidden)
    ? null
    : await maybeZoomImage(scene, sceneKey(variant, scene));

  const composites = [
    { input: background, left: 0, top: 0 },
    { input: foreground, left: placement.x, top: placement.y }
  ];

  let zoomSvg = '';
  if (zoomFile) {
    const zoomMode = scene.storyboardLayout?.zoomMode === 'crop' ? 'crop' : 'full';
    const zoomBox = scene.storyboardLayout?.zoomInset || (scene.zoomImage
      ? { left: 50, top: 12, width: 46 }
      : { left: 58, top: 4, width: 38 });
    const zoomWidth = Math.round(clamp(zoomBox.width || 38, 18, 86) / 100 * placement.width);
    const zoomMeta = await sharp(zoomFile).metadata();
    const zoomHeight = zoomMode === 'crop'
      ? Math.round(zoomWidth * 0.75)
      : Math.round(zoomWidth * (zoomMeta.height || 1) / (zoomMeta.width || 1));
    const left = Math.round(clamp(zoomBox.left ?? 58, 0, 100) / 100 * placement.width + placement.x);
    const top = Math.round(clamp(zoomBox.top ?? 4, 0, 100) / 100 * placement.height + placement.y);
    const safeLeft = clamp(left, placement.x, placement.x + placement.width - zoomWidth);
    const safeTop = clamp(top, placement.y, placement.y + placement.height - Math.min(zoomHeight, placement.height));
    const zoomBuffer = await zoomBufferForMode(
      zoomFile,
      zoomWidth,
      zoomHeight,
      zoomMode,
      scene.storyboardLayout?.zoomCropPosition
    );
    composites.push({ input: zoomBuffer, left: Math.round(safeLeft), top: Math.round(safeTop) });
    zoomSvg = `
      <rect x="${safeLeft - 4}" y="${safeTop - 4}" width="${zoomWidth + 8}" height="${zoomHeight + 8}" rx="10" fill="none" stroke="#ff2d2d" stroke-width="4"/>
    `;
  }

  const subtitle = splitLines(scene.subtitle || '', 30).slice(0, 2);
  const subtitleHeight = subtitle.length > 1 ? 102 : 70;
  const subtitleLayout = scene.storyboardLayout?.subtitleBox || null;
  const estimatedSubtitleWidth = subtitle.length
    ? Math.max(...subtitle.map(line => line.length)) * 34 * 0.68 + 72
    : 0;
  let subtitleWidth = 1280;
  let subtitleX = (width - subtitleWidth) / 2;
  let subtitleY = placement.y + placement.height - subtitleHeight - Math.round(placement.height * 0.04);
  if (subtitle.length && subtitleLayout && Number.isFinite(subtitleLayout.left) && Number.isFinite(subtitleLayout.top)) {
    const savedWidth = Number.isFinite(subtitleLayout.width)
      ? subtitleLayout.width / 100 * placement.width
      : 1280;
    subtitleWidth = Math.round(clamp(Math.max(savedWidth, estimatedSubtitleWidth), 240, 1280));
    subtitleX = Math.round(placement.x + clamp(subtitleLayout.left, 0, 100) / 100 * placement.width);
    subtitleY = Math.round(placement.y + clamp(subtitleLayout.top, 0, 100) / 100 * placement.height);
    subtitleX = Math.round(clamp(subtitleX, placement.x, placement.x + placement.width - subtitleWidth));
    subtitleY = Math.round(clamp(subtitleY, placement.y, placement.y + placement.height - subtitleHeight));
  }
  const overlay = `
  <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="shadow" x="-40%" y="-40%" width="180%" height="180%">
        <feDropShadow dx="0" dy="5" stdDeviation="4" flood-color="#000000" flood-opacity="0.34"/>
      </filter>
    </defs>
    ${target ? `<rect x="${target.x}" y="${target.y}" width="${target.width}" height="${target.height}" rx="8" fill="rgba(255,45,45,.035)" stroke="#ff2d2d" stroke-width="4"/>` : ''}
    ${zoomSvg}
    ${cursorSvg(mouse)}
    ${subtitle.length ? `<rect x="${subtitleX}" y="${subtitleY}" width="${subtitleWidth}" height="${subtitleHeight}" rx="14" fill="rgba(15,23,42,.88)" filter="url(#shadow)"/>` : ''}
    ${subtitle.length ? svgText(subtitle, subtitleX + subtitleWidth / 2, subtitleY + (subtitle.length > 1 ? 42 : 45), 34, '#ffffff', 800, 1.25, 'middle') : ''}
  </svg>`;

  composites.push({ input: Buffer.from(overlay), left: 0, top: 0 });

  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: '#eef2f7'
    }
  })
    .composite(composites)
    .png()
    .toFile(framePath);
}

applyBrowserLayout(scripts);
await writeJson(scriptsPath, scripts);
await writeCompanionFiles(scripts);

for (const variant of scripts.variants) {
  if (variant.style !== 'nanny') continue;
  const scenes = [];
  for (const scene of variant.scenes) {
    const framePath = path.join(frameDir, `scene-${String(scene.index).padStart(2, '0')}.png`);
    await renderFrame(scene, variant, framePath);
    scenes.push({
      ...scene,
      framePath,
      framePaths: [framePath],
      audioPath: outputPath(flags.outputDir, 'audio', variant.style, `scene-${String(scene.index).padStart(2, '0')}.m4a`)
    });
  }
  const manifest = {
    createdAt: new Date().toISOString(),
    style: variant.style,
    styleName: variant.styleName,
    aspect: 'horizontal',
    aspectName: '横屏',
    width: 1920,
    height: 1080,
    renderer: 'storyboard-preview',
    layoutSource: layoutPath,
    totalDuration: variant.totalDuration,
    scenes,
    outputVideo: outputPath(flags.outputDir, 'videos', `${variant.style}-horizontal-storyboard.mp4`)
  };
  await writeJson(path.join(manifestDir, `${variant.style}-horizontal-storyboard.json`), manifest);
}

console.log(`storyboard-frames=${frameDir}`);
