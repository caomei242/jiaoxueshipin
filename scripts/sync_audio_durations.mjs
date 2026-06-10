#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseArgs } from '../lib/config.mjs';
import { outputPath, readJson, writeJson } from '../lib/fs-utils.mjs';
import { formatSrtTime } from '../lib/text-utils.mjs';

const execFileAsync = promisify(execFile);
const flags = parseArgs(process.argv.slice(2));
const scriptDir = outputPath(flags.outputDir, 'scripts');
const manifestDir = outputPath(flags.outputDir, 'manifests');
const scriptsPath = path.join(scriptDir, 'tutorial-scripts.json');
const scripts = await readJson(scriptsPath);

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function audioDuration(file) {
  if (!await exists(file)) return null;
  try {
    const { stdout, stderr } = await execFileAsync('/usr/bin/afinfo', [file], { maxBuffer: 1024 * 1024 });
    const text = `${stdout}\n${stderr}`;
    const estimated = text.match(/estimated duration:\s*([0-9.]+)/i);
    if (estimated) return Number(estimated[1]);
    const duration = text.match(/duration:\s*([0-9.]+)/i);
    if (duration) return Number(duration[1]);
  } catch {
    return null;
  }
  return null;
}

function recalcVariant(variant) {
  let cursor = 0;
  for (const scene of variant.scenes) {
    scene.start = Number(cursor.toFixed(2));
    scene.end = Number((cursor + scene.duration).toFixed(2));
    cursor += scene.duration;
  }
  variant.totalDuration = Number(cursor.toFixed(2));
}

for (const variant of scripts.variants) {
  for (const scene of variant.scenes) {
    const audioPath = outputPath(flags.outputDir, 'audio', variant.style, `scene-${String(scene.index).padStart(2, '0')}.m4a`);
    const duration = await audioDuration(audioPath);
    if (duration !== null && Number.isFinite(duration)) {
      scene.audioDuration = Number(duration.toFixed(3));
      scene.duration = Number(Math.max(scene.duration || 0, duration + 0.55).toFixed(2));
    }
  }
  recalcVariant(variant);
}

await writeJson(scriptsPath, scripts);

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
    scene.subtitle,
    ''
  ].join('\n')).join('\n');
  await fs.writeFile(path.join(scriptDir, `${variant.style}.srt`), srt, 'utf8');
}

const manifestNames = await fs.readdir(manifestDir).catch(() => []);
const scriptsByStyle = new Map(scripts.variants.map(variant => [variant.style, variant]));
for (const name of manifestNames.filter(name => name.endsWith('.json'))) {
  const manifestPath = path.join(manifestDir, name);
  const manifest = await readJson(manifestPath);
  const variant = scriptsByStyle.get(manifest.style);
  if (!variant) continue;
  const scenesByIndex = new Map(variant.scenes.map(scene => [scene.index, scene]));
  manifest.scenes = manifest.scenes.map(scene => {
    const source = scenesByIndex.get(scene.index);
    return source ? { ...scene, duration: source.duration, start: source.start, end: source.end, audioDuration: source.audioDuration } : scene;
  });
  manifest.totalDuration = variant.totalDuration;
  await writeJson(manifestPath, manifest);
}

console.log(`audio-durations=synced ${scriptsPath}`);
