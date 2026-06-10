# AI Image To Video Playbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a separate customer playbook-video pipeline that turns AI-optimized product images into a customer-facing horizontal video about `AI优化商品图 → 确认发布 → AI批量生成视频`.

**Architecture:** Keep the existing nanny tutorial pipeline untouched. Add a parallel `playbook` layer with its own output directory, asset manifest, recipe, review board, frame renderer, voiceover job list, and build script. The first implementation supports manual or semi-automatic asset import; live Computer Use capture is added after the video loop works.

**Tech Stack:** Node.js ESM scripts, `sharp`, existing Swift `compose_video.swift`, macOS `say`, local HTML review board, GitHub remote `git@github.com:caomei242/jiaoxueshipin.git`.

---

## Scope Check

The design has two separable subsystems:

- Playbook video software loop: workspace, asset manifest, recipe, review board, renderer, voiceover, MP4.
- Real browser capture loop: Chrome/CDP or Computer Use operation over 稿定商品 test store `道理门`.

Implement the playbook video software loop first. It is useful even with manually imported screenshots and generated result images. Add live browser capture only after the playbook build can output a video from selected assets.

## File Structure

- Create `/Users/gd/Desktop/主业/客户教程视频自动化/lib/playbook/paths.mjs`  
  Owns output paths and directory creation for the new playbook pipeline.
- Create `/Users/gd/Desktop/主业/客户教程视频自动化/lib/playbook/assets.mjs`  
  Owns asset manifest reading, writing, importing, rejecting, and tag lookup.
- Create `/Users/gd/Desktop/主业/客户教程视频自动化/lib/playbook/recipe.mjs`  
  Builds the first customer playbook recipe and customer-facing copy.
- Create `/Users/gd/Desktop/主业/客户教程视频自动化/scripts/create_playbook_workspace.mjs`  
  Creates the isolated output tree and writes the initial manifest.
- Create `/Users/gd/Desktop/主业/客户教程视频自动化/scripts/import_playbook_asset.mjs`  
  Imports a local screenshot, generated image, or AI video result into the asset library.
- Create `/Users/gd/Desktop/主业/客户教程视频自动化/scripts/generate_playbook_recipe.mjs`  
  Turns the asset manifest into `recipes/ai-image-to-video.json` and script files.
- Create `/Users/gd/Desktop/主业/客户教程视频自动化/scripts/export_playbook_board.mjs`  
  Exports `storyboard/playbook-board.html` for reviewing scenes, selected assets, subtitles, and voiceover.
- Create `/Users/gd/Desktop/主业/客户教程视频自动化/scripts/playbook_server.mjs`  
  Serves the playbook board and saves review overrides.
- Create `/Users/gd/Desktop/主业/客户教程视频自动化/scripts/render_playbook_frames.mjs`  
  Renders 1920x1080 frames from the playbook recipe and review state.
- Create `/Users/gd/Desktop/主业/客户教程视频自动化/scripts/list_playbook_voiceover_jobs.mjs`  
  Emits voiceover jobs with `AI` and `SKU` pronunciation normalization.
- Create `/Users/gd/Desktop/主业/客户教程视频自动化/build_playbook_video.sh`  
  Runs recipe generation, board export, review application, frame render, voiceover, Swift compose, and report.
- Modify `/Users/gd/Desktop/主业/客户教程视频自动化/package.json`  
  Adds `build:playbook` and `playbook:workspace` scripts.
- Modify `/Users/gd/Desktop/主业/客户教程视频自动化/README.md`  
  Documents the new playbook workflow and its separation from the old nanny tutorial pipeline.

## Task 1: Create Isolated Playbook Workspace

**Files:**
- Create: `/Users/gd/Desktop/主业/客户教程视频自动化/lib/playbook/paths.mjs`
- Create: `/Users/gd/Desktop/主业/客户教程视频自动化/scripts/create_playbook_workspace.mjs`
- Modify: `/Users/gd/Desktop/主业/客户教程视频自动化/package.json`

- [ ] **Step 1: Write the failing workspace smoke command**

Run this before creating the files:

```bash
node scripts/create_playbook_workspace.mjs \
  --output /tmp/tutorial-playbook-smoke \
  --force
```

Expected: fail with `Cannot find module` for `scripts/create_playbook_workspace.mjs`.

- [ ] **Step 2: Create `lib/playbook/paths.mjs`**

Use this complete file:

```js
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
      flags.outputDir = path.resolve(argv[index + 1]);
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
```

- [ ] **Step 3: Create `scripts/create_playbook_workspace.mjs`**

Use this complete file:

```js
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
```

- [ ] **Step 4: Update `package.json` scripts**

Add these entries inside `scripts`:

```json
"playbook:workspace": "node scripts/create_playbook_workspace.mjs",
"build:playbook": "./build_playbook_video.sh"
```

- [ ] **Step 5: Run the workspace smoke command**

Run:

```bash
node scripts/create_playbook_workspace.mjs \
  --output /tmp/tutorial-playbook-smoke \
  --force
```

Expected: JSON includes `"ok": true`, and `/tmp/tutorial-playbook-smoke/manifests/assets.json` exists.

- [ ] **Step 6: Commit Task 1**

```bash
git add lib/playbook/paths.mjs scripts/create_playbook_workspace.mjs package.json
git commit -m "feat: add playbook workspace scaffold"
```

## Task 2: Add Playbook Asset Manifest And Importer

**Files:**
- Create: `/Users/gd/Desktop/主业/客户教程视频自动化/lib/playbook/assets.mjs`
- Create: `/Users/gd/Desktop/主业/客户教程视频自动化/scripts/import_playbook_asset.mjs`

- [ ] **Step 1: Write the failing asset import command**

Run:

```bash
node scripts/import_playbook_asset.mjs \
  --output /tmp/tutorial-playbook-smoke \
  --source README.md \
  --type operation-screenshot \
  --title "操作截图 / 测试导入" \
  --tags ai-image-optimize,confirm-publish
```

Expected: fail with `Cannot find module` for the importer.

- [ ] **Step 2: Create `lib/playbook/assets.mjs`**

Implement these exported functions:

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensurePlaybookWorkspace, playbookPaths } from './paths.mjs';

export const ASSET_TYPES = new Set([
  'operation-screenshot',
  'dropdown-open',
  'before-after',
  'generated-image',
  'publish-confirm',
  'video-result'
]);

export function slugify(value) {
  return String(value || 'asset')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'asset';
}

export function assetSubdir(type) {
  if (type === 'generated-image' || type === 'before-after') return 'generated-images';
  if (type === 'video-result') return 'video-results';
  return 'operation-screenshots';
}

export async function readAssetManifest(outputDir) {
  const paths = playbookPaths(outputDir);
  try {
    return JSON.parse(await fs.readFile(paths.manifestPath, 'utf8'));
  } catch {
    await ensurePlaybookWorkspace(outputDir);
    return {
      version: 1,
      kind: 'playbook-assets',
      playbook: 'ai-image-to-video',
      store: '道理门',
      platform: '抖音',
      assets: [],
      updatedAt: new Date().toISOString()
    };
  }
}

export async function writeAssetManifest(outputDir, manifest) {
  const paths = await ensurePlaybookWorkspace(outputDir);
  const next = {
    ...manifest,
    assets: Array.isArray(manifest.assets) ? manifest.assets : [],
    updatedAt: new Date().toISOString()
  };
  await fs.writeFile(paths.manifestPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

export async function importAsset(outputDir, options) {
  if (!ASSET_TYPES.has(options.type)) {
    throw new Error(`invalid asset type: ${options.type}`);
  }
  const sourcePath = path.resolve(options.source);
  await fs.access(sourcePath);
  const paths = await ensurePlaybookWorkspace(outputDir);
  const manifest = await readAssetManifest(outputDir);
  const ext = path.extname(sourcePath) || '.asset';
  const id = options.id || `${options.type}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const title = options.title || id;
  const targetName = `${slugify(id)}${ext}`;
  const targetPath = path.join(paths.root, 'assets', assetSubdir(options.type), targetName);
  await fs.copyFile(sourcePath, targetPath);
  const entry = {
    id,
    type: options.type,
    title,
    sourcePath: targetPath,
    originalPath: sourcePath,
    featureTags: options.tags,
    store: options.store || '道理门',
    platform: options.platform || '抖音',
    status: 'active',
    createdAt: new Date().toISOString(),
    notes: options.notes || ''
  };
  manifest.assets = manifest.assets.filter(item => item.id !== id).concat(entry);
  await writeAssetManifest(outputDir, manifest);
  return entry;
}

export async function rejectAsset(outputDir, id, reason) {
  const manifest = await readAssetManifest(outputDir);
  manifest.assets = manifest.assets.map(item => item.id === id
    ? { ...item, status: 'reject', rejectReason: reason || '人工标记不用' }
    : item);
  await writeAssetManifest(outputDir, manifest);
  return manifest.assets.find(item => item.id === id);
}

export function findAssets(manifest, requiredTags = [], acceptedTypes = []) {
  const tags = requiredTags.map(String);
  const types = acceptedTypes.map(String);
  return (manifest.assets || []).filter(item => {
    if (item.status === 'reject') return false;
    if (types.length && !types.includes(item.type)) return false;
    return tags.every(tag => (item.featureTags || []).includes(tag));
  });
}
```

- [ ] **Step 3: Create `scripts/import_playbook_asset.mjs`**

Implement CLI parsing for `--output`, `--source`, `--type`, `--title`, `--tags`, `--id`, `--store`, `--platform`, and `--notes`; call `importAsset`; print the imported entry as JSON.

- [ ] **Step 4: Run the asset import smoke command**

Run:

```bash
node scripts/import_playbook_asset.mjs \
  --output /tmp/tutorial-playbook-smoke \
  --source README.md \
  --type operation-screenshot \
  --title "操作截图 / 测试导入" \
  --tags ai-image-optimize,confirm-publish
```

Expected: JSON includes `"type": "operation-screenshot"` and `assets/operation-screenshots/` contains the copied file.

- [ ] **Step 5: Verify reject behavior**

Run:

```bash
node --input-type=module <<'NODE'
import { readAssetManifest, rejectAsset, findAssets } from './lib/playbook/assets.mjs';
const output = '/tmp/tutorial-playbook-smoke';
const before = await readAssetManifest(output);
const id = before.assets[0].id;
await rejectAsset(output, id, 'smoke reject');
const after = await readAssetManifest(output);
const active = findAssets(after, ['ai-image-optimize'], ['operation-screenshot']);
if (active.length !== 0) throw new Error('rejected asset should not be selected');
console.log('asset reject smoke passed');
NODE
```

Expected: prints `asset reject smoke passed`.

- [ ] **Step 6: Commit Task 2**

```bash
git add lib/playbook/assets.mjs scripts/import_playbook_asset.mjs
git commit -m "feat: add playbook asset manifest"
```

## Task 3: Generate Customer Playbook Recipe

**Files:**
- Create: `/Users/gd/Desktop/主业/客户教程视频自动化/lib/playbook/recipe.mjs`
- Create: `/Users/gd/Desktop/主业/客户教程视频自动化/scripts/generate_playbook_recipe.mjs`

- [ ] **Step 1: Write the failing recipe command**

Run:

```bash
node scripts/generate_playbook_recipe.mjs --output /tmp/tutorial-playbook-smoke
```

Expected: fail with `Cannot find module`.

- [ ] **Step 2: Create `lib/playbook/recipe.mjs`**

Define a first recipe with these scene IDs in order:

```js
export const PLAYBOOK_SCENES = [
  'hook-old-product',
  'ai-image-optimize',
  'optimized-result',
  'confirm-publish',
  'ai-video-entry',
  'select-product',
  'generate-video',
  'video-result',
  'result-summary'
];
```

Each scene must include:

- `sceneKey`
- `title`
- `requiredTags`
- `acceptedTypes`
- `screenText`
- `voiceover`
- `duration`
- `selectedAssetId`
- `missingAsset`

Use these customer-facing copy lines:

```js
const COPY = {
  'hook-old-product': {
    title: '老商品图也能重新激活',
    screenText: '老商品图先优化，再生成商品视频',
    voiceover: '很多老商品不是不能卖，是主图和视频素材没有跟上。先用 AI 优化商品图，再生成商品视频。'
  },
  'ai-image-optimize': {
    title: '先用 AI 优化商品图',
    screenText: '第一步：AI优化商品图',
    voiceover: '第一步，先用 AI 优化商品图，把原来的商品图优化成更适合点击的主图、卖点图和 S K U 图。'
  },
  'optimized-result': {
    title: '查看优化后的商品图',
    screenText: '主图更吸引，卖点更清楚',
    voiceover: '优化后先看效果。主图负责吸引点击，卖点图负责让买家一眼看懂优势。'
  },
  'confirm-publish': {
    title: '确认发布到商品',
    screenText: '确认无误后发布到商品',
    voiceover: '确认图片没问题后，发布到测试店商品里。只有发布完成，后面生成视频才能读取到新商品图。'
  },
  'ai-video-entry': {
    title: '进入 AI生成视频',
    screenText: '第二步：AI批量生成视频',
    voiceover: '第二步，进入 AI 视频里的 AI 生成视频功能，用刚更新过的商品图继续生成视频。'
  },
  'select-product': {
    title: '选择平台、店铺和商品',
    screenText: '选择平台、店铺和要生成的视频商品',
    voiceover: '这里选择平台、店铺和商品。批量处理时，可以一次选多个商品，提高上新和素材制作效率。'
  },
  'generate-video': {
    title: '立即生成商品视频',
    screenText: '一键生成商品视频',
    voiceover: '选好商品后点击立即生成，让系统基于商品图生成商品视频。'
  },
  'video-result': {
    title: '查看视频生成结果',
    screenText: '图片变视频，商品更容易被看完',
    voiceover: '生成后查看视频结果。主图拉点击，视频拉停留，组合起来更适合电商转化。'
  },
  'result-summary': {
    title: '一套流程打通图和视频',
    screenText: 'AI优化图 + AI生成视频',
    voiceover: '这套流程适合老商品翻新，也适合批量上新。先优化图，再生成视频，让商品素材更完整。'
  }
};
```

- [ ] **Step 3: Implement asset selection**

In `buildPlaybookRecipe(manifest)`, select the first active asset matching every scene's `requiredTags` and `acceptedTypes`. If no asset matches, set `missingAsset: true` and leave `selectedAssetId: null`; keep the scene in the recipe so the review board can show exactly what is missing.

- [ ] **Step 4: Create `scripts/generate_playbook_recipe.mjs`**

The script must:

1. Parse `--output`.
2. Read `manifests/assets.json`.
3. Write `recipes/ai-image-to-video.json`.
4. Write `scripts/playbook-voiceover.md`.
5. Write `scripts/playbook.srt`.
6. Print a JSON summary with `sceneCount` and `missingAssetCount`.

- [ ] **Step 5: Run the recipe command**

Run:

```bash
node scripts/generate_playbook_recipe.mjs --output /tmp/tutorial-playbook-smoke
```

Expected: JSON includes `"sceneCount": 9`, and `/tmp/tutorial-playbook-smoke/recipes/ai-image-to-video.json` exists.

- [ ] **Step 6: Commit Task 3**

```bash
git add lib/playbook/recipe.mjs scripts/generate_playbook_recipe.mjs
git commit -m "feat: generate playbook recipe"
```

## Task 4: Export Playbook Review Board

**Files:**
- Create: `/Users/gd/Desktop/主业/客户教程视频自动化/scripts/export_playbook_board.mjs`
- Create: `/Users/gd/Desktop/主业/客户教程视频自动化/scripts/playbook_server.mjs`

- [ ] **Step 1: Write the failing board export command**

Run:

```bash
node scripts/export_playbook_board.mjs --output /tmp/tutorial-playbook-smoke
```

Expected: fail with `Cannot find module`.

- [ ] **Step 2: Create board exporter**

`scripts/export_playbook_board.mjs` must read the recipe and asset manifest, then write `storyboard/playbook-board.html`.

The board must show, per scene:

- Approval state: `通过`, `需修改`, `删除`.
- Selected asset preview or a clear missing-asset panel.
- Buttons: `选择素材`, `删除此镜头`, `在此前插入一镜`, `在此后插入一镜`.
- Editable fields: `屏幕文字`, `口播`, `给AI的改稿意见`.
- Subtitle position control: `左下`, `居中下`, `右下`, `顶部`.

State keys must be stored in `localStorage` as `playbook.review.<sceneKey>` and saved to `storyboard/playbook-review.json`.

- [ ] **Step 3: Create playbook server**

`scripts/playbook_server.mjs` must expose:

- `GET /` returns `storyboard/playbook-board.html`.
- `GET /api/state` returns `storyboard/playbook-review.json` or `{ scenes: {}, sceneOrder: [] }`.
- `POST /api/save-scene` saves one scene override.
- `POST /api/save-order` saves scene order.
- `POST /api/build-video` runs `./build_playbook_video.sh --output <output>`.
- `GET /api/build-result` returns last build result or existing video if present.

Use the same no-cache headers as `scripts/storyboard_server.mjs`.

- [ ] **Step 4: Run board export**

Run:

```bash
node scripts/export_playbook_board.mjs --output /tmp/tutorial-playbook-smoke
```

Expected: `/tmp/tutorial-playbook-smoke/storyboard/playbook-board.html` exists and contains `AI优化图到AI生成视频玩法审片台`.

- [ ] **Step 5: Run server smoke**

Run:

```bash
node scripts/playbook_server.mjs --output /tmp/tutorial-playbook-smoke --port 3839
```

Expected: terminal prints `playbook-board=http://127.0.0.1:3839/`. Open the URL and confirm the nine scenes render.

- [ ] **Step 6: Commit Task 4**

```bash
git add scripts/export_playbook_board.mjs scripts/playbook_server.mjs
git commit -m "feat: add playbook review board"
```

## Task 5: Render Horizontal Playbook Frames

**Files:**
- Create: `/Users/gd/Desktop/主业/客户教程视频自动化/scripts/render_playbook_frames.mjs`

- [ ] **Step 1: Write the failing render command**

Run:

```bash
node scripts/render_playbook_frames.mjs --output /tmp/tutorial-playbook-smoke
```

Expected: fail with `Cannot find module`.

- [ ] **Step 2: Implement frame renderer**

The renderer must:

1. Read `recipes/ai-image-to-video.json`.
2. Read `storyboard/playbook-review.json` if present.
3. Skip scenes whose review state is `删除`.
4. Render 1920x1080 PNG frames into `frames/playbook-horizontal/`.
5. Write `manifests/playbook-horizontal.json` compatible with `compose_video.swift`.

Frame layout:

- Background: light neutral workspace.
- Left 60 percent: selected operation screenshot or generated result image.
- Right 40 percent: title, one-line result statement, and optional asset label.
- Subtitle: drawn according to the scene's subtitle position.
- No giant separate subtitle board.

- [ ] **Step 3: Run render**

Run:

```bash
node scripts/render_playbook_frames.mjs --output /tmp/tutorial-playbook-smoke
```

Expected:

- `frames/playbook-horizontal/scene-01.png` exists.
- `manifests/playbook-horizontal.json` exists.
- Manifest width is `1920`, height is `1080`, and scenes array is not empty.

- [ ] **Step 4: Inspect one frame**

Run:

```bash
open /tmp/tutorial-playbook-smoke/frames/playbook-horizontal/scene-01.png
```

Expected: a readable horizontal frame with customer-facing text.

- [ ] **Step 5: Commit Task 5**

```bash
git add scripts/render_playbook_frames.mjs
git commit -m "feat: render playbook frames"
```

## Task 6: Add Voiceover Jobs And Build Script

**Files:**
- Create: `/Users/gd/Desktop/主业/客户教程视频自动化/scripts/list_playbook_voiceover_jobs.mjs`
- Create: `/Users/gd/Desktop/主业/客户教程视频自动化/build_playbook_video.sh`

- [ ] **Step 1: Write the failing voiceover job command**

Run:

```bash
node scripts/list_playbook_voiceover_jobs.mjs --output /tmp/tutorial-playbook-smoke
```

Expected: fail with `Cannot find module`.

- [ ] **Step 2: Create voiceover job script**

The script must print tab-separated rows:

```text
playbook	1	/tmp/tutorial-playbook-smoke/audio/playbook/scene-01.m4a	第一句客户口播
```

Normalize speech text:

- `SKU` becomes `S K U`.
- `AI` becomes `A I`.

The recipe text remains normal Chinese display text; only the voiceover job output is normalized.

- [ ] **Step 3: Create build script**

`build_playbook_video.sh` must:

1. Parse `--output`.
2. Create playbook workspace.
3. Generate playbook recipe.
4. Export playbook board.
5. Render playbook frames.
6. Clear `audio/playbook/`.
7. Run macOS `say` for every row from `list_playbook_voiceover_jobs.mjs`.
8. Run `swift compose_video.swift "$manifest" "$video"`.
9. Write `reports/playbook-build-report.md`.
10. Print `playbook-video=<absolute path>`.

- [ ] **Step 4: Run build**

Run:

```bash
./build_playbook_video.sh --output /tmp/tutorial-playbook-smoke
```

Expected: prints `playbook-video=/tmp/tutorial-playbook-smoke/videos/ai-image-to-video-playbook-horizontal.mp4`.

- [ ] **Step 5: Verify media metadata**

Run:

```bash
mdls -name kMDItemDurationSeconds /tmp/tutorial-playbook-smoke/videos/ai-image-to-video-playbook-horizontal.mp4
afinfo /tmp/tutorial-playbook-smoke/videos/ai-image-to-video-playbook-horizontal.mp4 | rg "estimated duration"
```

Expected: both commands report durations that are close to each other.

- [ ] **Step 6: Commit Task 6**

```bash
git add scripts/list_playbook_voiceover_jobs.mjs build_playbook_video.sh
git commit -m "feat: build playbook video"
```

## Task 7: Add Manual-Assisted Capture Skeleton

**Files:**
- Create: `/Users/gd/Desktop/主业/客户教程视频自动化/scripts/capture_playbook_flow.mjs`

- [ ] **Step 1: Write the failing capture command**

Run:

```bash
node scripts/capture_playbook_flow.mjs \
  --output /tmp/tutorial-playbook-smoke \
  --dry-run
```

Expected: fail with `Cannot find module`.

- [ ] **Step 2: Implement capture skeleton**

The script must:

1. Connect to the existing CDP base from `CDP_BASE_URL` or `http://localhost:3456`.
2. Find the active 稿定商品 tab.
3. Save current URL, title, and screenshot to `captures/`.
4. Create a capture manifest at `manifests/capture.json`.
5. In `--dry-run`, never click anything.
6. Without `--dry-run`, stop at a checkpoint before any final publish or generate action unless `--allow-publish --allow-generate-video` are both passed.

Safety rule:

```text
Only the 道理门 test store can be used for publish/generate actions.
```

- [ ] **Step 3: Run dry-run capture**

Run:

```bash
node scripts/capture_playbook_flow.mjs \
  --output /tmp/tutorial-playbook-smoke \
  --dry-run
```

Expected: writes `manifests/capture.json` with `mode: "dry-run"` and at least one screenshot if Chrome/CDP is reachable. If CDP is unreachable, the script exits with a clear message that includes the attempted base URL.

- [ ] **Step 4: Commit Task 7**

```bash
git add scripts/capture_playbook_flow.mjs
git commit -m "feat: add playbook capture skeleton"
```

## Task 8: Document And Protect The Workflow

**Files:**
- Modify: `/Users/gd/Desktop/主业/客户教程视频自动化/README.md`
- Modify: `/Users/gd/Desktop/主业/客户教程视频自动化/AGENTS.md`

- [ ] **Step 1: Update README with playbook commands**

Add a section named `AI优化图到AI生成视频玩法视频` with these commands:

```bash
node scripts/create_playbook_workspace.mjs \
  --output /Users/gd/Desktop/主业/客户教程视频/稿定商品-AI优化商品图/2026-06-10-ai-image-to-video-playbook

node scripts/import_playbook_asset.mjs \
  --output /Users/gd/Desktop/主业/客户教程视频/稿定商品-AI优化商品图/2026-06-10-ai-image-to-video-playbook \
  --source /absolute/path/to/asset.png \
  --type generated-image \
  --title "AI优化后的主图" \
  --tags ai-image-optimize,generated-result

./build_playbook_video.sh \
  --output /Users/gd/Desktop/主业/客户教程视频/稿定商品-AI优化商品图/2026-06-10-ai-image-to-video-playbook
```

- [ ] **Step 2: Update AGENTS with separation rule**

Add this rule:

```text
AI优化图到AI生成视频玩法视频属于 playbook 旁路产线；不得写入或覆盖 2026-05-29-horizontal-v7 的 storyboard、frames、audio、manifests 或 videos。单功能保姆教程继续使用原 storyboard-preview 链路。
```

- [ ] **Step 3: Run final smoke sequence**

Run:

```bash
rm -rf /tmp/tutorial-playbook-smoke
node scripts/create_playbook_workspace.mjs --output /tmp/tutorial-playbook-smoke --force
node scripts/import_playbook_asset.mjs --output /tmp/tutorial-playbook-smoke --source README.md --type operation-screenshot --title "操作截图 / 烟测" --tags ai-image-optimize
node scripts/generate_playbook_recipe.mjs --output /tmp/tutorial-playbook-smoke
node scripts/export_playbook_board.mjs --output /tmp/tutorial-playbook-smoke
node scripts/render_playbook_frames.mjs --output /tmp/tutorial-playbook-smoke
```

Expected: all commands exit `0`; frame and recipe files exist.

- [ ] **Step 4: Commit Task 8**

```bash
git add README.md AGENTS.md
git commit -m "docs: document playbook workflow"
```

- [ ] **Step 5: Push all implementation commits**

```bash
git push origin main
```

Expected: remote `origin/main` includes every task commit.

## Final Acceptance Checklist

- [ ] Existing `2026-05-29-horizontal-v7` output directory remains untouched.
- [ ] `node scripts/create_playbook_workspace.mjs --output <dir>` creates the new directory tree.
- [ ] `node scripts/import_playbook_asset.mjs` imports assets and writes `manifests/assets.json`.
- [ ] `node scripts/generate_playbook_recipe.mjs` writes a nine-scene customer recipe.
- [ ] `node scripts/export_playbook_board.mjs` writes a reviewable HTML board.
- [ ] `node scripts/render_playbook_frames.mjs` writes 1920x1080 frames and a Swift-compatible manifest.
- [ ] `./build_playbook_video.sh --output <dir>` writes an MP4.
- [ ] Voiceover pronounces `AI` as `A I` and `SKU` as `S K U`.
- [ ] The build report states whether the AI生成视频 result was real, missing, or blocked.
- [ ] README and AGENTS explain the playbook pipeline is separate from the old nanny tutorial pipeline.
