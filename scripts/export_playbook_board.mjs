#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  PLAYBOOK_DEFAULT_OUTPUT_DIR,
  ensurePlaybookWorkspace
} from '../lib/playbook/paths.mjs';
import { readAssetManifest } from '../lib/playbook/assets.mjs';

const BOARD_TITLE = 'AI优化图到AI生成视频玩法审片台';
const IMAGE_EXTENSIONS = new Set(['.apng', '.avif', '.gif', '.jpeg', '.jpg', '.png', '.webp']);
const VIDEO_EXTENSIONS = new Set(['.m4v', '.mov', '.mp4', '.webm']);

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

function isImageFriendly(sourcePath = '') {
  return IMAGE_EXTENSIONS.has(path.extname(sourcePath).toLowerCase());
}

function isVideoFriendly(sourcePath = '') {
  return VIDEO_EXTENSIONS.has(path.extname(sourcePath).toLowerCase());
}

function toBoardAsset(asset, outputDir) {
  const sourcePath = asset.sourcePath || asset.targetPath || '';
  const resolved = sourcePath ? path.resolve(sourcePath) : '';
  const outputRoot = path.resolve(outputDir);
  const isInsideOutput = resolved === outputRoot || resolved.startsWith(outputRoot + path.sep);
  const relativeUrl = isInsideOutput
    ? `/${path.relative(outputRoot, resolved).split(path.sep).map(encodeURIComponent).join('/')}`
    : '';
  return {
    ...asset,
    sourcePath,
    isImageFriendly: isImageFriendly(sourcePath),
    isVideoFriendly: isVideoFriendly(sourcePath),
    previewUrl: relativeUrl
  };
}

function htmlEscape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function safeJsonScript(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function isTruthyFlag(value) {
  return value === true || value === 'true' || value === '1';
}

function buildHtml({ recipe, manifest, outputDir }) {
  const assets = (manifest.assets || []).map(asset => toBoardAsset(asset, outputDir));
  const assetById = new Map(assets.map(asset => [asset.id, asset]));
  const scenes = (recipe.scenes || []).map((scene, index) => {
    const asset = scene.selectedAssetId ? assetById.get(scene.selectedAssetId) : null;
    const zoomDeleted = isTruthyFlag(scene.zoomDeleted) || isTruthyFlag(scene.zoomRemoved);
    const zoomAsset = scene.zoomAssetId && !zoomDeleted ? assetById.get(scene.zoomAssetId) : null;
    return {
      ...scene,
      index: scene.index || index + 1,
      selectedAsset: asset || null,
      zoomAssetId: scene.zoomAssetId || '',
      zoomImage: scene.zoomImage || '',
      zoomDeleted,
      zoomRemoved: isTruthyFlag(scene.zoomRemoved),
      zoomSelectedAsset: zoomAsset || null
    };
  });
  const boardData = {
    title: BOARD_TITLE,
    outputDir,
    recipe: {
      version: recipe.version,
      kind: recipe.kind,
      playbook: recipe.playbook,
      sceneCount: recipe.sceneCount,
      missingAssetCount: recipe.missingAssetCount,
      totalDuration: recipe.totalDuration
    },
    assets,
    scenes
  };

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate">
  <meta http-equiv="Pragma" content="no-cache">
  <meta http-equiv="Expires" content="0">
  <title>${htmlEscape(BOARD_TITLE)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --ink: #1e252f;
      --muted: #667085;
      --line: #d9dee7;
      --accent: #0f766e;
      --accent-dark: #0d5f59;
      --danger: #b42318;
      --warning: #b54708;
      --soft: #eef6f5;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 10;
      background: rgba(255, 255, 255, 0.96);
      border-bottom: 1px solid var(--line);
      padding: 16px 24px;
      backdrop-filter: blur(10px);
    }
    h1 {
      margin: 0 0 6px;
      font-size: 22px;
      letter-spacing: 0;
    }
    main {
      max-width: 1180px;
      margin: 0 auto;
      padding: 20px 18px 48px;
    }
    .summary {
      color: var(--muted);
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
      flex-wrap: wrap;
    }
    .toolbar-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      flex-wrap: wrap;
    }
    .message {
      min-height: 24px;
      color: var(--muted);
    }
    .message.error {
      color: var(--danger);
    }
    .build-status {
      min-height: 24px;
      color: var(--muted);
    }
    .build-status.success {
      color: var(--accent-dark);
      font-weight: 650;
    }
    .build-status.error {
      color: var(--danger);
    }
    .scene-list {
      display: grid;
      gap: 14px;
    }
    .scene-card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
    }
    .scene-card[data-review-status="delete"] {
      border-color: #f3b4ad;
      background: #fff7f6;
    }
    .scene-head {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 12px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
      background: #fbfcfe;
    }
    .scene-title {
      margin: 0;
      font-size: 17px;
      letter-spacing: 0;
    }
    .scene-key {
      color: var(--muted);
      font-size: 12px;
      word-break: break-all;
    }
    .scene-body {
      display: grid;
      grid-template-columns: minmax(260px, 42%) 1fr;
      gap: 16px;
      padding: 16px;
    }
    .asset-panel {
      min-height: 250px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fafafa;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      position: relative;
    }
    .asset-panel img {
      width: 100%;
      height: 100%;
      max-height: 360px;
      object-fit: contain;
      display: block;
      background: #111827;
    }
    .asset-panel video {
      width: 100%;
      max-height: 360px;
      display: block;
      background: #111827;
    }
    .asset-missing,
    .asset-label {
      padding: 18px;
      text-align: center;
      color: var(--muted);
    }
    .asset-missing strong,
    .asset-label strong {
      display: block;
      color: var(--ink);
      margin-bottom: 6px;
    }
    .zoom-section {
      margin-top: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      overflow: hidden;
    }
    .zoom-section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      background: #fbfcfe;
    }
    .zoom-section-title {
      font-weight: 650;
    }
    .zoom-preview {
      min-height: 128px;
      border: 0;
      border-radius: 0;
      background: #fafafa;
    }
    .zoom-preview img,
    .zoom-preview video {
      max-height: 180px;
    }
    .zoom-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 10px 12px;
      border-top: 1px solid var(--line);
    }
    .fields {
      display: grid;
      gap: 12px;
    }
    .field-row {
      display: grid;
      gap: 6px;
    }
    label {
      font-weight: 650;
    }
    input,
    select,
    textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px 10px;
      background: #fff;
      color: var(--ink);
      font: inherit;
    }
    textarea {
      min-height: 86px;
      resize: vertical;
    }
    .compact-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 0 16px 16px;
    }
    button {
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      color: var(--ink);
      padding: 8px 10px;
      font: inherit;
      cursor: pointer;
    }
    button:hover {
      border-color: var(--accent);
      color: var(--accent-dark);
    }
    button.primary {
      border-color: var(--accent);
      background: var(--accent);
      color: #fff;
    }
    button[disabled] {
      cursor: progress;
      opacity: 0.68;
    }
    button.danger {
      border-color: #f3b4ad;
      color: var(--danger);
    }
    .pill {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      border-radius: 999px;
      padding: 2px 9px;
      background: var(--soft);
      color: var(--accent-dark);
      font-size: 12px;
      font-weight: 650;
    }
    @media (max-width: 820px) {
      header {
        padding: 14px 16px;
      }
      .scene-head,
      .scene-body,
      .toolbar {
        grid-template-columns: 1fr;
      }
      .toolbar {
        align-items: stretch;
      }
      .toolbar-actions {
        justify-content: flex-start;
      }
      .scene-body {
        display: block;
      }
      .asset-panel {
        margin-bottom: 14px;
      }
      .compact-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <header>
    <h1>${htmlEscape(BOARD_TITLE)}</h1>
    <div class="summary">
      <span>输出目录：${htmlEscape(outputDir)}</span>
      <span>镜头：${htmlEscape(scenes.length)}</span>
      <span>缺素材：${htmlEscape(recipe.missingAssetCount ?? scenes.filter(scene => scene.missingAsset).length)}</span>
    </div>
  </header>
  <main>
    <div class="toolbar">
      <div class="message" id="message">正在载入审片状态...</div>
      <div class="toolbar-actions">
        <button class="primary" id="build-video" type="button">一键生成玩法横屏视频</button>
        <span class="build-status" id="build-status" aria-live="polite">等待生成视频。</span>
        <button class="primary" id="save-order" type="button">保存当前顺序</button>
      </div>
    </div>
    <section class="scene-list" id="scene-list" aria-label="Playbook scenes"></section>
  </main>
  <script>
    window.PLAYBOOK_BOARD_DATA = ${safeJsonScript(boardData)};
  </script>
  <script>
    const data = window.PLAYBOOK_BOARD_DATA;
    const scenesByKey = new Map(data.scenes.map(scene => [scene.sceneKey, scene]));
    const assetsById = new Map(data.assets.map(asset => [asset.id, asset]));
    let scenes = [...data.scenes];
    let serverState = { scenes: {}, sceneOrder: [] };

    const list = document.querySelector('#scene-list');
    const message = document.querySelector('#message');
    const saveOrderButton = document.querySelector('#save-order');
    const buildVideoButton = document.querySelector('#build-video');
    const buildStatus = document.querySelector('#build-status');

    function storageKey(sceneKey) {
      return 'playbook.review.' + sceneKey;
    }

    function showMessage(text, type = '') {
      message.textContent = text;
      message.className = type ? 'message ' + type : 'message';
    }

    function showBuildStatus(text, type = '') {
      buildStatus.textContent = text;
      buildStatus.className = type ? 'build-status ' + type : 'build-status';
    }

    function readLocalOverride(sceneKey) {
      try {
        return JSON.parse(localStorage.getItem(storageKey(sceneKey)) || '{}');
      } catch {
        return {};
      }
    }

    function mergedScene(scene) {
      return {
        ...scene,
        ...(serverState.scenes?.[scene.sceneKey] || {}),
        ...readLocalOverride(scene.sceneKey),
        sceneKey: scene.sceneKey
      };
    }

    function orderedScenes(sourceScenes) {
      const order = Array.isArray(serverState.sceneOrder) ? serverState.sceneOrder : [];
      if (!order.length) return sourceScenes;
      const byKey = new Map(sourceScenes.map(scene => [scene.sceneKey, scene]));
      const ordered = order.map(key => byKey.get(key)).filter(Boolean);
      const used = new Set(ordered.map(scene => scene.sceneKey));
      return ordered.concat(sourceScenes.filter(scene => !used.has(scene.sceneKey)));
    }

    function reviewStatusLabel(value) {
      return {
        pass: '通过',
        revise: '需修改',
        delete: '删除'
      }[value] || '通过';
    }

    function selectedAsset(scene) {
      const assetId = scene.selectedAssetId || '';
      return assetId ? assetsById.get(assetId) : null;
    }

    function zoomIsDeleted(scene) {
      return scene.zoomDeleted === true || scene.zoomDeleted === 'true' || scene.zoomDeleted === '1' ||
        scene.zoomRemoved === true || scene.zoomRemoved === 'true' || scene.zoomRemoved === '1';
    }

    function zoomAsset(scene) {
      if (zoomIsDeleted(scene)) return null;
      const assetId = scene.zoomAssetId || '';
      return assetId ? assetsById.get(assetId) : null;
    }

    function assetPreviewHtml(asset, missingHtml) {
      if (!asset) {
        return missingHtml;
      }
      if (asset.isImageFriendly && asset.previewUrl) {
        return '<img src="' + escapeHtml(asset.previewUrl) + '" alt="' + escapeHtml(asset.title || asset.id) + '">';
      }
      if (asset.isVideoFriendly && asset.previewUrl) {
        return '<video controls preload="metadata" src="' + escapeHtml(asset.previewUrl) + '"></video>';
      }
      return '<div class="asset-label"><strong>' + escapeHtml(asset.title || asset.id) + '</strong><div>非图片素材：' + escapeHtml(asset.type || 'unknown') + '</div><div>' + escapeHtml(asset.sourcePath || '') + '</div></div>';
    }

    function assetPanel(scene) {
      return assetPreviewHtml(
        selectedAsset(scene),
        '<div class="asset-missing"><strong>缺少可用素材</strong><div>当前镜头未选中素材或素材 ID 不在 manifest 中。</div></div>'
      );
    }

    function zoomPanel(scene) {
      const deleted = zoomIsDeleted(scene);
      const zoomId = deleted ? '' : (scene.zoomAssetId || '');
      const asset = zoomId ? zoomAsset(scene) : null;
      let preview = '<div class="asset-missing"><strong>未添加放大图</strong><div>可从 manifest 素材里新增一张放大图。</div></div>';
      if (zoomId && asset) {
        preview = assetPreviewHtml(asset, '<div class="asset-missing"><strong>放大图素材缺失</strong><div>manifest 中找不到：' + escapeHtml(zoomId) + '</div></div>');
      } else if (zoomId) {
        preview = '<div class="asset-missing"><strong>放大图素材缺失</strong><div>manifest 中找不到：' + escapeHtml(zoomId) + '</div></div>';
      }
      const buttonLabel = zoomId ? '替换放大图' : '新增放大图';
      return '<section class="zoom-section" data-zoom-section>' +
        '<input type="hidden" data-field="zoomAssetId" value="' + escapeHtml(zoomId) + '">' +
        '<input type="hidden" data-field="zoomImage" value="' + escapeHtml(deleted ? '' : (scene.zoomImage || asset?.sourcePath || '')) + '">' +
        '<input type="hidden" data-field="zoomDeleted" value="' + (deleted ? '1' : '0') + '">' +
        '<input type="hidden" data-field="zoomRemoved" value="' + (deleted ? '1' : '0') + '">' +
        '<div class="zoom-section-head">' +
          '<span class="zoom-section-title">放大图（可选素材）</span>' +
          '<span class="pill">' + escapeHtml(zoomId ? (asset?.type || '素材') : '未添加') + '</span>' +
        '</div>' +
        '<div class="asset-panel zoom-preview">' + preview + '</div>' +
        '<div class="zoom-actions">' +
          '<button type="button" data-action="choose-zoom-asset">' + buttonLabel + '</button>' +
          '<button type="button" class="danger" data-action="delete-zoom-asset">删除放大图</button>' +
        '</div>' +
      '</section>';
    }

    function escapeHtml(value) {
      return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    function fieldValue(scene, key) {
      return scene[key] ?? '';
    }

    function assetOptions(scene) {
      const current = scene.selectedAssetId || '';
      const options = ['<option value="">未选择素材</option>'].concat(data.assets.map(asset => {
        const selected = asset.id === current ? ' selected' : '';
        return '<option value="' + escapeHtml(asset.id) + '"' + selected + '>' + escapeHtml(asset.title || asset.id) + ' / ' + escapeHtml(asset.type || '') + '</option>';
      }));
      return options.join('');
    }

    function renderScene(scene, index) {
      const current = mergedScene(scene);
      const status = current.reviewStatus || 'pass';
      return '<article class="scene-card" data-scene-key="' + escapeHtml(current.sceneKey) + '" data-review-status="' + escapeHtml(status) + '">' +
        '<div class="scene-head">' +
          '<div>' +
            '<h2 class="scene-title">' + (index + 1) + '. ' + escapeHtml(current.title || '未命名镜头') + '</h2>' +
            '<div class="scene-key">' + escapeHtml(current.sceneKey) + '</div>' +
          '</div>' +
          '<span class="pill">' + escapeHtml(reviewStatusLabel(status)) + '</span>' +
        '</div>' +
        '<div class="scene-body">' +
          '<div>' +
            '<div class="asset-panel">' + assetPanel(current) + '</div>' +
            '<div class="field-row" style="margin-top:10px;">' +
              '<label>当前素材</label>' +
              '<select data-field="selectedAssetId">' + assetOptions(current) + '</select>' +
            '</div>' +
            zoomPanel(current) +
          '</div>' +
          '<div class="fields">' +
            '<div class="compact-grid">' +
              '<div class="field-row">' +
                '<label>批改状态</label>' +
                '<select data-field="reviewStatus">' +
                  '<option value="pass"' + (status === 'pass' ? ' selected' : '') + '>通过</option>' +
                  '<option value="revise"' + (status === 'revise' ? ' selected' : '') + '>需修改</option>' +
                  '<option value="delete"' + (status === 'delete' ? ' selected' : '') + '>删除</option>' +
                '</select>' +
              '</div>' +
              '<div class="field-row">' +
                '<label>字幕位置</label>' +
                '<select data-field="subtitlePosition">' +
                  '<option value="left-bottom"' + ((current.subtitlePosition || 'left-bottom') === 'left-bottom' ? ' selected' : '') + '>左下</option>' +
                  '<option value="center-bottom"' + (current.subtitlePosition === 'center-bottom' ? ' selected' : '') + '>居中下</option>' +
                  '<option value="right-bottom"' + (current.subtitlePosition === 'right-bottom' ? ' selected' : '') + '>右下</option>' +
                  '<option value="top"' + (current.subtitlePosition === 'top' ? ' selected' : '') + '>顶部</option>' +
                '</select>' +
              '</div>' +
            '</div>' +
            '<div class="field-row">' +
              '<label>屏幕文字</label>' +
              '<textarea data-field="screenText">' + escapeHtml(fieldValue(current, 'screenText')) + '</textarea>' +
            '</div>' +
            '<div class="field-row">' +
              '<label>口播</label>' +
              '<textarea data-field="voiceover">' + escapeHtml(fieldValue(current, 'voiceover')) + '</textarea>' +
            '</div>' +
            '<div class="field-row">' +
              '<label>给AI的改稿意见</label>' +
              '<textarea data-field="reviewNote">' + escapeHtml(fieldValue(current, 'reviewNote')) + '</textarea>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="actions">' +
          '<button type="button" data-action="choose-asset">选择素材</button>' +
          '<button type="button" class="danger" data-action="delete-scene">删除此镜头</button>' +
          '<button type="button" data-action="insert-before">在此前插入一镜</button>' +
          '<button type="button" data-action="insert-after">在此后插入一镜</button>' +
        '</div>' +
      '</article>';
    }

    function render() {
      scenes = orderedScenes(scenes);
      list.innerHTML = scenes.map(renderScene).join('');
    }

    function payloadFromCard(card) {
      const sceneKey = card.dataset.sceneKey;
      const base = scenesByKey.get(sceneKey) || scenes.find(scene => scene.sceneKey === sceneKey) || { sceneKey };
      const payload = {
        ...base,
        sceneKey
      };
      card.querySelectorAll('[data-field]').forEach(field => {
        const key = field.dataset.field;
        payload[key] = key === 'zoomDeleted' || key === 'zoomRemoved'
          ? field.value === '1' || field.value === 'true'
          : field.value;
      });
      if (payload.zoomAssetId) {
        const asset = assetsById.get(payload.zoomAssetId);
        payload.zoomImage = asset?.sourcePath || payload.zoomImage || '';
        payload.zoomDeleted = false;
        payload.zoomRemoved = false;
      } else {
        payload.zoomAssetId = '';
        if (payload.zoomDeleted || payload.zoomRemoved) {
          payload.zoomImage = '';
          payload.zoomDeleted = true;
          payload.zoomRemoved = true;
        } else {
          payload.zoomImage = payload.zoomImage || '';
          payload.zoomDeleted = false;
          payload.zoomRemoved = false;
        }
      }
      return payload;
    }

    async function postJson(url, payload) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(body.error || body.message || response.statusText || ('HTTP ' + response.status));
        error.status = response.status;
        error.body = body;
        throw error;
      }
      return body;
    }

    function buildSuccessMessage(result) {
      if (result?.videoPath) return '生成完成：' + result.videoPath;
      if (result?.outputDir) return '生成完成，输出目录：' + result.outputDir;
      return '生成完成。';
    }

    function buildErrorMessage(error) {
      if (error?.status === 501) return '生成视频暂不可用：' + error.message;
      if (error?.status === 409) return '已有生成任务在运行，请稍后再试。';
      return '生成失败：' + (error?.message || String(error));
    }

    async function saveScene(card) {
      const payload = payloadFromCard(card);
      localStorage.setItem(storageKey(payload.sceneKey), JSON.stringify(payload));
      card.dataset.reviewStatus = payload.reviewStatus || 'pass';
      card.querySelector('.pill').textContent = reviewStatusLabel(payload.reviewStatus || 'pass');
      await postJson('/api/save-scene', payload);
      serverState.scenes[payload.sceneKey] = {
        ...(serverState.scenes[payload.sceneKey] || {}),
        ...payload
      };
      showMessage('已保存：' + payload.sceneKey);
    }

    function currentSceneOrder() {
      return [...list.querySelectorAll('.scene-card')].map(card => card.dataset.sceneKey).filter(Boolean);
    }

    async function saveOrder() {
      const sceneOrder = currentSceneOrder();
      await postJson('/api/save-order', { sceneOrder });
      serverState.sceneOrder = sceneOrder;
      showMessage('镜头顺序已保存。');
    }

    async function buildVideo() {
      buildVideoButton.disabled = true;
      const originalText = buildVideoButton.textContent;
      buildVideoButton.textContent = '生成中...';
      showBuildStatus('正在调用本地视频生成任务...');
      try {
        const result = await postJson('/api/build-video', {});
        if (result?.ok === false) {
          throw new Error(result.error || '视频生成没有完成');
        }
        showBuildStatus(buildSuccessMessage(result), 'success');
      } catch (error) {
        showBuildStatus(buildErrorMessage(error), 'error');
      } finally {
        buildVideoButton.disabled = false;
        buildVideoButton.textContent = originalText;
      }
    }

    function setZoomAsset(card, assetId, deleted = false) {
      const asset = assetId ? assetsById.get(assetId) : null;
      card.querySelector('[data-field="zoomAssetId"]').value = assetId || '';
      card.querySelector('[data-field="zoomImage"]').value = asset?.sourcePath || '';
      card.querySelector('[data-field="zoomDeleted"]').value = deleted ? '1' : '0';
      card.querySelector('[data-field="zoomRemoved"]').value = deleted ? '1' : '0';
    }

    async function chooseAsset(card, fieldName = 'selectedAssetId') {
      if (!data.assets.length) {
        window.alert('当前 manifest 里还没有可选素材，先用 import_playbook_asset.mjs 导入素材。');
        return;
      }
      const choices = data.assets.map(asset => (asset.id + '  ' + (asset.title || '') + '  ' + (asset.type || ''))).join('\\n');
      const currentPayload = payloadFromCard(card);
      const picked = window.prompt('输入要使用的素材 ID：\\n\\n' + choices, currentPayload[fieldName] || '');
      if (picked === null) return;
      if (picked && !assetsById.has(picked)) {
        window.alert('manifest 中找不到这个素材 ID。');
        return;
      }
      if (fieldName === 'zoomAssetId') {
        setZoomAsset(card, picked, !picked);
      } else {
        card.querySelector('[data-field="selectedAssetId"]').value = picked;
      }
      await saveScene(card);
      render();
    }

    async function deleteZoomAsset(card) {
      setZoomAsset(card, '', true);
      await saveScene(card);
      render();
    }

    async function markDeleted(card) {
      card.querySelector('[data-field="reviewStatus"]').value = 'delete';
      await saveScene(card);
    }

    async function insertScene(anchorCard, position) {
      const anchorKey = anchorCard.dataset.sceneKey;
      const stamp = Date.now().toString(36);
      const sceneKey = 'insert-' + position + '-' + anchorKey + '-' + stamp;
      const anchor = payloadFromCard(anchorCard);
      const inserted = {
        sceneKey,
        title: position === 'before' ? '补充镜头：前插' : '补充镜头：后插',
        screenText: '',
        voiceover: '',
        reviewNote: '',
        reviewStatus: 'revise',
        subtitlePosition: anchor.subtitlePosition || 'left-bottom',
        selectedAssetId: '',
        zoomAssetId: '',
        zoomImage: '',
        zoomDeleted: false,
        zoomRemoved: false,
        isInserted: true,
        anchorSceneKey: anchorKey,
        insertPosition: position,
        createdAt: new Date().toISOString()
      };
      const anchorIndex = scenes.findIndex(scene => scene.sceneKey === anchorKey);
      const targetIndex = position === 'before' ? anchorIndex : anchorIndex + 1;
      scenes.splice(Math.max(0, targetIndex), 0, inserted);
      scenesByKey.set(sceneKey, inserted);
      localStorage.setItem(storageKey(sceneKey), JSON.stringify(inserted));
      await postJson('/api/save-scene', inserted);
      render();
      await saveOrder();
      document.querySelector('[data-scene-key="' + CSS.escape(sceneKey) + '"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    list.addEventListener('change', event => {
      const field = event.target.closest('[data-field]');
      if (!field) return;
      const card = field.closest('.scene-card');
      saveScene(card).then(() => {
        if (field.dataset.field === 'selectedAssetId') render();
      }).catch(error => showMessage('保存失败：' + error.message, 'error'));
    });

    list.addEventListener('input', event => {
      const field = event.target.closest('textarea[data-field], input[data-field]');
      if (!field) return;
      const card = field.closest('.scene-card');
      clearTimeout(card._saveTimer);
      card._saveTimer = setTimeout(() => {
        saveScene(card).catch(error => showMessage('保存失败：' + error.message, 'error'));
      }, 450);
    });

    list.addEventListener('click', event => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const card = button.closest('.scene-card');
      const action = button.dataset.action;
      const run = async () => {
        if (action === 'choose-asset') await chooseAsset(card);
        if (action === 'choose-zoom-asset') await chooseAsset(card, 'zoomAssetId');
        if (action === 'delete-zoom-asset') await deleteZoomAsset(card);
        if (action === 'delete-scene') await markDeleted(card);
        if (action === 'insert-before') await insertScene(card, 'before');
        if (action === 'insert-after') await insertScene(card, 'after');
      };
      run().catch(error => showMessage('操作失败：' + error.message, 'error'));
    });

    saveOrderButton.addEventListener('click', () => {
      saveOrder().catch(error => showMessage('保存顺序失败：' + error.message, 'error'));
    });

    buildVideoButton.addEventListener('click', () => {
      buildVideo();
    });

    async function init() {
      try {
        const response = await fetch('/api/state', { cache: 'no-store' });
        if (response.ok) {
          serverState = await response.json();
          const inserted = Object.values(serverState.scenes || {})
            .filter(scene => scene?.isInserted && scene.sceneKey && !scenesByKey.has(scene.sceneKey));
          inserted.forEach(scene => {
            scenes.push(scene);
            scenesByKey.set(scene.sceneKey, scene);
          });
        }
      } catch {
        serverState = { scenes: {}, sceneOrder: [] };
      }
      render();
      showMessage('审片台已就绪。');
    }

    init();
  </script>
</body>
</html>
`;
}

const flags = parseArgs(process.argv.slice(2));
const paths = await ensurePlaybookWorkspace(flags.output);
const recipe = await readJsonFile(paths.recipePath, 'recipe');
const manifest = await readAssetManifest(paths.root);
const html = buildHtml({ recipe, manifest, outputDir: paths.root });

await fs.writeFile(paths.boardPath, html, 'utf8');

console.log(JSON.stringify({
  ok: true,
  outputDir: paths.root,
  boardPath: paths.boardPath,
  sceneCount: Array.isArray(recipe.scenes) ? recipe.scenes.length : 0
}, null, 2));
