import fs from 'node:fs/promises';
import path from 'node:path';
import { CDP_BASE_URL } from './config.mjs';

async function request(pathname, options = {}) {
  const response = await fetch(`${CDP_BASE_URL}${pathname}`, options);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`CDP request failed ${response.status} ${pathname}\n${body}`);
  }
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function listTargets() {
  return request('/targets');
}

export async function newTarget(url) {
  const encoded = encodeURIComponent(url);
  const result = await request(`/new?url=${encoded}`);
  return result.targetId;
}

export async function navigateTarget(targetId, url) {
  return request(`/navigate?target=${encodeURIComponent(targetId)}&url=${encodeURIComponent(url)}`);
}

export async function closeTarget(targetId) {
  return request(`/close?target=${encodeURIComponent(targetId)}`);
}

export async function evalInTarget(targetId, source) {
  const result = await request(`/eval?target=${encodeURIComponent(targetId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: source
  });
  if (result && Object.prototype.hasOwnProperty.call(result, 'exceptionDetails')) {
    throw new Error(`CDP eval exception: ${JSON.stringify(result.exceptionDetails)}`);
  }
  return result?.value ?? result;
}

export async function clickAtSelector(targetId, selector) {
  return request(`/clickAt?target=${encodeURIComponent(targetId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: selector
  });
}

export async function screenshot(targetId, file) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  return request(`/screenshot?target=${encodeURIComponent(targetId)}&file=${encodeURIComponent(file)}`);
}

export async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}
