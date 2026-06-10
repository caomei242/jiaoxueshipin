#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from '../lib/config.mjs';
import { outputPath, readJson } from '../lib/fs-utils.mjs';

const flags = parseArgs(process.argv.slice(2));
const scripts = await readJson(outputPath(flags.outputDir, 'scripts', 'tutorial-scripts.json'));

function normalizeSpeechText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/SKU/gi, 'S K U')
    .replace(/AI/gi, 'A I')
    .replace(/\bS\s+K\s+U\b/gi, 'S K U')
    .replace(/\bA\s+I\b/gi, 'A I')
    .trim();
}

for (const variant of scripts.variants) {
  for (const scene of variant.scenes) {
    const audioPath = outputPath(flags.outputDir, 'audio', variant.style, `scene-${String(scene.index).padStart(2, '0')}.m4a`);
    const text = normalizeSpeechText(scene.voiceover);
    console.log([variant.style, scene.index, path.resolve(audioPath), text].join('\t'));
  }
}
