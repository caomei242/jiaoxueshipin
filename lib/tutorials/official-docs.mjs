import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');
const DEFAULT_DOCS_PATH = path.join(ROOT_DIR, 'configs', 'official-docs.json');

function assertSafeId(value, fieldName) {
  if (!/^[a-z0-9-]+$/.test(String(value || ''))) {
    throw new Error(`${fieldName} must use lowercase letters, numbers, and dashes: ${value}`);
  }
}

function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    return url.toString();
  } catch {
    return raw;
  }
}

function publicOfficialDoc(doc) {
  return {
    id: doc.id,
    title: doc.title,
    url: doc.url,
    source: doc.source,
    lastReviewedAt: doc.lastReviewedAt,
    appliesTo: doc.appliesTo,
    platforms: doc.platforms,
    factSummary: doc.factSummary,
    pointRules: doc.pointRules,
    operationFlow: doc.operationFlow,
    scriptCoverageChecklist: doc.scriptCoverageChecklist
  };
}

export function officialDocsPathFromEnv() {
  return path.resolve(process.env.TUTORIAL_OFFICIAL_DOCS_PATH || DEFAULT_DOCS_PATH);
}

export async function loadOfficialDocs(docsPath = officialDocsPathFromEnv()) {
  const raw = await fs.readFile(docsPath, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data.docs)) throw new Error('official docs config missing docs');

  const ids = new Set();
  const docs = data.docs.map(doc => {
    assertSafeId(doc.id, 'officialDoc.id');
    if (ids.has(doc.id)) throw new Error(`duplicate official doc id: ${doc.id}`);
    ids.add(doc.id);

    return {
      id: doc.id,
      title: String(doc.title || doc.id),
      url: normalizeUrl(doc.url),
      source: String(doc.source || ''),
      lastReviewedAt: String(doc.lastReviewedAt || ''),
      appliesTo: Array.isArray(doc.appliesTo) ? doc.appliesTo.map(String) : [],
      platforms: Array.isArray(doc.platforms) ? doc.platforms.map(String) : [],
      factSummary: Array.isArray(doc.factSummary) ? doc.factSummary.map(String) : [],
      pointRules: Array.isArray(doc.pointRules) ? doc.pointRules.map(String) : [],
      operationFlow: Array.isArray(doc.operationFlow)
        ? doc.operationFlow.map(step => ({
            title: String(step.title || ''),
            scriptUse: String(step.scriptUse || ''),
            customerPoint: String(step.customerPoint || '')
          }))
        : [],
      scriptCoverageChecklist: Array.isArray(doc.scriptCoverageChecklist)
        ? doc.scriptCoverageChecklist.map(String)
        : []
    };
  });

  return {
    version: Number(data.version || 1),
    docsPath,
    docs
  };
}

export function findOfficialDoc(docsData, docId) {
  if (!docId) return null;
  return docsData.docs.find(doc => doc.id === docId) || null;
}

export function findOfficialDocs(docsData, docIds) {
  const ids = Array.isArray(docIds) ? docIds : [docIds].filter(Boolean);
  return ids.map(id => findOfficialDoc(docsData, id)).filter(Boolean);
}

export function findOfficialDocByUrl(docsData, url) {
  const targetUrl = normalizeUrl(url);
  if (!targetUrl) return null;
  return docsData.docs.find(doc => normalizeUrl(doc.url) === targetUrl) || null;
}

export function publicOfficialDocs(docsData, docIds = []) {
  return findOfficialDocs(docsData, docIds).map(publicOfficialDoc);
}

export function publicOfficialDocByUrl(docsData, url) {
  const doc = findOfficialDocByUrl(docsData, url);
  return doc ? publicOfficialDoc(doc) : null;
}
