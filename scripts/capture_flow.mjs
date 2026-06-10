#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  parseArgs,
  APP_HOME_URL,
  TARGET_URL,
  SINGLE_SHOP_URL,
  TARGET_TEST_STORE,
  REFERENCE_VIDEO_URL,
  OFFICIAL_DOC_URL
} from '../lib/config.mjs';
import { clickAtSelector, closeTarget, evalInTarget, listTargets, navigateTarget, newTarget, screenshot, sleep } from '../lib/cdp.mjs';
import { ensureDir, outputPath, writeJson } from '../lib/fs-utils.mjs';

const flags = parseArgs(process.argv.slice(2));
const captureDir = outputPath(flags.outputDir, 'capture');
await ensureDir(captureDir);

function js(strings, ...values) {
  return String.raw({ raw: strings }, ...values);
}

async function findSourceTarget() {
  const targets = await listTargets();
  const exact = targets.find(t => t.url?.includes('/app-pim/#/ai/background-swap'));
  if (exact) return exact;
  const single = targets.find(t => t.url?.includes('/app-douyin#/'));
  if (single) return { ...single, relatedOnly: true };
  const related = targets.find(t => t.title?.includes('稿定商品') && t.url?.includes('gdsp.huanleguang.com'));
  return related ? { ...related, relatedOnly: true } : null;
}

const sourceTarget = await findSourceTarget();
const targetId = await newTarget(SINGLE_SHOP_URL);
await sleep(2600);

function safeUrl(url) {
  try {
    const parsed = new URL(url);
    const hash = parsed.hash || '';
    const route =
      hash.startsWith('#/ai/background-swap') ? '#/ai/background-swap' :
      hash.startsWith('#/') ? hash.split('?')[0] :
      '';
    return `${parsed.origin}${parsed.pathname}${route}`;
  } catch {
    return '页面地址已隐藏';
  }
}

function sanitizePageState(state) {
  return {
    title: state.title,
    url: safeUrl(state.url),
    platform: state.platform,
    selectedShopCount: state.selectedShopCount,
    hasSelectedShop: state.selectedShopCount !== null ? state.selectedShopCount > 0 : null,
    selectedProductCount: state.selectedProductCount,
    hasSelectedProduct: state.selectedProductCount > 0,
    hasEnoughPointsForSingleGeneration: state.points !== null ? state.points >= 25 : null,
    hasNoProducts: state.hasNoProducts,
    productRowCount: state.productRowCount,
    checkedPositions: state.checkedPositions,
    hasGenerate: state.hasGenerate,
    generateButtonLooksDisabled: /disabled|is-disabled/.test(state.generateButtonClass || ''),
    generatedResult: state.generatedResult
  };
}

const capture = {
  createdAt: new Date().toISOString(),
  dryRun: flags.dryRun,
  sourceTarget: sourceTarget ? {
    title: sourceTarget.title,
    url: safeUrl(sourceTarget.url)
  } : null,
  targetUrl: safeUrl(TARGET_URL),
  referenceVideoUrl: REFERENCE_VIDEO_URL,
  officialDocUrl: OFFICIAL_DOC_URL,
  targetTestStore: TARGET_TEST_STORE,
  operationDepth: flags.dryRun ? 'dry-run-no-generate' : 'generate-if-safe-no-publish',
  safety: {
    clickedGenerate: false,
    generatedResult: false,
    clickedPublish: false,
    clickedRecharge: false,
    blockedSubmitConfirmation: false,
    degraded: false,
    reasons: []
  },
  pageState: {},
  events: [],
  screenshots: []
};

const FOCUS_LABELS = [
  '切换至多店管理',
  '退出多店管理模式',
  '首页',
  '通用工具',
  '电商AI设计',
  'AI优化商品图',
  '平台',
  '抖音',
  '淘宝',
  '快手',
  '京东',
  '微信小店',
  '小红书',
  '测试使用',
  '已选',
  '已选0个店铺',
  '已选1个店铺',
  TARGET_TEST_STORE,
  '店群剩余点数',
  '选择位置',
  '1:1主图',
  '3:4主图',
  'SKU图',
  '请选择',
  '保留品牌logo',
  '主图1支持卖点',
  '显式AI标识',
  '不带显式AI标识',
  '预览列表',
  '选择宝贝',
  '商品信息',
  '暂无商品',
  '立即生成',
  '确定',
  '生成结果',
  'AI优化后',
  '换图记录'
];

const NEVER_CLICK_PATTERN = /发布|发布到商品|替换原图|替换商品|提交|确定发布|确认发布|上架|同步到商品|保存到商品|立即购买|充值|开通|支付|确认付款|授权|删除|批量删除/;

async function pageState() {
  return evalInTarget(targetId, js`
(() => {
  const text = document.body ? document.body.innerText : '';
  const buttonTexts = [...document.querySelectorAll('button,a,[role="button"]')]
    .map(el => ({ text: (el.innerText || el.textContent || '').trim(), className: String(el.className || '') }))
    .filter(x => x.text);
  const selectedShopMatch = text.match(/已选(\\d+)个店铺/);
  const pointsMatch = text.match(/店群剩余点数[:：]\\s*(\\d+)点/);
  const platformInput = [...document.querySelectorAll('input.hlg-input__inner')]
    .find(el => ['抖音', '淘宝', '快手', '京东', '微信小店', '小红书'].includes(el.value));
  const visibleRows = [...document.querySelectorAll('.hlg-table-wrapper .hlg-table__row')]
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 20 && r.height > 20 && /商品编号/.test(el.innerText || el.textContent || '');
    });
  const selectedProductCount = [...document.querySelectorAll('.hlg-table-wrapper .table-body-wrapper input[type="checkbox"]:checked')]
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }).length;
  const checkedPositions = [...document.querySelectorAll('label')]
    .filter(label => /1:1主图|3:4主图|SKU图/.test(label.innerText || '') && label.querySelector('input[type="checkbox"]')?.checked)
    .map(label => (label.innerText || '').replace(/\\s+/g, '').trim());
  const hasNoProducts = /暂无商品/.test(text);
  const hasGenerate = buttonTexts.some(x => x.text.includes('立即生成'));
  const generateButton = buttonTexts.find(x => x.text.includes('立即生成')) || null;
  const generatedResult = /生成结果|AI优化后|优化后|重新生成|不满意|换图结果|生成记录/.test(text);
  return {
    title: document.title,
    url: location.href,
    platform: platformInput ? platformInput.value : null,
    selectedShopCount: selectedShopMatch ? Number(selectedShopMatch[1]) : null,
    points: pointsMatch ? Number(pointsMatch[1]) : null,
    hasNoProducts,
    productRowCount: visibleRows.length,
    selectedProductCount,
    checkedPositions,
    hasGenerate,
    generatedResult,
    generateButtonClass: generateButton ? generateButton.className : '',
    bodySignals: {
      hasMultiShopExit: /退出多店管理模式/.test(text),
      hasSettings: /选择位置/.test(text),
      hasProductList: /选择宝贝|商品信息/.test(text),
      hasNoProducts
    }
  };
})()
`);
}

async function waitForText(pattern, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  const source = pattern instanceof RegExp ? pattern.source : String(pattern);
  while (Date.now() < deadline) {
    const ok = await evalInTarget(targetId, js`
((source) => {
  const re = new RegExp(source);
  return re.test(document.body?.innerText || '');
})(${JSON.stringify(source)})
`);
    if (ok) return true;
    await sleep(500);
  }
  return false;
}

async function setRelationPanelHidden(hidden) {
  await evalInTarget(targetId, js`
((hidden) => {
  let style = document.getElementById('codex-capture-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'codex-capture-style';
    style.textContent = [
      '.codex-hide-relation-panels .relation-shop-panel { display: none !important; }',
      '.codex-hide-debug-drawer .ant-drawer-content-wrapper { transform: translateX(-440px) !important; }',
      '.codex-readable-dropdowns .hlg-select-dropdown, .codex-readable-dropdowns .hlg-dropdown-menu__wrap { opacity: 1 !important; filter: none !important; backdrop-filter: none !important; background: #fff !important; color: #111827 !important; box-shadow: 0 10px 30px rgba(15,23,42,.16) !important; }',
      '.codex-readable-dropdowns .hlg-select-dropdown *, .codex-readable-dropdowns .hlg-dropdown-menu__wrap * { opacity: 1 !important; filter: none !important; text-shadow: none !important; }',
      '.codex-readable-dropdowns .hlg-select-dropdown [class*="disabled"], .codex-readable-dropdowns .hlg-select-dropdown [aria-disabled="true"] { color: #475569 !important; }',
      '.codex-product-list-view .mosaic-image__filter { display: none !important; }',
      '.codex-product-list-view .mosaic-image__list { margin-top: -270px !important; position: relative !important; z-index: 4 !important; background: #fff !important; }',
      '.codex-product-list-view .mosaic-image__list .common-filter { display: none !important; }',
      '.codex-product-list-view .mosaic-image__list .mosaic-image__list-action { display: none !important; }'
    ].join('\\n');
    document.head.appendChild(style);
  }
  document.documentElement.classList.toggle('codex-hide-relation-panels', Boolean(hidden));
  document.documentElement.classList.add('codex-hide-debug-drawer');
  document.documentElement.classList.add('codex-readable-dropdowns');
  return true;
})(${JSON.stringify(hidden)})
`);
}

async function setProductListView(enabled) {
  await evalInTarget(targetId, js`
((enabled) => {
  document.documentElement.classList.toggle('codex-product-list-view', Boolean(enabled));
  return true;
})(${JSON.stringify(enabled)})
`);
}

async function hideNonTargetDropdowns() {
  await evalInTarget(targetId, js`
(() => {
  for (const el of document.querySelectorAll('.hlg-select-dropdown, .hlg-dropdown-menu__wrap')) {
    const text = (el.innerText || el.textContent || '').trim();
    if (/20条\\/页|50条\\/页|100条\\/页/.test(text)) el.style.display = 'none';
  }
  return true;
})()
`);
}

async function hideSelectDropdowns() {
  await evalInTarget(targetId, js`
(() => {
  for (const el of document.querySelectorAll('.hlg-select-dropdown')) {
    el.style.display = 'none';
  }
  return true;
})()
`);
}

async function preparePageForCapture() {
  await evalInTarget(targetId, js`
(() => {
  document.body.style.background = '#eef2f7';
  document.querySelectorAll('.codex-redaction-overlay').forEach(el => el.remove());
  return true;
})()
`);
}

async function scrollPage(scrollY) {
  await evalInTarget(targetId, js`
((scrollY) => {
  const y = Number(scrollY || 0);
  window.scrollTo(0, y);
  if (document.scrollingElement) document.scrollingElement.scrollTop = y;
  const candidates = [...document.querySelectorAll('*')]
    .filter(el => el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 220);
  for (const el of candidates) {
    const r = el.getBoundingClientRect();
    if (r.width > 600 && r.height > 220) {
      el.scrollTop = y;
    }
  }
  return true;
})(${Number(scrollY || 0)})
`);
}

async function getFocusRects(labels) {
  return evalInTarget(targetId, js`
((labels) => {
  const selector = [
    'button',
    'a',
    'label',
    'input',
    'span',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'li',
    '[role="button"]',
    '.hlg-checkbox',
    '.hlg-radio',
    '.hlg-form-item',
    '.goods-filter',
    '.table-list',
    '.common-filter',
    '.swap-config',
    '.ai-background-swap',
    '.relation-shop-panel',
    '.hlg-select-dropdown',
    '.hlg-table-wrapper',
    '.mosaic-image__footer'
  ].join(',');

  const viewport = {
    width: window.innerWidth || document.documentElement.clientWidth || 0,
    height: window.innerHeight || document.documentElement.clientHeight || 0
  };

  function clean(text) {
    return String(text || '').replace(/\\s+/g, '').trim();
  }

  function textOf(el) {
    return [
      el.innerText,
      el.textContent,
      el.value,
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('title'),
      el.getAttribute?.('placeholder')
    ].filter(Boolean).join(' ');
  }

  function rectOf(el) {
    const r = el.getBoundingClientRect();
    if (!Number.isFinite(r.left) || !Number.isFinite(r.top) || r.width < 4 || r.height < 4) return null;
    if (r.right < -20 || r.bottom < -20 || r.left > viewport.width + 20 || r.top > viewport.height + 20) return null;
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }

  function scoreCandidate(el, label, rect, rawText) {
    const normalizedText = clean(rawText);
    const normalizedLabel = clean(label);
    const area = rect.width * rect.height;
    let score = 0;
    if (normalizedText === normalizedLabel) score += 260;
    if (normalizedText.startsWith(normalizedLabel)) score += 110;
    if (normalizedText.includes(normalizedLabel)) score += 85;
    score -= Math.min(170, normalizedText.length * 1.5);
    score -= Math.min(130, area / 5200);
    if (rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= viewport.width && rect.y + rect.height <= viewport.height) score += 36;

    const leftMenuLabels = new Set(['首页', '通用工具', '电商AI设计', 'AI优化商品图']);
    const settingsLabels = new Set(['选择位置', '1:1主图', '3:4主图', 'SKU图', '请选择', '保留品牌logo', '主图1支持卖点', '显式AI标识', '不带显式AI标识']);
    const topFilterLabels = new Set(['抖音', '淘宝', '快手', '京东', '微信小店', '小红书', '测试使用', '已选', '已选0个店铺', '已选1个店铺', '店群剩余点数', ${JSON.stringify(TARGET_TEST_STORE)}]);
    const productLabels = new Set(['预览列表', '选择宝贝', '商品信息', '暂无商品']);

    if (label === '切换至多店管理') score += rect.x < 360 && rect.y < 120 ? 260 : -120;
    if (leftMenuLabels.has(label)) score += rect.x < 260 ? 220 : -180;
    if (settingsLabels.has(label)) score += rect.x > 620 && rect.y > 420 && rect.y < 900 ? 150 : -30;
    if (topFilterLabels.has(label)) score += rect.x > 600 && rect.y > 250 && rect.y < 700 ? 150 : -40;
    if (productLabels.has(label)) score += rect.y > 850 ? 110 : 0;
    if (label === '立即生成') score += rect.y > viewport.height - 180 ? 180 : 0;

    if (el.matches?.('button,a,label,input,[role="button"],.hlg-checkbox,.hlg-radio')) score += 32;
    return score;
  }

  const elements = [...document.querySelectorAll(selector)];
  const out = {};
  for (const label of labels) {
    const candidates = [];
    for (const el of elements) {
      const rawText = textOf(el);
      if (!clean(rawText).includes(clean(label))) continue;
      const rect = rectOf(el);
      if (!rect) continue;
      candidates.push({
        rect,
        text: String(rawText || '').trim().slice(0, 120),
        score: scoreCandidate(el, label, rect, rawText)
      });
    }
    candidates.sort((a, b) => b.score - a.score);
    if (candidates[0]) out[label] = candidates[0].rect;
  }
  return out;
})(${JSON.stringify(labels)})
`);
}

async function captureShot(id, title, description, scrollY, focusLabel, fallbackRect = null) {
  await scrollPage(scrollY);
  await sleep(450);
  await preparePageForCapture();
  await hideNonTargetDropdowns();
  const file = path.join(captureDir, `${String(capture.screenshots.length + 1).padStart(2, '0')}-${id}.png`);
  await screenshot(targetId, file);
  const focusRects = await getFocusRects(FOCUS_LABELS);
  const focusRect = focusLabel ? focusRects[focusLabel] : null;
  capture.screenshots.push({
    id,
    title,
    description,
    file,
    scrollY,
    devicePixelRatio: await evalInTarget(targetId, 'window.devicePixelRatio || 1'),
    focusLabel,
    focusRect: focusRect || fallbackRect,
    focusRects
  });
}

async function clickText(text, options = {}) {
  const { exact = false, allowRiskyGenerate = false } = options;
  if (!allowRiskyGenerate && NEVER_CLICK_PATTERN.test(text)) {
    capture.events.push({ type: 'blocked-click', label: text, reason: 'denylist' });
    return false;
  }
  return evalInTarget(targetId, js`
((payload) => {
  const { text, exact } = payload;
  function clean(value) {
    return String(value || '').replace(/\\s+/g, '').trim();
  }
  function textOf(el) {
    return [
      el.innerText,
      el.textContent,
      el.value,
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('title'),
      el.getAttribute?.('placeholder')
    ].filter(Boolean).join(' ');
  }
  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
  }
  const wanted = clean(text);
  const candidates = [...document.querySelectorAll('button,a,label,input,[role="button"],span,li')]
    .filter(el => {
      const value = clean(textOf(el));
      return visible(el) && (exact ? value === wanted : value.includes(wanted));
    });
  candidates.sort((a, b) => {
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    const at = clean(textOf(a));
    const bt = clean(textOf(b));
    const as = (at === wanted ? -100000 : 0) + (a.matches('button,a,label,input,[role="button"]') ? -2000 : 0) + ar.width * ar.height;
    const bs = (bt === wanted ? -100000 : 0) + (b.matches('button,a,label,input,[role="button"]') ? -2000 : 0) + br.width * br.height;
    return as - bs;
  });
  const target = candidates[0] || null;
  if (!target) return false;
  const control = target.matches('input,button,a,[role="button"]')
    ? target
    : target.querySelector('input,button,a,[role="button"]') || target.closest('label')?.querySelector('input,button,a,[role="button"]') || target;
  control.scrollIntoView({ block: 'center', inline: 'center' });
  control.click();
  if (control.matches?.('input[type="checkbox"],input[type="radio"]')) {
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const r = control.getBoundingClientRect();
  return { text, x: r.left, y: r.top, width: r.width, height: r.height };
})(${JSON.stringify({ text, exact })})
`);
}

async function clickInputByValueOrPlaceholder({ value = null, placeholder = null, xMin = 0, yMin = 0, yMax = 99999 }) {
  return evalInTarget(targetId, js`
((query) => {
  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }
  const candidates = [...document.querySelectorAll('input.hlg-input__inner')]
    .filter(el => {
      const r = el.getBoundingClientRect();
      if (r.width <= 4 || r.height <= 4 || r.x < query.xMin || r.y < query.yMin || r.y > query.yMax) return false;
      if (query.value !== null && el.value !== query.value) return false;
      if (query.placeholder !== null && el.placeholder !== query.placeholder) return false;
      return true;
    });
  const target = candidates[0] || null;
  if (!target) return false;
  target.scrollIntoView({ block: 'center', inline: 'center' });
  target.click();
  const r = rectOf(target);
  return { text: target.value || target.placeholder || '', x: r.x, y: r.y, width: r.width, height: r.height };
})(${JSON.stringify({ value, placeholder, xMin, yMin, yMax })})
`);
}

async function openShopSelector() {
  return evalInTarget(targetId, js`
(() => {
  const buttons = [...document.querySelectorAll('button,a,[role="button"],span')]
    .filter(el => /已选\\d+个店铺/.test((el.innerText || el.textContent || '').replace(/\\s+/g, '')));
  const button = buttons.find(el => {
    const r = el.getBoundingClientRect();
    return r.width > 20 && r.height > 10 && r.x > 700 && r.y > 260 && r.y < 430;
  }) || buttons[0] || null;
  if (!button) return false;
  button.scrollIntoView({ block: 'center', inline: 'center' });
  button.click();
  const r = button.getBoundingClientRect();
  return { text: (button.innerText || button.textContent || '').trim(), x: r.left, y: r.top, width: r.width, height: r.height };
})()
`);
}

async function ensureStoreSelected() {
  const result = await evalInTarget(targetId, js`
((targetStore) => {
  function clean(value) {
    return String(value || '').replace(/\\s+/g, '').trim();
  }
  const wanted = clean(targetStore);
  const candidates = [...document.querySelectorAll('.relation-shop-panel label, .relation-shop-panel li, .relation-shop-panel div, .relation-shop-panel span')]
    .map(el => {
      const text = clean(el.innerText || el.textContent || '');
      if (!text.includes(wanted)) return null;
      const input =
        el.querySelector?.('input[type="checkbox"]') ||
        el.closest?.('label')?.querySelector?.('input[type="checkbox"]') ||
        el.closest?.('.hlg-checkbox')?.querySelector?.('input[type="checkbox"]') ||
        el.parentElement?.querySelector?.('input[type="checkbox"]');
      if (!input) return null;
      const r = input.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return null;
      return { el, input, area: r.width * r.height, text };
    })
    .filter(Boolean);
  candidates.sort((a, b) => a.area - b.area);
  const match = candidates[0] || null;
  if (!match) return { ok: false, reason: 'target-store-not-found', targetStore };
  const input = match.input;
  if (!input.checked) {
    input.click();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const r = input.getBoundingClientRect();
  return { ok: true, text: targetStore, matchedText: match.text, x: r.left, y: r.top, width: r.width, height: r.height, checked: input.checked };
})(${JSON.stringify(TARGET_TEST_STORE)})
`);
  if (result?.ok) {
    capture.events.push({ type: 'select-store', label: TARGET_TEST_STORE, rect: result });
    return result;
  }
  capture.safety.degraded = true;
  capture.safety.reasons.push(`未在店铺下拉里找到测试店：${TARGET_TEST_STORE}`);
  capture.events.push({ type: 'select-store-failed', label: TARGET_TEST_STORE, result });
  return null;
}

async function ensurePositionChecked(label) {
  const result = await evalInTarget(targetId, js`
((label) => {
  function clean(value) {
    return String(value || '').replace(/\\s+/g, '').trim();
  }
  const wanted = clean(label);
  const labelEl = [...document.querySelectorAll('label')]
    .find(el => clean(el.innerText || el.textContent).includes(wanted));
  const input = labelEl?.querySelector('input[type="checkbox"]') || null;
  if (!input) return false;
  if (!input.checked) {
    input.click();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const r = input.getBoundingClientRect();
  return { text: label, x: r.left, y: r.top, width: r.width, height: r.height, checked: input.checked };
})(${JSON.stringify(label)})
`);
  if (result) capture.events.push({ type: 'ensure-position', label, rect: result });
  return result;
}

async function clickFirstProduct() {
  const result = await evalInTarget(targetId, js`
(() => {
  const rows = [...document.querySelectorAll('.hlg-table-wrapper .table-body-wrapper .hlg-table__row')]
    .filter(row => /商品编号/.test(row.innerText || row.textContent || ''))
    .filter(row => {
      const r = row.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
    });
  const row = rows[0] || null;
  const input = row?.querySelector('input[type="checkbox"]') || null;
  if (!row || !input) return false;
  if (!input.checked) {
    row.click();
  }
  const r = row.getBoundingClientRect();
  return { text: (row.innerText || row.textContent || '目标商品').trim().slice(0, 120), x: r.left, y: r.top, width: r.width, height: r.height, checked: input.checked };
})()
`);
  if (result) capture.events.push({ type: 'select-product', label: 'first-product', rect: result });
  return result;
}

async function ensureProductTabAll() {
  return evalInTarget(targetId, js`
(() => {
  const labels = [...document.querySelectorAll('label')]
    .filter(label => (label.innerText || label.textContent || '').replace(/\\s+/g, '').trim() === '全部')
    .filter(label => {
      const r = label.getBoundingClientRect();
      return r.y > 850 && r.width > 20 && r.height > 20;
    });
  const label = labels[0] || null;
  if (!label) return false;
  const input = label.querySelector('input') || null;
  if (input && !input.checked) {
    input.click();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (!input) {
    label.click();
  }
  const r = label.getBoundingClientRect();
  return { text: '全部', x: r.left, y: r.top, width: r.width, height: r.height };
})()
`);
}

async function clickGenerateSafely() {
  const result = await evalInTarget(targetId, js`
(() => {
  const risky = /发布到商品|替换原图|替换商品|确认发布|确定发布|上架|支付/.test(document.body?.innerText || '');
  if (risky) return { blocked: true, reason: 'risky text already visible' };
  const buttons = [...document.querySelectorAll('button,a,[role="button"]')]
    .filter(el => (el.innerText || el.textContent || '').trim().includes('立即生成'));
  const button = buttons.find(el => {
    const r = el.getBoundingClientRect();
    return r.width > 10 && r.height > 10 && !/disabled|is-disabled/.test(String(el.className || ''));
  }) || null;
  if (!button) return false;
  button.scrollIntoView({ block: 'center', inline: 'center' });
  button.click();
  const r = button.getBoundingClientRect();
  return { text: '立即生成', x: r.left, y: r.top, width: r.width, height: r.height };
})()
`);
  if (result?.blocked) {
    capture.safety.reasons.push(`检测到风险文字，已阻止点击立即生成：${result.reason}`);
    return false;
  }
  if (result) capture.events.push({ type: 'click', label: '立即生成', rect: result });
  return result;
}

async function resultAreaRect() {
  return evalInTarget(targetId, js`
(() => {
  const candidates = [...document.querySelectorAll('*')]
    .map(el => {
      const text = (el.innerText || el.textContent || '').trim();
      const r = el.getBoundingClientRect();
      return { text, x: r.left, y: r.top, width: r.width, height: r.height };
    })
    .filter(item => item.width > 180 && item.height > 100 && /生成结果|AI优化后|优化后|重新生成|不满意|换图记录|商品信息/.test(item.text));
  candidates.sort((a, b) => (b.width * b.height) - (a.width * a.height));
  const item = candidates[0] || null;
  if (item) return item;
  return { x: 760, y: 880, width: 1240, height: 320 };
})()
`);
}

async function riskyModalState() {
  return evalInTarget(targetId, js`
(() => {
  const text = document.body ? document.body.innerText : '';
  const riskyButtons = [...document.querySelectorAll('button,a,[role="button"]')]
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
    })
    .map(el => (el.innerText || el.textContent || '').trim())
    .filter(label => /发布|发布到商品|替换原图|替换商品|提交|确认发布|确定发布|上架|支付/.test(label));
  return {
    riskyButtons,
    hasSubmit: riskyButtons.includes('提交'),
    risky: riskyButtons.length > 0,
    text: text.slice(0, 1200)
  };
})()
`);
}

async function confirmGenerationPromptIfPresent() {
  let lastMarked = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const marked = await evalInTarget(targetId, js`
(() => {
  document.querySelectorAll('[data-codex-confirm-generate]').forEach(el => el.removeAttribute('data-codex-confirm-generate'));
  const text = document.body ? document.body.innerText : '';
  const isGenerationPrompt = /已选择\\d+家店铺的商品/.test(text) && /逐一扣点|确认要进行操作/.test(text);
  if (!isGenerationPrompt) return false;
  const buttons = [...document.querySelectorAll('button,a,[role="button"]')]
    .filter(el => {
      const label = (el.innerText || el.textContent || '').trim();
      const r = el.getBoundingClientRect();
      return label === '确定' && r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
    });
  const button = buttons[0] || null;
  if (!button) return false;
  const r = button.getBoundingClientRect();
  button.setAttribute('data-codex-confirm-generate', 'true');
  return { text: '确定', x: r.left, y: r.top, width: r.width, height: r.height };
})()
`);
    if (!marked) return lastMarked;
    lastMarked = marked;
    await clickAtSelector(targetId, '[data-codex-confirm-generate="true"]');
    await sleep(900);
  }
  return lastMarked;
}

await preparePageForCapture();
capture.pageState.singleShop = sanitizePageState(await pageState());

await captureShot(
  'single-shop-entry',
  '从单店页切到多店管理',
  '单店工作台左上角有“切换至多店管理”，新手先从这里进入多店批量工具。',
  0,
  '切换至多店管理'
);

const switchClick = await clickText('切换至多店管理', { exact: true });
if (switchClick) capture.events.push({ type: 'click', label: '切换至多店管理', rect: switchClick });
await sleep(1200);
const switched = await waitForText(/退出多店管理模式|通用工具/, 4500);
if (!switched) {
  capture.safety.reasons.push('单店页切换按钮没有在等待时间内完成跳转，自动改用多店管理目标页继续录制');
}

await navigateTarget(targetId, TARGET_URL);
await waitForText(/AI优化商品图|选择位置/, 18000);
await sleep(1800);
capture.pageState.before = sanitizePageState(await pageState());

await captureShot(
  'entry',
  '进入多店管理的 AI 优化商品图',
  '进入多店管理后，在左侧通用工具里找到 AI优化商品图。',
  0,
  'AI优化商品图'
);

await setRelationPanelHidden(true);
const platformClick = await clickInputByValueOrPlaceholder({ value: '抖音', xMin: 620, yMin: 260, yMax: 430 });
if (platformClick) capture.events.push({ type: 'open-dropdown', label: '平台', rect: platformClick });
await sleep(500);
await captureShot(
  'platform-dropdown-open',
  '打开平台下拉',
  '平台不是只看抖店；抖音、淘宝、快手、京东、微信小店、小红书商家按自己的平台选择。',
  0,
  '抖音',
  platformClick || null
);

await hideSelectDropdowns();
await setRelationPanelHidden(false);
const shopButton = await openShopSelector();
if (shopButton) capture.events.push({ type: 'open-dropdown', label: '店铺选择', rect: shopButton });
await sleep(600);
await captureShot(
  'shop-dropdown-open',
  '打开店铺下拉并勾选店铺',
  '点店铺选择入口，在当前店群里勾选这次要处理的测试店铺。',
  0,
  TARGET_TEST_STORE
);

const selectedStore = await ensureStoreSelected();
await sleep(2600);
capture.selectionAttempt = { selectedStore: Boolean(selectedStore) };
await captureShot(
  'shop-selected',
  '确认已选店铺',
  '店铺勾上后，顶部会显示已选店铺数量，下面商品列表才会加载。',
  0,
  '已选1个店铺',
  selectedStore || null
);

await setRelationPanelHidden(true);
await captureShot(
  'settings',
  '选择要优化的图片位置',
  '在设置区先看图片位置：1:1主图、3:4主图、SKU图。',
  0,
  '选择位置'
);

const clickedOneToOne = await ensurePositionChecked('1:1主图');
await sleep(400);
capture.selectionAttempt = {
  ...capture.selectionAttempt,
  clickedOneToOne: Boolean(clickedOneToOne)
};

await captureShot(
  'position-selected',
  '先勾选 1:1 主图',
  '先演示勾选 1:1 主图；如果要生成 3:4 或 SKU，后面再勾。',
  0,
  '1:1主图',
  clickedOneToOne || null
);

const slotDropdown = await clickInputByValueOrPlaceholder({ placeholder: '请选择', xMin: 930, yMin: 480, yMax: 650 });
if (slotDropdown) capture.events.push({ type: 'open-dropdown', label: '图片位置下拉', rect: slotDropdown });
await sleep(500);
await captureShot(
  'image-slot-dropdown-open',
  '打开图片位置下拉',
  '如果某个位置后面有“请选择”，点开后按要替换的图片位置选择。',
  0,
  '请选择',
  slotDropdown || null
);

await hideSelectDropdowns();
const clickedThreeFour = await ensurePositionChecked('3:4主图');
await sleep(200);
const clickedSku = await ensurePositionChecked('SKU图');
await sleep(300);
capture.selectionAttempt = {
  ...capture.selectionAttempt,
  clickedThreeFour: Boolean(clickedThreeFour),
  clickedSku: Boolean(clickedSku)
};
await captureShot(
  'options-selected',
  '确认 logo、卖点和 AI 标识',
  '继续看保留品牌logo、主图卖点和 AI显式标识，按平台和商品要求设置。',
  0,
  '保留品牌logo'
);

await setProductListView(true);
await ensureProductTabAll();
await sleep(1000);
await captureShot(
  'product-list',
  '进入选择宝贝区域',
  '店铺选好后，预览列表会出现商品；如果没有商品，先换店铺或同步商品。',
  0,
  '商品信息',
  { x: 760, y: 1388, width: 1228, height: 390 }
);

const selectedProduct = await clickFirstProduct();
await sleep(700);
await captureShot(
  'product-selected',
  '勾选目标商品',
  '在商品列表里勾选这次要优化的宝贝，选中后再生成。',
  0,
  null,
  selectedProduct || null
);

await captureShot(
  'before-generate',
  '点击立即生成前复核',
  '生成前复核平台、店铺、图片位置和商品，确认无误后点击立即生成。',
  0,
  '立即生成'
);

const rawAfterSelectionState = await pageState();
capture.pageState.afterSelection = sanitizePageState(rawAfterSelectionState);

const state = rawAfterSelectionState;
const canGenerate = !flags.dryRun &&
  state.selectedShopCount !== null &&
  state.selectedShopCount > 0 &&
  state.points !== null &&
  state.points >= 25 &&
  state.selectedProductCount > 0 &&
  !state.hasNoProducts &&
  state.hasGenerate;

if (canGenerate) {
  const clickedGenerate = await clickGenerateSafely();
  capture.safety.clickedGenerate = Boolean(clickedGenerate);
  await sleep(1400);
  await captureShot(
    'generate-confirm',
    '确认生成并扣点',
    '页面会提醒本次只生成效果图并按商品数量扣点；确认后继续生成，不发布商品。',
    0,
    '确定',
    clickedGenerate || null
  );
  const confirmedGenerate = await confirmGenerationPromptIfPresent();
  if (confirmedGenerate) capture.events.push({ type: 'click', label: '生成确认-确定', rect: confirmedGenerate });
  await sleep(2500);

  const deadline = Date.now() + 95000;
  let generated = false;
  const riskyReasonSet = new Set(capture.safety.reasons);
  while (Date.now() < deadline) {
    const modalState = await riskyModalState();
    if (modalState.risky) {
      capture.safety.blockedSubmitConfirmation = true;
      const reason = `生成后检测到风险按钮，已停止后续点击：${modalState.riskyButtons.join('、')}`;
      if (!riskyReasonSet.has(reason)) {
        capture.safety.reasons.push(reason);
        riskyReasonSet.add(reason);
      }
    }
    const current = await pageState();
    if (current.generatedResult || /生成完成|AI优化后|重新生成|不满意/.test(modalState.text)) {
      generated = true;
      break;
    }
    await sleep(2500);
  }
  capture.safety.generatedResult = generated;
  if (!generated) {
    capture.safety.degraded = true;
    capture.safety.reasons.push('已点击立即生成，但等待时间内没有检测到稳定的生成结果页；视频保留到生成中/生成后复核步骤');
  }
  const fallback = await resultAreaRect();
  await captureShot(
    'after-generate',
    generated ? '查看真实生成结果' : '查看生成状态',
    '生成后只截图查看效果，不点击发布、替换、提交或充值。',
    420,
    generated ? 'AI优化后' : null,
    fallback
  );
} else {
  capture.safety.degraded = true;
  if (flags.dryRun) capture.safety.reasons.push('dry-run 模式不会点击立即生成');
  if (!state.hasGenerate) capture.safety.reasons.push('页面未检测到立即生成按钮');
  if (state.selectedShopCount === null || state.selectedShopCount <= 0) capture.safety.reasons.push('未检测到已选店铺，禁止消耗点数');
  if (state.points === null || state.points < 25) capture.safety.reasons.push('未检测到足够店群点数，禁止生成');
  if (state.selectedProductCount <= 0) capture.safety.reasons.push('未检测到已选商品，禁止生成');
  if (state.hasNoProducts) capture.safety.reasons.push('商品列表为空，降级为演示到生成前');
  const fallback = await resultAreaRect();
  await captureShot(
    'degraded',
    '条件不足时停在生成前',
    '如果没有店铺、商品或点数，先处理这些问题，不要强行点击生成。',
    0,
    '商品信息',
    fallback
  );
}

capture.pageState.after = sanitizePageState(await pageState());
await writeJson(path.join(captureDir, 'capture.json'), capture);

if (!flags.keepTab) {
  await closeTarget(targetId).catch(() => {});
}

console.log(`capture=${path.join(captureDir, 'capture.json')}`);
