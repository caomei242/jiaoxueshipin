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

function normalizeIdList(value, fieldName) {
  const rawList = Array.isArray(value) ? value : [value].filter(Boolean);
  return rawList.map(item => {
    const id = String(item || '').trim();
    assertSafeId(id, fieldName);
    return id;
  });
}

function replaceOutputDirArg(arg, outputDir) {
  return String(arg).replaceAll('<outputDir>', outputDir);
}

function assertPathInside(parentDir, childPath, fieldName) {
  const relativePath = path.relative(parentDir, childPath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`${fieldName} must resolve inside outputDir: ${childPath}`);
  }
}

function resolveRootScript(scriptPath, fieldName) {
  const raw = String(scriptPath || '').trim();
  if (!raw) return '';
  if (path.isAbsolute(raw)) throw new Error(`${fieldName} must be relative: ${raw}`);
  const resolved = path.resolve(ROOT_DIR, raw);
  const relativePath = path.relative(ROOT_DIR, resolved);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`${fieldName} must resolve inside project root: ${raw}`);
  }
  return resolved;
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
    if (tutorial.groupId) assertSafeId(tutorial.groupId, 'tutorial.groupId');
    if (tutorialIds.has(tutorial.id)) throw new Error(`duplicate tutorial id: ${tutorial.id}`);
    tutorialIds.add(tutorial.id);

    const rawOutputDir = String(tutorial.outputDir || '').trim();
    if (!rawOutputDir) throw new Error(`tutorial ${tutorial.id} missing outputDir`);
    const outputDir = path.resolve(rawOutputDir);

    const relativeVideoPath = String(tutorial.videoPath || '').trim();
    if (!relativeVideoPath) throw new Error(`tutorial ${tutorial.id} missing videoPath`);
    if (path.isAbsolute(relativeVideoPath)) {
      throw new Error(`tutorial ${tutorial.id} videoPath must be relative: ${relativeVideoPath}`);
    }

    const videoPath = path.resolve(outputDir, relativeVideoPath);
    assertPathInside(outputDir, videoPath, `tutorial ${tutorial.id} videoPath`);

    const build = tutorial.build || { enabled: false };
    const buildArgs = Array.isArray(build.args)
      ? build.args.map(arg => replaceOutputDirArg(arg, outputDir))
      : [];
    const start = tutorial.start || { enabled: false };
    const startArgs = Array.isArray(start.args)
      ? start.args.map(arg => replaceOutputDirArg(arg, outputDir))
      : [];
    const officialDocIds = normalizeIdList(
      tutorial.officialDocIds || tutorial.officialDocId || [],
      `tutorial ${tutorial.id} officialDocIds`
    );

    return {
      id: tutorial.id,
      tabId: tutorial.tabId,
      groupId: String(tutorial.groupId || tutorial.tabId),
      groupLabel: String(tutorial.groupLabel || ''),
      title: String(tutorial.title || tutorial.id),
      subtitle: String(tutorial.subtitle || ''),
      templateType: String(tutorial.templateType || 'operation-tutorial'),
      status: String(tutorial.status || 'draft'),
      statusLabel: String(tutorial.statusLabel || tutorial.status || 'draft'),
      targetStore: String(tutorial.targetStore || ''),
      captureUrl: String(tutorial.captureUrl || ''),
      officialDocIds,
      outputDir,
      boardUrl: String(tutorial.boardUrl || ''),
      relativeVideoPath,
      videoPath,
      boardRoute: String(tutorial.boardRoute || ''),
      start: {
        enabled: Boolean(start.enabled),
        label: String(start.label || '开始制作'),
        script: resolveRootScript(start.script, `tutorial ${tutorial.id} start.script`),
        args: startArgs,
        reason: String(start.reason || '')
      },
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
    groupId: tutorial.groupId,
    groupLabel: tutorial.groupLabel,
    title: tutorial.title,
    subtitle: tutorial.subtitle,
    templateType: tutorial.templateType,
    status: tutorial.status,
    statusLabel: tutorial.statusLabel,
    targetStore: tutorial.targetStore,
    captureUrl: tutorial.captureUrl,
    officialDocIds: tutorial.officialDocIds,
    outputDir: tutorial.outputDir,
    boardUrl: tutorial.boardUrl,
    boardRoute: tutorial.boardRoute,
    videoPath: tutorial.videoPath,
    startEnabled: tutorial.start.enabled,
    startLabel: tutorial.start.label,
    startDisabledReason: tutorial.start.reason,
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
