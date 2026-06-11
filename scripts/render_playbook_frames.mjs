#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { sharp } from '../lib/sharp-loader.mjs';
import { readAssetManifest } from '../lib/playbook/assets.mjs';
import {
  PLAYBOOK_DEFAULT_OUTPUT_DIR,
  ensurePlaybookWorkspace
} from '../lib/playbook/paths.mjs';
import { estimateDuration, formatSrtTime, splitLines } from '../lib/text-utils.mjs';

const WIDTH = 1920;
const HEIGHT = 1080;
const IMAGE_EXTENSIONS = new Set(['.apng', '.avif', '.gif', '.jpeg', '.jpg', '.png', '.tif', '.tiff', '.webp']);
const VIDEO_EXTENSIONS = new Set(['.m4v', '.mov', '.mp4', '.webm']);
const DELETE_STATUSES = new Set(['delete', 'remove', '删除']);

const layout = {
  leftPanel: { x: 64, y: 84, width: 1088, height: 812 },
  leftImage: { x: 92, y: 126, width: 1032, height: 724 },
  rightPanel: { x: 1192, y: 120, width: 664, height: 760 },
  zoomBox: { x: 1224, y: 650, width: 600, height: 170 }
};

function readFlagValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a path value`);
  }
  return value;
}

function parseArgs(argv) {
  const flags = {
    output: process.env.PLAYBOOK_OUTPUT_DIR || PLAYBOOK_DEFAULT_OUTPUT_DIR
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--output':
        flags.output = path.resolve(readFlagValue(argv, index, arg));
        index += 1;
        break;
      default:
        throw new Error(`unknown arg: ${arg}`);
    }
  }

  flags.output = path.resolve(flags.output);
  return flags;
}

async function readJsonFile(filePath, label) {
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(`missing ${label}: ${filePath}`, { cause: error });
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid ${label}: ${filePath}`, { cause: error });
  }
}

async function readOptionalJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw new Error(`invalid review state: ${filePath}`, { cause: error });
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function visibleText(value, fallback = '') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function truncateText(value, maxChars) {
  const text = visibleText(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1))}…`;
}

function wrapText(value, maxChars, maxLines) {
  const text = visibleText(value);
  if (!text) return [];
  const lines = splitLines(text, maxChars);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = truncateText(kept[maxLines - 1], maxChars);
  return kept;
}

function svgText(lines, x, y, size, color, options = {}) {
  const {
    weight = 700,
    lineHeight = 1.28,
    anchor = 'start',
    opacity = 1
  } = options;
  return lines.map((line, index) => (
    `<text x="${x}" y="${y + index * size * lineHeight}" fill="${color}" fill-opacity="${opacity}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" letter-spacing="0" font-family="PingFang SC, Hiragino Sans GB, Arial, sans-serif">${escapeXml(line)}</text>`
  )).join('\n');
}

function normalizeStatus(value) {
  return String(value ?? '').trim().toLowerCase();
}

function isDeleteStatus(value) {
  const raw = String(value ?? '').trim();
  return DELETE_STATUSES.has(raw) || DELETE_STATUSES.has(raw.toLowerCase());
}

function isTruthyFlag(value) {
  return value === true || value === 'true' || value === '1' || value === 1;
}

function reviewScenesMap(review) {
  const scenes = review?.scenes;
  if (Array.isArray(scenes)) {
    return new Map(scenes
      .filter(scene => scene?.sceneKey)
      .map(scene => [scene.sceneKey, scene]));
  }
  if (scenes && typeof scenes === 'object') {
    return new Map(Object.entries(scenes)
      .filter(([sceneKey, scene]) => sceneKey && scene && typeof scene === 'object')
      .map(([sceneKey, scene]) => [sceneKey, { ...scene, sceneKey: scene.sceneKey || sceneKey }]));
  }
  return new Map();
}

function sceneOrderKeys(sceneOrder) {
  if (Array.isArray(sceneOrder)) {
    return sceneOrder.map(String).filter(Boolean);
  }
  if (sceneOrder && typeof sceneOrder === 'object') {
    const preferredKeys = [
      'playbook-horizontal',
      'playbook',
      'horizontal',
      'ai-image-to-video',
      'nanny'
    ];
    for (const key of preferredKeys) {
      if (Array.isArray(sceneOrder[key])) {
        return sceneOrder[key].map(String).filter(Boolean);
      }
    }
    return Object.values(sceneOrder)
      .flatMap(value => Array.isArray(value) ? value : [])
      .map(String)
      .filter(Boolean);
  }
  return [];
}

function mergeScenes(recipe, review) {
  const reviewMap = reviewScenesMap(review);
  const sceneByKey = new Map();
  const recipeScenes = Array.isArray(recipe?.scenes) ? recipe.scenes : [];

  for (const [position, baseScene] of recipeScenes.entries()) {
    const sceneKey = baseScene.sceneKey || `scene-${String(position + 1).padStart(2, '0')}`;
    const reviewScene = reviewMap.get(sceneKey) || {};
    const selectedAssetId = reviewScene.selectedAssetId || baseScene.selectedAssetId || '';
    sceneByKey.set(sceneKey, {
      ...baseScene,
      ...reviewScene,
      sceneKey,
      selectedAssetId,
      baseIndex: position + 1
    });
  }

  for (const [sceneKey, reviewScene] of reviewMap.entries()) {
    if (sceneByKey.has(sceneKey)) continue;
    sceneByKey.set(sceneKey, {
      title: reviewScene.title || '补充镜头',
      screenText: reviewScene.screenText || reviewScene.subtitle || '',
      voiceover: reviewScene.voiceover || reviewScene.screenText || '',
      duration: reviewScene.duration,
      selectedAssetId: reviewScene.selectedAssetId || '',
      ...reviewScene,
      sceneKey
    });
  }

  const order = sceneOrderKeys(review?.sceneOrder);
  const ordered = order.map(sceneKey => sceneByKey.get(sceneKey)).filter(Boolean);
  const used = new Set(ordered.map(scene => scene.sceneKey));
  const remaining = [...sceneByKey.values()].filter(scene => !used.has(scene.sceneKey));
  return ordered.concat(remaining)
    .filter(scene => !isDeleteStatus(scene.reviewStatus))
    .map((scene, index) => {
      const duration = Number(scene.duration);
      return {
        ...scene,
        index: index + 1,
        duration: Number.isFinite(duration) && duration > 0
          ? Number(duration.toFixed(2))
          : estimateDuration(scene.voiceover || scene.screenText || scene.title || '', 4.5, 9)
      };
    });
}

function resolvePathMaybe(filePath, outputDir) {
  if (!filePath) return '';
  const expanded = String(filePath).replace(/^~/, process.env.HOME || '~');
  return path.isAbsolute(expanded) ? expanded : path.resolve(outputDir, expanded);
}

async function firstExistingPath(candidates, outputDir) {
  for (const candidate of candidates) {
    const resolved = resolvePathMaybe(candidate, outputDir);
    if (!resolved) continue;
    try {
      const stat = await fs.stat(resolved);
      if (stat.isFile()) return resolved;
    } catch {
      // Try the next candidate.
    }
  }
  return '';
}

function isImagePath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return !ext || IMAGE_EXTENSIONS.has(ext);
}

function isVideoPath(filePath) {
  return VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function loadImageSource(filePath) {
  if (!filePath || !isImagePath(filePath) || isVideoPath(filePath)) {
    return null;
  }
  try {
    const metadata = await sharp(filePath).metadata();
    if (!metadata.width || !metadata.height) return null;
    return { filePath, metadata };
  } catch {
    return null;
  }
}

async function assetImageSource(asset, outputDir) {
  if (!asset) return { image: null, reason: '未选择素材' };
  const candidate = await firstExistingPath(
    [asset.sourcePath, asset.targetPath, asset.path, asset.filePath],
    outputDir
  );
  if (!candidate) {
    return { image: null, reason: `素材文件不存在：${asset.id || 'unknown'}` };
  }
  if (isVideoPath(candidate) || !isImagePath(candidate)) {
    return { image: null, reason: `非图片素材：${path.basename(candidate)}` };
  }
  const image = await loadImageSource(candidate);
  if (!image) {
    return { image: null, reason: `图片读取失败：${path.basename(candidate)}` };
  }
  return { image, reason: '' };
}

async function sceneImageSource(scene, assetById, outputDir) {
  const asset = scene.selectedAssetId ? assetById.get(scene.selectedAssetId) : null;
  const source = await assetImageSource(asset, outputDir);
  return {
    ...source,
    asset,
    label: asset
      ? `${asset.title || asset.id || '素材'} / ${asset.type || 'asset'}`
      : '待补截图或生成图'
  };
}

async function zoomImageSource(scene, assetById, outputDir) {
  if (isTruthyFlag(scene.zoomDeleted) || isTruthyFlag(scene.zoomRemoved)) {
    return null;
  }

  const zoomAsset = scene.zoomAssetId ? assetById.get(scene.zoomAssetId) : null;
  if (zoomAsset) {
    const source = await assetImageSource(zoomAsset, outputDir);
    return {
      ...source,
      label: `${zoomAsset.title || zoomAsset.id || '放大图'} / ${zoomAsset.type || 'asset'}`
    };
  }

  const zoomPath = await firstExistingPath([scene.zoomImage], outputDir);
  if (zoomPath) {
    const image = await loadImageSource(zoomPath);
    return {
      image,
      reason: image ? '' : `放大图不可用：${path.basename(zoomPath)}`,
      label: `放大图 / ${path.basename(zoomPath)}`
    };
  }

  if (scene.zoomAssetId || scene.zoomImage) {
    return {
      image: null,
      reason: '放大图文件不存在',
      label: '放大图'
    };
  }

  return null;
}

async function containedImageBuffer(image, box) {
  const buffer = await sharp(image.filePath)
    .rotate()
    .resize({
      width: box.width,
      height: box.height,
      fit: 'inside',
      withoutEnlargement: false
    })
    .png()
    .toBuffer();
  const metadata = await sharp(buffer).metadata();
  return {
    buffer,
    left: Math.round(box.x + (box.width - metadata.width) / 2),
    top: Math.round(box.y + (box.height - metadata.height) / 2),
    width: metadata.width,
    height: metadata.height
  };
}

function backgroundSvg() {
  const { leftPanel, leftImage, rightPanel } = layout;
  return `
  <svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${WIDTH}" height="${HEIGHT}" fill="#f4f5f2"/>
    <path d="M0 0H1920V78H0Z" fill="#ffffff" fill-opacity="0.62"/>
    <path d="M0 1000H1920V1080H0Z" fill="#e9edf0" fill-opacity="0.52"/>
    <circle cx="1760" cy="92" r="138" fill="#d8e8e3" fill-opacity="0.36"/>
    <circle cx="112" cy="980" r="190" fill="#eee7d8" fill-opacity="0.32"/>
    <rect x="${leftPanel.x}" y="${leftPanel.y}" width="${leftPanel.width}" height="${leftPanel.height}" rx="22" fill="#ffffff" stroke="#d9dee6" stroke-width="2"/>
    <rect x="${leftImage.x}" y="${leftImage.y}" width="${leftImage.width}" height="${leftImage.height}" rx="16" fill="#eef1f4"/>
    <rect x="${rightPanel.x}" y="${rightPanel.y}" width="${rightPanel.width}" height="${rightPanel.height}" rx="22" fill="#ffffff" stroke="#d9dee6" stroke-width="2"/>
    <text x="${leftPanel.x + 28}" y="${leftPanel.y + 38}" fill="#5f6b7a" font-size="20" font-weight="650" letter-spacing="0" font-family="PingFang SC, Hiragino Sans GB, Arial, sans-serif">操作画面 / 生成结果</text>
  </svg>`;
}

function placeholderSvg(scene, reason) {
  const { leftImage } = layout;
  const title = wrapText(scene.title || scene.sceneKey, 17, 2);
  const detail = wrapText(reason || '素材暂未导入，先用占位画面继续渲染', 24, 2);
  const centerX = leftImage.x + leftImage.width / 2;
  const centerY = leftImage.y + leftImage.height / 2;
  return `
    <rect x="${leftImage.x + 24}" y="${leftImage.y + 24}" width="${leftImage.width - 48}" height="${leftImage.height - 48}" rx="18" fill="#f7f8fa" stroke="#bdc6d0" stroke-width="3" stroke-dasharray="14 12"/>
    <text x="${centerX}" y="${centerY - 66}" fill="#1f2937" font-size="42" font-weight="760" text-anchor="middle" letter-spacing="0" font-family="PingFang SC, Hiragino Sans GB, Arial, sans-serif">待补素材</text>
    ${svgText(title, centerX, centerY, 30, '#344054', { weight: 700, lineHeight: 1.32, anchor: 'middle' })}
    ${svgText(detail, centerX, centerY + 96, 22, '#667085', { weight: 560, lineHeight: 1.35, anchor: 'middle' })}
  `;
}

function subtitleSvg(scene) {
  const subtitleText = visibleText(scene.subtitle || scene.screenText || scene.voiceover);
  const lines = splitLines(subtitleText, 24).slice(0, 2);
  if (!lines.length) return '';

  const position = scene.subtitlePosition || 'left-bottom';
  const fontSize = lines.join('').length > 30 ? 30 : 34;
  const subtitleHeight = lines.length > 1 ? 106 : 70;
  const maxLineLength = Math.max(...lines.map(line => line.length), 1);
  const width = clamp(Math.round(maxLineLength * fontSize * 0.82 + 96), 420, position === 'center-bottom' || position === 'top' ? 1120 : 880);
  const bottomY = HEIGHT - subtitleHeight - 58;
  let x = layout.leftImage.x + 8;
  let y = bottomY;
  let textX = x + 36;
  let anchor = 'start';

  if (position === 'center-bottom') {
    x = Math.round((WIDTH - width) / 2);
    textX = x + width / 2;
    anchor = 'middle';
  } else if (position === 'right-bottom') {
    x = WIDTH - width - 72;
    textX = x + width - 36;
    anchor = 'end';
  } else if (position === 'top') {
    x = Math.round((WIDTH - width) / 2);
    y = 34;
    textX = x + width / 2;
    anchor = 'middle';
  }

  return `
    <rect x="${x}" y="${y}" width="${width}" height="${subtitleHeight}" rx="18" fill="#111827" fill-opacity="0.78"/>
    ${svgText(lines, textX, y + (lines.length > 1 ? 42 : 45), fontSize, '#ffffff', { weight: 760, lineHeight: 1.25, anchor })}
  `;
}

function rightPanelSvg(scene, assetLabel, zoomSource) {
  const { rightPanel, zoomBox } = layout;
  const titleLines = wrapText(scene.title || scene.sceneKey, 12, 2);
  const result = truncateText(scene.screenText || scene.subtitle || '客户能看懂这一镜的结果', 24);
  const resultSize = result.length > 18 ? 30 : 34;
  const assetLines = wrapText(assetLabel || '待补截图或生成图', 25, 2);
  const zoomText = zoomSource
    ? wrapText(zoomSource.label || zoomSource.reason || '放大图预览', 24, 1)
    : [];

  return `
    <text x="${rightPanel.x + 32}" y="${rightPanel.y + 48}" fill="#0f172a" font-size="22" font-weight="700" letter-spacing="0" font-family="PingFang SC, Hiragino Sans GB, Arial, sans-serif">玩法镜头 ${String(scene.index).padStart(2, '0')}</text>
    ${svgText(titleLines, rightPanel.x + 32, rightPanel.y + 122, 52, '#111827', { weight: 780, lineHeight: 1.16 })}
    <rect x="${rightPanel.x + 32}" y="${rightPanel.y + 264}" width="${rightPanel.width - 64}" height="86" rx="18" fill="#eff8f6"/>
    <text x="${rightPanel.x + 58}" y="${rightPanel.y + 318}" fill="#0f766e" font-size="${resultSize}" font-weight="760" letter-spacing="0" font-family="PingFang SC, Hiragino Sans GB, Arial, sans-serif">${escapeXml(result)}</text>
    <line x1="${rightPanel.x + 32}" y1="${rightPanel.y + 398}" x2="${rightPanel.x + rightPanel.width - 32}" y2="${rightPanel.y + 398}" stroke="#e4e7ec" stroke-width="2"/>
    <text x="${rightPanel.x + 32}" y="${rightPanel.y + 448}" fill="#667085" font-size="22" font-weight="680" letter-spacing="0" font-family="PingFang SC, Hiragino Sans GB, Arial, sans-serif">当前素材</text>
    ${svgText(assetLines, rightPanel.x + 32, rightPanel.y + 486, 25, '#344054', { weight: 650, lineHeight: 1.36 })}
    ${zoomSource ? `<rect x="${zoomBox.x}" y="${zoomBox.y}" width="${zoomBox.width}" height="${zoomBox.height}" rx="16" fill="#f8fafc" stroke="#d0d5dd" stroke-width="2"/>` : ''}
    ${zoomSource ? `<text x="${zoomBox.x}" y="${zoomBox.y - 18}" fill="#667085" font-size="20" font-weight="680" letter-spacing="0" font-family="PingFang SC, Hiragino Sans GB, Arial, sans-serif">放大图 / 可选预览</text>` : ''}
    ${zoomSource && !zoomSource.image ? svgText(wrapText(zoomSource.reason || '放大图不可用', 24, 2), zoomBox.x + zoomBox.width / 2, zoomBox.y + 78, 24, '#667085', { weight: 620, lineHeight: 1.3, anchor: 'middle' }) : ''}
    ${zoomText.length ? svgText(zoomText, zoomBox.x + 18, zoomBox.y + zoomBox.height + 30, 18, '#667085', { weight: 560, lineHeight: 1.25 }) : ''}
  `;
}

function foregroundSvg(scene, source, zoomSource) {
  const { leftImage } = layout;
  return `
  <svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    ${source.image ? '' : placeholderSvg(scene, source.reason)}
    <rect x="${leftImage.x}" y="${leftImage.y}" width="${leftImage.width}" height="${leftImage.height}" rx="16" fill="none" stroke="#cbd5e1" stroke-width="2"/>
    ${rightPanelSvg(scene, source.label, zoomSource)}
    ${subtitleSvg(scene)}
  </svg>`;
}

async function renderScene(scene, assetById, outputDir, framePath) {
  const sceneSource = await sceneImageSource(scene, assetById, outputDir);
  const zoomSource = await zoomImageSource(scene, assetById, outputDir);
  const composites = [
    { input: Buffer.from(backgroundSvg()), left: 0, top: 0 }
  ];

  if (sceneSource.image) {
    const image = await containedImageBuffer(sceneSource.image, layout.leftImage);
    composites.push({ input: image.buffer, left: image.left, top: image.top });
  }

  if (zoomSource?.image) {
    const preview = await containedImageBuffer(zoomSource.image, layout.zoomBox);
    composites.push({ input: preview.buffer, left: preview.left, top: preview.top });
  }

  composites.push({
    input: Buffer.from(foregroundSvg(scene, sceneSource, zoomSource)),
    left: 0,
    top: 0
  });

  await sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
      channels: 4,
      background: '#f4f5f2'
    }
  })
    .composite(composites)
    .png()
    .toFile(framePath);
}

function buildSrt(scenes) {
  let cursor = 0;
  return scenes.map(scene => {
    const start = cursor;
    const end = cursor + scene.duration;
    cursor = end;
    return [
      String(scene.index),
      `${formatSrtTime(start)} --> ${formatSrtTime(end)}`,
      scene.voiceover || scene.screenText || '',
      ''
    ].join('\n');
  }).join('\n');
}

const flags = parseArgs(process.argv.slice(2));
const paths = await ensurePlaybookWorkspace(flags.output);
const recipe = await readJsonFile(paths.recipePath, 'playbook recipe');
const review = await readOptionalJsonFile(paths.reviewPath, { scenes: {}, sceneOrder: [] });
const assetManifest = await readAssetManifest(paths.root);
const assetById = new Map((assetManifest.assets || []).map(asset => [asset.id, asset]));
const scenes = mergeScenes(recipe, review);

if (!scenes.length) {
  throw new Error('no renderable playbook scenes after review filtering');
}

await fs.rm(paths.framesDir, { recursive: true, force: true });
await fs.mkdir(paths.framesDir, { recursive: true });

const renderedScenes = [];
for (const scene of scenes) {
  const framePath = path.join(paths.framesDir, `scene-${String(scene.index).padStart(2, '0')}.png`);
  await renderScene(scene, assetById, paths.root, framePath);
  renderedScenes.push({
    sceneKey: scene.sceneKey,
    index: scene.index,
    title: scene.title || scene.sceneKey,
    screenText: scene.screenText || '',
    voiceover: scene.voiceover || '',
    duration: scene.duration,
    selectedAssetId: scene.selectedAssetId || '',
    reviewStatus: scene.reviewStatus || 'pass',
    subtitlePosition: scene.subtitlePosition || 'left-bottom',
    framePath,
    framePaths: [framePath],
    audioPath: path.join(paths.audioDir, `scene-${String(scene.index).padStart(2, '0')}.m4a`)
  });
}

const totalDuration = Number(renderedScenes.reduce((sum, scene) => sum + scene.duration, 0).toFixed(2));
const manifest = {
  createdAt: new Date().toISOString(),
  playbook: recipe.playbook || 'ai-image-to-video',
  renderer: 'playbook-preview',
  width: WIDTH,
  height: HEIGHT,
  totalDuration,
  scenes: renderedScenes,
  outputVideo: paths.videoPath
};
const manifestPath = path.join(paths.root, 'manifests', 'playbook-horizontal.json');
await writeJson(manifestPath, manifest);

const scriptDir = path.join(paths.root, 'scripts');
await fs.mkdir(scriptDir, { recursive: true });
await fs.writeFile(path.join(scriptDir, 'playbook.srt'), buildSrt(renderedScenes), 'utf8');

console.log(JSON.stringify({
  ok: true,
  outputDir: paths.root,
  framesDir: paths.framesDir,
  manifestPath,
  sceneCount: renderedScenes.length,
  totalDuration
}, null, 2));
