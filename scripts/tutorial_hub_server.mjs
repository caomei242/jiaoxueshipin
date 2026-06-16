#!/usr/bin/env node
import fsNode from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evalInTarget, listTargets, navigateTarget, newTarget, sleep } from '../lib/cdp.mjs';
import { loadTutorialCatalog, findTutorial, publicCatalog } from '../lib/tutorials/catalog.mjs';
import { loadOfficialDocs, publicOfficialDocs } from '../lib/tutorials/official-docs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const MAX_REQUEST_BODY_BYTES = 1024 * 1024;
const managedStoryboardServers = new Map();

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
      error.command = [command, ...args].join(' ');
      reject(error);
    });
  });
}

function runDetachedServer(command, args, logPath) {
  fsNode.appendFileSync(logPath, `\n[${new Date().toISOString()}] ${[command, ...args].join(' ')}\n`);
  const logFd = fsNode.openSync(logPath, 'a');
  let child;
  try {
    child = spawn(command, args, {
      cwd: ROOT_DIR,
      env: { ...process.env },
      detached: true,
      stdio: ['ignore', logFd, logFd]
    });
  } finally {
    fsNode.closeSync(logFd);
  }
  child.unref();
  managedStoryboardServers.set(logPath, child.pid);
  return child.pid;
}

async function fetchJsonWithTimeout(url, timeoutMs = 800) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForHttpOk(url, timeoutMs = 5000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return true;
    } catch (error) {
      lastError = error;
      await sleep(250);
    }
  }
  throw new Error(`审片板服务没有启动成功：${lastError?.message || url}`);
}

function storyBoardBuildNeedsOpenBoard(tutorial) {
  return path.basename(String(tutorial.build?.command || '')) === 'build_storyboard_video.sh' && Boolean(tutorial.boardUrl);
}

function cacheBustedUrl(urlString) {
  const url = new URL(urlString);
  url.searchParams.set('v', String(Date.now()));
  return url.href;
}

async function ensureStoryboardService(tutorial) {
  const boardUrl = parseHttpUrl(tutorial.boardUrl);
  if (!boardUrl) return null;
  const healthUrl = new URL('/api/health', boardUrl);
  const expectedOutputDir = path.resolve(tutorial.outputDir);

  try {
    const health = await fetchJsonWithTimeout(healthUrl.href);
    if (path.resolve(health.outputDir || '') !== expectedOutputDir) {
      throw new Error(`3829 已被其他审片板占用：${health.outputDir || '未知输出目录'}`);
    }
    return { started: false, healthUrl: healthUrl.href };
  } catch (error) {
    if (/已被其他审片板占用/.test(error.message)) throw error;
  }

  const port = boardUrl.port || '80';
  const logsDir = path.join(tutorial.outputDir, 'logs');
  await fs.mkdir(logsDir, { recursive: true });
  const logPath = path.join(logsDir, `hub-storyboard-server-${port}.log`);
  const command = process.execPath;
  const args = [
    path.join(ROOT_DIR, 'scripts/storyboard_server.mjs'),
    '--output',
    tutorial.outputDir,
    '--port',
    port
  ];
  const pid = runDetachedServer(command, args, logPath);
  await waitForHttpOk(healthUrl.href);
  return { started: true, pid, healthUrl: healthUrl.href, logPath };
}

async function waitForStoryboardChromeTarget(boardUrl, timeoutMs = 6000) {
  const parsed = new URL(boardUrl);
  const hostPort = `${parsed.hostname}:${parsed.port || '80'}`;
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const targets = await listTargets();
      const candidates = targets.filter(item => String(item.url || '').includes(hostPort));
      for (const target of candidates) {
        try {
          const pageState = await evalInTarget(target.targetId, `(() => ({
            title: document.title,
            sceneCount: document.querySelectorAll('.scene').length,
            hasSaveOrder: document.documentElement.innerHTML.includes('/api/save-order')
          }))()`);
          if (pageState.sceneCount > 0 || pageState.hasSaveOrder) {
            return { targetId: target.targetId, url: target.url, sceneCount: pageState.sceneCount };
          }
        } catch (error) {
          lastError = error;
        }
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(300);
  }

  throw new Error(`已打开审片板，但 Chrome 里没有检测到可导出的镜头页面：${lastError?.message || boardUrl}`);
}

async function ensureOpenStoryboardBoard(tutorial) {
  if (!storyBoardBuildNeedsOpenBoard(tutorial)) return null;
  const service = await ensureStoryboardService(tutorial);
  const boardUrl = cacheBustedUrl(tutorial.boardUrl);
  let targetId = null;

  try {
    const targets = await listTargets();
    const parsed = new URL(boardUrl);
    const hostPort = `${parsed.hostname}:${parsed.port || '80'}`;
    const existing = targets.find(item => String(item.url || '').includes(hostPort));
    if (existing?.targetId) {
      targetId = existing.targetId;
      await navigateTarget(targetId, boardUrl);
    } else {
      targetId = await newTarget(boardUrl);
    }
  } catch {
    await openWithFinder([boardUrl]);
  }

  const target = await waitForStoryboardChromeTarget(boardUrl);
  return { ...service, boardUrl, targetId: target.targetId || targetId, sceneCount: target.sceneCount };
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

async function serveStarterBoard(req, res, tutorial) {
  const boardPath = path.join(tutorial.outputDir, 'storyboard', 'shooting-board.html');
  try {
    const html = await fs.readFile(boardPath, 'utf8');
    sendText(req, res, 200, html, 'text/html; charset=utf-8');
    return;
  } catch {
    sendText(req, res, 200, renderStarterMissingHtml(tutorial, boardPath), 'text/html; charset=utf-8');
  }
}

function renderStarterMissingHtml(tutorial, boardPath) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(tutorial.title)}制作板待创建</title>
  <style>
    :root { color-scheme: light; --bg: #f4f7fb; --panel: #fff; --ink: #111827; --muted: #667085; --line: #d0d5dd; --brand: #2563eb; --warn: #c2410c; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; color: var(--ink); background: var(--bg); }
    header { padding: 24px 28px; color: white; background: #111827; }
    main { padding: 28px; }
    .panel { max-width: 880px; border: 1px solid var(--line); border-radius: 8px; padding: 20px; background: var(--panel); box-shadow: 0 10px 24px rgba(16, 24, 40, .06); }
    a { display: inline-flex; margin-top: 12px; border: 1px solid var(--brand); border-radius: 8px; padding: 10px 14px; color: white; background: var(--brand); font-weight: 800; text-decoration: none; }
    code { display: inline-block; max-width: 100%; overflow-wrap: anywhere; border-radius: 5px; padding: 2px 5px; color: #1f2937; background: #eef2ff; }
    p { color: var(--muted); line-height: 1.7; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(tutorial.title)}制作板还没创建</h1>
  </header>
  <main>
    <section class="panel">
      <p>这个功能可以开始做保姆教程，但还没有生成制作板。</p>
      <p>回到 Hub，点击 <b>${escapeHtml(tutorial.start.label || '开始制作')}</b>，系统会创建独立输出目录、采集清单和制作板。</p>
      <p>预期制作板路径：<code>${escapeHtml(boardPath)}</code></p>
      <a href="/">返回 Hub</a>
    </section>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
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
    .group { margin: 0 0 18px; }
    .group:last-child { margin-bottom: 0; }
    .group-title { margin: 2px 2px 10px; color: #344054; font-size: 13px; font-weight: 900; }
    .tutorial { width: 100%; margin: 0 0 12px; text-align: left; }
    .tutorial:last-child { margin-bottom: 0; }
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
    .docs { margin: 16px 0 0; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px; background: #eff6ff; }
    .docs h3 { margin: 0 0 8px; font-size: 15px; color: #1e3a8a; }
    .docs a { color: #1d4ed8; font-weight: 800; overflow-wrap: anywhere; }
    .docs ul { margin: 8px 0 0; padding-left: 18px; color: #334155; line-height: 1.55; }
    .docs li { margin: 4px 0; }
    .note { margin-top: 18px; border-left: 4px solid var(--warn); padding: 12px; color: #7c2d12; background: #fff7ed; line-height: 1.65; }
    .result-box { margin-top: 18px; border-radius: 8px; padding: 14px; color: #334155; background: #f8fafc; border: 1px solid #e2e8f0; line-height: 1.65; }
    .result-box.waiting { color: #dbeafe; background: #0b1220; border-color: #0b1220; }
    .result-box.ok { color: #14532d; background: #f0fdf4; border-color: #bbf7d0; }
    .result-box.error { color: #7f1d1d; background: #fef2f2; border-color: #fecaca; }
    .result-title { margin-bottom: 6px; font-size: 16px; font-weight: 900; }
    .result-path { margin-top: 6px; color: #475569; font-size: 13px; overflow-wrap: anywhere; }
    .result-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .result-actions button, .result-actions a { border: 1px solid #bfdbfe; border-radius: 8px; padding: 8px 12px; color: #1d4ed8; background: white; font-weight: 800; text-decoration: none; cursor: pointer; }
    .result-actions .primary-link { border-color: var(--brand); color: white; background: var(--brand); }
    details { margin-top: 10px; color: #475569; }
    details summary { cursor: pointer; font-weight: 800; }
    details pre { max-height: 220px; overflow: auto; border-radius: 8px; padding: 12px; color: #dbeafe; background: #0b1220; white-space: pre-wrap; }
    @media (max-width: 760px) { main { padding: 16px; } .layout, .meta { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <h1>客户教程视频审片台</h1>
    <p>按功能点分组和玩法组合管理教程。当前页面只生成当前教程，避免镜头互相串台。</p>
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
    function tutorialById(id) {
      return data.tutorials.find(item => item.id === id);
    }
    function templateLabel(type) {
      return {
        'operation-tutorial': '保姆操作教程',
        'playbook-chain': '玩法组合教程'
      }[type] || type || '未设置';
    }
    function groupedTutorialsForTab(tabId) {
      const groups = [];
      const byId = new Map();
      tutorialsForTab(tabId).forEach(tutorial => {
        const groupId = tutorial.groupId || tutorial.tabId;
        if (!byId.has(groupId)) {
          const group = {
            id: groupId,
            label: tutorial.groupLabel || data.tabs.find(tab => tab.id === tabId)?.label || '未分组',
            tutorials: []
          };
          byId.set(groupId, group);
          groups.push(group);
        }
        byId.get(groupId).tutorials.push(tutorial);
      });
      return groups;
    }
    async function post(path, body = {}) {
      const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await response.json();
      if (!response.ok) {
        const error = new Error(json.reason || json.error || response.statusText);
        error.details = json;
        throw error;
      }
      return json;
    }
    function bindResultActions(root) {
      root.querySelectorAll('[data-result-open-video]').forEach(button => button.addEventListener('click', event => {
        openTarget(event.currentTarget.dataset.resultOpenVideo, 'video');
      }));
      root.querySelectorAll('[data-result-reveal-video]').forEach(button => button.addEventListener('click', event => {
        openTarget(event.currentTarget.dataset.resultRevealVideo, 'video', 'reveal');
      }));
      root.querySelectorAll('[data-result-open-folder]').forEach(button => button.addEventListener('click', event => {
        openTarget(event.currentTarget.dataset.resultOpenFolder, 'folder');
      }));
    }
    function setResult(html, stateName = 'waiting') {
      const log = document.getElementById('log');
      if (!log) return;
      log.className = 'result-box ' + stateName;
      log.innerHTML = html;
      bindResultActions(log);
    }
    function setLog(text) {
      setResult(escapeHtml(text), 'waiting');
    }
    function safeParseJson(text) {
      if (!text) return null;
      try { return JSON.parse(String(text)); } catch { return null; }
    }
    function parsedCommandResult(result) {
      return safeParseJson(result?.stdout) || {};
    }
    function renderPath(label, value) {
      if (!value) return '';
      return '<div class="result-path"><b>' + escapeHtml(label) + '：</b>' + escapeHtml(value) + '</div>';
    }
    function renderTechnicalLog(result) {
      const raw = [result?.stdout, result?.stderr].filter(Boolean).join('\\n').trim();
      if (!raw) return '';
      return '<details><summary>查看技术日志</summary><pre>' + escapeHtml(raw) + '</pre></details>';
    }
    function renderStartResult(id, result) {
      const tutorial = tutorialById(id) || {};
      const started = parsedCommandResult(result);
      const starterUrl = result.starterUrl || ('/tutorial/' + id + '/starter');
      const needsCapture = tutorial.status === 'needs-capture';
      const resultTitle = needsCapture ? '采集清单已创建' : '制作板已创建';
      const sceneText = started.sceneCount
        ? '已创建 ' + started.sceneCount + (needsCapture ? ' 个采集镜头。' : ' 个拍摄镜头。')
        : (needsCapture ? '采集清单已经准备好。' : '制作板和采集清单已经准备好。');
      const nextText = needsCapture ? '下一步按清单去真实后台采集截图。' : '下一步可以直接进入制作板批改镜头。';
      const boardLabel = needsCapture ? '采集清单' : '制作板';
      const primaryText = needsCapture ? '查看采集清单' : '进入制作板';
      setResult(
        '<div class="result-title">' + escapeHtml(resultTitle) + '</div>' +
        '<div>' + escapeHtml(sceneText + nextText) + '</div>' +
        renderPath('输出目录', result.outputDir) +
        renderPath(boardLabel, started.boardPath) +
        renderPath('采集报告', started.reportPath) +
        '<div class="result-actions">' +
        '<a class="primary-link" href="' + escapeHtml(starterUrl) + '?v=' + Date.now() + '" target="_blank" rel="noreferrer">' + escapeHtml(primaryText) + '</a>' +
        '<button data-result-open-folder="' + escapeHtml(id) + '">打开视频文件夹</button>' +
        '</div>' +
        renderTechnicalLog(result),
        'ok'
      );
    }
    function renderBuildResult(id, result) {
      const tutorial = tutorialById(id) || {};
      const videoPath = result.videoPath || tutorial.videoPath;
      const fileSize = result.videoInfo?.fileSize ? '视频已生成，文件大小约 ' + Math.round(result.videoInfo.fileSize / 1024 / 1024 * 10) / 10 + ' MB。' : '视频已生成。';
      setResult(
        '<div class="result-title">视频生成完成</div>' +
        '<div>' + escapeHtml(fileSize) + '可以直接打开预览，或者在访达里定位文件。</div>' +
        renderPath('视频路径', videoPath) +
        '<div class="result-actions">' +
        '<button class="primary-link" data-result-open-video="' + escapeHtml(id) + '">打开视频</button>' +
        '<button data-result-reveal-video="' + escapeHtml(id) + '">访达定位</button>' +
        '<button data-result-open-folder="' + escapeHtml(id) + '">打开视频文件夹</button>' +
        '</div>' +
        renderTechnicalLog(result),
        'ok'
      );
    }
    function renderOpenResult(result) {
      const targetText = result.target === 'folder' ? '视频文件夹' : '视频文件';
      const actionText = result.action === 'reveal' ? '已在访达定位' : '已打开';
      setResult(
        '<div class="result-title">' + escapeHtml(actionText + targetText) + '</div>' +
        renderPath('路径', result.path),
        'ok'
      );
    }
    function renderError(error) {
      setResult(
        '<div class="result-title">操作没有完成</div>' +
        '<div>' + escapeHtml(error.message || error) + '</div>' +
        renderPath('命令', error.details?.command) +
        renderTechnicalLog(error.details),
        'error'
      );
    }
    async function buildTutorial(id) {
      setLog('正在生成当前教程视频...');
      try { renderBuildResult(id, await post('/api/tutorial/' + id + '/build')); }
      catch (error) { renderError(error); }
    }
    async function startTutorial(id) {
      setLog('正在创建制作板和采集清单...');
      try {
        const result = await post('/api/tutorial/' + id + '/start');
        renderStartResult(id, result);
      } catch (error) {
        renderError(error);
      }
    }
    async function openTarget(id, target, action = 'open') {
      setLog('正在打开...');
      try { renderOpenResult(await post('/api/tutorial/' + id + '/open', { target, action })); }
      catch (error) { renderError(error); }
    }
    function renderOfficialDocs(tutorial) {
      const docs = Array.isArray(tutorial.officialDocs) ? tutorial.officialDocs : [];
      if (!docs.length) return '';
      return docs.map(doc => {
        const facts = (doc.scriptCoverageChecklist || doc.factSummary || []).slice(0, 3);
        return '<section class="docs"><h3>官方文档参考</h3>' +
          '<a href="' + escapeHtml(doc.url) + '" target="_blank" rel="noreferrer">' + escapeHtml(doc.title) + '</a>' +
          (facts.length ? '<ul>' + facts.map(fact => '<li>' + escapeHtml(fact) + '</li>').join('') + '</ul>' : '') +
          '</section>';
      }).join('');
    }
    function render() {
      if (!state.tutorialId) state.tutorialId = tutorialsForTab(state.tabId)[0]?.id || '';
      tabsEl.innerHTML = data.tabs.map(tab => '<button class="tab ' + (tab.id === state.tabId ? 'active' : '') + '" data-tab="' + escapeHtml(tab.id) + '">' + escapeHtml(tab.label) + '</button>').join('');
      tabsEl.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => {
        state.tabId = button.dataset.tab;
        state.tutorialId = tutorialsForTab(state.tabId)[0]?.id || '';
        render();
      }));

      listEl.innerHTML = groupedTutorialsForTab(state.tabId).map(group => '<div class="group"><div class="group-title">' + escapeHtml(group.label) + '</div>' + group.tutorials.map(tutorial => '<button class="tutorial ' + (tutorial.id === state.tutorialId ? 'active' : '') + '" data-id="' + escapeHtml(tutorial.id) + '"><strong>' + escapeHtml(tutorial.title) + '</strong><span>' + escapeHtml(tutorial.subtitle) + '</span></button>').join('') + '</div>').join('') || '<p>暂无教程</p>';
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
      const boardRoute = String(tutorial.boardRoute || '').startsWith('/tutorial/') ? tutorial.boardRoute : '';
      const boardAction = boardUrl
        ? '<a class="action primary" href="' + escapeHtml(boardUrl) + '" target="_blank" rel="noreferrer">进入审片</a>'
        : boardRoute
          ? '<a class="action" href="' + escapeHtml(boardRoute) + '?v=' + Date.now() + '" target="_blank" rel="noreferrer">' + (tutorial.status === 'needs-capture' ? '查看采集清单' : '进入制作板') + '</a>'
          : '<button disabled>待采集后开放审片</button>';
      const startAction = tutorial.startEnabled
        ? '<button class="primary" data-start="' + escapeHtml(tutorial.id) + '">' + escapeHtml(tutorial.startLabel || '开始制作') + '</button>'
        : tutorial.startDisabledReason
          ? '<button disabled>' + escapeHtml(tutorial.startDisabledReason) + '</button>'
          : '';
      const buildButton = tutorial.buildEnabled ? '<button class="primary" data-build="' + escapeHtml(tutorial.id) + '">一键生成当前教程</button>' : '<button disabled>素材齐后生成</button>';
      const reason = tutorial.buildDisabledReason ? '<div class="note">' + escapeHtml(tutorial.buildDisabledReason) + '</div>' : '';
      const videoExists = tutorial.videoInfo?.exists ? '已生成' : '未生成';
      const videoActions = tutorial.videoInfo?.exists
        ? '<button data-open-video="' + escapeHtml(tutorial.id) + '">打开视频</button>' +
          '<button data-reveal-video="' + escapeHtml(tutorial.id) + '">访达定位</button>'
        : '<button disabled>打开视频</button><button disabled>访达定位</button>';
      detailEl.innerHTML = '<span class="badge ' + statusClass + '">' + escapeHtml(tutorial.statusLabel) + '</span>' +
        '<h2>' + escapeHtml(tutorial.title) + '</h2>' +
        '<p>' + escapeHtml(tutorial.subtitle) + '</p>' +
        '<div class="meta">' +
        '<div><b>教程类型</b><span>' + escapeHtml(templateLabel(tutorial.templateType)) + '</span></div>' +
        '<div><b>测试店</b><span>' + escapeHtml(tutorial.targetStore) + '</span></div>' +
        '<div><b>视频状态</b><span>' + escapeHtml(videoExists) + '</span></div>' +
        '<div><b>输出目录</b><span>' + escapeHtml(tutorial.outputDir) + '</span></div>' +
        '<div><b>视频路径</b><span>' + escapeHtml(tutorial.videoPath) + '</span></div>' +
        '</div>' +
        '<div class="actions">' + startAction + boardAction + buildButton +
        videoActions +
        '<button data-open-folder="' + escapeHtml(tutorial.id) + '">打开视频文件夹</button>' +
        '</div>' +
        renderOfficialDocs(tutorial) +
        reason +
        '<div id="log" class="result-box waiting">等待操作</div>';

      detailEl.querySelector('[data-build]')?.addEventListener('click', event => buildTutorial(event.currentTarget.dataset.build));
      detailEl.querySelector('[data-start]')?.addEventListener('click', event => startTutorial(event.currentTarget.dataset.start));
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
  const officialDocs = await loadOfficialDocs();
  data.tutorials = await Promise.all(data.tutorials.map(async tutorial => ({
    ...tutorial,
    boardUrl: parseHttpUrl(tutorial.boardUrl)?.href || '',
    officialDocs: publicOfficialDocs(officialDocs, tutorial.officialDocIds),
    videoInfo: await videoInfoFor(findTutorial(catalog, tutorial.id))
  })));
  return data;
}

const flags = parseArgs(process.argv.slice(2));
let buildRunning = false;
let startRunning = false;

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

    const starterMatch = url.pathname.match(/^\/tutorial\/([^/]+)\/starter$/);
    if (req.method === 'GET' && starterMatch) {
      const tutorial = findTutorial(catalog, starterMatch[1]);
      if (!tutorial) {
        sendText(req, res, 404, '教程不存在');
        return;
      }
      await serveStarterBoard(req, res, tutorial);
      return;
    }

    const startMatch = url.pathname.match(/^\/api\/tutorial\/([^/]+)\/start$/);
    if (req.method === 'POST' && startMatch) {
      const tutorial = findTutorial(catalog, startMatch[1]);
      if (!tutorial) {
        sendJson(req, res, 404, { ok: false, error: '教程不存在' });
        return;
      }
      if (!tutorial.start.enabled || !tutorial.start.script) {
        sendJson(req, res, 409, {
          ok: false,
          error: '当前教程没有开始制作入口',
          reason: tutorial.start.reason || 'start disabled'
        });
        return;
      }
      if (startRunning) {
        sendJson(req, res, 409, { ok: false, error: '已有教程正在创建制作板，请稍后再试。' });
        return;
      }

      startRunning = true;
      try {
        const result = await runCommand(process.execPath, [tutorial.start.script, ...tutorial.start.args]);
        sendJson(req, res, 200, {
          ok: true,
          tutorialId: tutorial.id,
          outputDir: tutorial.outputDir,
          starterUrl: tutorial.boardRoute || '',
          stdout: result.stdout,
          stderr: result.stderr
        });
      } finally {
        startRunning = false;
      }
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
        const board = await ensureOpenStoryboardBoard(tutorial);
        const result = await runCommand(tutorial.build.command, tutorial.build.args);
        sendJson(req, res, 200, {
          ok: true,
          tutorialId: tutorial.id,
          videoPath: tutorial.videoPath,
          videoInfo: await videoInfoFor(tutorial),
          board,
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
