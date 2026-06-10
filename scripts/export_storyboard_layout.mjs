#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from '../lib/config.mjs';
import { evalInTarget, listTargets } from '../lib/cdp.mjs';
import { ensureDir, outputPath, writeJson } from '../lib/fs-utils.mjs';

const flags = parseArgs(process.argv.slice(2));
const storyboardDir = outputPath(flags.outputDir, 'storyboard');
await ensureDir(storyboardDir);

const targets = await listTargets();
const candidates = targets.filter(item => item.title?.includes('AI优化商品图教程分镜拍摄脚本') && item.url?.includes('127.0.0.1:3829'));
const inspectedTargets = await Promise.all(candidates.map(async item => {
  let pageState = {
    sceneCount: 0,
    dragHandleCount: 0,
    zoomModeControlCount: 0,
    cropSceneCount: 0,
    hasSaveOrder: false
  };
  try {
    pageState = await evalInTarget(item.targetId, `(() => ({
      sceneCount: document.querySelectorAll('.scene').length,
      dragHandleCount: document.querySelectorAll('.scene-drag-handle').length,
      zoomModeControlCount: document.querySelectorAll('[data-zoom-mode-controls]').length,
      cropSceneCount: [...document.querySelectorAll('.scene')].filter(scene => scene.querySelector('[data-field="zoomMode"]')?.value === 'crop').length,
      hasSaveOrder: document.documentElement.innerHTML.includes('/api/save-order')
    }))()`);
  } catch {
    // Keep the candidate; a later page reload may still make it usable.
  }
  return { ...item, pageState };
}));
function targetScore(item) {
  const url = String(item.url || '');
  let value = 0;
  if (item.pageState?.dragHandleCount > 0) value += 500;
  if (item.pageState?.zoomModeControlCount > 0) value += 180;
  if (item.pageState?.cropSceneCount > 0) value += 240;
  if (item.pageState?.hasSaveOrder) value += 120;
  if (/[?&]v=/.test(url)) value += 80;
  if (url === 'http://127.0.0.1:3829/') value += 20;
  if (item.attached) value += 5;
  value += Math.min(item.pageState?.sceneCount || 0, 50) / 100;
  return value;
}
const target = inspectedTargets
  .sort((a, b) => targetScore(b) - targetScore(a) || String(b.url || '').localeCompare(String(a.url || '')))[0];

if (!target) {
  throw new Error('没有找到已打开的审片板页面，请先打开 http://127.0.0.1:3829/');
}

const layout = await evalInTarget(target.targetId, `(() => {
  const storagePrefix = 'shooting-board:' + location.pathname + ':';
  function storageKey(scene, field) {
    return storagePrefix + (scene.dataset.sceneKey || scene.id) + ':' + field;
  }
  function readJson(scene, field) {
    try {
      const raw = localStorage.getItem(storageKey(scene, field));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  function readRaw(scene, field) {
    return localStorage.getItem(storageKey(scene, field));
  }
  function fieldValue(scene, field) {
    return scene.querySelector('[data-field="' + field + '"]')?.value || '';
  }
  function hasStoredValue(scene, field) {
    return localStorage.getItem(storageKey(scene, field)) !== null;
  }
  function savedOrField(scene, field) {
    const raw = readRaw(scene, field);
    return raw !== null ? raw : fieldValue(scene, field);
  }
  function embeddedJson(scene, field) {
    try {
      return JSON.parse(scene.dataset[field] || 'null');
    } catch {
      return null;
    }
  }
  const scenes = [...document.querySelectorAll('.scene')].map(scene => {
    const zoomDeleted = readRaw(scene, 'zoomDeleted') === '1' || readRaw(scene, 'zoomHidden') === '1';
    return {
      sceneKey: scene.dataset.sceneKey,
      sceneId: scene.dataset.sceneId,
      style: scene.dataset.style,
      index: scene.dataset.index,
      title: scene.dataset.title,
      reviewStatus: savedOrField(scene, 'reviewStatus') || 'pass',
      reviewStatusStored: hasStoredValue(scene, 'reviewStatus'),
      action: savedOrField(scene, 'action'),
      subtitle: savedOrField(scene, 'subtitle'),
      voiceover: savedOrField(scene, 'voiceover'),
      reviewNote: savedOrField(scene, 'reviewNote'),
      screenshot: savedOrField(scene, 'screenshot'),
      targetBox: readJson(scene, 'targetBox'),
      mouseMarker: readJson(scene, 'mouseMarker'),
      mouseManual: readRaw(scene, 'mouseManual') === '1',
      subtitleBox: readJson(scene, 'subtitleBox'),
      zoomImage: zoomDeleted
        ? ''
        : (savedOrField(scene, 'zoomImage') || scene.querySelector('[data-zoom-inset] img')?.getAttribute('src') || ''),
      zoomInset: readJson(scene, 'zoomInset'),
      zoomMode: savedOrField(scene, 'zoomMode') === 'crop' ? 'crop' : 'full',
      zoomCropPosition: readJson(scene, 'zoomCropPosition') || embeddedJson(scene, 'zoomCropPosition'),
      zoomDeleted,
      zoomHidden: readRaw(scene, 'zoomHidden') === '1'
    };
  });
  const storage = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(storagePrefix)) storage[key.slice(storagePrefix.length)] = localStorage.getItem(key);
  }
  return {
    exportedAt: new Date().toISOString(),
    targetId: ${JSON.stringify(target.targetId)},
    url: location.href,
    storagePrefix,
    scenes,
    storage
  };
})()`);

const outPath = path.join(storyboardDir, 'browser-layout.json');
await writeJson(outPath, layout);
console.log(`storyboard-layout=${outPath} scenes=${layout.scenes.length}`);
