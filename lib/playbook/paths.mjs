import fs from 'node:fs/promises';
import path from 'node:path';

export const PLAYBOOK_NAME = 'ai-image-to-video';
export const PLAYBOOK_DEFAULT_OUTPUT_DIR =
  '/Users/gd/Desktop/主业/客户教程视频/稿定商品-AI优化商品图/2026-06-10-ai-image-to-video-playbook';

export const PLAYBOOK_DIRS = [
  'captures',
  'assets',
  'assets/originals',
  'assets/generated-images',
  'assets/video-results',
  'assets/operation-screenshots',
  'manifests',
  'recipes',
  'storyboard',
  'frames/playbook-horizontal',
  'audio/playbook',
  'videos',
  'reports',
  'logs'
];

export function parsePlaybookArgs(argv) {
  const flags = {
    outputDir: process.env.PLAYBOOK_OUTPUT_DIR || PLAYBOOK_DEFAULT_OUTPUT_DIR,
    force: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--output requires a path value');
      }
      flags.outputDir = path.resolve(value);
      index += 1;
    } else if (arg === '--force') {
      flags.force = true;
    } else {
      throw new Error(`unknown arg: ${arg}`);
    }
  }
  return flags;
}

export function playbookPaths(outputDir) {
  const root = path.resolve(outputDir);
  return {
    root,
    manifestPath: path.join(root, 'manifests', 'assets.json'),
    recipePath: path.join(root, 'recipes', 'ai-image-to-video.json'),
    boardPath: path.join(root, 'storyboard', 'playbook-board.html'),
    reviewPath: path.join(root, 'storyboard', 'playbook-review.json'),
    framesDir: path.join(root, 'frames', 'playbook-horizontal'),
    audioDir: path.join(root, 'audio', 'playbook'),
    videoPath: path.join(root, 'videos', 'ai-image-to-video-playbook-horizontal.mp4'),
    reportPath: path.join(root, 'reports', 'playbook-build-report.md')
  };
}

export async function ensurePlaybookWorkspace(outputDir) {
  const root = path.resolve(outputDir);
  for (const dir of PLAYBOOK_DIRS) {
    await fs.mkdir(path.join(root, dir), { recursive: true });
  }
  return playbookPaths(root);
}
