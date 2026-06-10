#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, TARGET_TEST_STORE } from '../lib/config.mjs';
import { ensureDir, outputPath, readJson } from '../lib/fs-utils.mjs';
import { sharp } from '../lib/sharp-loader.mjs';

const flags = parseArgs(process.argv.slice(2));
const scripts = await readJson(outputPath(flags.outputDir, 'scripts', 'tutorial-scripts.json'));
const boardDir = outputPath(flags.outputDir, 'storyboard');
await ensureDir(boardDir);
const zoomDir = path.join(boardDir, 'zooms');
await ensureDir(zoomDir);
const reviewStatePath = path.join(boardDir, 'review-overrides.json');

async function readReviewOverrides() {
  try {
    return JSON.parse(await fs.readFile(reviewStatePath, 'utf8'));
  } catch {
    return { scenes: {}, insertedScenes: [] };
  }
}

const reviewOverrides = await readReviewOverrides();
const boardVariants = scripts.variants.filter(variant => variant.style === 'nanny');

async function pathExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function isImageFile(file) {
  return ['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(file).toLowerCase());
}

function isRejectedSampleImage(file) {
  return /去掉商品品牌|适合批货|铺货转化|分销商家|批货商家/.test(file);
}

async function collectImages(root, prefix, max = 220) {
  const out = [];
  if (!(await pathExists(root))) return out;
  async function walk(dir) {
    if (out.length >= max) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    for (const entry of entries) {
      if (out.length >= max) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && isImageFile(full) && !isRejectedSampleImage(full)) {
        out.push({
          file: full,
          label: `${prefix} / ${path.relative(root, full)}`
        });
      }
    }
  }
  await walk(root);
  return out;
}

async function buildBackgroundOptions() {
  const byFile = new Map();
  const capture = await readJsonIfExists(outputPath(flags.outputDir, 'capture', 'capture.json'), { screenshots: [] });
  for (const shot of capture.screenshots || []) {
    if (!shot.file || byFile.has(shot.file)) continue;
    byFile.set(shot.file, {
      file: shot.file,
      label: `操作截图 / ${shot.title || shot.id || path.basename(shot.file)}`
    });
  }

  const sampleRoot = path.join(path.dirname(flags.outputDir), '样例图');
  for (const item of await collectImages(sampleRoot, '样例图')) {
    if (!byFile.has(item.file)) byFile.set(item.file, item);
  }

  return [...byFile.values()];
}

const backgroundOptions = await buildBackgroundOptions();

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sceneProblem(scene) {
  const id = scene.id;
  const known = {
    'single-shop-entry': `目标测试店必须是「${TARGET_TEST_STORE}」。如果截图里是其他店名，这一镜不能用，先切到测试店再重拍；鼠标放到按钮右下方，不遮挡文字。`,
    'platform-dropdown-open': '必须展示平台下拉展开状态；如果下拉没有露出，标记为需要重拍。',
    shopDropdownOpen: '必须展示店铺下拉展开和勾选框。',
    'shop-dropdown-open': `必须展示店铺下拉展开和「${TARGET_TEST_STORE}」勾选框；看不到目标店就重拍。`,
    settings: '这一镜只做设置区总览，后面要分开讲图片位置、主图1-5和三个设置作用。',
    'position-selected': '要看清 1:1主图、3:4主图、SKU图的勾选状态。',
    'image-slot-dropdown-open': '必须看到“请选择”下拉真正展开，并能看到位置1到位置5。',
    'options-selected': '要讲清 SKU图、保留品牌logo、主图1支持卖点分别有什么作用。',
    'product-list': '焦点框容易框到整张列表；需要只框商品列表首屏区域。',
    'product-selected': '要看到商品行和勾选框，不要只给空白放大区。',
    'before-generate': '鼠标放在按钮右下方，不能遮挡“立即生成”。',
    'generate-confirm': '要完整显示确认弹窗，且只点“确定”，不碰发布/替换类按钮。',
    'after-generate': '当前没有真实生成结果；要作为正式教程，需要重拍真实结果页或换成“生成记录处理中”的异常分镜。'
  };
  return known[id] || '检查红框、鼠标、下拉框和放大区是否和这一步动作一致。';
}

function shotRequirement(scene) {
  const id = scene.id;
  const map = {
    'single-shop-entry': `全屏保留「${TARGET_TEST_STORE}」单店首页。红圈圈“切换至多店管理”，鼠标在按钮右下方。`,
    entry: '左侧栏必须完整露出，红框只框 AI优化商品图入口。',
    'platform-dropdown-open': '平台下拉必须展开，能看到多个平台选项。',
    'shop-dropdown-open': `店铺下拉必须展开，能看到「${TARGET_TEST_STORE}」和勾选框。`,
    'shop-selected': `顶部“已选1个店铺”必须清楚，且确认选择的是「${TARGET_TEST_STORE}」。`,
    settings: '设置区总览，只让客户知道接下来要看图片位置、SKU、logo、卖点。',
    'position-selected': '画面聚焦图片位置区域，能看清 1:1主图、3:4主图、SKU图。',
    'image-slot-dropdown-open': '勾选 1:1主图后，右侧“请选择”下拉展开，能看到位置1到位置5。',
    'options-selected': '画面能看到 SKU图、保留品牌logo、主图1支持卖点。',
    'product-list': '商品列表首屏要清楚，表头和第一行商品都要露出。',
    'product-selected': '第一行商品被勾选，红框只框该商品行。',
    'before-generate': '立即生成按钮要完整可见。',
    'generate-confirm': '确认弹窗要完整可见。',
    'after-generate': '优先拍真实生成后效果；没有就作为异常处理分镜。'
  };
  return map[id] || '画面必须能让客户一眼知道点哪里。';
}

function htmlId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '-');
}

function assetLabel(file, fallbackPrefix) {
  const found = backgroundOptions.find(item => item.file === file);
  return found?.label || `${fallbackPrefix} / ${path.basename(file || '')}`;
}

function backgroundLabel(file) {
  return assetLabel(file, '当前底图');
}

function zoomLabel(file) {
  return file ? assetLabel(file, '当前放大图') : '未选择放大图';
}

function reviewStatusControl(variant, scene) {
  const key = sceneKey(variant, scene);
  const id = htmlId(key);
  const selected = scene.reviewStatus || 'pass';
  function option(value, label) {
    return `<option value="${value}"${selected === value ? ' selected' : ''}>${label}</option>`;
  }
  return `
        <div class="review-strip">
          <label class="review-label" for="review-${id}">批改状态</label>
          <select id="review-${id}" class="review-status" data-field="reviewStatus">
            ${option('pass', '通过')}
            ${option('modify', '需修改')}
            ${option('recapture', '重拍')}
            ${option('remove', '删除')}
            ${option('pending', '待确认')}
          </select>
          <span class="save-hint">自动保存</span>
        </div>
  `;
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
  if (scene.sceneKey) return scene.sceneKey;
  return `${variant.style}-${scene.index}`;
}

function applyReviewOverride(variant, scene) {
  const key = sceneKey(variant, scene);
  const override = reviewOverrides.scenes?.[key] || {};
  return {
    ...scene,
    sceneKey: key,
    action: override.action ?? scene.action,
    subtitle: override.subtitle ?? scene.subtitle,
    voiceover: override.voiceover ?? scene.voiceover,
    screenshot: override.screenshot ?? scene.screenshot,
    focusRect: override.focusRect ?? scene.focusRect,
    devicePixelRatio: override.devicePixelRatio ?? scene.devicePixelRatio,
    sourceDescription: override.sourceDescription ?? scene.sourceDescription,
    zoomImage: override.zoomImage ?? scene.zoomImage,
    zoomDeleted: override.zoomDeleted ?? scene.zoomDeleted ?? false,
    zoomMode: override.zoomMode ?? scene.zoomMode ?? 'full',
    zoomCropPosition: override.zoomCropPosition ?? scene.zoomCropPosition ?? null,
    reviewStatus: override.reviewStatus ?? 'pass',
    reviewNote: override.reviewNote ?? scene.reviewNote ?? '',
    inserted: Boolean(scene.inserted)
  };
}

function insertedScenesFor(variant, scene, position) {
  const existingKeys = new Set(variant.scenes.map(item => sceneKey(variant, item)));
  const key = sceneKey(variant, scene);
  return (reviewOverrides.insertedScenes || [])
    .filter(item => item.style === variant.style)
    .filter(item => position === 'before' ? item.beforeSceneKey === key : item.afterSceneKey === key)
    .filter(item => !existingKeys.has(item.sceneKey))
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
    .map((item, index) => ({
      ...scene,
      ...item,
      inserted: true,
      sourceSceneKey: item.sourceSceneKey || key,
      index: position === 'before' ? `${scene.index}前${index + 1}` : `${scene.index}.${index + 1}`,
      title: item.title || `补充镜头：${scene.title}`,
    action: item.action || shotRequirement(scene),
    subtitle: item.subtitle || scene.subtitle,
    voiceover: item.voiceover || scene.voiceover,
    zoomImage: item.zoomImage || scene.zoomImage,
    zoomDeleted: item.zoomDeleted ?? scene.zoomDeleted ?? false,
    zoomMode: item.zoomMode || scene.zoomMode || 'full',
    zoomCropPosition: item.zoomCropPosition || scene.zoomCropPosition || null,
    reviewNote: item.reviewNote || ''
  }));
}

function scenesForVariant(variant) {
  const out = [];
  for (const scene of variant.scenes) {
    out.push(...insertedScenesFor(variant, scene, 'before'));
    out.push(scene);
    out.push(...insertedScenesFor(variant, scene, 'after'));
  }
  return out;
}

function orderedScenesForVariant(variant) {
  const scenes = scenesForVariant(variant);
  const order = reviewOverrides.sceneOrder?.[variant.style];
  if (!Array.isArray(order) || order.length === 0) return scenes;
  const positions = new Map(order.filter(Boolean).map((key, index) => [String(key), index]));
  return scenes
    .map((scene, index) => ({
      scene,
      index,
      key: sceneKey(variant, scene)
    }))
    .sort((a, b) => {
      const aPosition = positions.has(a.key) ? positions.get(a.key) : Number.MAX_SAFE_INTEGER;
      const bPosition = positions.has(b.key) ? positions.get(b.key) : Number.MAX_SAFE_INTEGER;
      return aPosition - bPosition || a.index - b.index;
    })
    .map(item => item.scene);
}

function needsZoom(scene) {
  return new Set([
    'platform-dropdown-open',
    'shop-dropdown-open',
    'image-slot-dropdown-open'
  ]).has(scene.id);
}

function rectInScreenshotPixels(scene, meta) {
  const rect = scene.focusRect;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const dpr = scene.devicePixelRatio || 1;
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizedCrop(meta, crop) {
  const left = clamp(Math.floor(crop.left), 0, meta.width - 2);
  const top = clamp(Math.floor(crop.top), 0, meta.height - 2);
  const right = clamp(Math.ceil(crop.left + crop.width), left + 2, meta.width);
  const bottom = clamp(Math.ceil(crop.top + crop.height), top + 2, meta.height);
  return { left, top, width: right - left, height: bottom - top };
}

function zoomCropForScene(scene, meta) {
  const rect = rectInScreenshotPixels(scene, meta);
  if (scene.id === 'platform-dropdown-open') {
    return normalizedCrop(meta, {
      left: rect.x - 18,
      top: rect.y - 12,
      width: rect.width + 36,
      height: 310
    });
  }
  if (scene.id === 'shop-dropdown-open') {
    return normalizedCrop(meta, {
      left: rect.x - 230,
      top: rect.y - 120,
      width: rect.width + 260,
      height: 255
    });
  }
  if (scene.id === 'image-slot-dropdown-open') {
    return normalizedCrop(meta, {
      left: rect.x - 20,
      top: rect.y - 14,
      width: rect.width + 36,
      height: 245
    });
  }
  return normalizedCrop(meta, {
    left: rect.x - Math.max(80, rect.width),
    top: rect.y - Math.max(50, rect.height),
    width: rect.width + Math.max(160, rect.width * 2),
    height: rect.height + Math.max(120, rect.height * 4)
  });
}

async function buildZoomImages() {
  const zoomImages = new Map();
  for (const variant of boardVariants) {
    for (const scene of orderedScenesForVariant(variant)) {
      if (!needsZoom(scene) || !isRect(scene.focusRect)) continue;
      const meta = await sharp(scene.screenshot).metadata();
      const crop = zoomCropForScene(scene, meta);
      const key = sceneKey(variant, scene);
      const file = path.join(zoomDir, `${htmlId(key)}-${scene.id}.png`);
      await sharp(scene.screenshot)
        .extract(crop)
        .resize({
          width: 900,
          fit: 'inside',
          kernel: 'lanczos3',
          withoutEnlargement: false
        })
        .sharpen({ sigma: 0.8 })
        .linear(1.08, -5)
        .png()
        .toFile(file);
      zoomImages.set(key, file);
    }
  }
  return zoomImages;
}

const zoomImages = await buildZoomImages();

function mouseOverlay(scene) {
  const hasFocus = isRect(scene.focusRect);
  const rect = hasFocus ? scene.focusRect : { x: 0, y: 0, width: 0, height: 0 };
  return `
          <div
            class="focus-overlay"
            data-has-focus="${hasFocus ? '1' : '0'}"
            data-x="${rect.x}"
            data-y="${rect.y}"
            data-w="${rect.width}"
            data-h="${rect.height}"
            data-dpr="${scene.devicePixelRatio || 1}"
          >
            <div class="target-box"><div class="target-resize-handle" title="拖动缩放红框"></div></div>
            <div class="mouse-marker" aria-label="鼠标">
              <svg viewBox="0 0 74 100" aria-hidden="true">
                <path d="M3 4 L3 78 L24 57 L41 96 L60 87 L43 50 L70 50 Z" fill="#fff" stroke="#101828" stroke-width="5" stroke-linejoin="round"/>
              </svg>
            </div>
          </div>
  `;
}

function frameOverlay(scene) {
  return `
          ${mouseOverlay(scene)}
          <div class="frame-subtitle">${escapeHtml(scene.subtitle || '')}</div>
  `;
}

function rowsForVariant(variant) {
  return orderedScenesForVariant(variant).map(rawScene => {
    const scene = applyReviewOverride(variant, rawScene);
    const key = sceneKey(variant, rawScene);
    const zoomDeleted = Boolean(scene.zoomDeleted);
    const zoomImage = zoomDeleted ? '' : (scene.zoomImage || zoomImages.get(key) || zoomImages.get(scene.sourceSceneKey));
    const zoomMode = scene.zoomMode === 'crop' ? 'crop' : 'full';
    const currentBackgroundLabel = backgroundLabel(scene.screenshot);
    const currentZoomLabel = zoomLabel(zoomImage);
    return `
    <section
      class="scene"
      id="${htmlId(key)}"
      data-scene-key="${escapeHtml(key)}"
      data-scene-id="${escapeHtml(scene.id)}"
      data-style="${escapeHtml(variant.style)}"
      data-index="${escapeHtml(scene.index)}"
      data-title="${escapeHtml(scene.title)}"
      data-inserted="${scene.inserted ? '1' : '0'}"
      data-zoom-crop-position="${escapeHtml(scene.zoomCropPosition ? JSON.stringify(scene.zoomCropPosition) : '')}"
    >
      <div class="shot">
        <div class="shot-frame">
          <img class="background-image" src="${escapeHtml(scene.screenshot)}" alt="${escapeHtml(scene.title)}">
          ${frameOverlay(scene)}
          ${zoomImage ? `<div class="zoom-inset" data-zoom-inset><button type="button" class="zoom-delete-button" title="删除放大图" aria-label="删除放大图">×</button><img src="${escapeHtml(zoomImage)}" alt="${escapeHtml(scene.title)}放大"><div class="zoom-resize-handle" title="拖动缩放放大图"></div></div>` : ''}
        </div>
      </div>
      <div class="meta">
        ${reviewStatusControl(variant, scene)}
        <div class="scene-title-row">
          <h2><span class="scene-number">${escapeHtml(scene.index)}</span>. ${escapeHtml(scene.title)}</h2>
          <div class="scene-actions">
            <button type="button" class="tool-button scene-drag-handle" draggable="true" title="按住上下拖动调整镜头顺序">拖动排序</button>
            <button type="button" class="tool-button overlay-button" data-action="add-target">添加红框</button>
            <button type="button" class="tool-button overlay-button" data-action="add-mouse">添加鼠标</button>
            <button type="button" class="tool-button insert-button" data-action="insert-before">在此前插入一镜</button>
            <button type="button" class="tool-button insert-button" data-action="insert-after">在此后插入一镜</button>
            <button type="button" class="tool-button delete-scene-button" data-action="delete-scene">删除此镜头</button>
          </div>
        </div>
        <label>底图（可选已生成图）</label>
        <div class="background-picker" data-background-picker>
          <input type="hidden" data-field="screenshot" value="${escapeHtml(scene.screenshot || '')}">
          <button type="button" class="background-picker-button" data-action="open-background-picker">
            <img class="background-picker-thumb" src="${escapeHtml(scene.screenshot || '')}" alt="">
            <span class="background-picker-copy">
              <strong>当前底图</strong>
              <span class="background-picker-label">${escapeHtml(currentBackgroundLabel)}</span>
            </span>
            <span class="background-picker-cta">选择截图</span>
          </button>
        </div>
        <label>放大图（可选已生成图）</label>
        <div class="background-picker zoom-picker" data-zoom-picker>
          <input type="hidden" data-field="zoomImage" value="${escapeHtml(zoomImage || '')}">
          <input type="hidden" data-field="zoomMode" value="${escapeHtml(zoomMode)}">
          <button type="button" class="background-picker-button" data-action="open-zoom-picker">
            <img class="background-picker-thumb" src="${escapeHtml(zoomImage || scene.screenshot || '')}" alt="">
            <span class="background-picker-copy">
              <strong>${zoomImage ? '当前放大图' : '未添加放大图'}</strong>
              <span class="background-picker-label">${escapeHtml(currentZoomLabel)}</span>
            </span>
            <span class="background-picker-cta">${zoomImage ? '替换放大图' : '新增放大图'}</span>
          </button>
          <div class="zoom-mode-controls" data-zoom-mode-controls>
            <button type="button" class="zoom-mode-button" data-action="zoom-mode-full" aria-pressed="${zoomMode === 'full' ? 'true' : 'false'}">完整显示</button>
            <button type="button" class="zoom-mode-button" data-action="zoom-mode-crop" aria-pressed="${zoomMode === 'crop' ? 'true' : 'false'}">局部展示</button>
            <span class="zoom-mode-tip">局部模式下，可拖动图内画面微调显示区域</span>
          </div>
        </div>
        <p><b>这一步要拍：</b>${escapeHtml(shotRequirement(scene))}</p>
        <p class="problem"><b>当前问题/检查点：</b>${escapeHtml(sceneProblem(scene))}</p>
        <div class="field-head">
          <label>画面要求（可改）</label>
          <button type="button" class="tool-button recapture-button" data-action="recapture">立即按要求重拍这一镜</button>
        </div>
        <textarea data-field="action">${escapeHtml(scene.action || '')}</textarea>
        <div class="field-head">
          <label>屏幕文字（可改，短句）</label>
          <button type="button" class="tool-button ai-button" data-action="ai-copy">生成客户版台词</button>
        </div>
        <textarea data-field="subtitle">${escapeHtml(scene.subtitle || '')}</textarea>
        <label>口播（可改，短句）</label>
        <textarea data-field="voiceover">${escapeHtml(scene.voiceover || '')}</textarea>
        <label>给AI的改稿意见（可选，不进视频）</label>
        <textarea data-field="reviewNote" placeholder="例如：口播短一点 / 不要说测试店 / 解释这个设置的作用 / 更像客户教程">${escapeHtml(scene.reviewNote || '')}</textarea>
        <div class="scene-message" aria-live="polite"></div>
      </div>
    </section>
  `;
  }).join('\n');
}

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>AI优化商品图教程分镜拍摄脚本</title>
  <style>
    body { margin: 0; background: #f5f7fb; color: #172033; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; }
    header { background: #111827; color: white; padding: 18px 28px; }
    header h1 { margin: 0 0 6px; font-size: 24px; }
    header p { margin: 0; color: #cbd5e1; }
    .build-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 14px; }
    .build-video-button { border: 1px solid #60a5fa; border-radius: 9px; padding: 9px 14px; background: #2563eb; color: #fff; font: inherit; font-weight: 900; cursor: pointer; box-shadow: 0 8px 22px rgba(37, 99, 235, .22); }
    .build-video-button:hover { background: #1d4ed8; }
    .build-video-button:disabled { opacity: .66; cursor: wait; }
    .build-video-status { color: #cbd5e1; font-size: 14px; }
    .build-video-status[data-kind="ok"] { color: #bbf7d0; }
    .build-video-status[data-kind="warn"] { color: #fde68a; }
    .build-video-status[data-kind="error"] { color: #fecaca; }
    .build-open-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .build-open-actions[hidden] { display: none; }
    .build-open-button { border: 1px solid rgba(191, 219, 254, .55); border-radius: 8px; padding: 7px 10px; background: rgba(30, 41, 59, .82); color: #dbeafe; font: inherit; font-size: 13px; font-weight: 800; cursor: pointer; }
    .build-open-button:hover { border-color: #93c5fd; background: rgba(37, 99, 235, .45); color: #fff; }
    .build-open-button:disabled { opacity: .55; cursor: wait; }
    .variant { padding: 26px 28px 8px; }
    .variant h1 { font-size: 22px; margin: 0 0 16px; }
    .scene { position: relative; display: grid; grid-template-columns: minmax(520px, 58vw) 1fr; gap: 18px; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; margin: 0 0 18px; box-shadow: 0 1px 2px rgba(15, 23, 42, .04); }
    .scene-dragging { opacity: .58; transform: scale(.996); box-shadow: 0 18px 46px rgba(15, 23, 42, .18); }
    .scene-drop-before::before,
    .scene-drop-after::after { content: ""; position: absolute; left: 12px; right: 12px; height: 4px; border-radius: 999px; background: #ef4444; box-shadow: 0 0 0 4px rgba(239, 68, 68, .14); }
    .scene-drop-before::before { top: -11px; }
    .scene-drop-after::after { bottom: -11px; }
    .shot-frame { position: relative; overflow: hidden; border: 1px solid #d8dee9; border-radius: 8px; background: #fff; }
    .shot img { display: block; width: 100%; }
    .focus-overlay { position: absolute; inset: 0; pointer-events: none; }
    .target-box { position: absolute; z-index: 2; border: 4px solid #ff2d2d; border-radius: 8px; background: rgba(255, 45, 45, .035); box-shadow: 0 0 0 9999px rgba(15, 23, 42, .025); pointer-events: auto; cursor: grab; }
    .target-resize-handle { position: absolute; right: -10px; bottom: -10px; width: 18px; height: 18px; border: 2px solid #fff; border-radius: 5px; background: #ff2d2d; cursor: nwse-resize; box-shadow: 0 4px 10px rgba(127, 29, 29, .35); }
    .target-resize-handle::before { content: ""; position: absolute; right: 4px; bottom: 4px; width: 6px; height: 6px; border-right: 2px solid #fff; border-bottom: 2px solid #fff; }
    .mouse-marker { position: absolute; z-index: 3; width: 30px; height: 42px; transform: translate(-4px, -3px); filter: drop-shadow(0 4px 6px rgba(15, 23, 42, .25)); pointer-events: auto; cursor: grab; }
    .target-box:active, .mouse-marker:active { cursor: grabbing; }
    .mouse-marker svg { width: 25px; height: 34px; transform: rotate(-13deg); flex: 0 0 auto; }
    .zoom-inset { position: absolute; z-index: 4; right: 18px; top: 18px; width: min(48%, 560px); min-width: 180px; max-width: 86%; max-height: 78%; overflow: hidden; background: #fff; border: 4px solid #ff2d2d; border-radius: 10px; box-shadow: 0 14px 34px rgba(15, 23, 42, .22); pointer-events: auto; cursor: move; touch-action: none; }
    .zoom-inset img { display: block; width: 100%; height: auto; user-select: none; -webkit-user-drag: none; pointer-events: none; }
    .zoom-inset[data-zoom-mode="crop"] { aspect-ratio: 4 / 3; }
    .zoom-inset[data-zoom-mode="crop"] img { width: 100%; height: 100%; object-fit: cover; object-position: var(--zoom-pos-x, 50%) var(--zoom-pos-y, 50%); pointer-events: auto; cursor: grab; }
    .zoom-inset[data-zoom-mode="crop"] img:active { cursor: grabbing; }
    .zoom-delete-button { position: absolute; right: 8px; top: 8px; z-index: 2; width: 26px; height: 26px; border: 0; border-radius: 999px; background: rgba(15,23,42,.76); color: #fff; font-size: 18px; line-height: 24px; font-weight: 900; cursor: pointer; box-shadow: 0 4px 12px rgba(15,23,42,.24); }
    .zoom-delete-button:hover { background: #b42318; }
    .zoom-resize-handle { position: absolute; right: 0; bottom: 0; width: 24px; height: 24px; border-top: 3px solid rgba(255,255,255,.9); border-left: 3px solid rgba(255,255,255,.9); background: rgba(255,45,45,.9); cursor: nwse-resize; box-shadow: 0 0 0 1px rgba(127,29,29,.25) inset; }
    .zoom-resize-handle::before { content: ""; position: absolute; right: 5px; bottom: 5px; width: 8px; height: 8px; border-right: 2px solid #fff; border-bottom: 2px solid #fff; }
    .frame-subtitle { position: absolute; z-index: 5; left: 50%; bottom: 4%; transform: translateX(-50%); max-width: 74%; color: #fff; background: rgba(15, 23, 42, .88); border-radius: 10px; padding: 10px 18px; font-size: clamp(15px, 1.18vw, 24px); line-height: 1.35; font-weight: 800; text-align: center; text-shadow: 0 1px 2px rgba(0,0,0,.5); box-shadow: 0 8px 22px rgba(15,23,42,.22); cursor: grab; pointer-events: auto; touch-action: none; user-select: none; }
    .frame-subtitle:active { cursor: grabbing; }
    .frame-subtitle:empty { display: none; }
    .scene-title-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 0 0 10px; }
    .scene-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .meta h2 { margin: 0; font-size: 20px; }
    .scene-drag-handle { border-color: #c7d2fe; color: #3730a3; background: #eef2ff; cursor: grab; }
    .scene-drag-handle:hover { border-color: #818cf8; background: #e0e7ff; }
    .scene-drag-handle:active { cursor: grabbing; }
    .meta p { margin: 8px 0; line-height: 1.55; }
    .problem { color: #b42318; background: #fff5f5; border: 1px solid #fecaca; border-radius: 8px; padding: 8px 10px; }
    .review-strip { display: flex; align-items: center; gap: 10px; margin: 0 0 12px; padding: 10px 12px; border-radius: 8px; background: #ecfdf3; border: 1px solid #bbf7d0; }
    .review-label { margin: 0; font-weight: 800; color: #14532d; }
    .review-status { height: 34px; border: 1px solid #86efac; border-radius: 7px; padding: 0 36px 0 10px; background: white; color: #14532d; font: inherit; font-weight: 700; }
    .save-hint { margin-left: auto; color: #64748b; font-size: 13px; }
    .field-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 12px 0 6px; }
    .field-head label { margin: 0; }
    .tool-button { border: 1px solid #cbd5e1; background: #fff; color: #1f2937; border-radius: 7px; padding: 7px 10px; font: inherit; font-weight: 800; cursor: pointer; white-space: nowrap; }
    .tool-button:hover { border-color: #94a3b8; background: #f8fafc; }
    .tool-button:disabled { opacity: .55; cursor: wait; }
    .recapture-button { border-color: #fecaca; color: #b42318; background: #fff5f5; }
    .recapture-button:hover { border-color: #f87171; background: #fee2e2; }
    .ai-button { border-color: #bfdbfe; color: #1d4ed8; background: #eff6ff; }
    .ai-button:hover { border-color: #60a5fa; background: #dbeafe; }
    .overlay-button { border-color: #fecaca; color: #b42318; background: #fff7f7; }
    .overlay-button:hover { border-color: #fb7185; background: #ffe4e6; }
    .insert-button { border-color: #bbf7d0; color: #166534; background: #f0fdf4; }
    .insert-button:hover { border-color: #4ade80; background: #dcfce7; }
    .delete-scene-button { border-color: #fecaca; color: #991b1b; background: #fff5f5; }
    .delete-scene-button:hover { border-color: #f87171; background: #fee2e2; }
    .scene[data-inserted="1"] { border-color: #bbf7d0; background: #fbfffd; }
    .scene-message { display: none; margin-top: 10px; padding: 9px 10px; border-radius: 8px; font-size: 13px; line-height: 1.45; }
    .scene-message[data-kind="ok"] { display: block; color: #14532d; background: #ecfdf3; border: 1px solid #bbf7d0; }
    .scene-message[data-kind="warn"] { display: block; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; }
    .scene-message[data-kind="error"] { display: block; color: #991b1b; background: #fff5f5; border: 1px solid #fecaca; }
    .scene[data-review-status="modify"] .review-strip { background: #fff7ed; border-color: #fed7aa; }
    .scene[data-review-status="modify"] .review-label,
    .scene[data-review-status="modify"] .review-status { color: #9a3412; border-color: #fdba74; }
    .scene[data-review-status="recapture"] .review-strip { background: #fff5f5; border-color: #fecaca; }
    .scene[data-review-status="recapture"] .review-label,
    .scene[data-review-status="recapture"] .review-status { color: #991b1b; border-color: #fca5a5; }
    .scene[data-review-status="remove"] { opacity: .68; }
    .scene[data-review-status="remove"] .shot-frame::after { content: "此镜头已标记删除，出片会跳过"; position: absolute; inset: 0; z-index: 7; display: grid; place-items: center; background: rgba(248, 250, 252, .76); color: #334155; font-size: 24px; font-weight: 900; letter-spacing: 0; }
    .scene[data-review-status="remove"] .review-strip { background: #f8fafc; border-color: #cbd5e1; }
    .scene[data-review-status="remove"] .review-label,
    .scene[data-review-status="remove"] .review-status { color: #475569; border-color: #cbd5e1; }
    .scene[data-review-status="pending"] .review-strip { background: #eff6ff; border-color: #bfdbfe; }
    .scene[data-review-status="pending"] .review-label,
    .scene[data-review-status="pending"] .review-status { color: #1d4ed8; border-color: #93c5fd; }
    label { display: block; margin: 12px 0 6px; font-weight: 700; color: #334155; }
    .background-picker { margin-bottom: 10px; }
    .background-picker-button { width: 100%; min-height: 74px; display: grid; grid-template-columns: 112px minmax(0, 1fr) auto; gap: 12px; align-items: center; text-align: left; border: 1px solid #cbd5e1; border-radius: 10px; padding: 9px; background: #fff; color: #172033; font: inherit; cursor: pointer; }
    .background-picker-button:hover { border-color: #60a5fa; background: #f8fbff; }
    .background-picker-thumb { width: 112px; height: 56px; object-fit: cover; border-radius: 7px; border: 1px solid #e2e8f0; background: #f8fafc; }
    .background-picker-copy { min-width: 0; display: grid; gap: 4px; }
    .background-picker-copy strong { font-size: 14px; color: #0f172a; }
    .background-picker-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: #64748b; }
    .background-picker-cta { padding: 7px 10px; border-radius: 8px; background: #eff6ff; color: #1d4ed8; font-size: 13px; font-weight: 900; }
    .zoom-mode-controls { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; margin-top: 8px; }
    .zoom-mode-button { border: 1px solid #cbd5e1; border-radius: 999px; padding: 6px 10px; background: #fff; color: #334155; font: inherit; font-size: 12px; font-weight: 900; cursor: pointer; }
    .zoom-mode-button:hover { border-color: #60a5fa; background: #eff6ff; color: #1d4ed8; }
    .zoom-mode-button[aria-pressed="true"] { border-color: #ef4444; background: #ef4444; color: #fff; }
    .zoom-mode-tip { color: #64748b; font-size: 12px; line-height: 1.4; }
    .background-modal[hidden] { display: none !important; }
    .background-modal { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(15, 23, 42, .58); }
    .background-modal-panel { width: min(1180px, 94vw); max-height: 88vh; display: grid; grid-template-rows: auto auto auto minmax(0, 1fr); gap: 12px; border-radius: 14px; background: #fff; box-shadow: 0 24px 80px rgba(15, 23, 42, .32); padding: 16px; }
    .background-modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    .background-modal-head h2 { margin: 0; font-size: 20px; color: #0f172a; }
    .background-modal-head p { margin: 4px 0 0; color: #64748b; }
    .background-modal-close { width: 34px; height: 34px; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; font-size: 24px; line-height: 1; cursor: pointer; }
    .background-search { width: 100%; height: 40px; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 10px; padding: 0 12px; font: inherit; }
    .background-filter-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .background-filter-chip { border: 1px solid #cbd5e1; border-radius: 999px; padding: 7px 12px; background: #fff; color: #334155; font: inherit; font-size: 13px; font-weight: 800; cursor: pointer; }
    .background-filter-chip:hover { border-color: #60a5fa; background: #eff6ff; color: #1d4ed8; }
    .background-filter-chip[aria-pressed="true"] { border-color: #ef4444; background: #ef4444; color: #fff; }
    .background-grid { overflow: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(172px, 1fr)); gap: 12px; padding: 2px 2px 8px; }
    .background-option { min-height: 150px; display: grid; grid-template-rows: 102px auto; gap: 8px; border: 2px solid transparent; border-radius: 10px; padding: 8px; background: #f8fafc; cursor: pointer; text-align: left; font: inherit; }
    .background-option:hover { border-color: #93c5fd; background: #eff6ff; }
    .background-option[aria-selected="true"] { border-color: #ef4444; background: #fff7f7; }
    .background-option img { width: 100%; height: 102px; object-fit: cover; border-radius: 7px; background: #fff; border: 1px solid #e2e8f0; }
    .background-option span { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: #334155; font-size: 12px; line-height: 1.35; word-break: break-all; }
    .background-empty { padding: 30px; text-align: center; color: #64748b; border: 1px dashed #cbd5e1; border-radius: 10px; }
    textarea { width: 100%; min-height: 54px; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 8px; padding: 9px 10px; font: inherit; resize: vertical; }
    @media (max-width: 1100px) { .scene { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <h1>AI优化商品图教程分镜拍摄脚本</h1>
    <p>目标测试店：${escapeHtml(TARGET_TEST_STORE)}。先审每一镜：画面是否拍对、下拉是否展开、鼠标是否挡字、放大区是否必要。通过后再重拍/合成。</p>
    <div class="build-toolbar">
      <button type="button" class="build-video-button" data-build-video-button>一键生成保姆版横屏视频</button>
      <span class="build-video-status" data-build-video-status>改完分镜后点这里，生成 videos/nanny-horizontal-storyboard.mp4。</span>
      <div class="build-open-actions" data-build-open-actions hidden>
        <button type="button" class="build-open-button" data-open-build-target="video" data-open-build-action="open">打开视频</button>
        <button type="button" class="build-open-button" data-open-build-target="video" data-open-build-action="reveal">访达定位</button>
        <button type="button" class="build-open-button" data-open-build-target="video-folder" data-open-build-action="open">打开视频文件夹</button>
      </div>
    </div>
  </header>
  ${boardVariants.map(variant => `
    <main class="variant" data-style="${escapeHtml(variant.style)}">
      <h1>${escapeHtml(variant.styleName)}（${variant.style}，约 ${variant.totalDuration}s）</h1>
      ${rowsForVariant(variant)}
    </main>
  `).join('\n')}
  <div class="background-modal" data-background-modal hidden>
    <div class="background-modal-panel">
      <div class="background-modal-head">
        <div>
          <h2 data-background-modal-title>选择底图</h2>
          <p data-background-modal-copy>点缩略图即可替换当前镜头底图。</p>
        </div>
        <button type="button" class="background-modal-close" data-background-close aria-label="关闭">×</button>
      </div>
      <input class="background-search" data-background-search placeholder="搜索：操作截图、生成结果、主图、SKU、文件名">
      <div class="background-filter-bar" data-background-filters aria-label="底图类型筛选">
        <button type="button" class="background-filter-chip" data-background-filter="all" aria-pressed="true">全部</button>
        <button type="button" class="background-filter-chip" data-background-filter="capture" aria-pressed="false">操作截图</button>
        <button type="button" class="background-filter-chip" data-background-filter="result" aria-pressed="false">生成结果</button>
        <button type="button" class="background-filter-chip" data-background-filter="feature" aria-pressed="false">功能点图</button>
        <button type="button" class="background-filter-chip" data-background-filter="main1" aria-pressed="false">1:1主图</button>
        <button type="button" class="background-filter-chip" data-background-filter="main34" aria-pressed="false">3:4主图</button>
        <button type="button" class="background-filter-chip" data-background-filter="sku" aria-pressed="false">SKU图</button>
        <button type="button" class="background-filter-chip" data-background-filter="fashion" aria-pressed="false">女装</button>
        <button type="button" class="background-filter-chip" data-background-filter="shoes" aria-pressed="false">鞋类</button>
      </div>
      <div class="background-grid" data-background-grid></div>
    </div>
  </div>
  <script>
    (() => {
      const storagePrefix = 'shooting-board:' + location.pathname + ':';
      const apiBase = location.protocol === 'file:' ? 'http://127.0.0.1:3829' : '';
      const backgroundOptions = ${JSON.stringify(backgroundOptions)};
      function storageKey(scene, field) {
        return storagePrefix + (scene.dataset.sceneKey || scene.id) + ':' + field;
      }
      function orderStorageKey(style) {
        return storagePrefix + 'sceneOrder:' + style;
      }
      function legacyStorageKey(scene, field) {
        return storagePrefix + (scene.dataset.sceneId || scene.id) + ':' + field;
      }
      function setSceneStatus(scene, value) {
        scene.dataset.reviewStatus = value || 'pass';
      }
      function percent(value) {
        return Number(String(value || '').replace('%', '')) || 0;
      }
      function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
      }
      const backgroundModal = document.querySelector('[data-background-modal]');
      const backgroundGrid = document.querySelector('[data-background-grid]');
      const backgroundSearch = document.querySelector('[data-background-search]');
      const backgroundModalTitle = document.querySelector('[data-background-modal-title]');
      const backgroundModalCopy = document.querySelector('[data-background-modal-copy]');
      const backgroundFilterButtons = Array.from(document.querySelectorAll('[data-background-filter]'));
      let activeBackgroundScene = null;
      let activePickerField = 'screenshot';
      let activeBackgroundFilter = 'all';
      function backgroundOptionFor(file) {
        return backgroundOptions.find(item => item.file === file) || {
          file,
          label: (activePickerField === 'zoomImage' ? '当前放大图 / ' : '当前底图 / ') + String(file || '').split('/').pop()
        };
      }
      function backgroundListForActiveScene() {
        const current = activeBackgroundScene ? fieldValue(activeBackgroundScene, activePickerField) : '';
        if (current && !backgroundOptions.some(item => item.file === current)) {
          return [backgroundOptionFor(current), ...backgroundOptions];
        }
        return backgroundOptions;
      }
      function backgroundSearchText(item) {
        return (String(item.label || '') + ' ' + String(item.file || '')).toLowerCase();
      }
      function matchesBackgroundFilter(item) {
        const text = backgroundSearchText(item);
        if (activeBackgroundFilter === 'capture') return text.includes('操作截图');
        if (activeBackgroundFilter === 'result') return /生成结果|确认生成|查看生成|generated-result|after-generate|publish|跳过/.test(text);
        if (activeBackgroundFilter === 'feature') return /功能点|对比|卖点|品牌|logo|sku图优化|ai显式|内嵌前后|点击率|转化/.test(text);
        if (activeBackgroundFilter === 'main1') return /1:1|1：1|1比1|1-1|主图1/.test(text);
        if (activeBackgroundFilter === 'main34') return /3:4|3：4|3比4|3-4/.test(text);
        if (activeBackgroundFilter === 'sku') return /sku/.test(text);
        if (activeBackgroundFilter === 'fashion') return /女装|polo|t恤|连衣裙|外套|毛衣|衬衫|裤|裙|上衣|服饰|针织/.test(text);
        if (activeBackgroundFilter === 'shoes') return /鞋|凉拖|德训鞋|跆拳道鞋|板鞋|凉鞋|运动鞋/.test(text);
        return true;
      }
      function updateBackgroundFilterButtons() {
        for (const button of backgroundFilterButtons) {
          button.setAttribute('aria-pressed', button.dataset.backgroundFilter === activeBackgroundFilter ? 'true' : 'false');
        }
      }
      function updateBackgroundPicker(scene) {
        const picker = scene.querySelector('[data-background-picker]');
        if (!picker) return;
        const value = fieldValue(scene, 'screenshot');
        const option = backgroundOptionFor(value);
        const thumb = picker.querySelector('.background-picker-thumb');
        const label = picker.querySelector('.background-picker-label');
        if (thumb && value) thumb.src = value;
        if (label) label.textContent = option.label || value || '未选择底图';
      }
      function updateZoomPicker(scene) {
        const picker = scene.querySelector('[data-zoom-picker]');
        if (!picker) return;
        const value = fieldValue(scene, 'zoomImage');
        const option = backgroundOptions.find(item => item.file === value);
        const thumb = picker.querySelector('.background-picker-thumb');
        const label = picker.querySelector('.background-picker-label');
        const title = picker.querySelector('.background-picker-copy strong');
        const cta = picker.querySelector('.background-picker-cta');
        if (thumb) thumb.src = value || fieldValue(scene, 'screenshot') || '';
        if (label) label.textContent = value ? (option?.label || ('当前放大图 / ' + String(value).split('/').pop())) : '未选择放大图';
        if (title) title.textContent = value ? '当前放大图' : '未添加放大图';
        if (cta) cta.textContent = value ? '替换放大图' : '新增放大图';
      }
      function zoomCropPosition(scene) {
        const saved = readSavedPosition(scene, 'zoomCropPosition');
        if (saved) return saved;
        try {
          const embedded = JSON.parse(scene.dataset.zoomCropPosition || 'null');
          if (embedded) return embedded;
        } catch {
          // Fall through to centered crop.
        }
        return { x: 50, y: 50 };
      }
      function applyZoomCropPosition(scene) {
        const zoom = scene.querySelector('[data-zoom-inset]');
        if (!zoom) return;
        const pos = zoomCropPosition(scene);
        zoom.style.setProperty('--zoom-pos-x', clamp(pos.x ?? 50, 0, 100) + '%');
        zoom.style.setProperty('--zoom-pos-y', clamp(pos.y ?? 50, 0, 100) + '%');
      }
      function updateZoomModeControls(scene) {
        const mode = fieldValue(scene, 'zoomMode') === 'crop' ? 'crop' : 'full';
        const zoom = scene.querySelector('[data-zoom-inset]');
        if (zoom) {
          zoom.dataset.zoomMode = mode;
          applyZoomCropPosition(scene);
          placeZoomInset(scene);
        }
        for (const button of scene.querySelectorAll('.zoom-mode-button')) {
          const pressed = button.dataset.action === (mode === 'crop' ? 'zoom-mode-crop' : 'zoom-mode-full');
          button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
        }
      }
      function closeBackgroundPicker() {
        if (backgroundModal) backgroundModal.hidden = true;
        activeBackgroundScene = null;
        activePickerField = 'screenshot';
      }
      function renderBackgroundOptions() {
        if (!backgroundGrid || !activeBackgroundScene) return;
        const query = (backgroundSearch?.value || '').trim().toLowerCase();
        const selected = fieldValue(activeBackgroundScene, activePickerField);
        const options = backgroundListForActiveScene()
          .filter(item => matchesBackgroundFilter(item))
          .filter(item => {
            if (!query) return true;
            return backgroundSearchText(item).includes(query);
          });
        backgroundGrid.innerHTML = '';
        if (!options.length) {
          const empty = document.createElement('div');
          empty.className = 'background-empty';
          empty.textContent = '没找到匹配的截图或样例图';
          backgroundGrid.appendChild(empty);
          return;
        }
        for (const item of options.slice(0, 260)) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'background-option';
          button.setAttribute('aria-selected', item.file === selected ? 'true' : 'false');
          const img = document.createElement('img');
          img.loading = 'lazy';
          img.src = item.file;
          img.alt = item.label || '';
          const label = document.createElement('span');
          label.textContent = item.label || item.file;
          button.append(img, label);
          button.addEventListener('click', () => {
            setFieldValue(activeBackgroundScene, activePickerField, item.file);
            saveSceneToServer(activeBackgroundScene);
            closeBackgroundPicker();
          });
          backgroundGrid.appendChild(button);
        }
      }
      function openAssetPicker(scene, field) {
        activeBackgroundScene = scene;
        activePickerField = field || 'screenshot';
        if (!backgroundModal) return;
        if (backgroundModalTitle) {
          backgroundModalTitle.textContent = activePickerField === 'zoomImage' ? '选择放大图' : '选择底图';
        }
        if (backgroundModalCopy) {
          backgroundModalCopy.textContent = activePickerField === 'zoomImage'
            ? '点缩略图即可新增或替换当前镜头放大图。'
            : '点缩略图即可替换当前镜头底图。';
        }
        backgroundModal.hidden = false;
        if (backgroundSearch) backgroundSearch.value = '';
        activeBackgroundFilter = 'all';
        updateBackgroundFilterButtons();
        renderBackgroundOptions();
        setTimeout(() => backgroundSearch?.focus(), 0);
      }
      function openBackgroundPicker(scene) {
        openAssetPicker(scene, 'screenshot');
      }
      function openZoomPicker(scene) {
        openAssetPicker(scene, 'zoomImage');
      }
      function readSavedPosition(scene, field) {
        try {
          return JSON.parse(localStorage.getItem(storageKey(scene, field)) || 'null');
        } catch {
          return null;
        }
      }
      function savePosition(scene, field, value) {
        localStorage.setItem(storageKey(scene, field), JSON.stringify(value));
      }
      function setBoxPercent(el, box) {
        el.style.left = box.left + '%';
        el.style.top = box.top + '%';
        if (Number.isFinite(box.width)) el.style.width = box.width + '%';
        if (Number.isFinite(box.height)) el.style.height = box.height + '%';
      }
      function setZoomPercent(el, box) {
        el.style.right = 'auto';
        el.style.left = box.left + '%';
        el.style.top = box.top + '%';
        if (Number.isFinite(box.width)) el.style.width = box.width + '%';
      }
      function subtitleBoxFromDom(frame, subtitle) {
        const frameRect = frame.getBoundingClientRect();
        const subtitleRect = subtitle.getBoundingClientRect();
        return {
          left: (subtitleRect.left - frameRect.left) / frameRect.width * 100,
          top: (subtitleRect.top - frameRect.top) / frameRect.height * 100,
          width: subtitleRect.width / frameRect.width * 100,
          height: subtitleRect.height / frameRect.height * 100
        };
      }
      function clampSubtitleBox(frame, subtitle, box) {
        const frameRect = frame.getBoundingClientRect();
        const current = subtitleBoxFromDom(frame, subtitle);
        const width = clamp(Number.isFinite(box.width) ? box.width : current.width, 4, 82);
        const height = clamp(Number.isFinite(box.height) ? box.height : current.height, 3, 30);
        return {
          left: clamp(box.left, 0, Math.max(0, 100 - width)),
          top: clamp(box.top, 0, Math.max(0, 100 - height)),
          width,
          height,
          frameWidth: frameRect.width,
          frameHeight: frameRect.height
        };
      }
      function setSubtitlePercent(el, box) {
        el.style.left = box.left + '%';
        el.style.top = box.top + '%';
        el.style.bottom = 'auto';
        el.style.transform = 'none';
      }
      function placeSubtitle(scene) {
        const frame = scene.querySelector('.shot-frame');
        const subtitle = scene.querySelector('.frame-subtitle');
        const saved = readSavedPosition(scene, 'subtitleBox');
        if (!frame || !subtitle || !saved) return;
        setSubtitlePercent(subtitle, clampSubtitleBox(frame, subtitle, saved));
      }
      function defaultMarkerFromBox(box) {
        return {
          left: clamp(box.left + box.width + Math.max(2.5, Math.min(8, box.width * .18)), 1, 94),
          top: clamp(box.top + box.height + Math.max(2, Math.min(7, box.height * .48)), 2, 92)
        };
      }
      function clampTargetBox(box) {
        const width = clamp(Number.isFinite(box.width) ? box.width : 8, 1.5, 96);
        const height = clamp(Number.isFinite(box.height) ? box.height : 8, 1.5, 96);
        return {
          left: clamp(box.left, 0, Math.max(0, 100 - width)),
          top: clamp(box.top, 0, Math.max(0, 100 - height)),
          width,
          height
        };
      }
      function placeMouseOverlay(frame) {
        const scene = frame.closest('.scene');
        const img = frame.querySelector('.background-image');
        const overlay = frame.querySelector('.focus-overlay');
        const target = frame.querySelector('.target-box');
        const marker = frame.querySelector('.mouse-marker');
        if (!scene || !img || !overlay || !target || !marker || !img.naturalWidth || !img.naturalHeight) return;
        const hasFocus = overlay.dataset.hasFocus === '1';
        const savedTarget = readSavedPosition(scene, 'targetBox');
        const savedMarker = readSavedPosition(scene, 'mouseMarker');
        if (!hasFocus && !savedTarget) {
          target.style.display = 'none';
        }
        if (!hasFocus && !savedMarker) {
          marker.style.display = 'none';
        }
        const raw = {
          x: Number(overlay.dataset.x),
          y: Number(overlay.dataset.y),
          w: Number(overlay.dataset.w),
          h: Number(overlay.dataset.h),
          dpr: Number(overlay.dataset.dpr || 1)
        };
        const rawRight = raw.x + raw.w;
        const rawBottom = raw.y + raw.h;
        const shouldApplyDpr = raw.dpr > 1 &&
          rawRight * raw.dpr <= img.naturalWidth + 4 &&
          rawBottom * raw.dpr <= img.naturalHeight + 4;
        const scale = shouldApplyDpr ? raw.dpr : 1;
        const rect = {
          x: raw.x * scale,
          y: raw.y * scale,
          w: raw.w * scale,
          h: raw.h * scale
        };
        const rawX = clamp(rect.x, 0, img.naturalWidth);
        const rawY = clamp(rect.y, 0, img.naturalHeight);
        const rawW = clamp(rect.w, 8, img.naturalWidth - rawX);
        const rawH = clamp(rect.h, 8, img.naturalHeight - rawY);
        const padX = clamp(rawW * .28, 24, 82);
        const padY = clamp(rawH * .9, 16, 58);
        const x = clamp(rawX - padX, 0, img.naturalWidth);
        const y = clamp(rawY - padY, 0, img.naturalHeight);
        const right = clamp(rawX + rawW + padX, x + 8, img.naturalWidth);
        const bottom = clamp(rawY + rawH + padY, y + 8, img.naturalHeight);
        const w = right - x;
        const h = bottom - y;
        const defaultBox = {
          left: x / img.naturalWidth * 100,
          top: y / img.naturalHeight * 100,
          width: w / img.naturalWidth * 100,
          height: h / img.naturalHeight * 100
        };
        const targetBox = clampTargetBox(savedTarget || defaultBox);
        if (hasFocus || savedTarget) {
          target.style.display = '';
          setBoxPercent(target, targetBox);
        }
        const markerPosition = savedMarker || defaultMarkerFromBox(targetBox);
        if (hasFocus || savedMarker) {
          marker.style.display = '';
          setBoxPercent(marker, markerPosition);
        }
      }
      function updateSubtitle(scene) {
        const text = scene.querySelector('[data-field="subtitle"]')?.value || '';
        const subtitle = scene.querySelector('.frame-subtitle');
        if (subtitle) {
          subtitle.textContent = text;
          placeSubtitle(scene);
        }
      }
      function fieldValue(scene, field) {
        return scene.querySelector('[data-field="' + field + '"]')?.value || '';
      }
      function setFieldValue(scene, field, value) {
        const el = scene.querySelector('[data-field="' + field + '"]');
        if (!el) return;
        el.value = value || '';
        localStorage.setItem(storageKey(scene, field), el.value);
        if (field === 'subtitle') updateSubtitle(scene);
        if (field === 'screenshot') {
          updateBackground(scene);
          updateBackgroundPicker(scene);
        }
        if (field === 'zoomImage') {
          localStorage.removeItem(storageKey(scene, 'zoomDeleted'));
          localStorage.removeItem(storageKey(scene, 'zoomHidden'));
          updateZoomInset(scene);
          updateZoomPicker(scene);
        }
        if (field === 'zoomMode') {
          el.value = el.value === 'crop' ? 'crop' : 'full';
          localStorage.setItem(storageKey(scene, field), el.value);
          updateZoomModeControls(scene);
        }
      }
      function updateBackground(scene) {
        const value = fieldValue(scene, 'screenshot');
        const frame = scene.querySelector('.shot-frame');
        const img = frame?.querySelector('.background-image');
        if (!value || !img) return;
        if (img.getAttribute('src') === value) {
          placeMouseOverlay(frame);
          return;
        }
        img.addEventListener('load', () => placeMouseOverlay(frame), { once: true });
        img.src = value;
      }
      function createZoomInset(scene) {
        const frame = scene.querySelector('.shot-frame');
        if (!frame) return null;
        const zoom = document.createElement('div');
        zoom.className = 'zoom-inset';
        zoom.setAttribute('data-zoom-inset', '');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'zoom-delete-button';
        button.title = '删除放大图';
        button.setAttribute('aria-label', '删除放大图');
        button.textContent = '×';
        const img = document.createElement('img');
        img.alt = (scene.dataset.title || '') + '放大';
        const handle = document.createElement('div');
        handle.className = 'zoom-resize-handle';
        handle.title = '拖动缩放放大图';
        zoom.append(button, img, handle);
        frame.appendChild(zoom);
        attachZoom(scene);
        return zoom;
      }
      function updateZoomInset(scene) {
        const value = fieldValue(scene, 'zoomImage');
        let zoom = scene.querySelector('[data-zoom-inset]');
        if (!value) return;
        if (!zoom) zoom = createZoomInset(scene);
        const img = zoom?.querySelector('img');
        if (!img) return;
        const place = () => placeZoomInset(scene);
        updateZoomModeControls(scene);
        if (img.getAttribute('src') === value) {
          place();
          return;
        }
        img.addEventListener('load', place, { once: true });
        img.src = value;
      }
      function scenePayload(scene) {
        return {
          sceneKey: scene.dataset.sceneKey,
          sceneId: scene.dataset.sceneId,
          style: scene.dataset.style,
          index: Number(scene.dataset.index || 0),
          title: scene.dataset.title,
          reviewStatus: fieldValue(scene, 'reviewStatus') || 'pass',
          action: fieldValue(scene, 'action'),
          subtitle: fieldValue(scene, 'subtitle'),
          voiceover: fieldValue(scene, 'voiceover'),
          reviewNote: fieldValue(scene, 'reviewNote'),
          screenshot: fieldValue(scene, 'screenshot'),
          zoomImage: fieldValue(scene, 'zoomImage'),
          zoomMode: fieldValue(scene, 'zoomMode') === 'crop' ? 'crop' : 'full',
          zoomCropPosition: readSavedPosition(scene, 'zoomCropPosition'),
          zoomDeleted:
            localStorage.getItem(storageKey(scene, 'zoomDeleted')) === '1' ||
            localStorage.getItem(storageKey(scene, 'zoomHidden')) === '1'
        };
      }
      function setMessage(scene, kind, text) {
        const el = scene.querySelector('.scene-message');
        if (!el) return;
        el.dataset.kind = kind || '';
        el.textContent = text || '';
      }
      async function postJson(path, body) {
        const response = await fetch(apiBase + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const text = await response.text();
        let data = {};
        try { data = text ? JSON.parse(text) : {}; }
        catch { data = { message: text }; }
        if (!response.ok) throw new Error(data.error || data.message || ('HTTP ' + response.status));
        return data;
      }
      async function getJson(path) {
        const response = await fetch(apiBase + path);
        const text = await response.text();
        let data = {};
        try { data = text ? JSON.parse(text) : {}; }
        catch { data = { message: text }; }
        if (!response.ok) throw new Error(data.error || data.message || ('HTTP ' + response.status));
        return data;
      }
      async function saveSceneToServer(scene) {
        try {
          await postJson('/api/save-scene', scenePayload(scene));
        } catch {
          // 静态 file:// 打开时允许只保存到 localStorage。
        }
      }
      function setBuildActionsVisible(visible) {
        const actions = document.querySelector('[data-build-open-actions]');
        if (actions) actions.hidden = !visible;
      }
      function renderBuildResult(result) {
        const status = document.querySelector('[data-build-video-status]');
        if (!status || !result) return;
        if (result.ok && result.videoPath) {
          status.dataset.kind = 'ok';
          status.textContent = '已生成：' + result.videoPath;
          setBuildActionsVisible(true);
          return;
        }
        if (result.error) {
          status.dataset.kind = 'error';
          status.textContent = '上次生成失败：' + result.error;
          setBuildActionsVisible(false);
        }
      }
      async function refreshBuildStatus() {
        try {
          const data = await getJson('/api/build-status');
          renderBuildResult(data.lastBuildResult);
        } catch {
          // 静态 file:// 或服务没开时不打扰审片。
        }
      }
      async function openBuildTarget(button) {
        const target = button.dataset.openBuildTarget || 'video';
        const action = button.dataset.openBuildAction || 'open';
        const status = document.querySelector('[data-build-video-status]');
        button.disabled = true;
        try {
          const data = await postJson('/api/open-build-target', { target, action });
          if (status) {
            status.dataset.kind = 'ok';
            status.textContent = data.message + ' ' + (data.path || '');
          }
        } catch (error) {
          if (status) {
            status.dataset.kind = 'error';
            status.textContent = '打开失败：' + error.message;
          }
        } finally {
          button.disabled = false;
        }
      }
      async function buildStoryboardVideo(button) {
        const status = document.querySelector('[data-build-video-status]');
        const setBuildStatus = (kind, text) => {
          if (!status) return;
          status.dataset.kind = kind || '';
          status.textContent = text || '';
        };
        button.disabled = true;
        setBuildActionsVisible(false);
        setBuildStatus('warn', '正在生成保姆版横屏视频，期间不要关闭这个审片板...');
        try {
          const data = await postJson('/api/build-video', { style: 'nanny' });
          renderBuildResult(data);
        } catch (error) {
          setBuildStatus('error', '生成失败：' + error.message + '。确认本地服务已启动后再点。');
        } finally {
          button.disabled = false;
        }
      }
      function scenesInContainer(container) {
        return [...container.querySelectorAll(':scope > .scene')];
      }
      function renumberScenes(container) {
        scenesInContainer(container).forEach((scene, index) => {
          const number = index + 1;
          scene.dataset.index = String(number);
          const label = scene.querySelector('.scene-number');
          if (label) label.textContent = String(number);
        });
      }
      function currentSceneOrder(container) {
        return scenesInContainer(container).map(scene => scene.dataset.sceneKey || scene.id).filter(Boolean);
      }
      async function saveSceneOrder(container) {
        const style = container.dataset.style || container.querySelector('.scene')?.dataset.style;
        if (!style) return;
        const sceneOrder = currentSceneOrder(container);
        localStorage.setItem(orderStorageKey(style), JSON.stringify(sceneOrder));
        try {
          await postJson('/api/save-order', { style, sceneOrder });
        } catch {
          // 静态 file:// 打开时允许只保存到 localStorage。
        }
      }
      function applySavedSceneOrder(container) {
        const style = container.dataset.style || container.querySelector('.scene')?.dataset.style;
        if (!style) {
          renumberScenes(container);
          return;
        }
        let order = [];
        try {
          order = JSON.parse(localStorage.getItem(orderStorageKey(style)) || '[]');
        } catch {
          order = [];
        }
        if (!Array.isArray(order) || order.length === 0) {
          renumberScenes(container);
          return;
        }
        const scenes = scenesInContainer(container);
        const byKey = new Map(scenes.map(scene => [scene.dataset.sceneKey || scene.id, scene]));
        const fragment = document.createDocumentFragment();
        const used = new Set();
        for (const key of order) {
          const scene = byKey.get(String(key));
          if (!scene || used.has(scene)) continue;
          fragment.appendChild(scene);
          used.add(scene);
        }
        for (const scene of scenes) {
          if (!used.has(scene)) fragment.appendChild(scene);
        }
        container.appendChild(fragment);
        renumberScenes(container);
      }
      function attachSceneReorder(container) {
        let draggedScene = null;
        function clearDropMarkers() {
          for (const scene of scenesInContainer(container)) {
            scene.classList.remove('scene-drop-before', 'scene-drop-after');
          }
        }
        for (const handle of container.querySelectorAll('.scene-drag-handle')) {
          const scene = handle.closest('.scene');
          if (!scene) continue;
          handle.addEventListener('dragstart', event => {
            draggedScene = scene;
            scene.classList.add('scene-dragging');
            event.dataTransfer?.setData('text/plain', scene.dataset.sceneKey || scene.id || '');
            if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
          });
          handle.addEventListener('dragend', () => {
            if (draggedScene) draggedScene.classList.remove('scene-dragging');
            draggedScene = null;
            clearDropMarkers();
            renumberScenes(container);
            saveSceneOrder(container);
          });
        }
        for (const scene of scenesInContainer(container)) {
          scene.addEventListener('dragover', event => {
            if (!draggedScene || draggedScene === scene || !container.contains(draggedScene)) return;
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
            const rect = scene.getBoundingClientRect();
            const before = event.clientY < rect.top + rect.height / 2;
            clearDropMarkers();
            scene.classList.add(before ? 'scene-drop-before' : 'scene-drop-after');
            if (before) {
              container.insertBefore(draggedScene, scene);
            } else {
              container.insertBefore(draggedScene, scene.nextElementSibling);
            }
          });
          scene.addEventListener('drop', event => {
            if (!draggedScene) return;
            event.preventDefault();
            clearDropMarkers();
            renumberScenes(container);
            saveSceneOrder(container);
          });
        }
      }
      async function generateCopy(scene, button) {
        button.disabled = true;
        setMessage(scene, 'warn', '正在根据画面要求、备注和当前步骤生成客户能听懂的台词...');
        try {
          const data = await postJson('/api/generate-copy', scenePayload(scene));
          if (data.action) setFieldValue(scene, 'action', data.action);
          if (data.subtitle) setFieldValue(scene, 'subtitle', data.subtitle);
          if (data.voiceover) setFieldValue(scene, 'voiceover', data.voiceover);
          const via = data.provider === 'copy-api'
            ? '已用本地 API 生成'
            : data.provider === 'local-copywriter-fallback'
              ? 'API 失败，已用本地模板兜底'
              : '已用本地模板生成';
          setMessage(scene, data.provider === 'local-copywriter-fallback' ? 'warn' : 'ok', via + '客户版屏幕文字和口播，可继续手改。');
        } catch (error) {
          setMessage(scene, 'error', '本地服务没开或生成失败：' + error.message + '。运行 scripts/storyboard_server.mjs 后再点。');
        } finally {
          button.disabled = false;
        }
      }
      async function recaptureScene(scene, button) {
        button.disabled = true;
        setMessage(scene, 'warn', '正在保存要求并重新干跑截图，过程大概十几秒；不会点击生成。');
        try {
          const data = await postJson('/api/recapture-scene', scenePayload(scene));
          setMessage(scene, 'ok', data.message || '截图已更新，正在刷新页面。');
          setTimeout(() => {
            location.href = location.pathname + '?v=' + Date.now() + '#' + scene.id;
          }, 600);
        } catch (error) {
          setMessage(scene, 'error', '重拍失败：' + error.message + '。确认本地服务已启动，Chrome 保持登录态。');
        } finally {
          button.disabled = false;
        }
      }
      function defaultInsertText(scene) {
        const sceneId = scene.dataset.sceneId || '';
        if (sceneId === 'platform-dropdown-open') return '平台下拉展开，看到抖音、淘宝、快手、京东、微信小店、小红书。';
        if (sceneId === 'shop-dropdown-open') return '店铺下拉展开，看到目标店铺和勾选框。';
        if (sceneId === 'image-slot-dropdown-open') return '主图位置下拉展开，看到主图1到主图5。';
        return fieldValue(scene, 'action') || '补充一镜，把关键操作单独拍清楚。';
      }
      async function insertScene(scene, button, position) {
        const text = window.prompt('这条补充镜要拍什么？', defaultInsertText(scene));
        if (!text) return;
        button.disabled = true;
        setMessage(scene, 'warn', '正在插入补充镜头...');
        try {
          const data = await postJson('/api/insert-scene', {
            ...scenePayload(scene),
            insertPosition: position,
            insertAction: text
          });
          setMessage(scene, 'ok', data.message || '已插入补充镜头，正在刷新页面。');
          setTimeout(() => {
            location.href = location.pathname + '?v=' + Date.now() + '#' + (data.sceneKey || scene.id);
          }, 500);
        } catch (error) {
          setMessage(scene, 'error', '插入失败：' + error.message);
        } finally {
          button.disabled = false;
        }
      }
      async function deleteScene(scene) {
        const ok = window.confirm('确定删除这一镜吗？出片时会跳过，但你可以在批改状态里改回“通过”。');
        if (!ok) return;
        const status = scene.querySelector('.review-status');
        if (status) {
          status.value = 'remove';
          localStorage.setItem(storageKey(scene, 'reviewStatus'), 'remove');
        }
        setSceneStatus(scene, 'remove');
        await saveSceneToServer(scene);
        setMessage(scene, 'ok', '已标记删除。生成视频时会跳过这一镜。');
      }
      function addTarget(scene) {
        const target = scene.querySelector('.target-box');
        if (!target) return;
        const saved = readSavedPosition(scene, 'targetBox');
        const box = clampTargetBox(saved || { left: 38, top: 34, width: 18, height: 11 });
        target.style.display = '';
        setBoxPercent(target, box);
        savePosition(scene, 'targetBox', box);
        localStorage.setItem(storageKey(scene, 'targetManual'), '1');
        saveSceneToServer(scene);
        setMessage(scene, 'ok', '已添加红框，直接拖动红框或右下角小块调整。');
      }
      function addMouse(scene) {
        const marker = scene.querySelector('.mouse-marker');
        if (!marker) return;
        const target = scene.querySelector('.target-box');
        const saved = readSavedPosition(scene, 'mouseMarker');
        const targetBox = target && target.style.display !== 'none'
          ? {
              left: percent(target.style.left),
              top: percent(target.style.top),
              width: percent(target.style.width),
              height: percent(target.style.height)
            }
          : null;
        const point = saved || (targetBox ? defaultMarkerFromBox(targetBox) : { left: 52, top: 48 });
        marker.style.display = '';
        setBoxPercent(marker, point);
        savePosition(scene, 'mouseMarker', point);
        localStorage.setItem(storageKey(scene, 'mouseManual'), '1');
        saveSceneToServer(scene);
        setMessage(scene, 'ok', '已添加鼠标，直接拖动到点击位置。');
      }
      function setZoomMode(scene, mode) {
        const normalized = mode === 'crop' ? 'crop' : 'full';
        setFieldValue(scene, 'zoomMode', normalized);
        if (normalized === 'crop' && !readSavedPosition(scene, 'zoomCropPosition')) {
          savePosition(scene, 'zoomCropPosition', { x: 50, y: 50 });
          applyZoomCropPosition(scene);
        }
        saveSceneToServer(scene);
        setMessage(
          scene,
          'ok',
          normalized === 'crop'
            ? '已切到局部展示。可以拖动放大图内部画面，微调要露出的局部。'
            : '已切回完整显示。'
        );
      }
      function attachDrag(scene) {
        const frame = scene.querySelector('.shot-frame');
        const target = scene.querySelector('.target-box');
        const targetHandle = scene.querySelector('.target-resize-handle');
        const marker = scene.querySelector('.mouse-marker');
        if (!frame) return;
        function dragPercent(el, event, onMove, onEnd) {
          event.preventDefault();
          const box = frame.getBoundingClientRect();
          const start = {
            x: event.clientX,
            y: event.clientY,
            left: percent(el.style.left),
            top: percent(el.style.top)
          };
          function move(moveEvent) {
            const left = clamp(start.left + (moveEvent.clientX - start.x) / box.width * 100, 0, 96);
            const top = clamp(start.top + (moveEvent.clientY - start.y) / box.height * 100, 0, 94);
            onMove(left, top);
          }
          function up() {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            onEnd?.();
          }
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        }
        if (marker) {
          marker.addEventListener('pointerdown', event => {
            localStorage.setItem(storageKey(scene, 'mouseManual'), '1');
            dragPercent(marker, event, (left, top) => {
              setBoxPercent(marker, { left, top });
              savePosition(scene, 'mouseMarker', { left, top });
            });
          });
        }
        if (target) {
          target.addEventListener('pointerdown', event => {
            if (event.target === targetHandle) return;
            const start = {
              width: percent(target.style.width),
              height: percent(target.style.height),
              mouseWasManual: localStorage.getItem(storageKey(scene, 'mouseManual')) === '1'
            };
            dragPercent(target, event, (left, top) => {
              const box = clampTargetBox({ left, top, width: start.width, height: start.height });
              setBoxPercent(target, box);
              savePosition(scene, 'targetBox', box);
              if (marker && !start.mouseWasManual) {
                setBoxPercent(marker, defaultMarkerFromBox(box));
              }
            }, () => {
              if (marker && !start.mouseWasManual) {
                const box = {
                  left: percent(target.style.left),
                  top: percent(target.style.top),
                  width: percent(target.style.width),
                  height: percent(target.style.height)
                };
                const markerPosition = defaultMarkerFromBox(box);
                setBoxPercent(marker, markerPosition);
                savePosition(scene, 'mouseMarker', markerPosition);
              }
            });
          });
        }
        targetHandle?.addEventListener('pointerdown', event => {
          event.preventDefault();
          event.stopPropagation();
          targetHandle.setPointerCapture?.(event.pointerId);
          const frameBox = frame.getBoundingClientRect();
          const start = {
            x: event.clientX,
            y: event.clientY,
            left: percent(target.style.left),
            top: percent(target.style.top),
            width: percent(target.style.width),
            height: percent(target.style.height),
            mouseWasManual: localStorage.getItem(storageKey(scene, 'mouseManual')) === '1'
          };
          function move(moveEvent) {
            const width = start.width + (moveEvent.clientX - start.x) / frameBox.width * 100;
            const height = start.height + (moveEvent.clientY - start.y) / frameBox.height * 100;
            const box = clampTargetBox({ left: start.left, top: start.top, width, height });
            setBoxPercent(target, box);
            savePosition(scene, 'targetBox', box);
            if (marker && !start.mouseWasManual) {
              const markerPosition = defaultMarkerFromBox(box);
              setBoxPercent(marker, markerPosition);
              savePosition(scene, 'mouseMarker', markerPosition);
            }
          }
          function up(upEvent) {
            targetHandle.releasePointerCapture?.(upEvent.pointerId);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
          }
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        });
      }
      function clampZoomBox(frame, zoom, box) {
        const frameRect = frame.getBoundingClientRect();
        const zoomWidthPct = Number.isFinite(box.width) ? box.width : zoom.getBoundingClientRect().width / frameRect.width * 100;
        const zoomHeightPct = zoom.getBoundingClientRect().height / frameRect.height * 100;
        return {
          left: clamp(box.left, 0, Math.max(0, 100 - zoomWidthPct)),
          top: clamp(box.top, 0, Math.max(0, 100 - zoomHeightPct)),
          width: clamp(zoomWidthPct, 18, 86)
        };
      }
      function placeZoomInset(scene) {
        const frame = scene.querySelector('.shot-frame');
        const zoom = scene.querySelector('.zoom-inset');
        if (!frame || !zoom) return;
        const saved = readSavedPosition(scene, 'zoomInset');
        if (saved) {
          setZoomPercent(zoom, clampZoomBox(frame, zoom, saved));
          return;
        }
        const frameRect = frame.getBoundingClientRect();
        const zoomRect = zoom.getBoundingClientRect();
        const defaultBox = {
          left: Math.max(1, (frameRect.width - zoomRect.width - 18) / frameRect.width * 100),
          top: 3,
          width: zoomRect.width / frameRect.width * 100
        };
        setZoomPercent(zoom, clampZoomBox(frame, zoom, defaultBox));
      }
      function attachZoom(scene) {
        const frame = scene.querySelector('.shot-frame');
        const zoom = scene.querySelector('.zoom-inset');
        if (!frame || !zoom) return;
        if (zoom.dataset.zoomAttached === '1') return;
        zoom.dataset.zoomAttached = '1';
        const handle = zoom.querySelector('.zoom-resize-handle');
        const deleteButton = zoom.querySelector('.zoom-delete-button');
        const img = zoom.querySelector('img');
        function deleteZoom() {
          localStorage.setItem(storageKey(scene, 'zoomDeleted'), '1');
          localStorage.removeItem(storageKey(scene, 'zoomHidden'));
          localStorage.removeItem(storageKey(scene, 'zoomInset'));
          const field = scene.querySelector('[data-field="zoomImage"]');
          if (field) {
            field.value = '';
            localStorage.setItem(storageKey(scene, 'zoomImage'), '');
          }
          updateZoomPicker(scene);
          zoom.remove();
          saveSceneToServer(scene);
        }
        if (
          localStorage.getItem(storageKey(scene, 'zoomDeleted')) === '1' ||
          localStorage.getItem(storageKey(scene, 'zoomHidden')) === '1'
        ) {
          deleteZoom();
          return;
        }
        const place = () => placeZoomInset(scene);
        if (img?.complete) place();
        img?.addEventListener('load', place);
        updateZoomModeControls(scene);

        deleteButton?.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          deleteZoom();
        });

        img?.addEventListener('pointerdown', event => {
          if (fieldValue(scene, 'zoomMode') !== 'crop') return;
          event.preventDefault();
          event.stopPropagation();
          img.setPointerCapture?.(event.pointerId);
          const zoomRect = zoom.getBoundingClientRect();
          const startPosition = zoomCropPosition(scene);
          const start = {
            x: event.clientX,
            y: event.clientY,
            posX: clamp(startPosition.x ?? 50, 0, 100),
            posY: clamp(startPosition.y ?? 50, 0, 100)
          };
          function move(moveEvent) {
            const next = {
              x: clamp(start.posX - (moveEvent.clientX - start.x) / zoomRect.width * 82, 0, 100),
              y: clamp(start.posY - (moveEvent.clientY - start.y) / zoomRect.height * 82, 0, 100)
            };
            savePosition(scene, 'zoomCropPosition', next);
            applyZoomCropPosition(scene);
          }
          function up(upEvent) {
            img.releasePointerCapture?.(upEvent.pointerId);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            saveSceneToServer(scene);
          }
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        });

        zoom.addEventListener('pointerdown', event => {
          if (event.target === handle || event.target === deleteButton) return;
          event.preventDefault();
          zoom.setPointerCapture?.(event.pointerId);
          const frameRect = frame.getBoundingClientRect();
          const zoomRect = zoom.getBoundingClientRect();
          const start = {
            x: event.clientX,
            y: event.clientY,
            left: percent(zoom.style.left),
            top: percent(zoom.style.top),
            width: zoomRect.width / frameRect.width * 100
          };
          function move(moveEvent) {
            const next = clampZoomBox(frame, zoom, {
              left: start.left + (moveEvent.clientX - start.x) / frameRect.width * 100,
              top: start.top + (moveEvent.clientY - start.y) / frameRect.height * 100,
              width: start.width
            });
            setZoomPercent(zoom, next);
            savePosition(scene, 'zoomInset', next);
          }
          function up(upEvent) {
            zoom.releasePointerCapture?.(upEvent.pointerId);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
          }
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        });

        handle?.addEventListener('pointerdown', event => {
          event.preventDefault();
          event.stopPropagation();
          handle.setPointerCapture?.(event.pointerId);
          const frameRect = frame.getBoundingClientRect();
          const startWidth = zoom.getBoundingClientRect().width;
          const start = {
            x: event.clientX,
            y: event.clientY,
            left: percent(zoom.style.left),
            top: percent(zoom.style.top)
          };
          function move(moveEvent) {
            const delta = Math.max(moveEvent.clientX - start.x, moveEvent.clientY - start.y);
            const width = clamp((startWidth + delta) / frameRect.width * 100, 18, 86);
            const next = clampZoomBox(frame, zoom, { left: start.left, top: start.top, width });
            setZoomPercent(zoom, next);
            savePosition(scene, 'zoomInset', next);
          }
          function up(upEvent) {
            handle.releasePointerCapture?.(upEvent.pointerId);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
          }
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        });
      }
      function attachSubtitleDrag(scene) {
        const frame = scene.querySelector('.shot-frame');
        const subtitle = scene.querySelector('.frame-subtitle');
        if (!frame || !subtitle) return;
        placeSubtitle(scene);
        subtitle.addEventListener('pointerdown', event => {
          if (!subtitle.textContent.trim()) return;
          event.preventDefault();
          event.stopPropagation();
          subtitle.setPointerCapture?.(event.pointerId);
          const start = {
            ...subtitleBoxFromDom(frame, subtitle),
            x: event.clientX,
            y: event.clientY
          };
          setSubtitlePercent(subtitle, start);
          function move(moveEvent) {
            const frameRect = frame.getBoundingClientRect();
            const next = clampSubtitleBox(frame, subtitle, {
              left: start.left + (moveEvent.clientX - start.x) / frameRect.width * 100,
              top: start.top + (moveEvent.clientY - start.y) / frameRect.height * 100,
              width: start.width,
              height: start.height
            });
            setSubtitlePercent(subtitle, next);
            savePosition(scene, 'subtitleBox', next);
          }
          function up(upEvent) {
            subtitle.releasePointerCapture?.(upEvent.pointerId);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            savePosition(scene, 'subtitleBox', clampSubtitleBox(frame, subtitle, subtitleBoxFromDom(frame, subtitle)));
          }
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        });
      }
      for (const variant of document.querySelectorAll('.variant')) {
        applySavedSceneOrder(variant);
        attachSceneReorder(variant);
      }
      for (const frame of document.querySelectorAll('.shot-frame')) {
        const img = frame.querySelector('.background-image');
        if (!img) continue;
        if (img.complete) placeMouseOverlay(frame);
        img.addEventListener('load', () => placeMouseOverlay(frame));
      }
      for (const scene of document.querySelectorAll('.scene')) {
        const status = scene.querySelector('.review-status');
        if (status) {
          const saved = localStorage.getItem(storageKey(scene, 'reviewStatus'));
          if (saved) status.value = saved;
          setSceneStatus(scene, status.value);
        }
        for (const el of scene.querySelectorAll('[data-field]')) {
          const key = storageKey(scene, el.dataset.field);
          const saved = localStorage.getItem(key) ?? localStorage.getItem(legacyStorageKey(scene, el.dataset.field));
          if (saved !== null) el.value = saved;
          if (el.dataset.field === 'subtitle') updateSubtitle(scene);
          if (el.dataset.field === 'screenshot') {
            updateBackground(scene);
            updateBackgroundPicker(scene);
          }
          if (el.dataset.field === 'zoomImage') {
            updateZoomPicker(scene);
            if (
              el.value &&
              localStorage.getItem(storageKey(scene, 'zoomDeleted')) !== '1' &&
              localStorage.getItem(storageKey(scene, 'zoomHidden')) !== '1'
            ) {
              updateZoomInset(scene);
            }
          }
          if (el.dataset.field === 'zoomMode') {
            el.value = el.value === 'crop' ? 'crop' : 'full';
            updateZoomModeControls(scene);
          }
          const eventName = el.tagName === 'SELECT' ? 'change' : 'input';
          el.addEventListener(eventName, () => {
            localStorage.setItem(key, el.value);
            if (el.classList.contains('review-status')) setSceneStatus(scene, el.value);
            if (el.dataset.field === 'subtitle') updateSubtitle(scene);
            if (el.dataset.field === 'screenshot') {
              updateBackground(scene);
              updateBackgroundPicker(scene);
            }
            if (el.dataset.field === 'zoomImage') {
              localStorage.removeItem(storageKey(scene, 'zoomDeleted'));
              localStorage.removeItem(storageKey(scene, 'zoomHidden'));
              updateZoomInset(scene);
              updateZoomPicker(scene);
            }
            if (el.dataset.field === 'zoomMode') {
              el.value = el.value === 'crop' ? 'crop' : 'full';
              updateZoomModeControls(scene);
            }
            saveSceneToServer(scene);
          });
        }
        for (const button of scene.querySelectorAll('[data-action]')) {
          button.addEventListener('click', () => {
            if (button.dataset.action === 'open-background-picker') openBackgroundPicker(scene);
            if (button.dataset.action === 'open-zoom-picker') openZoomPicker(scene);
            if (button.dataset.action === 'ai-copy') generateCopy(scene, button);
            if (button.dataset.action === 'recapture') recaptureScene(scene, button);
            if (button.dataset.action === 'insert-before') insertScene(scene, button, 'before');
            if (button.dataset.action === 'insert-after') insertScene(scene, button, 'after');
            if (button.dataset.action === 'delete-scene') deleteScene(scene);
            if (button.dataset.action === 'add-target') addTarget(scene);
            if (button.dataset.action === 'add-mouse') addMouse(scene);
            if (button.dataset.action === 'zoom-mode-full') setZoomMode(scene, 'full');
            if (button.dataset.action === 'zoom-mode-crop') setZoomMode(scene, 'crop');
          });
        }
        attachDrag(scene);
        attachZoom(scene);
        attachSubtitleDrag(scene);
      }
      backgroundSearch?.addEventListener('input', renderBackgroundOptions);
      for (const button of backgroundFilterButtons) {
        button.addEventListener('click', () => {
          activeBackgroundFilter = button.dataset.backgroundFilter || 'all';
          updateBackgroundFilterButtons();
          renderBackgroundOptions();
        });
      }
      document.querySelector('[data-background-close]')?.addEventListener('click', closeBackgroundPicker);
      document.querySelector('[data-build-video-button]')?.addEventListener('click', event => {
        buildStoryboardVideo(event.currentTarget);
      });
      for (const button of document.querySelectorAll('[data-open-build-target]')) {
        button.addEventListener('click', () => openBuildTarget(button));
      }
      refreshBuildStatus();
      backgroundModal?.addEventListener('click', event => {
        if (event.target === backgroundModal) closeBackgroundPicker();
      });
      window.addEventListener('keydown', event => {
        if (event.key === 'Escape' && backgroundModal && !backgroundModal.hidden) closeBackgroundPicker();
      });
    })();
  </script>
</body>
</html>`;

const htmlPath = path.join(boardDir, 'shooting-board.html');
await fs.writeFile(htmlPath, html, 'utf8');

const md = [
  '# AI优化商品图教程分镜拍摄脚本',
  '',
  `目标测试店：${TARGET_TEST_STORE}。如果截图出现其他店名，这一镜先标记重拍。`,
  '',
  '先审画面，再做成片。每一镜看四件事：点哪里、有没有挡住、下拉有没有展开、放大区是否必要。',
  ''
];

for (const variant of boardVariants) {
  md.push(`## ${variant.styleName}（${variant.style}，约 ${variant.totalDuration}s）`, '');
  for (const scene of scenesForVariant(variant)) {
    md.push(`### ${scene.index}. ${scene.title}`);
    md.push(`![${scene.title}](${scene.screenshot})`);
    md.push('- 批改状态：通过（可改：需修改 / 重拍 / 删除 / 待确认）');
    md.push(`- 这一步要拍：${shotRequirement(scene)}`);
    md.push(`- 当前问题/检查点：${sceneProblem(scene)}`);
    md.push(`- 屏幕文字：${scene.subtitle || ''}`);
    md.push(`- 口播：${scene.voiceover || ''}`);
    md.push(`- 给AI的改稿意见：`);
    md.push('');
  }
}

const mdPath = path.join(boardDir, 'shooting-board.md');
await fs.writeFile(mdPath, `${md.join('\n')}\n`, 'utf8');

console.log(`shooting-board=${htmlPath}`);
console.log(`shooting-board-md=${mdPath}`);
