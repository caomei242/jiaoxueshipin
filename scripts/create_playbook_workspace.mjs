#!/usr/bin/env node
import fs from 'node:fs/promises';
import { ensurePlaybookWorkspace, parsePlaybookArgs } from '../lib/playbook/paths.mjs';

const flags = parsePlaybookArgs(process.argv.slice(2));
const paths = await ensurePlaybookWorkspace(flags.outputDir);

let exists = true;
try {
  await fs.access(paths.manifestPath);
} catch {
  exists = false;
}

if (!exists || flags.force) {
  const manifest = {
    version: 1,
    kind: 'playbook-assets',
    playbook: 'ai-image-to-video',
    store: '道理门',
    platform: '抖音',
    assets: [],
    updatedAt: new Date().toISOString()
  };
  await fs.writeFile(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify({
  ok: true,
  outputDir: paths.root,
  manifestPath: paths.manifestPath,
  videoPath: paths.videoPath
}, null, 2));
