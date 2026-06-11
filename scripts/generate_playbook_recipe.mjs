#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJson, ensureDir } from '../lib/fs-utils.mjs';
import { readAssetManifest } from '../lib/playbook/assets.mjs';
import {
  PLAYBOOK_DEFAULT_OUTPUT_DIR,
  ensurePlaybookWorkspace
} from '../lib/playbook/paths.mjs';
import { buildPlaybookRecipe } from '../lib/playbook/recipe.mjs';
import { formatSrtTime } from '../lib/text-utils.mjs';

function readFlagValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a path value`);
  }
  return value;
}

function parseArgs(argv) {
  const flags = {
    output: PLAYBOOK_DEFAULT_OUTPUT_DIR
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

function timedScenes(scenes) {
  let cursor = 0;
  return scenes.map((scene, index) => {
    const start = Number(cursor.toFixed(2));
    const end = Number((cursor + scene.duration).toFixed(2));
    cursor += scene.duration;
    return {
      ...scene,
      index: index + 1,
      start,
      end
    };
  });
}

function buildVoiceoverMarkdown(recipe, scenes) {
  return [
    '# AI优化图 + AI生成视频口播稿',
    '',
    `总镜头：${recipe.sceneCount}`,
    `预计时长：${recipe.totalDuration} 秒`,
    '',
    ...scenes.flatMap(scene => [
      `<!-- BEGIN sceneKey=${scene.sceneKey} -->`,
      `## ${scene.index}. ${scene.title}`,
      '',
      `screenText: ${scene.screenText}`,
      `asset: ${scene.selectedAssetId || 'MISSING'}`,
      '',
      'voiceover:',
      scene.voiceover,
      `<!-- END sceneKey=${scene.sceneKey} -->`,
      ''
    ])
  ].join('\n');
}

function buildSrt(scenes) {
  return scenes.map(scene => [
    String(scene.index),
    `${formatSrtTime(scene.start)} --> ${formatSrtTime(scene.end)}`,
    scene.voiceover,
    ''
  ].join('\n')).join('\n');
}

const flags = parseArgs(process.argv.slice(2));
const paths = await ensurePlaybookWorkspace(flags.output);
const scriptDir = path.join(paths.root, 'scripts');
await ensureDir(scriptDir);

const manifest = await readAssetManifest(paths.root);
const recipe = buildPlaybookRecipe(manifest);
const scenes = timedScenes(recipe.scenes);

await writeJson(paths.recipePath, recipe);

const voiceoverPath = path.join(scriptDir, 'playbook-voiceover.md');
await fs.writeFile(voiceoverPath, buildVoiceoverMarkdown(recipe, scenes), 'utf8');

const srtPath = path.join(scriptDir, 'playbook.srt');
await fs.writeFile(srtPath, buildSrt(scenes), 'utf8');

console.log(JSON.stringify({
  ok: true,
  outputDir: paths.root,
  recipePath: paths.recipePath,
  voiceoverPath,
  srtPath,
  sceneCount: recipe.sceneCount,
  missingAssetCount: recipe.missingAssetCount
}, null, 2));
