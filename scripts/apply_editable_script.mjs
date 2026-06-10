#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../lib/config.mjs';
import { outputPath, readJson, writeJson } from '../lib/fs-utils.mjs';
import { estimateDuration, formatSrtTime } from '../lib/text-utils.mjs';

const flags = parseArgs(process.argv.slice(2));
const scriptDir = outputPath(flags.outputDir, 'scripts');
const editPath = path.join(scriptDir, 'editable-script.md');

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

if (!await exists(editPath)) {
  console.log(`editable-script=missing ${editPath}`);
  process.exit(0);
}

const scripts = await readJson(path.join(scriptDir, 'tutorial-scripts.json'));
const markdown = await fs.readFile(editPath, 'utf8');
const blocks = [...markdown.matchAll(/<!-- BEGIN style=([a-z0-9_-]+) index=(\d+) -->([\s\S]*?)<!-- END -->/g)];

function lineValue(block, field) {
  const match = block.match(new RegExp(`^${field}:\\s*(.*)$`, 'm'));
  return match ? match[1].trim() : null;
}

function voiceoverValue(block) {
  const match = block.match(/^voiceover:\s*\n([\s\S]*)$/m);
  return match ? match[1].trim() : null;
}

const byKey = new Map();
for (const [, style, indexText, block] of blocks) {
  byKey.set(`${style}:${Number(indexText)}`, {
    title: lineValue(block, 'title'),
    emphasis: lineValue(block, 'emphasis'),
    action: lineValue(block, 'action'),
    subtitle: lineValue(block, 'subtitle'),
    voiceover: voiceoverValue(block)
  });
}

function recalcVariant(variant) {
  let cursor = 0;
  for (const scene of variant.scenes) {
    const edit = byKey.get(`${variant.style}:${scene.index}`);
    if (edit) {
      for (const field of ['title', 'emphasis', 'action', 'subtitle', 'voiceover']) {
        if (edit[field] !== null && edit[field] !== undefined) scene[field] = edit[field];
      }
    }
    scene.duration = estimateDuration(scene.voiceover, 4.2, 12);
    scene.start = Number(cursor.toFixed(2));
    scene.end = Number((cursor + scene.duration).toFixed(2));
    cursor += scene.duration;
  }
  variant.totalDuration = Number(cursor.toFixed(2));
}

for (const variant of scripts.variants) recalcVariant(variant);

await writeJson(path.join(scriptDir, 'tutorial-scripts.json'), scripts);

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

console.log(`editable-script=applied ${editPath}`);
