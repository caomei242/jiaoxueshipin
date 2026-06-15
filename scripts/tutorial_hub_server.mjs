#!/usr/bin/env node
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadTutorialCatalog, findTutorial, publicCatalog } from '../lib/tutorials/catalog.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

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
      if (!Number.isInteger(flags.port) || flags.port <= 0) {
        throw new Error('--port requires a positive integer');
      }
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

function parseHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function localOrigin(host, port) {
  if (!host) return null;
  const normalizedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `http://${normalizedHost}:${port}`;
}

function requestHostOrigin(req) {
  try {
    const url = new URL(`http://${req.headers.host || `${flags.host}:${flags.port}`}`);
    return localOrigin(url.hostname, flags.port);
  } catch {
    return null;
  }
}

function allowedOrigins(req) {
  const origins = new Set([
    localOrigin('localhost', flags.port),
    localOrigin('127.0.0.1', flags.port),
    requestHostOrigin(req)
  ]);
  if (flags.host !== '0.0.0.0') {
    origins.add(localOrigin(flags.host, flags.port));
  }
  origins.delete(null);
  return origins;
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const parsed = parseHttpUrl(origin);
  return Boolean(parsed) && allowedOrigins(req).has(parsed.origin);
}

function noCacheHeaders(type = 'text/plain; charset=utf-8', req = null) {
  const headers = {
    'Content-Type': type,
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  if (req?.headers.origin && originAllowed(req)) {
    headers['Access-Control-Allow-Origin'] = req.headers.origin;
    headers.Vary = 'Origin';
  }
  return headers;
}

function sendJson(req, res, status, data) {
  res.writeHead(status, noCacheHeaders('application/json; charset=utf-8', req));
  res.end(`${JSON.stringify(data, null, 2)}\n`);
}

function sendText(req, res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, noCacheHeaders(type, req));
  res.end(text);
}

async function readRequestJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_REQUEST_BODY_BYTES) {
      const error = new Error('request body too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error('invalid JSON request body');
    error.status = 400;
    throw error;
  }
}

function ensureInsideOutputDir(tutorial, targetPath) {
  const resolved = path.resolve(targetPath);
  const root = path.resolve(tutorial.outputDir);
  if (resolved === root || resolved.startsWith(root + path.sep)) return resolved;

  const error = new Error('只能打开当前教程输出目录内的视频或视频文件夹。');
  error.status = 403;
  throw error;
}

async function videoInfoFor(tutorial) {
  try {
    const stat = await fs.stat(tutorial.videoPath);
    return {
      exists: stat.isFile() && stat.size > 0,
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
      cwd: ROOT_DIR,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', code => {
      const output = Buffer.concat(stdout).toString('utf8');
      const errorOutput = Buffer.concat(stderr).toString('utf8');
      if (code === 0) {
        resolve({ code, stdout: output, stderr: errorOutput });
        return;
      }

      const error = new Error(`command failed with exit ${code}`);
      error.status = 500;
      error.code = code;
      error.stdout = output;
      error.stderr = errorOutput;
      reject(error);
    });
  });
}

function openWithFinder(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/open', args, {
      detached: true,
      stdio: 'ignore'
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

async function openTarget(tutorial, payload = {}) {
  const target = String(payload.target || 'video');
  const action = String(payload.action || 'open');
  if (!['video', 'folder'].includes(target)) {
    const error = new Error('target must be video or folder');
    error.status = 400;
    throw error;
  }
  if (!['open', 'reveal'].includes(action)) {
    const error = new Error('action must be open or reveal');
    error.status = 400;
    throw error;
  }

  const videosDir = path.dirname(tutorial.videoPath);
  const targetPath = target === 'folder' ? videosDir : tutorial.videoPath;
  const safePath = ensureInsideOutputDir(tutorial, targetPath);
  if (target === 'folder') {
    await fs.mkdir(safePath, { recursive: true });
  } else {
    try {
      const stat = await fs.stat(safePath);
      if (!stat.isFile()) throw new Error('not a file');
    } catch {
      const error = new Error('目标视频还不存在，请先生成视频。');
      error.status = 404;
      throw error;
    }
  }

  await openWithFinder(action === 'reveal' ? ['-R', safePath] : [safePath]);
  return { ok: true, target, action, path: safePath };
}

function renderHubHtml(publicData) {
  const dataJson = JSON.stringify(publicData).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>客户教程视频审片台</title>
  <style>
    :root { color-scheme: light; --bg: #f4f7fb; --panel: #fff; --ink: #111827; --muted: #667085; --line: #d0d5dd; --brand: #2563eb; --ok: #16803c; --warn: #c2410c; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; color: var(--ink); background: var(--bg); }
    header { padding: 22px 28px; color: white; background: #111827; }
    h1 { margin: 0 0 8px; font-size: 24px; letter-spacing: 0; }
    header p { margin: 0; color: #cbd5e1; }
    main { padding: 22px 28px 36px; }
    .tabs { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
    button, a.action { border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; color: var(--ink); background: white; font-weight: 800; text-decoration: none; cursor: pointer; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    .tab.active, .primary { border-color: var(--brand); color: white; background: var(--brand); }
    .layout { display: grid; grid-template-columns: minmax(280px, 360px) 1fr; gap: 18px; }
    .panel { border: 1px solid var(--line); border-radius: 8px; background: var(--panel); box-shadow: 0 10px 24px rgba(16, 24, 40, .06); }
    .list { padding: 14px; }
    .tutorial { width: 100%; margin: 0 0 12px; text-align: left; }
    .tutorial.active { border-color: var(--brand); box-shadow: 0 0 0 3px rgba(37, 99, 235, .14); }
    .tutorial strong, .tutorial span { display: block; }
    .tutorial span { margin-top: 6px; color: var(--muted); font-size: 13px; line-height: 1.5; }
    .detail { min-height: 420px; padding: 20px; }
    .detail h2 { margin: 10px 0 8px; font-size: 24px; letter-spacing: 0; }
    .badge { display: inline-flex; border-radius: 999px; padding: 4px 10px; color: white; font-size: 12px; font-weight: 800; background: var(--ok); }
    .badge.needs-capture { background: var(--warn); }
    .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 18px 0; }
    .meta div { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; background: #f8fafc; }
    .meta b { display: block; margin-bottom: 4px; color: #475467; font-size: 12px; }
    .meta span { display: block; overflow-wrap: anywhere; font-size: 13px; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
    .note { margin-top: 18px; border-left: 4px solid var(--warn); padding: 12px; color: #7c2d12; background: #fff7ed; line-height: 1.65; }
    pre { max-height: 220px; overflow: auto; border-radius: 8px; padding: 12px; color: #dbeafe; background: #0b1220; white-space: pre-wrap; }
    @media (max-width: 760px) { main { padding: 16px; } .layout, .meta { grid-template-columns: 1fr; } }
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
    const data = window.__TUTORIAL_DATA__;
    const state = { tabId: data.tabs[0]?.id || '', tutorialId: '' };
    const tabsEl = document.getElementById('tabs');
    const listEl = document.getElementById('tutorialList');
    const detailEl = document.getElementById('detail');

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }
    function tutorialsForTab(tabId) {
      return data.tutorials.filter(tutorial => tutorial.tabId === tabId);
    }
    async function post(path, body = {}) {
      const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.reason || json.error || response.statusText);
      return json;
    }
    function setLog(text) {
      const log = document.getElementById('log');
      if (log) log.textContent = text;
    }
    async function buildTutorial(id) {
      setLog('正在生成当前教程视频...');
      try { setLog(JSON.stringify(await post('/api/tutorial/' + id + '/build'), null, 2)); }
      catch (error) { setLog(error.message); }
    }
    async function openTarget(id, target, action = 'open') {
      setLog('正在打开...');
      try { setLog(JSON.stringify(await post('/api/tutorial/' + id + '/open', { target, action }), null, 2)); }
      catch (error) { setLog(error.message); }
    }
    function render() {
      if (!state.tutorialId) state.tutorialId = tutorialsForTab(state.tabId)[0]?.id || '';
      tabsEl.innerHTML = data.tabs.map(tab => '<button class="tab ' + (tab.id === state.tabId ? 'active' : '') + '" data-tab="' + escapeHtml(tab.id) + '">' + escapeHtml(tab.label) + '</button>').join('');
      tabsEl.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => {
        state.tabId = button.dataset.tab;
        state.tutorialId = tutorialsForTab(state.tabId)[0]?.id || '';
        render();
      }));

      listEl.innerHTML = tutorialsForTab(state.tabId).map(tutorial => '<button class="tutorial ' + (tutorial.id === state.tutorialId ? 'active' : '') + '" data-id="' + escapeHtml(tutorial.id) + '"><strong>' + escapeHtml(tutorial.title) + '</strong><span>' + escapeHtml(tutorial.subtitle) + '</span></button>').join('');
      listEl.querySelectorAll('.tutorial').forEach(button => button.addEventListener('click', () => {
        state.tutorialId = button.dataset.id;
        render();
      }));

      const tutorial = data.tutorials.find(item => item.id === state.tutorialId);
      if (!tutorial) {
        detailEl.innerHTML = '<h2>没有教程</h2>';
        return;
      }
      const statusClass = tutorial.status === 'needs-capture' ? 'needs-capture' : '';
      let boardUrl = '';
      try {
        const parsed = new URL(tutorial.boardUrl || '');
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') boardUrl = parsed.href;
      } catch {}
      const boardAction = boardUrl ? '<a class="action primary" href="' + escapeHtml(boardUrl) + '" target="_blank" rel="noreferrer">进入审片</a>' : '<button disabled>待采集后开放审片</button>';
      const buildButton = tutorial.buildEnabled ? '<button class="primary" data-build="' + escapeHtml(tutorial.id) + '">一键生成当前教程</button>' : '<button disabled>暂不能生成</button>';
      const reason = tutorial.buildDisabledReason ? '<div class="note">' + escapeHtml(tutorial.buildDisabledReason) + '</div>' : '';
      const videoExists = tutorial.videoInfo?.exists ? '已生成' : '未生成';
      detailEl.innerHTML = '<span class="badge ' + statusClass + '">' + escapeHtml(tutorial.statusLabel) + '</span>' +
        '<h2>' + escapeHtml(tutorial.title) + '</h2>' +
        '<p>' + escapeHtml(tutorial.subtitle) + '</p>' +
        '<div class="meta">' +
        '<div><b>教程类型</b><span>' + escapeHtml(tutorial.templateType) + '</span></div>' +
        '<div><b>测试店</b><span>' + escapeHtml(tutorial.targetStore) + '</span></div>' +
        '<div><b>视频状态</b><span>' + escapeHtml(videoExists) + '</span></div>' +
        '<div><b>输出目录</b><span>' + escapeHtml(tutorial.outputDir) + '</span></div>' +
        '<div><b>视频路径</b><span>' + escapeHtml(tutorial.videoPath) + '</span></div>' +
        '</div>' +
        '<div class="actions">' + boardAction + buildButton +
        '<button data-open-video="' + escapeHtml(tutorial.id) + '">打开视频</button>' +
        '<button data-reveal-video="' + escapeHtml(tutorial.id) + '">访达定位</button>' +
        '<button data-open-folder="' + escapeHtml(tutorial.id) + '">打开视频文件夹</button>' +
        '</div>' +
        reason +
        '<pre id="log">等待操作</pre>';

      detailEl.querySelector('[data-build]')?.addEventListener('click', event => buildTutorial(event.currentTarget.dataset.build));
      detailEl.querySelector('[data-open-video]')?.addEventListener('click', event => openTarget(event.currentTarget.dataset.openVideo, 'video'));
      detailEl.querySelector('[data-reveal-video]')?.addEventListener('click', event => openTarget(event.currentTarget.dataset.revealVideo, 'video', 'reveal'));
      detailEl.querySelector('[data-open-folder]')?.addEventListener('click', event => openTarget(event.currentTarget.dataset.openFolder, 'folder'));
    }
    render();
  </script>
</body>
</html>`;
}

async function publicCatalogWithVideoInfo(catalog) {
  const data = publicCatalog(catalog);
  data.tutorials = await Promise.all(data.tutorials.map(async tutorial => ({
    ...tutorial,
    boardUrl: parseHttpUrl(tutorial.boardUrl)?.href || '',
    videoInfo: await videoInfoFor(findTutorial(catalog, tutorial.id))
  })));
  return data;
}

const flags = parseArgs(process.argv.slice(2));
let buildRunning = false;

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      if (!originAllowed(req)) {
        res.writeHead(403, noCacheHeaders('application/json; charset=utf-8', req));
        res.end(`${JSON.stringify({ ok: false, error: 'origin not allowed' }, null, 2)}\n`);
        return;
      }
      res.writeHead(204, noCacheHeaders('text/plain; charset=utf-8', req));
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    if (req.method === 'POST' && !originAllowed(req)) {
      sendJson(req, res, 403, { ok: false, error: 'origin not allowed' });
      return;
    }

    const catalog = await loadTutorialCatalog();

    if (req.method === 'GET' && url.pathname === '/') {
      sendText(req, res, 200, renderHubHtml(await publicCatalogWithVideoInfo(catalog)), 'text/html; charset=utf-8');
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/tutorials') {
      sendJson(req, res, 200, await publicCatalogWithVideoInfo(catalog));
      return;
    }

    const buildMatch = url.pathname.match(/^\/api\/tutorial\/([^/]+)\/build$/);
    if (req.method === 'POST' && buildMatch) {
      const tutorial = findTutorial(catalog, buildMatch[1]);
      if (!tutorial) {
        sendJson(req, res, 404, { ok: false, error: '教程不存在' });
        return;
      }
      if (!tutorial.build.enabled) {
        sendJson(req, res, 409, {
          ok: false,
          error: '当前教程暂不能生成',
          reason: tutorial.build.reason || 'build disabled'
        });
        return;
      }
      if (buildRunning) {
        sendJson(req, res, 409, { ok: false, error: '已有视频正在生成，请稍后再试。' });
        return;
      }

      buildRunning = true;
      try {
        const result = await runCommand(tutorial.build.command, tutorial.build.args);
        sendJson(req, res, 200, {
          ok: true,
          tutorialId: tutorial.id,
          videoPath: tutorial.videoPath,
          videoInfo: await videoInfoFor(tutorial),
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
        sendJson(req, res, 404, { ok: false, error: '教程不存在' });
        return;
      }
      sendJson(req, res, 200, await openTarget(tutorial, await readRequestJson(req)));
      return;
    }

    sendText(req, res, 404, 'Not found');
  } catch (error) {
    sendJson(req, res, error.status || 500, {
      ok: false,
      error: error.message || String(error),
      stdout: error.stdout,
      stderr: error.stderr
    });
  }
});

server.listen(flags.port, flags.host, () => {
  console.log(`Tutorial hub listening at http://${flags.host}:${flags.port}/`);
});
