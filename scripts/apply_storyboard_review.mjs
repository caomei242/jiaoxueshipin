#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../lib/config.mjs';
import { outputPath, readJson, writeJson } from '../lib/fs-utils.mjs';
import { estimateDuration, formatSrtTime } from '../lib/text-utils.mjs';

const flags = parseArgs(process.argv.slice(2));
const scriptDir = outputPath(flags.outputDir, 'scripts');
const storyboardDir = outputPath(flags.outputDir, 'storyboard');
const scriptsPath = path.join(scriptDir, 'tutorial-scripts.json');
const reviewPath = path.join(storyboardDir, 'review-overrides.json');

async function readReviewState() {
  try {
    return JSON.parse(await fs.readFile(reviewPath, 'utf8'));
  } catch {
    return { scenes: {}, insertedScenes: [] };
  }
}

function sceneKey(variant, scene) {
  return scene.sceneKey || `${variant.style}-${scene.index}`;
}

function textOverride(value, fallback) {
  return value !== undefined && value !== null ? value : fallback;
}

function applyOverride(scene, override = {}) {
  const out = {
    ...scene,
    sceneKey: override.sceneKey || scene.sceneKey,
    title: textOverride(override.title, scene.title),
    action: textOverride(override.action, scene.action),
    subtitle: textOverride(override.subtitle, scene.subtitle),
    voiceover: textOverride(override.voiceover, scene.voiceover),
    screenshot: textOverride(override.screenshot, scene.screenshot),
    focusRect: textOverride(override.focusRect, scene.focusRect),
    devicePixelRatio: textOverride(override.devicePixelRatio, scene.devicePixelRatio),
    sourceDescription: textOverride(override.sourceDescription, scene.sourceDescription),
    zoomImage: textOverride(override.zoomImage, scene.zoomImage),
    zoomDeleted: textOverride(override.zoomDeleted, scene.zoomDeleted || false),
    zoomMode: textOverride(override.zoomMode, scene.zoomMode || 'full'),
    zoomCropPosition: textOverride(override.zoomCropPosition, scene.zoomCropPosition || null),
    reviewStatus: textOverride(override.reviewStatus, scene.reviewStatus || 'pass'),
    reviewNote: textOverride(override.reviewNote, scene.reviewNote || '')
  };
  return out;
}

function recalcVariant(variant) {
  let cursor = 0;
  for (const [idx, scene] of variant.scenes.entries()) {
    scene.index = idx + 1;
    scene.duration = estimateDuration(scene.voiceover || scene.subtitle || '', 4.2, 12);
    scene.start = Number(cursor.toFixed(2));
    scene.end = Number((cursor + scene.duration).toFixed(2));
    cursor += scene.duration;
  }
  variant.totalDuration = Number(cursor.toFixed(2));
}

function applySceneOrder(variant, scenes, reviewState) {
  const order = reviewState.sceneOrder?.[variant.style];
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

function buildInsertedScene(baseScene, item, reviewState) {
  const insertedKey = item.sceneKey;
  const override = reviewState.scenes?.[insertedKey] || {};
  const scene = {
    ...baseScene,
    sceneKey: insertedKey,
    inserted: true,
    sourceSceneKey: item.sourceSceneKey || baseScene.sceneKey,
    id: item.sceneId || baseScene.id,
    screenshot: item.screenshot || baseScene.screenshot,
    focusRect: Object.hasOwn(item, 'focusRect') ? item.focusRect : baseScene.focusRect,
    devicePixelRatio: item.devicePixelRatio || baseScene.devicePixelRatio,
    sourceDescription: item.sourceDescription || baseScene.sourceDescription,
    title: item.title || `补充镜头：${baseScene.title}`,
    action: item.action || baseScene.action,
    subtitle: item.subtitle || baseScene.subtitle,
    voiceover: item.voiceover || baseScene.voiceover,
    zoomImage: item.zoomImage || baseScene.zoomImage,
    zoomDeleted: item.zoomDeleted ?? baseScene.zoomDeleted ?? false,
    zoomMode: item.zoomMode || baseScene.zoomMode || 'full',
    zoomCropPosition: item.zoomCropPosition || baseScene.zoomCropPosition || null,
    reviewStatus: item.reviewStatus || 'pass',
    reviewNote: item.reviewNote || ''
  };
  return applyOverride(scene, override);
}

function applyReviewToVariant(variant, reviewState) {
  const insertedByBefore = new Map();
  const insertedByAfter = new Map();
  for (const item of reviewState.insertedScenes || []) {
    if (item.style !== variant.style) continue;
    if (item.beforeSceneKey) {
      if (!insertedByBefore.has(item.beforeSceneKey)) insertedByBefore.set(item.beforeSceneKey, []);
      insertedByBefore.get(item.beforeSceneKey).push(item);
      continue;
    }
    if (item.afterSceneKey) {
      if (!insertedByAfter.has(item.afterSceneKey)) insertedByAfter.set(item.afterSceneKey, []);
      insertedByAfter.get(item.afterSceneKey).push(item);
    }
  }
  for (const items of insertedByBefore.values()) {
    items.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  }
  for (const items of insertedByAfter.values()) {
    items.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  }

  const scenes = [];
  for (const scene of variant.scenes) {
    const key = sceneKey(variant, scene);
    const base = { ...scene, sceneKey: key };

    for (const item of insertedByBefore.get(key) || []) {
      const inserted = buildInsertedScene(base, item, reviewState);
      if (inserted.reviewStatus !== 'remove') scenes.push(inserted);
    }

    const reviewed = applyOverride(base, reviewState.scenes?.[key] || {});
    if (reviewed.reviewStatus !== 'remove') scenes.push(reviewed);

    for (const item of insertedByAfter.get(key) || []) {
      const inserted = buildInsertedScene(base, item, reviewState);
      if (inserted.reviewStatus !== 'remove') scenes.push(inserted);
    }
  }
  variant.scenes = applySceneOrder(variant, scenes, reviewState);
  recalcVariant(variant);
}

async function writeCompanionFiles(scripts) {
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

const scripts = await readJson(scriptsPath);
const reviewState = await readReviewState();

if (flags.style !== 'all') {
  scripts.variants = scripts.variants.filter(variant => variant.style === flags.style);
  if (scripts.variants.length === 0) {
    throw new Error(`style not found in tutorial scripts: ${flags.style}`);
  }
}

for (const variant of scripts.variants) {
  applyReviewToVariant(variant, reviewState);
}

scripts.reviewAppliedAt = new Date().toISOString();
scripts.reviewSource = reviewPath;
scripts.styleFilter = flags.style;

await writeJson(scriptsPath, scripts);
await writeCompanionFiles(scripts);

console.log(`storyboard-review=applied style=${flags.style} ${scriptsPath}`);
