#!/usr/bin/env node
import path from 'node:path';
import { ensurePlaybookWorkspace, PLAYBOOK_NAME } from '../lib/playbook/paths.mjs';
import { TARGET_TEST_STORE } from '../lib/config.mjs';
import { writeJson } from '../lib/fs-utils.mjs';

const DEFAULT_CDP_BASE_URL = 'http://localhost:3456';
const TARGET_DOMAIN = 'gdsp.huanleguang.com';
const PREFERRED_ROUTES = ['/app-pim', '/app-douyin'];
const SENSITIVE_KEY_PATTERN = /^(token|cookie|secret|debug(?:_secret)?|access_token|refresh_token|auth|authorization|session|sid)$/i;

function usageError(message) {
  return new Error(`${message}\nUsage: node scripts/capture_playbook_flow.mjs --output <dir> [--dry-run] [--allow-publish] [--allow-generate-video]`);
}

function parseArgs(argv) {
  const flags = {
    outputDir: null,
    dryRun: false,
    allowPublish: false,
    allowGenerateVideo: false,
    cdpBaseUrl: process.env.CDP_BASE_URL || DEFAULT_CDP_BASE_URL
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw usageError('--output requires a path value');
      flags.outputDir = path.resolve(value);
      index += 1;
    } else if (arg === '--dry-run') {
      flags.dryRun = true;
    } else if (arg === '--allow-publish') {
      flags.allowPublish = true;
    } else if (arg === '--allow-generate-video') {
      flags.allowGenerateVideo = true;
    } else {
      throw usageError(`unknown arg: ${arg}`);
    }
  }

  if (!flags.outputDir) throw usageError('--output is required');
  return flags;
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_CDP_BASE_URL).replace(/\/+$/, '');
}

function sanitizeUrlForOutput(value) {
  if (!value) return '';
  const raw = String(value);
  try {
    const parsed = new URL(raw);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, parsed.pathname === '/' ? '/' : '');
  } catch {
    return raw
      .replace(/^([^:/?#]+:\/\/)[^/@\s]+@/, '$1')
      .split(/[?#]/)[0];
  }
}

function sanitizeTextForOutput(value) {
  return String(value || '')
    .replace(/https?:\/\/[^\s"'<>]+/g, match => sanitizeUrlForOutput(match))
    .replace(/\b(token|cookie|secret|debug(?:_secret)?|access_token|refresh_token|auth|authorization|session|sid)\b\s*[:=]\s*([^\s"'<>]+)/gi, '$1=[redacted]')
    .replace(/(["'])(token|cookie|secret|debug(?:_secret)?|access_token|refresh_token|auth|authorization|session|sid)\1\s*:\s*(["'])[^"']*\3/gi, '$1$2$1:$3[redacted]$3');
}

function sanitizeValueForOutput(value, key = '') {
  if (SENSITIVE_KEY_PATTERN.test(String(key))) return '[redacted]';
  if (typeof value === 'string') return sanitizeTextForOutput(value);
  if (Array.isArray(value)) return value.map(item => sanitizeValueForOutput(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeValueForOutput(entryValue, entryKey)
      ])
    );
  }
  return value;
}

function sanitizeJsonForOutput(value) {
  return JSON.stringify(sanitizeValueForOutput(value));
}

async function cdpRequest(cdpBaseUrl, pathname, options = {}) {
  const url = `${normalizeBaseUrl(cdpBaseUrl)}${pathname}`;
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new Error(`CDP request failed: unable to reach ${sanitizeUrlForOutput(normalizeBaseUrl(cdpBaseUrl))} (attempted ${sanitizeUrlForOutput(url)}): ${sanitizeTextForOutput(error.message)}`);
  }

  const body = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(`CDP request failed ${response.status} ${response.statusText} at ${sanitizeUrlForOutput(url)}`);
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

async function listTargets(cdpBaseUrl) {
  const targets = await cdpRequest(cdpBaseUrl, '/targets');
  if (!Array.isArray(targets)) {
    throw new Error(`CDP ${sanitizeUrlForOutput(normalizeBaseUrl(cdpBaseUrl))}/targets returned non-array response`);
  }
  return targets;
}

async function evalInTarget(cdpBaseUrl, targetId, source) {
  const result = await cdpRequest(cdpBaseUrl, `/eval?target=${encodeURIComponent(targetId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: source
  });
  if (result && Object.prototype.hasOwnProperty.call(result, 'exceptionDetails')) {
    throw new Error(`CDP eval exception: ${sanitizeJsonForOutput(result.exceptionDetails)}`);
  }
  return result?.value ?? result;
}

async function screenshot(cdpBaseUrl, targetId, file) {
  return cdpRequest(cdpBaseUrl, `/screenshot?target=${encodeURIComponent(targetId)}&file=${encodeURIComponent(file)}`);
}

function targetScore(target) {
  const title = target.title || '';
  const url = target.url || '';
  let score = 0;
  if (url.includes(TARGET_DOMAIN)) score += 100;
  if (title.includes('稿定商品')) score += 80;
  if (PREFERRED_ROUTES.some(route => url.includes(route))) score += 60;
  if (url.includes('/app-pim')) score += 16;
  if (url.includes('/app-douyin')) score += 12;
  if (target.type === 'page') score += 8;
  return score;
}

function findPlaybookTarget(targets) {
  const candidates = targets
    .filter(target => {
      const title = target.title || '';
      const url = target.url || '';
      return url.includes(TARGET_DOMAIN) || title.includes('稿定商品');
    })
    .map(target => ({ target, score: targetScore(target) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.target || null;
}

function safeTargetInfo(target) {
  return {
    targetId: target.targetId || target.id || null,
    type: target.type || null,
    title: sanitizeTextForOutput(target.title || ''),
    url: sanitizeUrlForOutput(target.url || '')
  };
}

function pageTextProbeSource() {
  return `(() => {
    const text = document.body ? document.body.innerText : '';
    return {
      title: document.title,
      url: location.href,
      hasTargetTestStore: text.includes(${JSON.stringify(TARGET_TEST_STORE)}),
      textSample: text.replace(/\\s+/g, ' ').trim().slice(0, 600)
    };
  })()`;
}

function buildSafety({ flags, pageProbe }) {
  const requestedBothFinalFlags = flags.allowPublish && flags.allowGenerateVideo;
  const reasons = [];

  if (!requestedBothFinalFlags) {
    if (!flags.allowPublish) reasons.push('missing --allow-publish');
    if (!flags.allowGenerateVideo) reasons.push('missing --allow-generate-video');
  }
  if (!pageProbe?.hasTargetTestStore) {
    reasons.push(`page text does not contain target test store: ${TARGET_TEST_STORE}`);
  }
  if (flags.dryRun) {
    reasons.push('dry-run mode never allows final publish/generate actions');
  }

  const allowedFinalActions = !flags.dryRun && requestedBothFinalFlags && Boolean(pageProbe?.hasTargetTestStore);
  return {
    targetTestStore: TARGET_TEST_STORE,
    allowPublishFlag: flags.allowPublish,
    allowGenerateVideoFlag: flags.allowGenerateVideo,
    containsTargetTestStore: Boolean(pageProbe?.hasTargetTestStore),
    allowedFinalActions,
    reasons: allowedFinalActions ? [`both allow flags are present and page text contains ${TARGET_TEST_STORE}`] : reasons
  };
}

function buildNextCheckpoint(flags, safety) {
  if (flags.dryRun) {
    return 'Dry run completed. Review output/manifests/capture.json and captured screenshot before any manual action.';
  }
  if (!safety.allowedFinalActions) {
    return 'Checkpoint before final publish or generate action. Re-run with both --allow-publish and --allow-generate-video only after confirming the active page is 道理门.';
  }
  return 'Final actions are safety-eligible, but this skeleton only captures context and does not click publish or generate.';
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const cdpBaseUrl = normalizeBaseUrl(flags.cdpBaseUrl);
  const paths = await ensurePlaybookWorkspace(flags.outputDir);
  const captureDir = path.join(paths.root, 'captures');
  const manifestPath = path.join(paths.root, 'manifests', 'capture.json');
  const createdAt = new Date().toISOString();
  const mode = flags.dryRun ? 'dry-run' : 'checkpoint';

  const targets = await listTargets(cdpBaseUrl);
  const target = findPlaybookTarget(targets);
  if (!target) {
    throw new Error(`No relevant 稿定商品 tab found from CDP base ${sanitizeUrlForOutput(cdpBaseUrl)}. Open a ${TARGET_DOMAIN} /app-pim or /app-douyin tab and retry.`);
  }

  const targetId = target.targetId || target.id;
  if (!targetId) {
    throw new Error(`Selected CDP target has no targetId from ${sanitizeUrlForOutput(cdpBaseUrl)}: ${JSON.stringify(safeTargetInfo(target))}`);
  }

  const pageProbe = await evalInTarget(cdpBaseUrl, targetId, pageTextProbeSource());
  const screenshotFile = path.join(captureDir, `playbook-capture-${createdAt.replace(/[:.]/g, '-')}.png`);
  await screenshot(cdpBaseUrl, targetId, screenshotFile);

  const safety = buildSafety({ flags, pageProbe });
  const screenshots = [{
    id: 'active-playbook-page',
    title: 'Active 稿定商品 page',
    file: screenshotFile,
    capturedAt: new Date().toISOString()
  }];

  const manifest = {
    kind: 'playbook-capture',
    playbook: PLAYBOOK_NAME,
    mode,
    createdAt,
    cdpBaseUrl: sanitizeUrlForOutput(cdpBaseUrl),
    target: {
      ...safeTargetInfo(target),
      currentTitle: sanitizeTextForOutput(pageProbe?.title || target.title || ''),
      currentUrl: sanitizeUrlForOutput(pageProbe?.url || target.url || '')
    },
    pageTextSample: sanitizeTextForOutput(pageProbe?.textSample || ''),
    screenshots,
    safety,
    nextCheckpoint: buildNextCheckpoint(flags, safety)
  };

  await writeJson(manifestPath, manifest);
  console.log(`capture manifest: ${manifestPath}`);
  console.log(`screenshot: ${screenshotFile}`);
  console.log(`mode: ${mode}`);
  console.log(`allowedFinalActions: ${safety.allowedFinalActions}`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
