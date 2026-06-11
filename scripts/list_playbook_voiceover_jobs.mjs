#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  PLAYBOOK_DEFAULT_OUTPUT_DIR,
  playbookPaths
} from '../lib/playbook/paths.mjs';

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

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function readFirstExistingJson(candidates) {
  for (const candidate of candidates) {
    try {
      return {
        filePath: candidate.filePath,
        kind: candidate.kind,
        data: await readJsonFile(candidate.filePath)
      };
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw new Error(`invalid ${candidate.kind}: ${candidate.filePath}`, { cause: error });
    }
  }
  throw new Error(`missing playbook manifest or recipe: ${candidates.map(item => item.filePath).join(', ')}`);
}

function normalizeSpeechText(text) {
  const skuToken = '\uE000';
  const aiToken = '\uE001';
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/S\s+K\s+U/gi, skuToken)
    .replace(/A\s+I/gi, aiToken)
    .replace(/SKU/gi, skuToken)
    .replace(/AI/gi, aiToken)
    .replaceAll(skuToken, 'S K U')
    .replaceAll(aiToken, 'A I')
    .trim();
}

function sceneIndex(scene, position) {
  const index = Number(scene?.index);
  return Number.isInteger(index) && index > 0 ? index : position + 1;
}

const flags = parseArgs(process.argv.slice(2));
const paths = playbookPaths(flags.output);
const source = await readFirstExistingJson([
  {
    kind: 'rendered playbook manifest',
    filePath: path.join(paths.root, 'manifests', 'playbook-horizontal.json')
  },
  {
    kind: 'playbook recipe',
    filePath: paths.recipePath
  }
]);

const scenes = Array.isArray(source.data?.scenes) ? source.data.scenes : [];
if (!scenes.length) {
  throw new Error(`no playbook scenes found in ${source.filePath}`);
}

for (const [position, scene] of scenes.entries()) {
  const index = sceneIndex(scene, position);
  const audioPath = path.join(paths.audioDir, `scene-${String(index).padStart(2, '0')}.m4a`);
  const speechText = normalizeSpeechText(scene.voiceover || scene.screenText || scene.title || '');
  console.log(['playbook', index, path.resolve(audioPath), speechText].join('\t'));
}
