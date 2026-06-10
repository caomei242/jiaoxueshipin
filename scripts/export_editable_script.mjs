#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../lib/config.mjs';
import { ensureDir, outputPath, readJson } from '../lib/fs-utils.mjs';

const flags = parseArgs(process.argv.slice(2));
const force = process.argv.includes('--force');
const scripts = await readJson(outputPath(flags.outputDir, 'scripts', 'tutorial-scripts.json'));
const editPath = outputPath(flags.outputDir, 'scripts', 'editable-script.md');

await ensureDir(path.dirname(editPath));

if (!force) {
  try {
    await fs.access(editPath);
    console.log(`editable-script=${editPath}`);
    process.exit(0);
  } catch {
    // First export.
  }
}

const lines = [
  '# 可编辑视频脚本',
  '',
  '只改每段里的 title / emphasis / action / subtitle / voiceover。',
  '不要删除 BEGIN/END 标记，也不要改 style 和 index。',
  '改完后运行：',
  '',
  '```bash',
  `./build_all.sh --output ${flags.outputDir} --skip-capture --aspect horizontal`,
  '```',
  ''
];

for (const variant of scripts.variants) {
  lines.push(`## ${variant.styleName}（${variant.style}）`, '');
  for (const scene of variant.scenes) {
    lines.push(`<!-- BEGIN style=${variant.style} index=${scene.index} -->`);
    lines.push(`### ${variant.style} ${String(scene.index).padStart(2, '0')}`);
    lines.push(`title: ${scene.title || ''}`);
    lines.push(`emphasis: ${scene.emphasis || ''}`);
    lines.push(`action: ${scene.action || ''}`);
    lines.push(`subtitle: ${scene.subtitle || ''}`);
    lines.push('voiceover:');
    lines.push(scene.voiceover || '');
    lines.push('<!-- END -->');
    lines.push('');
  }
}

await fs.writeFile(editPath, `${lines.join('\n')}\n`, 'utf8');
console.log(`editable-script=${editPath}`);
