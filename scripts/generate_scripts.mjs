#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../lib/config.mjs';
import { ensureDir, outputPath, readJson, writeJson } from '../lib/fs-utils.mjs';
import { estimateDuration, formatSrtTime } from '../lib/text-utils.mjs';
import { buildStoryboards } from '../lib/storyboards.mjs';
import { loadOfficialDocs, publicOfficialDocByUrl } from '../lib/tutorials/official-docs.mjs';

const flags = parseArgs(process.argv.slice(2));
const capture = await readJson(outputPath(flags.outputDir, 'capture', 'capture.json'));
const scriptDir = outputPath(flags.outputDir, 'scripts');
await ensureDir(scriptDir);
const officialDocsData = await loadOfficialDocs();
const officialDoc = publicOfficialDocByUrl(officialDocsData, capture.officialDocUrl);

const screenshotById = new Map(capture.screenshots.map(shot => [shot.id, shot]));
const storyboard = buildStoryboards(capture);

function buildStyle(styleId, styleName) {
  let cursor = 0;
  const scenes = storyboard[styleId].map((scene, index) => {
    const shot = screenshotById.get(scene.id) || capture.screenshots[index] || capture.screenshots[0];
    const duration = estimateDuration(scene.voiceover, 4.2, 8.5);
    const focusRect = scene.focusLabel && shot.focusRects
      ? shot.focusRects[scene.focusLabel] || shot.focusRect
      : shot.focusRect;
    const item = {
      index: index + 1,
      id: scene.id,
      style: styleId,
      styleName,
      title: scene.title,
      action: scene.action,
      emphasis: scene.emphasis,
      focusLabel: scene.focusLabel,
      voiceover: scene.voiceover,
      subtitle: scene.subtitle || scene.voiceover,
      duration,
      start: Number(cursor.toFixed(2)),
      end: Number((cursor + duration).toFixed(2)),
      screenshot: shot.file,
      devicePixelRatio: shot.devicePixelRatio,
      focusRect,
      sourceDescription: shot.description
    };
    cursor += duration;
    return item;
  });
  return {
    style: styleId,
    styleName,
    totalDuration: Number(cursor.toFixed(2)),
    scenes
  };
}

const scripts = {
  createdAt: new Date().toISOString(),
  captureSummary: {
    dryRun: capture.dryRun,
    officialDocUrl: capture.officialDocUrl,
    targetTestStore: capture.targetTestStore,
    degraded: capture.safety.degraded,
    reasons: capture.safety.reasons,
    clickedGenerate: capture.safety.clickedGenerate,
    generatedResult: capture.safety.generatedResult,
    clickedPublish: capture.safety.clickedPublish
  },
  officialDoc,
  variants: [
    buildStyle('nanny', '保姆级'),
    buildStyle('shortform', '短视频干货风')
  ]
};

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

console.log(`scripts=${path.join(scriptDir, 'tutorial-scripts.json')}`);
