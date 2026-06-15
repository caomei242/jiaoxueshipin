# Multi Tab Tutorial Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first version of a multi-tab tutorial review hub for `AI图片`, `AI视频`, and `玩法组合`, while keeping the existing AI优化商品图 and playbook review boards isolated.

**Architecture:** Add a small tutorial catalog layer and a standalone local Node server. The hub reads `configs/tutorials.json`, renders a lightweight HTML dashboard, links to existing review boards where available, and runs the correct build/open commands for the selected tutorial only.

**Tech Stack:** Node.js ESM, local HTML/CSS/JS, existing shell build scripts, macOS `open`, existing storyboard/playbook output directories.

---

## Scope Check

The approved design covers a long-term Hub plus future AI批量生成视频 capture. This plan implements only the first useful Hub shell:

- Add a catalog with three tutorials.
- Add a local Hub server and UI.
- Reuse existing AI优化商品图 and playbook review boards by linking to their existing ports.
- Register AI批量生成视频 as a separate tutorial project with a clear `待采集` status.
- Keep per-tutorial build/open actions isolated.

This plan does not implement the full AI批量生成视频 screenshot capture or final nanny storyboard. That should be a follow-up plan after the Hub works.

## File Structure

- Create: `/Users/gd/Desktop/主业/客户教程视频自动化/configs/tutorials.json`  
  Stores the tutorial tabs, output directories, board URLs, build commands, and video paths.
- Create: `/Users/gd/Desktop/主业/客户教程视频自动化/lib/tutorials/catalog.mjs`  
  Loads and normalizes the tutorial catalog, resolves tutorial IDs, and returns public summaries.
- Create: `/Users/gd/Desktop/主业/客户教程视频自动化/scripts/check_tutorial_catalog.mjs`  
  Smoke-checks that the catalog can load and includes the required three tutorials.
- Create: `/Users/gd/Desktop/主业/客户教程视频自动化/scripts/tutorial_hub_server.mjs`  
  Serves the multi-tab Hub and provides `/api/tutorials`, `/api/tutorial/:id/build`, and `/api/tutorial/:id/open`.
- Modify: `/Users/gd/Desktop/主业/客户教程视频自动化/package.json`  
  Adds `serve:hub` and `serve:hub:lan`.
- Modify: `/Users/gd/Desktop/主业/客户教程视频自动化/README.md`  
  Documents the Hub URL, tab behavior, and current AI视频 limitation.
- Modify: `/Users/gd/Desktop/主业/客户教程视频自动化/AGENTS.md`  
  Records that the Hub is the preferred entry point once available.

## Task 1: Add Tutorial Catalog

**Files:**
- Create: `/Users/gd/Desktop/主业/客户教程视频自动化/configs/tutorials.json`
- Create: `/Users/gd/Desktop/主业/客户教程视频自动化/lib/tutorials/catalog.mjs`
- Create: `/Users/gd/Desktop/主业/客户教程视频自动化/scripts/check_tutorial_catalog.mjs`

- [ ] **Step 1: Run the failing catalog check**

Run:

```bash
node scripts/check_tutorial_catalog.mjs
```

Expected: fails with `Cannot find module` because the check script does not exist yet.

- [ ] **Step 2: Create `configs/tutorials.json`**

Use this complete file:

```json
{
  "version": 1,
  "tabs": [
    {
      "id": "ai-image",
      "label": "AI图片",
      "description": "商品图、主图、SKU图和品牌展示相关教程"
    },
    {
      "id": "ai-video",
      "label": "AI视频",
      "description": "商品视频生成、批量视频和生成记录相关教程"
    },
    {
      "id": "playbook",
      "label": "玩法组合",
      "description": "多个功能串成客户能理解的一条龙玩法"
    }
  ],
  "tutorials": [
    {
      "id": "ai-image-optimize-nanny",
      "tabId": "ai-image",
      "title": "AI优化商品图",
      "subtitle": "保姆教程：从入口、平台、店铺、图片位置到确认发布",
      "templateType": "operation-tutorial",
      "status": "active",
      "statusLabel": "可审片",
      "targetStore": "道理门",
      "outputDir": "/Users/gd/Desktop/主业/客户教程视频/稿定商品-AI优化商品图/2026-05-29-horizontal-v7",
      "boardUrl": "http://127.0.0.1:3829/",
      "videoPath": "videos/nanny-horizontal-storyboard.mp4",
      "build": {
        "enabled": true,
        "command": "./build_storyboard_video.sh",
        "args": ["--output", "<outputDir>", "--style", "nanny"]
      }
    },
    {
      "id": "ai-batch-video-nanny",
      "tabId": "ai-video",
      "title": "AI批量生成视频",
      "subtitle": "保姆教程：选择平台、店铺、商品并生成视频",
      "templateType": "operation-tutorial",
      "status": "needs-capture",
      "statusLabel": "待采集",
      "targetStore": "道理门",
      "outputDir": "/Users/gd/Desktop/主业/客户教程视频/稿定商品-AI批量生成视频/2026-06-15-horizontal-v1",
      "boardUrl": "",
      "videoPath": "videos/nanny-horizontal-storyboard.mp4",
      "build": {
        "enabled": false,
        "reason": "AI批量生成视频的真实操作截图和分镜还没有采集，不能用假画面出片。"
      }
    },
    {
      "id": "ai-image-to-video-playbook",
      "tabId": "playbook",
      "title": "AI优化图到AI批量生成视频",
      "subtitle": "玩法组合：优化商品图、确认发布，再批量生成商品视频",
      "templateType": "playbook-chain",
      "status": "active",
      "statusLabel": "可审片",
      "targetStore": "道理门",
      "outputDir": "/Users/gd/Desktop/主业/客户教程视频/稿定商品-AI优化商品图/2026-06-10-ai-image-to-video-playbook",
      "boardUrl": "http://127.0.0.1:3839/",
      "videoPath": "videos/ai-image-to-video-playbook-horizontal.mp4",
      "build": {
        "enabled": true,
        "command": "./build_playbook_video.sh",
        "args": ["--output", "<outputDir>"]
      }
    }
  ]
}
```

- [ ] **Step 3: Create `lib/tutorials/catalog.mjs`**

Use this complete file:

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');
const DEFAULT_CATALOG_PATH = path.join(ROOT_DIR, 'configs', 'tutorials.json');

function assertSafeId(value, fieldName) {
  if (!/^[a-z0-9-]+$/.test(String(value || ''))) {
    throw new Error(`${fieldName} must use lowercase letters, numbers, and dashes: ${value}`);
  }
}

function replaceOutputDirArg(arg, outputDir) {
  return String(arg).replaceAll('<outputDir>', outputDir);
}

export function catalogPathFromEnv() {
  return path.resolve(process.env.TUTORIAL_CATALOG_PATH || DEFAULT_CATALOG_PATH);
}

export async function loadTutorialCatalog(catalogPath = catalogPathFromEnv()) {
  const raw = await fs.readFile(catalogPath, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data.tabs)) throw new Error('tutorial catalog missing tabs');
  if (!Array.isArray(data.tutorials)) throw new Error('tutorial catalog missing tutorials');

  const tabIds = new Set();
  const tabs = data.tabs.map(tab => {
    assertSafeId(tab.id, 'tab.id');
    if (tabIds.has(tab.id)) throw new Error(`duplicate tab id: ${tab.id}`);
    tabIds.add(tab.id);
    return {
      id: tab.id,
      label: String(tab.label || tab.id),
      description: String(tab.description || '')
    };
  });

  const tutorialIds = new Set();
  const tutorials = data.tutorials.map(tutorial => {
    assertSafeId(tutorial.id, 'tutorial.id');
    assertSafeId(tutorial.tabId, 'tutorial.tabId');
    if (!tabIds.has(tutorial.tabId)) throw new Error(`tutorial ${tutorial.id} references missing tab ${tutorial.tabId}`);
    if (tutorialIds.has(tutorial.id)) throw new Error(`duplicate tutorial id: ${tutorial.id}`);
    tutorialIds.add(tutorial.id);

    const outputDir = path.resolve(String(tutorial.outputDir || ''));
    const relativeVideoPath = String(tutorial.videoPath || '');
    const videoPath = path.resolve(outputDir, relativeVideoPath);
    const build = tutorial.build || { enabled: false };
    const buildArgs = Array.isArray(build.args)
      ? build.args.map(arg => replaceOutputDirArg(arg, outputDir))
      : [];

    return {
      id: tutorial.id,
      tabId: tutorial.tabId,
      title: String(tutorial.title || tutorial.id),
      subtitle: String(tutorial.subtitle || ''),
      templateType: String(tutorial.templateType || 'operation-tutorial'),
      status: String(tutorial.status || 'draft'),
      statusLabel: String(tutorial.statusLabel || tutorial.status || 'draft'),
      targetStore: String(tutorial.targetStore || ''),
      outputDir,
      boardUrl: String(tutorial.boardUrl || ''),
      relativeVideoPath,
      videoPath,
      build: {
        enabled: Boolean(build.enabled),
        command: build.command ? path.resolve(ROOT_DIR, String(build.command)) : '',
        args: buildArgs,
        reason: String(build.reason || '')
      }
    };
  });

  return {
    version: Number(data.version || 1),
    catalogPath,
    tabs,
    tutorials
  };
}

export function findTutorial(catalog, tutorialId) {
  return catalog.tutorials.find(tutorial => tutorial.id === tutorialId) || null;
}

export function publicTutorial(tutorial) {
  return {
    id: tutorial.id,
    tabId: tutorial.tabId,
    title: tutorial.title,
    subtitle: tutorial.subtitle,
    templateType: tutorial.templateType,
    status: tutorial.status,
    statusLabel: tutorial.statusLabel,
    targetStore: tutorial.targetStore,
    outputDir: tutorial.outputDir,
    boardUrl: tutorial.boardUrl,
    videoPath: tutorial.videoPath,
    buildEnabled: tutorial.build.enabled,
    buildDisabledReason: tutorial.build.reason
  };
}

export function publicCatalog(catalog) {
  return {
    version: catalog.version,
    tabs: catalog.tabs,
    tutorials: catalog.tutorials.map(publicTutorial)
  };
}
```

- [ ] **Step 4: Create `scripts/check_tutorial_catalog.mjs`**

Use this complete file:

```js
#!/usr/bin/env node
import { loadTutorialCatalog, publicCatalog } from '../lib/tutorials/catalog.mjs';

const catalog = await loadTutorialCatalog();
const publicData = publicCatalog(catalog);
const requiredIds = [
  'ai-image-optimize-nanny',
  'ai-batch-video-nanny',
  'ai-image-to-video-playbook'
];

for (const id of requiredIds) {
  if (!publicData.tutorials.some(tutorial => tutorial.id === id)) {
    throw new Error(`missing required tutorial: ${id}`);
  }
}

console.log(JSON.stringify({
  ok: true,
  tabs: publicData.tabs.map(tab => tab.label),
  tutorials: publicData.tutorials.map(tutorial => ({
    id: tutorial.id,
    title: tutorial.title,
    status: tutorial.status
  }))
}, null, 2));
```

- [ ] **Step 5: Run catalog check**

Run:

```bash
node scripts/check_tutorial_catalog.mjs
```

Expected: JSON includes `"ok": true`, `AI图片`, `AI视频`, `玩法组合`, and the three required tutorial IDs.

- [ ] **Step 6: Commit Task 1**

```bash
git add configs/tutorials.json lib/tutorials/catalog.mjs scripts/check_tutorial_catalog.mjs
git commit -m "feat: add tutorial catalog"
```

## Task 2: Add Tutorial Hub Server

**Files:**
- Create: `/Users/gd/Desktop/主业/客户教程视频自动化/scripts/tutorial_hub_server.mjs`
- Modify: `/Users/gd/Desktop/主业/客户教程视频自动化/package.json`

- [ ] **Step 1: Run the failing Hub server command**

Run:

```bash
node scripts/tutorial_hub_server.mjs --port 3849
```

Expected: fails with `Cannot find module` because the server does not exist yet.

- [ ] **Step 2: Create `scripts/tutorial_hub_server.mjs`**

Use this complete file:

```js
#!/usr/bin/env node
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadTutorialCatalog, findTutorial, publicCatalog } from '../lib/tutorials/catalog.mjs';

function readFlagValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function parseArgs(argv) {
  const flags = {
    port: 3849,
    host: process.env.TUTORIAL_HUB_HOST || '127.0.0.1'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--port') {
      flags.port = Number(readFlagValue(argv, index, arg));
      if (!Number.isInteger(flags.port) || flags.port <= 0) throw new Error('--port requires a positive integer');
      index += 1;
    } else if (arg === '--host') {
      flags.host = readFlagValue(argv, index, arg);
      index += 1;
    } else {
      throw new Error(`unknown arg: ${arg}`);
    }
  }
  return flags;
}

function noCacheHeaders(type = 'text/plain; charset=utf-8') {
  return {
    'Content-Type': type,
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function sendJson(res, status, data) {
  res.writeHead(status, noCacheHeaders('application/json; charset=utf-8'));
  res.end(`${JSON.stringify(data, null, 2)}\n`);
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, noCacheHeaders(type));
  res.end(text);
}

function ensureInsideOutputDir(tutorial, targetPath) {
  const resolved = path.resolve(targetPath);
  const root = path.resolve(tutorial.outputDir);
  if (resolved === root || resolved.startsWith(root + path.sep)) return resolved;
  const error = new Error('只能打开当前教程输出目录内的文件。');
  error.status = 403;
  throw error;
}

async function readRequestJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

async function existingVideoInfo(tutorial) {
  try {
    const stat = await fs.stat(tutorial.videoPath);
    if (!stat.isFile() || stat.size <= 0) return null;
    return {
      exists: true,
      path: tutorial.videoPath,
      fileSize: stat.size,
      modifiedAt: stat.mtime.toISOString()
    };
  } catch {
    return {
      exists: false,
      path: tutorial.videoPath
    };
  }
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: path.resolve(command, '..'),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', code => {
      const output = Buffer.concat(stdout).toString('utf8');
      const errorOutput = Buffer.concat(stderr).toString('utf8');
      if (code === 0) {
        resolve({ code, stdout: output, stderr: errorOutput });
      } else {
        const error = new Error(`command failed with exit ${code}`);
        error.code = code;
        error.stdout = output;
        error.stderr = errorOutput;
        reject(error);
      }
    });
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderHubHtml(publicData) {
  const dataJson = JSON.stringify(publicData).replaceAll('</script>', '<\\/script>');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>客户教程视频审片台</title>
  <style>
    :root { color-scheme: light; --bg: #f3f6fb; --panel: #fff; --ink: #101828; --muted: #667085; --line: #d0d5dd; --brand: #2563eb; --green: #16a34a; --orange: #f97316; --red: #ef4444; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; color: var(--ink); background: var(--bg); }
    header { padding: 22px 28px; color: white; background: #0b1220; }
    h1 { margin: 0 0 8px; font-size: 24px; }
    header p { margin: 0; color: #cbd5e1; }
    main { padding: 22px 28px 36px; }
    .tabs { display: flex; gap: 10px; margin-bottom: 16px; }
    .tab { border: 1px solid var(--line); border-radius: 8px; padding: 10px 16px; background: white; font-weight: 800; cursor: pointer; }
    .tab.active { color: white; border-color: var(--brand); background: var(--brand); }
    .layout { display: grid; grid-template-columns: 360px 1fr; gap: 18px; }
    .panel { border: 1px solid var(--line); border-radius: 12px; background: var(--panel); box-shadow: 0 10px 24px rgba(16, 24, 40, .06); }
    .list { padding: 14px; }
    .tutorial { width: 100%; border: 1px solid var(--line); border-radius: 10px; padding: 14px; margin: 0 0 12px; text-align: left; background: white; cursor: pointer; }
    .tutorial.active { border-color: var(--brand); box-shadow: 0 0 0 3px rgba(37, 99, 235, .14); }
    .tutorial strong { display: block; margin-bottom: 6px; font-size: 16px; }
    .tutorial span { display: block; color: var(--muted); font-size: 13px; line-height: 1.5; }
    .detail { padding: 20px; min-height: 480px; }
    .detail h2 { margin: 0 0 8px; font-size: 24px; }
    .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 18px 0; }
    .meta div { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; background: #f8fafc; }
    .meta b { display: block; margin-bottom: 4px; color: #475467; font-size: 12px; }
    .meta span { display: block; overflow-wrap: anywhere; font-size: 13px; }
    .badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 4px 10px; color: white; font-size: 12px; font-weight: 800; background: var(--green); }
    .badge.needs-capture { background: var(--orange); }
    .badge.draft { background: #64748b; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
    button, a.action { border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; color: var(--ink); background: white; font-weight: 800; text-decoration: none; cursor: pointer; }
    button.primary, a.primary { border-color: var(--brand); color: white; background: var(--brand); }
    button:disabled { opacity: .45; cursor: not-allowed; }
    pre { max-height: 190px; overflow: auto; border-radius: 8px; padding: 12px; color: #dbeafe; background: #0b1220; white-space: pre-wrap; }
    .note { margin-top: 18px; border-left: 4px solid var(--orange); background: #fff7ed; padding: 12px; color: #7c2d12; line-height: 1.65; }
  </style>
</head>
<body>
  <header>
    <h1>客户教程视频审片台</h1>
    <p>按产品功能和玩法组合管理教程。当前页面只生成当前教程，避免镜头互相串台。</p>
  </header>
  <main>
    <div class="tabs" id="tabs"></div>
    <div class="layout">
      <section class="panel list" id="tutorialList"></section>
      <section class="panel detail" id="detail"></section>
    </div>
  </main>
  <script>window.__TUTORIAL_DATA__ = ${dataJson};</script>
  <script>
    const state = { tabId: '', tutorialId: '' };
    const data = window.__TUTORIAL_DATA__;
    const tabsEl = document.getElementById('tabs');
    const listEl = document.getElementById('tutorialList');
    const detailEl = document.getElementById('detail');

    function tutorialsForTab(tabId) {
      return data.tutorials.filter(tutorial => tutorial.tabId === tabId);
    }

    function selectTab(tabId) {
      state.tabId = tabId;
      const first = tutorialsForTab(tabId)[0];
      state.tutorialId = first ? first.id : '';
      render();
    }

    function selectTutorial(id) {
      state.tutorialId = id;
      render();
    }

    async function post(path, body = {}) {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || response.statusText);
      return json;
    }

    function setLog(text) {
      const log = document.getElementById('log');
      if (log) log.textContent = text;
    }

    async function buildTutorial(id) {
      setLog('正在生成当前教程视频...');
      try {
        const result = await post('/api/tutorial/' + id + '/build');
        setLog(JSON.stringify(result, null, 2));
      } catch (error) {
        setLog(error.message);
      }
    }

    async function openTarget(id, target, action = 'open') {
      setLog('正在打开...');
      try {
        const result = await post('/api/tutorial/' + id + '/open', { target, action });
        setLog(JSON.stringify(result, null, 2));
      } catch (error) {
        setLog(error.message);
      }
    }

    function render() {
      tabsEl.innerHTML = data.tabs.map(tab => '<button class="tab ' + (tab.id === state.tabId ? 'active' : '') + '" data-tab="' + tab.id + '">' + tab.label + '</button>').join('');
      tabsEl.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => selectTab(button.dataset.tab)));

      const tutorials = tutorialsForTab(state.tabId);
      listEl.innerHTML = tutorials.map(tutorial => '<button class="tutorial ' + (tutorial.id === state.tutorialId ? 'active' : '') + '" data-id="' + tutorial.id + '"><strong>' + tutorial.title + '</strong><span>' + tutorial.subtitle + '</span></button>').join('');
      listEl.querySelectorAll('.tutorial').forEach(button => button.addEventListener('click', () => selectTutorial(button.dataset.id)));

      const tutorial = data.tutorials.find(item => item.id === state.tutorialId);
      if (!tutorial) {
        detailEl.innerHTML = '<h2>没有教程</h2>';
        return;
      }
      const statusClass = tutorial.status === 'needs-capture' ? 'needs-capture' : tutorial.status === 'active' ? '' : 'draft';
      const boardAction = tutorial.boardUrl ? '<a class="action primary" href="' + tutorial.boardUrl + '" target="_blank">进入审片</a>' : '<button disabled>待采集后开放审片</button>';
      const buildButton = tutorial.buildEnabled ? '<button class="primary" data-build="' + tutorial.id + '">一键生成当前教程</button>' : '<button disabled>暂不能生成</button>';
      const reason = tutorial.buildDisabledReason ? '<div class="note">' + tutorial.buildDisabledReason + '</div>' : '';
      detailEl.innerHTML = '<span class="badge ' + statusClass + '">' + tutorial.statusLabel + '</span>' +
        '<h2>' + tutorial.title + '</h2>' +
        '<p>' + tutorial.subtitle + '</p>' +
        '<div class="meta">' +
        '<div><b>教程类型</b><span>' + tutorial.templateType + '</span></div>' +
        '<div><b>测试店</b><span>' + tutorial.targetStore + '</span></div>' +
        '<div><b>输出目录</b><span>' + tutorial.outputDir + '</span></div>' +
        '<div><b>视频路径</b><span>' + tutorial.videoPath + '</span></div>' +
        '</div>' +
        '<div class="actions">' + boardAction + buildButton +
        '<button data-open-video="' + tutorial.id + '">打开视频</button>' +
        '<button data-reveal-video="' + tutorial.id + '">访达定位</button>' +
        '<button data-open-folder="' + tutorial.id + '">打开视频文件夹</button>' +
        '</div>' +
        reason +
        '<pre id="log">等待操作</pre>';

      detailEl.querySelector('[data-build]')?.addEventListener('click', event => buildTutorial(event.currentTarget.dataset.build));
      detailEl.querySelector('[data-open-video]')?.addEventListener('click', event => openTarget(event.currentTarget.dataset.openVideo, 'video', 'open'));
      detailEl.querySelector('[data-reveal-video]')?.addEventListener('click', event => openTarget(event.currentTarget.dataset.revealVideo, 'video', 'reveal'));
      detailEl.querySelector('[data-open-folder]')?.addEventListener('click', event => openTarget(event.currentTarget.dataset.openFolder, 'folder', 'open'));
    }

    state.tabId = data.tabs[0]?.id || '';
    state.tutorialId = tutorialsForTab(state.tabId)[0]?.id || '';
    render();
  </script>
</body>
</html>`;
}

async function openTarget(tutorial, payload = {}) {
  const target = String(payload.target || 'video');
  const action = String(payload.action || 'open');
  const targetPath = target === 'folder'
    ? path.dirname(tutorial.videoPath)
    : tutorial.videoPath;
  const safePath = ensureInsideOutputDir(tutorial, targetPath);
  await fs.mkdir(path.dirname(tutorial.videoPath), { recursive: true });
  const args = action === 'reveal'
    ? ['-R', safePath]
    : [safePath];
  const result = await runCommand('/usr/bin/open', args);
  return { ok: true, target, action, path: safePath, stdout: result.stdout, stderr: result.stderr };
}

const flags = parseArgs(process.argv.slice(2));
let buildRunning = false;

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, noCacheHeaders());
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const catalog = await loadTutorialCatalog();

    if (req.method === 'GET' && url.pathname === '/') {
      sendText(res, 200, renderHubHtml(publicCatalog(catalog)), 'text/html; charset=utf-8');
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/tutorials') {
      const data = publicCatalog(catalog);
      data.tutorials = await Promise.all(data.tutorials.map(async tutorial => ({
        ...tutorial,
        videoInfo: await existingVideoInfo(findTutorial(catalog, tutorial.id))
      })));
      sendJson(res, 200, data);
      return;
    }

    const buildMatch = url.pathname.match(/^\/api\/tutorial\/([^/]+)\/build$/);
    if (req.method === 'POST' && buildMatch) {
      const tutorial = findTutorial(catalog, buildMatch[1]);
      if (!tutorial) {
        sendJson(res, 404, { ok: false, error: '教程不存在' });
        return;
      }
      if (!tutorial.build.enabled) {
        sendJson(res, 409, { ok: false, error: tutorial.build.reason || '当前教程暂不能生成' });
        return;
      }
      if (buildRunning) {
        sendJson(res, 409, { ok: false, error: '已有视频正在生成，请稍后再试。' });
        return;
      }
      buildRunning = true;
      try {
        const result = await runCommand(tutorial.build.command, tutorial.build.args);
        sendJson(res, 200, {
          ok: true,
          tutorialId: tutorial.id,
          videoPath: tutorial.videoPath,
          videoInfo: await existingVideoInfo(tutorial),
          stdout: result.stdout,
          stderr: result.stderr
        });
      } finally {
        buildRunning = false;
      }
      return;
    }

    const openMatch = url.pathname.match(/^\/api\/tutorial\/([^/]+)\/open$/);
    if (req.method === 'POST' && openMatch) {
      const tutorial = findTutorial(catalog, openMatch[1]);
      if (!tutorial) {
        sendJson(res, 404, { ok: false, error: '教程不存在' });
        return;
      }
      const payload = await readRequestJson(req);
      const result = await openTarget(tutorial, payload);
      sendJson(res, 200, result);
      return;
    }

    sendText(res, 404, 'Not found');
  } catch (error) {
    sendJson(res, error.status || 500, {
      ok: false,
      error: error.message
    });
  }
});

server.listen(flags.port, flags.host, () => {
  const shownHost = flags.host === '0.0.0.0' ? '0.0.0.0' : flags.host;
  console.log(`Tutorial hub listening at http://${shownHost}:${flags.port}/`);
});
```

- [ ] **Step 3: Add package scripts**

Modify the `scripts` object in `package.json` to include:

```json
"serve:hub": "node scripts/tutorial_hub_server.mjs --port 3849",
"serve:hub:lan": "node scripts/tutorial_hub_server.mjs --port 3849 --host 0.0.0.0"
```

- [ ] **Step 4: Run Hub server smoke test**

Run:

```bash
node scripts/tutorial_hub_server.mjs --port 3849
```

Expected: process stays running and prints `Tutorial hub listening at http://127.0.0.1:3849/`.

In another shell, run:

```bash
curl -s http://127.0.0.1:3849/api/tutorials | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s); if(j.tabs.length!==3) throw new Error('bad tab count'); console.log(j.tutorials.map(t=>t.id).join('\\n'))})"
```

Expected output includes:

```text
ai-image-optimize-nanny
ai-batch-video-nanny
ai-image-to-video-playbook
```

- [ ] **Step 5: Commit Task 2**

```bash
git add scripts/tutorial_hub_server.mjs package.json
git commit -m "feat: add tutorial hub server"
```

## Task 3: Verify Hub UI In Browser

**Files:**
- No source files unless a visual bug is found.

- [ ] **Step 1: Start the Hub**

Run:

```bash
npm run serve:hub
```

Expected: Hub is available at `http://127.0.0.1:3849/`.

- [ ] **Step 2: Open the Hub in Browser**

Use the Browser or Chrome tool to open:

```text
http://127.0.0.1:3849/?v=20260615
```

Expected:

- Top header says `客户教程视频审片台`.
- Tabs show `AI图片`, `AI视频`, `玩法组合`.
- `AI图片` shows `AI优化商品图`.
- `AI视频` shows `AI批量生成视频` with `待采集`.
- `玩法组合` shows `AI优化图到AI批量生成视频`.

- [ ] **Step 3: Check disabled AI视频 build**

Click `AI视频` -> `AI批量生成视频`.

Expected:

- `暂不能生成` is disabled.
- A note explains the real screenshots and storyboard have not been captured yet.
- The page does not pretend that a video can already be generated.

- [ ] **Step 4: Check existing board links**

Click `AI图片` -> `AI优化商品图` -> `进入审片`.

Expected: opens or navigates to `http://127.0.0.1:3829/`.

Click `玩法组合` -> `AI优化图到AI批量生成视频` -> `进入审片`.

Expected: opens or navigates to `http://127.0.0.1:3839/`.

- [ ] **Step 5: Commit any UI fixes**

If no fixes are needed, do not create a commit.

If a source fix is needed:

```bash
git add scripts/tutorial_hub_server.mjs
git commit -m "fix: polish tutorial hub ui"
```

## Task 4: Document Hub Entry Point

**Files:**
- Modify: `/Users/gd/Desktop/主业/客户教程视频自动化/README.md`
- Modify: `/Users/gd/Desktop/主业/客户教程视频自动化/AGENTS.md`

- [ ] **Step 1: Update README**

Add this section near the local service instructions:

```markdown
## 多 Tab 教程审片台

第一版多 Tab Hub 是本地统一入口，用来管理不同产品功能和玩法组合教程。它不替代各子功能的审片台，而是负责按教程目录进入对应审片、生成当前教程、打开视频和定位输出目录。

启动：

```bash
cd /Users/gd/Desktop/主业/客户教程视频自动化
npm run serve:hub
```

打开：

```text
http://127.0.0.1:3849/
```

当前三块：

- `AI图片 / AI优化商品图`：跳转到现有保姆教程审片台。
- `AI视频 / AI批量生成视频`：先作为独立教程项目登记，状态为 `待采集`；必须采集真实截图后才能出片。
- `玩法组合 / AI优化图到AI批量生成视频`：跳转到现有玩法组合审片台。

同内网访问：

```bash
npm run serve:hub:lan
```

例如本机 IP 是 `10.1.45.166`，同内网设备打开：

```text
http://10.1.45.166:3849/
```
```

- [ ] **Step 2: Update AGENTS.md**

Add this project rule:

```markdown
- 多教程并行时，优先从多 Tab Hub 进入；Hub 默认端口为 `3849`，本机地址 `http://127.0.0.1:3849/`。Hub 只负责教程目录、入口、当前教程生成和打开产物；具体红框、鼠标、字幕、放大图和镜头批改仍由各子功能审片台负责。新增教程必须先写入 `configs/tutorials.json`，并使用独立输出目录，不能混入旧 `2026-05-29-horizontal-v7`。
```

- [ ] **Step 3: Run final checks**

Run:

```bash
node scripts/check_tutorial_catalog.mjs
node scripts/tutorial_hub_server.mjs --port 3849
```

Expected:

- Catalog check prints `"ok": true`.
- Hub server starts without crashing.

- [ ] **Step 4: Commit Task 4**

```bash
git add README.md AGENTS.md
git commit -m "docs: document tutorial hub"
```

## Final Verification

Run these checks before reporting completion:

```bash
node scripts/check_tutorial_catalog.mjs
npm run serve:hub
```

Then open:

```text
http://127.0.0.1:3849/?v=20260615
```

Acceptance:

- Hub shows exactly the three top-level tabs from the spec.
- AI图片 and 玩法组合 have active review-board links.
- AI视频 is visible but safely marked `待采集`.
- No old `AI优化商品图` output directory is modified by just opening the Hub.
- Hub actions for disabled tutorials do not generate fake videos.
