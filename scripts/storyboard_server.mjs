#!/usr/bin/env node
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_OUTPUT_DIR, ROOT_DIR } from '../lib/config.mjs';
import { ensureDir } from '../lib/fs-utils.mjs';
import { generateSceneCopySmart, sceneCopyProviderStatus } from '../lib/storyboard-copywriter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function parseCli(argv) {
  const flags = {
    outputDir: DEFAULT_OUTPUT_DIR,
    port: 3829
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--output') {
      flags.outputDir = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg === '--port') {
      flags.port = Number(argv[i + 1]);
      i += 1;
    }
  }
  return flags;
}

const flags = parseCli(process.argv.slice(2));
const outputDir = flags.outputDir;
const boardDir = path.join(outputDir, 'storyboard');
const reviewStatePath = path.join(boardDir, 'review-overrides.json');
const capturePath = path.join(outputDir, 'capture', 'capture.json');
const logDir = path.join(outputDir, 'logs');
let recaptureRunning = false;
let buildRunning = false;
let lastBuildResult = null;

function buildPaths(style = 'nanny') {
  return {
    outputDir,
    videoPath: path.join(outputDir, 'videos', `${style}-horizontal-storyboard.mp4`),
    videosDir: path.join(outputDir, 'videos'),
    manifestPath: path.join(outputDir, 'manifests', `${style}-horizontal-storyboard.json`)
  };
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
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
    return JSON.parse(await fs.readFile(reviewStatePath, 'utf8'));
  } catch {
    return { updatedAt: null, scenes: {}, insertedScenes: [] };
  }
}

async function readCaptureState() {
  try {
    return JSON.parse(await fs.readFile(capturePath, 'utf8'));
  } catch {
    return { screenshots: [] };
  }
}

async function existingBuildResult(style = 'nanny') {
  const paths = buildPaths(style);
  try {
    const stat = await fs.stat(paths.videoPath);
    return {
      ok: true,
      style,
      outputDir,
      videoPath: paths.videoPath,
      videosDir: paths.videosDir,
      manifestPath: paths.manifestPath,
      finishedAt: stat.mtime.toISOString(),
      source: 'existing-file'
    };
  } catch {
    return null;
  }
}

async function currentBuildResult() {
  if (lastBuildResult) return lastBuildResult;
  return existingBuildResult('nanny');
}

function textForMatching(payload) {
  return [
    payload.sceneId,
    payload.title,
    payload.action,
    payload.insertAction,
    payload.subtitle,
    payload.voiceover,
    payload.reviewNote
  ].filter(Boolean).join(' ');
}

function preferredCaptureId(payload) {
  const text = textForMatching(payload);
  const sceneId = String(payload.sceneId || '');
  const title = String(payload.title || '');
  if (
    sceneId.startsWith('feature-') ||
    /主图1加卖点|品牌展示|SKU图优化|AI显式标识|功能点|前后对比/.test(title)
  ) {
    return null;
  }
  if (/不需要.*(下拉|请选择)|不要.*(下拉|请选择)/.test(text)) {
    return null;
  }
  const wantsDropdown = /下拉|展开|选项|请选择/.test(text);
  if (/平台|抖音|淘宝|快手|京东|微信小店|小红书/.test(text) && wantsDropdown) {
    return 'platform-dropdown-open';
  }
  if (/店铺|店群|店/.test(text) && wantsDropdown) {
    return 'shop-dropdown-open';
  }
  if (/(1\s*[:：]\s*1|1:1|1：1|主图|位置|1\s*[到至-]\s*5|1-5|请选择)/.test(text) && wantsDropdown) {
    return 'image-slot-dropdown-open';
  }
  if (payload.sceneId === 'platform-dropdown-open') return 'platform-dropdown-open';
  if (payload.sceneId === 'shop-dropdown-open') return 'shop-dropdown-open';
  if (payload.sceneId === 'image-slot-dropdown-open') return 'image-slot-dropdown-open';
  return null;
}

async function captureOverrideForRequirement(payload) {
  const id = preferredCaptureId(payload);
  if (!id) return null;
  const capture = await readCaptureState();
  const shot = (capture.screenshots || []).find(item => item.id === id);
  if (!shot?.file) return null;
  return {
    screenshot: shot.file,
    focusRect: shot.focusRect || null,
    devicePixelRatio: shot.devicePixelRatio,
    sourceDescription: shot.description,
    linkedCaptureId: shot.id,
    screenshotOverrideReason: 'matched-existing-dropdown-capture'
  };
}

async function saveScene(payload, extra = {}) {
  if (!payload.sceneKey) throw new Error('missing sceneKey');
  await ensureDir(boardDir);
  const state = await readReviewState();
  const previous = state.scenes[payload.sceneKey] || {};
  state.updatedAt = new Date().toISOString();
  state.scenes[payload.sceneKey] = {
    ...previous,
    sceneKey: payload.sceneKey,
    sceneId: payload.sceneId,
    style: payload.style,
    index: payload.index,
    title: payload.title,
    reviewStatus: payload.reviewStatus || 'pass',
    action: payload.action || '',
    subtitle: payload.subtitle || '',
    voiceover: payload.voiceover || '',
    reviewNote: payload.reviewNote || '',
    screenshot: payload.screenshot ?? previous.screenshot,
    zoomImage: payload.zoomImage ?? previous.zoomImage,
    zoomDeleted: payload.zoomDeleted ?? previous.zoomDeleted,
    zoomMode: payload.zoomMode ?? previous.zoomMode,
    zoomCropPosition: payload.zoomCropPosition ?? previous.zoomCropPosition,
    focusRect: payload.focusRect ?? previous.focusRect,
    devicePixelRatio: payload.devicePixelRatio ?? previous.devicePixelRatio,
    sourceDescription: payload.sourceDescription ?? previous.sourceDescription,
    ...extra,
    updatedAt: new Date().toISOString()
  };
  await fs.writeFile(reviewStatePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return state.scenes[payload.sceneKey];
}

async function saveSceneOrder(payload) {
  if (!payload.style) throw new Error('missing style');
  if (!Array.isArray(payload.sceneOrder)) throw new Error('missing sceneOrder');
  await ensureDir(boardDir);
  const state = await readReviewState();
  const updatedAt = new Date().toISOString();
  state.updatedAt = updatedAt;
  state.sceneOrder = {
    ...(state.sceneOrder || {}),
    [payload.style]: payload.sceneOrder.map(item => String(item)).filter(Boolean)
  };
  await fs.writeFile(reviewStatePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return state.sceneOrder[payload.style];
}

function titleForInsert(payload) {
  const text = `${payload.insertAction || ''}${payload.action || ''}`;
  if (/平台|抖音|淘宝|快手|京东|微信小店|小红书/.test(text)) return '补充镜头：平台下拉展开';
  if (/店铺|店/.test(text)) return '补充镜头：店铺下拉展开';
  if (/主图|位置|1到5|1-5/.test(text)) return '补充镜头：下拉选项展开';
  return '补充镜头';
}

async function insertScene(payload) {
  if (!payload.sceneKey) throw new Error('missing sceneKey');
  await ensureDir(boardDir);
  const state = await readReviewState();
  const createdAt = new Date().toISOString();
  const insertPosition = payload.insertPosition === 'before' ? 'before' : 'after';
  const captureOverride = await captureOverrideForRequirement(payload);
  const generatedResult = await generateSceneCopySmart({
    ...payload,
    action: payload.insertAction || payload.action || '',
    reviewNote: payload.reviewNote || '补充镜头'
  });
  const generated = generatedResult.copy;
  const item = {
    sceneKey: `${payload.style || 'scene'}-insert-${Date.now().toString(36)}`,
    sourceSceneKey: payload.sceneKey,
    anchorSceneKey: payload.sceneKey,
    insertPosition,
    ...(insertPosition === 'before'
      ? { beforeSceneKey: payload.sceneKey }
      : { afterSceneKey: payload.sceneKey }),
    sceneId: payload.sceneId,
    style: payload.style,
    title: titleForInsert(payload),
    action: payload.insertAction || payload.action || '',
    subtitle: generated.subtitle,
    voiceover: generated.voiceover,
    ...(captureOverride || {}),
    reviewStatus: 'pass',
    reviewNote: '',
    generatedBy: generatedResult.provider,
    generatedModel: generatedResult.model,
    createdAt,
    updatedAt: createdAt
  };
  state.updatedAt = createdAt;
  state.insertedScenes = [...(state.insertedScenes || []), item];
  await fs.writeFile(reviewStatePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return item;
}

async function runExport() {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(rootDir, 'scripts/export_shooting_board.mjs'),
      '--output',
      outputDir
    ], {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderr = '';
    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8');
    });
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`export failed ${code}: ${stderr.trim()}`));
    });
    child.on('error', reject);
  });
}

async function runDryCapture() {
  if (recaptureRunning) {
    const error = new Error('已有重拍任务正在执行，等它完成后再点。');
    error.status = 409;
    throw error;
  }
  recaptureRunning = true;
  await ensureDir(logDir);
  const logPath = path.join(logDir, `recapture-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
  const args = [
    path.join(rootDir, 'build_all.sh'),
    '--dry-run',
    '--output',
    outputDir,
    '--aspect',
    'horizontal'
  ];

  await new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), {
      cwd: rootDir,
      env: {
        ...process.env,
        ROOT_DIR
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const logStream = createWriteStream(logPath, { flags: 'w' });
    child.stdout.pipe(logStream, { end: false });
    child.stderr.pipe(logStream, { end: false });
    child.on('close', code => {
      logStream.end(() => {
        if (code === 0) resolve();
        else reject(new Error(`dry-run exited ${code}; log=${logPath}`));
      });
    });
    child.on('error', error => {
      logStream.end(() => reject(error));
    });
  }).finally(() => {
    recaptureRunning = false;
  });

  return logPath;
}

async function runStoryboardBuild(style = 'nanny') {
  if (style !== 'nanny') {
    const error = new Error('当前只支持生成保姆版横屏视频。');
    error.status = 400;
    throw error;
  }
  if (recaptureRunning) {
    const error = new Error('已有重拍任务正在执行，等它完成后再生成视频。');
    error.status = 409;
    throw error;
  }
  if (buildRunning) {
    const error = new Error('已有视频生成任务正在执行，等它完成后再点。');
    error.status = 409;
    throw error;
  }

  buildRunning = true;
  await ensureDir(logDir);
  const startedAt = new Date().toISOString();
  const safeStamp = startedAt.replace(/[:.]/g, '-');
  const logPath = path.join(logDir, `storyboard-build-${safeStamp}.log`);
  const paths = buildPaths(style);
  const args = [
    path.join(rootDir, 'build_storyboard_video.sh'),
    '--output',
    outputDir,
    '--style',
    style
  ];

  try {
    await new Promise((resolve, reject) => {
      const child = spawn(args[0], args.slice(1), {
        cwd: rootDir,
        env: {
          ...process.env,
          ROOT_DIR
        },
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
      style,
      startedAt,
      finishedAt: new Date().toISOString(),
      outputDir,
      videoPath: paths.videoPath,
      videosDir: paths.videosDir,
      manifestPath: paths.manifestPath,
      logPath
    };
    return lastBuildResult;
  } catch (error) {
    lastBuildResult = {
      ok: false,
      style,
      startedAt,
      finishedAt: new Date().toISOString(),
      outputDir,
      videoPath: paths.videoPath,
      videosDir: paths.videosDir,
      manifestPath: paths.manifestPath,
      logPath,
      error: error.message || String(error)
    };
    throw error;
  } finally {
    buildRunning = false;
  }
}

function ensureInsideOutputDir(targetPath) {
  const resolved = path.resolve(targetPath);
  const root = path.resolve(outputDir);
  if (resolved === root || resolved.startsWith(root + path.sep)) return resolved;
  const error = new Error('只能打开当前教程输出目录内的文件。');
  error.status = 403;
  throw error;
}

async function openBuildTarget(payload = {}) {
  const result = await currentBuildResult();
  const paths = buildPaths('nanny');
  const target = String(payload.target || 'video');
  const action = String(payload.action || 'open');
  const targetPath = {
    video: result?.videoPath || paths.videoPath,
    'video-folder': result?.videosDir || paths.videosDir,
    'output-folder': outputDir,
    manifest: result?.manifestPath || paths.manifestPath,
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

function mimeFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.md') return 'text/markdown; charset=utf-8';
  return 'application/octet-stream';
}

async function serveFile(req, res, pathname) {
  let file;
  if (pathname === '/' || pathname === '/shooting-board.html') {
    file = path.join(boardDir, 'shooting-board.html');
  } else if (pathname.startsWith('/Users/')) {
    file = decodeURIComponent(pathname);
  } else {
    file = path.join(outputDir, decodeURIComponent(pathname));
  }
  const resolved = path.resolve(file);
  if (!resolved.startsWith('/Users/gd/')) {
    sendText(res, 403, 'forbidden');
    return;
  }
  try {
    await fs.access(resolved);
  } catch {
    sendText(res, 404, 'not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': mimeFor(resolved),
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Access-Control-Allow-Origin': '*'
  });
  createReadStream(resolved).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      sendText(res, 204, '');
      return;
    }
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, { ok: true, outputDir, recaptureRunning, buildRunning, lastBuildResult: await currentBuildResult(), copyProvider: sceneCopyProviderStatus() });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/build-status') {
      sendJson(res, 200, { ok: true, buildRunning, lastBuildResult: await currentBuildResult() });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/save-scene') {
      const payload = await readRequestJson(req);
      const scene = await saveScene(payload);
      sendJson(res, 200, { ok: true, scene });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/save-order') {
      const payload = await readRequestJson(req);
      const sceneOrder = await saveSceneOrder(payload);
      sendJson(res, 200, { ok: true, style: payload.style, sceneOrder });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/generate-copy') {
      const payload = await readRequestJson(req);
      const generatedResult = await generateSceneCopySmart(payload);
      const generated = generatedResult.copy;
      const scene = await saveScene(
        { ...payload, ...generated },
        {
          generatedBy: generatedResult.provider,
          generatedModel: generatedResult.model,
          generationError: generatedResult.error
        }
      );
      sendJson(res, 200, {
        ok: true,
        ...generated,
        provider: generatedResult.provider,
        model: generatedResult.model,
        error: generatedResult.error,
        scene
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/insert-scene') {
      const payload = await readRequestJson(req);
      const scene = await insertScene(payload);
      await runExport();
      sendJson(res, 200, {
        ok: true,
        scene,
        sceneKey: scene.sceneKey,
        message: payload.insertPosition === 'before'
          ? '已在当前镜头前插入补充镜。'
          : '已在当前镜头后插入补充镜。'
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/recapture-scene') {
      const payload = await readRequestJson(req);
      const captureOverride = await captureOverrideForRequirement(payload);
      if (captureOverride) {
        await saveScene(payload, {
          ...captureOverride,
          recaptureRequestedAt: new Date().toISOString(),
          recaptureMode: 'existing-capture-match'
        });
        await runExport();
        sendJson(res, 200, {
          ok: true,
          message: `已把这一镜切换到真实截图：${captureOverride.linkedCaptureId}。`,
          linkedCaptureId: captureOverride.linkedCaptureId
        });
        return;
      }
      await saveScene(payload, { recaptureRequestedAt: new Date().toISOString() });
      const logPath = await runDryCapture();
      sendJson(res, 200, {
        ok: true,
        message: '已按当前要求重新干跑截图，页面即将刷新。',
        logPath
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/build-video') {
      const payload = await readRequestJson(req);
      const result = await runStoryboardBuild(payload.style || 'nanny');
      sendJson(res, 200, {
        ok: true,
        ...result,
        message: '保姆版横屏视频已生成。'
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/open-build-target') {
      const payload = await readRequestJson(req);
      const result = await openBuildTarget(payload);
      sendJson(res, 200, result);
      return;
    }
    if (req.method === 'GET') {
      await serveFile(req, res, url.pathname);
      return;
    }
    sendJson(res, 405, { error: 'method not allowed' });
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message || String(error) });
  }
});

server.listen(flags.port, '127.0.0.1', () => {
  console.log(`storyboard server: http://127.0.0.1:${flags.port}/`);
  console.log(`output: ${outputDir}`);
});
