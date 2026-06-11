#!/usr/bin/env node
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  PLAYBOOK_DEFAULT_OUTPUT_DIR,
  ensurePlaybookWorkspace
} from '../lib/playbook/paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function readFlagValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const flags = {
    output: process.env.PLAYBOOK_OUTPUT_DIR || PLAYBOOK_DEFAULT_OUTPUT_DIR,
    port: 3839
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--output':
        flags.output = path.resolve(readFlagValue(argv, index, arg));
        index += 1;
        break;
      case '--port': {
        const port = Number(readFlagValue(argv, index, arg));
        if (!Number.isInteger(port) || port <= 0) {
          throw new Error('--port requires a positive integer');
        }
        flags.port = port;
        index += 1;
        break;
      }
      default:
        throw new Error(`unknown arg: ${arg}`);
    }
  }

  flags.output = path.resolve(flags.output);
  return flags;
}

const flags = parseArgs(process.argv.slice(2));
const paths = await ensurePlaybookWorkspace(flags.output);
const outputDir = paths.root;
let buildRunning = false;
let lastBuildResult = null;
let reviewWriteQueue = Promise.resolve();

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' &&
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') &&
      String(parsed.port || '80') === String(flags.port);
  } catch {
    return false;
  }
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
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

async function readReviewState() {
  try {
    return JSON.parse(await fs.readFile(paths.reviewPath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw new Error(`invalid review state: ${paths.reviewPath}`, { cause: error });
    }
    return { scenes: {}, sceneOrder: [] };
  }
}

async function writeReviewState(state) {
  await fs.mkdir(path.dirname(paths.reviewPath), { recursive: true });
  const tmpPath = `${paths.reviewPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await fs.rename(tmpPath, paths.reviewPath);
}

async function updateReviewState(updater) {
  const next = reviewWriteQueue.then(async () => {
    const state = await readReviewState();
    const result = await updater(state);
    await writeReviewState(state);
    return result;
  });
  reviewWriteQueue = next.catch(() => {});
  return next;
}

async function saveScene(payload) {
  if (!payload.sceneKey) {
    const error = new Error('missing sceneKey');
    error.status = 400;
    throw error;
  }
  return updateReviewState(async state => {
    const updatedAt = new Date().toISOString();
    const previous = state.scenes?.[payload.sceneKey] || {};
    state.updatedAt = updatedAt;
    state.scenes = {
      ...(state.scenes || {}),
      [payload.sceneKey]: {
        ...previous,
        ...payload,
        sceneKey: payload.sceneKey,
        updatedAt
      }
    };
    if (!Array.isArray(state.sceneOrder)) state.sceneOrder = [];
    return state.scenes[payload.sceneKey];
  });
}

async function saveOrder(payload) {
  if (!Array.isArray(payload.sceneOrder)) {
    const error = new Error('missing sceneOrder');
    error.status = 400;
    throw error;
  }
  return updateReviewState(async state => {
    state.updatedAt = new Date().toISOString();
    state.scenes = state.scenes || {};
    state.sceneOrder = payload.sceneOrder.map(item => String(item)).filter(Boolean);
    return state.sceneOrder;
  });
}

async function existingBuildResult() {
  try {
    const stat = await fs.stat(paths.videoPath);
    return {
      ok: true,
      source: 'existing-file',
      outputDir,
      videoPath: paths.videoPath,
      finishedAt: stat.mtime.toISOString()
    };
  } catch {
    return null;
  }
}

async function currentBuildResult() {
  if (lastBuildResult) return lastBuildResult;
  return existingBuildResult();
}

function ensureInsideOutputDir(targetPath) {
  const resolved = path.resolve(targetPath);
  const root = path.resolve(outputDir);
  if (resolved === root || resolved.startsWith(root + path.sep)) return resolved;
  const error = new Error('只能打开当前玩法视频输出目录内的文件。');
  error.status = 403;
  throw error;
}

async function openBuildTarget(payload = {}) {
  const result = await currentBuildResult();
  const target = String(payload.target || 'video');
  const action = String(payload.action || 'open');
  const targetPath = {
    video: result?.videoPath || paths.videoPath,
    'video-folder': path.dirname(paths.videoPath),
    'output-folder': outputDir,
    report: paths.reportPath,
    log: result?.logPath
  }[target];

  if (!targetPath) {
    const error = new Error('没有可打开的目标文件。');
    error.status = 404;
    throw error;
  }

  const resolved = ensureInsideOutputDir(targetPath);
  await fs.access(resolved);
  const args = action === 'reveal' ? ['-R', resolved] : [resolved];
  const child = spawn('open', args, {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
  return {
    ok: true,
    target,
    action,
    path: resolved,
    message: action === 'reveal' ? '已在访达中定位。' : '已打开。'
  };
}

async function runBuildVideo() {
  if (buildRunning) {
    const error = new Error('playbook video build is already running');
    error.status = 409;
    throw error;
  }

  const scriptPath = path.join(rootDir, 'build_playbook_video.sh');
  try {
    await fs.access(scriptPath);
  } catch {
    lastBuildResult = {
      ok: false,
      outputDir,
      videoPath: paths.videoPath,
      finishedAt: new Date().toISOString(),
      error: `build script not found: ${scriptPath}`
    };
    return lastBuildResult;
  }

  buildRunning = true;
  await fs.mkdir(path.join(outputDir, 'logs'), { recursive: true });
  const startedAt = new Date().toISOString();
  const logPath = path.join(outputDir, 'logs', `playbook-build-${startedAt.replace(/[:.]/g, '-')}.log`);

  try {
    await new Promise((resolve, reject) => {
      const child = spawn(scriptPath, ['--output', outputDir], {
        cwd: rootDir,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      const logStream = createWriteStream(logPath, { flags: 'w' });
      child.stdout.pipe(logStream, { end: false });
      child.stderr.pipe(logStream, { end: false });
      child.on('close', code => {
        logStream.end(() => {
          if (code === 0) resolve();
          else reject(new Error(`build exited ${code}; log=${logPath}`));
        });
      });
      child.on('error', error => {
        logStream.end(() => reject(error));
      });
    });
    lastBuildResult = {
      ok: true,
      outputDir,
      videoPath: paths.videoPath,
      logPath,
      startedAt,
      finishedAt: new Date().toISOString()
    };
    return lastBuildResult;
  } catch (error) {
    lastBuildResult = {
      ok: false,
      outputDir,
      videoPath: paths.videoPath,
      logPath,
      startedAt,
      finishedAt: new Date().toISOString(),
      error: error.message || String(error)
    };
    return lastBuildResult;
  } finally {
    buildRunning = false;
  }
}

function mimeFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.avif') return 'image/avif';
  if (ext === '.mp4') return 'video/mp4';
  return 'application/octet-stream';
}

async function serveFile(req, res, filePath) {
  const resolved = path.resolve(filePath);
  const allowedRoot = path.resolve(outputDir);
  if (!(resolved === allowedRoot || resolved.startsWith(allowedRoot + path.sep))) {
    sendText(req, res, 403, 'forbidden');
    return;
  }
  let realRoot;
  let realTarget;
  let stat;
  try {
    realRoot = await fs.realpath(allowedRoot);
    realTarget = await fs.realpath(resolved);
    stat = await fs.stat(realTarget);
  } catch {
    sendText(req, res, 404, 'not found');
    return;
  }
  if (!(realTarget === realRoot || realTarget.startsWith(realRoot + path.sep))) {
    sendText(req, res, 403, 'forbidden');
    return;
  }
  if (!stat.isFile()) {
    sendText(req, res, 404, 'not found');
    return;
  }
  res.writeHead(200, noCacheHeaders(mimeFor(realTarget), req));
  const stream = createReadStream(realTarget);
  stream.on('error', error => {
    if (!res.headersSent) {
      sendText(req, res, 500, error.message || 'failed to read file');
    } else {
      res.destroy(error);
    }
  });
  stream.pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      if (!originAllowed(req)) {
        sendJson(req, res, 403, { error: 'origin not allowed' });
        return;
      }
      res.writeHead(204, noCacheHeaders('text/plain; charset=utf-8', req));
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    if ((req.method === 'POST' || req.method === 'OPTIONS') && !originAllowed(req)) {
      sendJson(req, res, 403, { error: 'origin not allowed' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      sendJson(req, res, 200, await readReviewState());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/save-scene') {
      const scene = await saveScene(await readRequestJson(req));
      sendJson(req, res, 200, { ok: true, scene });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/save-order') {
      const sceneOrder = await saveOrder(await readRequestJson(req));
      sendJson(req, res, 200, { ok: true, sceneOrder });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/build-video') {
      const result = await runBuildVideo();
      sendJson(req, res, result.ok ? 200 : 501, result);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/build-result') {
      sendJson(req, res, 200, await currentBuildResult() || { ok: false, outputDir, videoPath: paths.videoPath, error: 'no build result yet' });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/open-build-target') {
      const result = await openBuildTarget(await readRequestJson(req));
      sendJson(req, res, 200, result);
      return;
    }

    if (req.method === 'GET') {
      if (url.pathname === '/' || url.pathname === '/playbook-board.html') {
        await serveFile(req, res, paths.boardPath);
        return;
      }
      await serveFile(req, res, path.join(outputDir, decodeURIComponent(url.pathname)));
      return;
    }

    sendJson(req, res, 405, { error: 'method not allowed' });
  } catch (error) {
    sendJson(req, res, error.status || 500, { error: error.message || String(error) });
  }
});

server.listen(flags.port, '127.0.0.1', () => {
  console.log(`playbook-board=http://127.0.0.1:${flags.port}/`);
  console.log(`output=${outputDir}`);
});
