import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensurePlaybookWorkspace, playbookPaths } from './paths.mjs';

export const ASSET_TYPES = new Set([
  'operation-screenshot',
  'dropdown-open',
  'before-after',
  'generated-image',
  'publish-confirm',
  'video-result'
]);

export function slugify(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') || 'asset';
}

export function assetSubdir(type) {
  if (type === 'generated-image' || type === 'before-after') {
    return 'generated-images';
  }
  if (type === 'video-result') {
    return 'video-results';
  }
  return 'operation-screenshots';
}

export async function readAssetManifest(outputDir) {
  const paths = playbookPaths(outputDir);
  let rawManifest;

  try {
    rawManifest = await fs.readFile(paths.manifestPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw new Error(`invalid asset manifest: ${paths.manifestPath}`, { cause: error });
    }

    await ensurePlaybookWorkspace(outputDir);
    return {
      version: 1,
      kind: 'playbook-assets',
      playbook: 'ai-image-to-video',
      store: '道理门',
      platform: '抖音',
      assets: [],
      updatedAt: new Date().toISOString()
    };
  }

  try {
    return JSON.parse(rawManifest);
  } catch (error) {
    throw new Error(`invalid asset manifest: ${paths.manifestPath}`, { cause: error });
  }
}

export async function writeAssetManifest(outputDir, manifest) {
  const paths = await ensurePlaybookWorkspace(outputDir);
  const source = manifest && typeof manifest === 'object' ? manifest : {};
  const next = {
    ...source,
    assets: Array.isArray(source.assets) ? source.assets : [],
    updatedAt: new Date().toISOString()
  };
  await fs.writeFile(paths.manifestPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

export async function importAsset(outputDir, options) {
  if (!ASSET_TYPES.has(options.type)) {
    throw new Error(`invalid asset type: ${options.type}`);
  }

  const sourcePath = path.resolve(options.source);
  await fs.access(sourcePath);

  const paths = await ensurePlaybookWorkspace(outputDir);
  const manifest = await readAssetManifest(outputDir);
  const id = options.id || `${options.type}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const title = options.title || id;
  const ext = path.extname(sourcePath) || '.asset';
  const targetPath = path.join(paths.root, 'assets', assetSubdir(options.type), `${slugify(id)}${ext}`);

  await fs.copyFile(sourcePath, targetPath);

  const entry = {
    id,
    type: options.type,
    title,
    sourcePath: targetPath,
    targetPath,
    originalPath: sourcePath,
    featureTags: Array.isArray(options.tags) ? options.tags : [],
    store: options.store || '道理门',
    platform: options.platform || '抖音',
    status: 'active',
    createdAt: new Date().toISOString(),
    notes: options.notes || ''
  };

  manifest.assets = (Array.isArray(manifest.assets) ? manifest.assets : [])
    .filter(item => item.id !== id)
    .concat(entry);
  await writeAssetManifest(outputDir, manifest);
  return entry;
}

export async function rejectAsset(outputDir, id, reason) {
  const manifest = await readAssetManifest(outputDir);
  manifest.assets = (Array.isArray(manifest.assets) ? manifest.assets : []).map(item => (
    item.id === id
      ? { ...item, status: 'reject', rejectReason: reason || '人工标记不用' }
      : item
  ));
  await writeAssetManifest(outputDir, manifest);
  return manifest.assets.find(item => item.id === id);
}

export function findAssets(manifest, requiredTags = [], acceptedTypes = []) {
  const tags = requiredTags.map(String);
  const types = acceptedTypes.map(String);
  return (manifest.assets || []).filter(item => {
    if (item.status === 'reject') return false;
    if (types.length && !types.includes(item.type)) return false;
    return tags.every(tag => (item.featureTags || []).includes(tag));
  });
}
