#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../lib/config.mjs';
import { ensureDir, outputPath, readJson, writeJson } from '../lib/fs-utils.mjs';
import { sharp } from '../lib/sharp-loader.mjs';
import { splitLines } from '../lib/text-utils.mjs';

const flags = parseArgs(process.argv.slice(2));
const scripts = await readJson(outputPath(flags.outputDir, 'scripts', 'tutorial-scripts.json'));
const manifestDir = outputPath(flags.outputDir, 'manifests');
await ensureDir(manifestDir);

const aspectConfigs = {
  horizontal: {
    label: '横屏',
    width: 1920,
    height: 1080,
    shotBox: { x: 0, y: 0, w: 1920, h: 1080 },
    titleBar: { x: 430, y: 26, w: 1060, h: 58 },
    emphasisBar: { x: 650, y: 92, w: 620, h: 38 },
    effectPanel: { x: 1214, y: 170, w: 660, h: 612 },
    titleSize: 34,
    subtitleSize: 34,
    caption: { x: 360, y: 942, w: 1200, h: 108 }
  },
  vertical: {
    label: '竖屏',
    width: 1080,
    height: 1920,
    shotBox: { x: 0, y: 132, w: 1080, h: 650 },
    zoomBox: { x: 54, y: 820, w: 972, h: 560 },
    titleSize: 42,
    subtitleSize: 42,
    caption: { x: 54, y: 1468, w: 972, h: 330 }
  }
};

function escapeXml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function svgText(lines, x, y, size, color, weight = 600, lineHeight = 1.35, anchor = 'start') {
  return lines.map((line, index) =>
    `<text x="${x}" y="${y + index * size * lineHeight}" fill="${color}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" font-family="PingFang SC, Hiragino Sans GB, Arial, sans-serif">${escapeXml(line)}</text>`
  ).join('\n');
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

function scaleRect(rect, imageMeta, placed, scene = null) {
  if (!isRect(rect)) return null;
  rect = rectInScreenshotPixels(rect, imageMeta, scene);
  const scaleX = placed.width / imageMeta.width;
  const scaleY = placed.height / imageMeta.height;
  return {
    x: placed.x + rect.x * scaleX,
    y: placed.y + rect.y * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY
  };
}

function inferredDevicePixelRatio(rect, meta, scene) {
  if (Number.isFinite(scene?.devicePixelRatio) && scene.devicePixelRatio > 0) {
    return scene.devicePixelRatio;
  }
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  if (meta.width >= 2500 && right <= meta.width / 1.6 && bottom <= meta.height / 1.6) {
    return 2;
  }
  if (meta.width >= 1800 && right <= meta.width / 1.2 && bottom <= meta.height / 1.2) {
    return 1.5;
  }
  return 1;
}

function rectInScreenshotPixels(rect, meta, scene = null) {
  if (!isRect(rect)) return null;
  const dpr = inferredDevicePixelRatio(rect, meta, scene);
  return {
    ...rect,
    x: rect.x * dpr,
    y: rect.y * dpr,
    width: rect.width * dpr,
    height: rect.height * dpr
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function focusPoint(rect) {
  if (!rect) return null;
  return {
    x: rect.x + rect.width * 0.5,
    y: rect.y + rect.height * 0.5
  };
}

function clickPointForPhase(rect, phase) {
  const center = focusPoint(rect);
  if (!center) return null;
  if (phase === 'approach') {
    return {
      x: center.x - Math.max(42, rect.width * 0.32),
      y: center.y - Math.max(30, rect.height * 0.5)
    };
  }
  return center;
}

function cursorPointForPhase(rect, phase, aspect) {
  if (!rect) return null;
  const offsetX = Math.min(78, Math.max(36, rect.width * 0.16));
  const offsetY = Math.min(78, Math.max(34, rect.height * 0.36));
  return {
    x: clamp(rect.x + rect.width + offsetX, 18, aspect.width - 90),
    y: clamp(rect.y + rect.height + offsetY, 64, aspect.height - 130)
  };
}

function highlightSvg(rect, phase, aspectId) {
  if (!rect) return '';
  const padX = aspectId === 'vertical'
    ? clamp(rect.width * 0.28, 22, 72)
    : clamp(rect.width * 0.28, 14, 46);
  const padY = aspectId === 'vertical'
    ? clamp(rect.height * 0.9, 18, 58)
    : clamp(rect.height * 0.9, 10, 36);
  const x = Math.max(0, rect.x - padX);
  const y = Math.max(0, rect.y - padY);
  const width = rect.width + padX * 2;
  const height = rect.height + padY * 2;
  return `
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="8" fill="rgba(255,255,255,0.06)" stroke="#ff2d2d" stroke-width="${aspectId === 'vertical' ? 6 : 3}"/>
  `;
}

function cursorSvg(rect, phase, aspectId, aspect) {
  const point = cursorPointForPhase(rect, phase, aspect);
  if (!point) return '';
  const scale = aspectId === 'vertical' ? 0.78 : 0.44;
  const x = clamp(point.x, 18, aspect.width - 90);
  const y = clamp(point.y, 64, aspect.height - 130);
  return `
    <g transform="translate(${x} ${y}) rotate(-12) scale(${scale})" filter="url(#shadow)">
      <path d="M0 0 L0 82 L23 60 L38 98 L58 90 L42 54 L73 54 Z" fill="#ffffff" stroke="#111827" stroke-width="5" stroke-linejoin="round"/>
      <path d="M9 14 L9 59 L22 47 L38 84 L44 81 L28 43 L52 43 Z" fill="#ffffff"/>
    </g>
  `;
}

function insetPlacement(focus, aspectId, aspect) {
  if (aspect.zoomBox) return aspect.zoomBox;
  if (aspectId === 'horizontal' && aspect.effectPanel) return aspect.effectPanel;
  const w = 430;
  const h = 250;
  if (!focus || focus.x < aspect.width * 0.33) return { x: aspect.width - w - 52, y: 256, w, h };
  if (focus.x > aspect.width * 0.64) return { x: 52, y: 256, w, h };
  return { x: aspect.width - w - 52, y: 210, w, h };
}

function effectPanelSvg(scene, aspectId, aspect) {
  return '';
}

function cropRectForFocus(rect, meta, scene) {
  if (!isRect(rect)) return null;
  rect = rectInScreenshotPixels(rect, meta, scene);
  const padX = rect.width > 520 ? 70 : Math.max(90, Math.min(260, rect.width * 1.8));
  const padY = rect.height > 180 ? 80 : Math.max(110, Math.min(260, rect.height * 4.2));
  const left = clamp(Math.floor(rect.x - padX), 0, meta.width - 2);
  const top = clamp(Math.floor(rect.y - padY), 0, meta.height - 2);
  const right = clamp(Math.ceil(rect.x + rect.width + padX), left + 2, meta.width);
  const bottom = clamp(Math.ceil(rect.y + rect.height + padY), top + 2, meta.height);
  return {
    left,
    top,
    width: right - left,
    height: bottom - top
  };
}

async function buildInset(scene, meta, focus, aspectId, aspect) {
  const crop = cropRectForFocus(scene.focusRect, meta, scene);
  if (!crop || !focus) return null;
  const box = insetPlacement(focus, aspectId, aspect);
  const buffer = await sharp(scene.screenshot)
    .extract(crop)
    .resize({
      width: box.w,
      height: box.h,
      fit: 'cover',
      position: 'center',
      background: '#ffffff'
    })
    .png()
    .toBuffer();
  return { ...box, buffer };
}

async function renderSceneFrame(scene, variant, aspectId, aspect, framePath, phase = 'click') {
  const source = sharp(scene.screenshot);
  const meta = await source.metadata();
  const scale = Math.min(aspect.shotBox.w / meta.width, aspect.shotBox.h / meta.height);
  const imageWidth = Math.round(meta.width * scale);
  const imageHeight = Math.round(meta.height * scale);
  const imagePlacement = {
    x: Math.round(aspect.shotBox.x + (aspect.shotBox.w - imageWidth) / 2),
    y: Math.round(aspect.shotBox.y + (aspect.shotBox.h - imageHeight) / 2),
    width: imageWidth,
    height: imageHeight
  };
  const screenshotBuffer = await source
    .resize({
      width: imageWidth,
      height: imageHeight,
      fit: 'fill'
    })
    .png()
    .toBuffer();

  const focus = scaleRect(scene.focusRect, meta, imagePlacement, scene);
  const inset = await buildInset(scene, meta, focus, aspectId, aspect);

  const actionLines = splitLines(scene.action || scene.subtitle, aspectId === 'vertical' ? 16 : 36);
  const subtitleLines = splitLines(scene.subtitle, aspectId === 'vertical' ? 16 : 40);
  const visibleActionLines = aspectId === 'vertical' ? actionLines.slice(0, 2) : actionLines.slice(0, 1);
  const visibleSubtitleLines = aspectId === 'vertical' ? subtitleLines.slice(0, 3) : subtitleLines.slice(0, 1);
  const stepLabel = `步骤 ${scene.index}/${variant.scenes.length}  ${scene.title}`;
  const emphasis = scene.emphasis || '';
  const caption = aspect.caption;
  const titleBar = aspect.titleBar || { x: aspectId === 'vertical' ? 36 : 42, y: aspectId === 'vertical' ? 34 : 28, w: aspectId === 'vertical' ? 1008 : 940, h: aspectId === 'vertical' ? 88 : 58 };
  const emphasisBar = aspect.emphasisBar || { x: aspectId === 'vertical' ? 36 : 42, y: aspectId === 'vertical' ? 122 : 92, w: aspectId === 'vertical' ? 1008 : 520, h: aspectId === 'vertical' ? 48 : 38 };
  const captionTextX = aspectId === 'horizontal' ? caption.x + caption.w / 2 : caption.x + 26;
  const captionAnchor = aspectId === 'horizontal' ? 'middle' : 'start';

  const baseOverlay = `
  <svg width="${aspect.width}" height="${aspect.height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#f1f5f9"/>
    <rect x="${aspect.shotBox.x}" y="${aspect.shotBox.y}" width="${aspect.shotBox.w}" height="${aspect.shotBox.h}" fill="#ffffff"/>
  </svg>`;

  const topOverlay = `
  <svg width="${aspect.width}" height="${aspect.height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="shadow" x="-40%" y="-40%" width="180%" height="180%">
        <feDropShadow dx="0" dy="8" stdDeviation="5" flood-color="#000000" flood-opacity="0.32"/>
      </filter>
    </defs>
    <rect x="${titleBar.x}" y="${titleBar.y}" width="${titleBar.w}" height="${titleBar.h}" rx="18" fill="rgba(15,23,42,0.88)"/>
    ${svgText([stepLabel], titleBar.x + titleBar.w / 2, titleBar.y + (aspectId === 'vertical' ? 56 : 39), aspect.titleSize, '#ffffff', 800, 1.2, 'middle')}
    ${emphasis ? `<rect x="${emphasisBar.x}" y="${emphasisBar.y}" width="${emphasisBar.w}" height="${emphasisBar.h}" rx="14" fill="rgba(255,255,255,0.94)"/>` : ''}
    ${emphasis ? svgText([emphasis], emphasisBar.x + emphasisBar.w / 2, emphasisBar.y + (aspectId === 'vertical' ? 34 : 27), aspectId === 'vertical' ? 28 : 24, '#ef233c', 800, 1.2, 'middle') : ''}
    ${effectPanelSvg(scene, aspectId, aspect)}
    ${highlightSvg(focus, phase, aspectId)}
    ${cursorSvg(focus, phase, aspectId, aspect)}
    ${inset ? `<rect x="${inset.x - 6}" y="${inset.y - 6}" width="${inset.w + 12}" height="${inset.h + 12}" rx="16" fill="none" stroke="#ff2d2d" stroke-width="${aspectId === 'vertical' ? 7 : 4}"/>` : ''}
    ${inset ? `<rect x="${inset.x + 14}" y="${inset.y + 14}" width="${aspectId === 'vertical' ? 200 : 142}" height="${aspectId === 'vertical' ? 44 : 32}" rx="16" fill="#ff2d2d"/>` : ''}
    ${inset ? svgText(['放大区域'], inset.x + 32, inset.y + (aspectId === 'vertical' ? 45 : 37), aspectId === 'vertical' ? 26 : 20, '#ffffff', 800) : ''}
    <rect x="${caption.x}" y="${caption.y}" width="${caption.w}" height="${caption.h}" rx="22" fill="rgba(15,23,42,0.92)"/>
    ${svgText(visibleActionLines, captionTextX, caption.y + (aspectId === 'vertical' ? 62 : 43), aspectId === 'vertical' ? 34 : 27, '#93c5fd', 700, 1.28, captionAnchor)}
    ${svgText(visibleSubtitleLines, captionTextX, caption.y + (aspectId === 'vertical' ? 150 : 94), aspect.subtitleSize, '#ffffff', 700, 1.28, captionAnchor)}
  </svg>`;

  const composites = [
    { input: Buffer.from(baseOverlay), left: 0, top: 0 },
    { input: screenshotBuffer, left: imagePlacement.x, top: imagePlacement.y }
  ];
  if (inset) {
    composites.push({ input: inset.buffer, left: inset.x, top: inset.y });
  }
  composites.push({ input: Buffer.from(topOverlay), left: 0, top: 0 });

  await sharp({
    create: {
      width: aspect.width,
      height: aspect.height,
      channels: 4,
      background: '#eef2f7'
    }
  })
    .composite(composites)
    .png()
    .toFile(framePath);
}

const aspectEntries = Object.entries(aspectConfigs)
  .filter(([aspectId]) => flags.aspect === 'all' || flags.aspect === aspectId);

for (const variant of scripts.variants) {
  for (const [aspectId, aspect] of aspectEntries) {
    const frameDir = outputPath(flags.outputDir, 'frames', `${variant.style}-${aspectId}`);
    await ensureDir(frameDir);
    const scenes = [];
    for (const scene of variant.scenes) {
      const framePath = path.join(frameDir, `scene-${String(scene.index).padStart(2, '0')}.png`);
      const framePaths = [
        path.join(frameDir, `scene-${String(scene.index).padStart(2, '0')}-approach.png`),
        path.join(frameDir, `scene-${String(scene.index).padStart(2, '0')}-hover.png`),
        framePath
      ];
      await renderSceneFrame(scene, variant, aspectId, aspect, framePaths[0], 'approach');
      await renderSceneFrame(scene, variant, aspectId, aspect, framePaths[1], 'hover');
      await renderSceneFrame(scene, variant, aspectId, aspect, framePaths[2], 'click');
      scenes.push({
        ...scene,
        framePath,
        framePaths,
        audioPath: outputPath(flags.outputDir, 'audio', variant.style, `scene-${String(scene.index).padStart(2, '0')}.m4a`)
      });
    }
    const manifest = {
      createdAt: new Date().toISOString(),
      style: variant.style,
      styleName: variant.styleName,
      aspect: aspectId,
      aspectName: aspect.label,
      width: aspect.width,
      height: aspect.height,
      totalDuration: variant.totalDuration,
      scenes,
      outputVideo: outputPath(flags.outputDir, 'videos', `${variant.style}-${aspectId}.mp4`)
    };
    await writeJson(path.join(manifestDir, `${variant.style}-${aspectId}.json`), manifest);
  }
}

console.log(`manifests=${manifestDir}`);
