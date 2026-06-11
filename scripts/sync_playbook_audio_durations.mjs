#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  PLAYBOOK_DEFAULT_OUTPUT_DIR,
  playbookPaths
} from '../lib/playbook/paths.mjs';
import { formatSrtTime } from '../lib/text-utils.mjs';

const execFileAsync = promisify(execFile);

function readFlagValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a path value`);
  }
  return value;
}

function parseArgs(argv) {
  const flags = {
    output: process.env.PLAYBOOK_OUTPUT_DIR || PLAYBOOK_DEFAULT_OUTPUT_DIR,
    pad: 0.55
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--output':
        flags.output = path.resolve(readFlagValue(argv, index, arg));
        index += 1;
        break;
      case '--pad':
        flags.pad = Number(readFlagValue(argv, index, arg));
        if (!Number.isFinite(flags.pad) || flags.pad < 0) {
          throw new Error(`invalid --pad: ${argv[index + 1]}`);
        }
        index += 1;
        break;
      default:
        throw new Error(`unknown arg: ${arg}`);
    }
  }

  flags.output = path.resolve(flags.output);
  return flags;
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`invalid ${label}: ${filePath}`, { cause: error });
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function audioDuration(filePath) {
  if (!await exists(filePath)) return null;
  try {
    const { stdout, stderr } = await execFileAsync('/usr/bin/afinfo', [filePath], {
      maxBuffer: 1024 * 1024
    });
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
const paths = playbookPaths(flags.output);
const manifestPath = path.join(paths.root, 'manifests', 'playbook-horizontal.json');
const manifest = await readJson(manifestPath, 'playbook manifest');

if (!Array.isArray(manifest.scenes) || !manifest.scenes.length) {
  throw new Error(`playbook manifest has no scenes: ${manifestPath}`);
}

let cursor = 0;
const scenes = [];
for (const scene of manifest.scenes) {
  const duration = await audioDuration(scene.audioPath);
  const nextDuration = duration !== null && Number.isFinite(duration)
    ? Number(Math.max(scene.duration || 0, duration + flags.pad).toFixed(2))
    : Number(scene.duration || 0);
  const start = Number(cursor.toFixed(2));
  const end = Number((cursor + nextDuration).toFixed(2));
  cursor += nextDuration;
  scenes.push({
    ...scene,
    duration: nextDuration,
    start,
    end,
    audioDuration: duration !== null && Number.isFinite(duration)
      ? Number(duration.toFixed(3))
      : scene.audioDuration
  });
}

manifest.scenes = scenes;
manifest.totalDuration = Number(cursor.toFixed(2));
manifest.audioSyncedAt = new Date().toISOString();

await writeJson(manifestPath, manifest);

const scriptDir = path.join(paths.root, 'scripts');
await fs.mkdir(scriptDir, { recursive: true });
await fs.writeFile(path.join(scriptDir, 'playbook.srt'), buildSrt(scenes), 'utf8');

console.log(JSON.stringify({
  ok: true,
  manifestPath,
  sceneCount: scenes.length,
  totalDuration: manifest.totalDuration
}, null, 2));
