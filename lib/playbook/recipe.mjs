import { findAssets } from './assets.mjs';
import { estimateDuration } from '../text-utils.mjs';

export const PLAYBOOK_SCENES = [
  'hook-old-product',
  'ai-image-optimize',
  'optimized-result',
  'confirm-publish',
  'ai-video-entry',
  'select-product',
  'generate-video',
  'video-result',
  'result-summary'
];

const COPY = {
  'hook-old-product': {
    title: '老商品图也能重新激活',
    screenText: '老商品图先优化，再生成商品视频',
    voiceover: '很多老商品不是不能卖，是主图和视频素材没有跟上。先用 AI 优化商品图，再生成商品视频。'
  },
  'ai-image-optimize': {
    title: '先用 AI 优化商品图',
    screenText: '第一步：AI优化商品图',
    voiceover: '第一步，先用 AI 优化商品图，把原来的商品图优化成更适合点击的主图、卖点图和 S K U 图。'
  },
  'optimized-result': {
    title: '查看优化后的商品图',
    screenText: '主图更吸引，卖点更清楚',
    voiceover: '优化后先看效果。主图负责吸引点击，卖点图负责让买家一眼看懂优势。'
  },
  'confirm-publish': {
    title: '确认发布到商品',
    screenText: '确认无误后发布到商品',
    voiceover: '确认图片没问题后，发布到测试店商品里。只有发布完成，后面生成视频才能读取到新商品图。'
  },
  'ai-video-entry': {
    title: '进入 AI生成视频',
    screenText: '第二步：AI批量生成视频',
    voiceover: '第二步，进入 AI 视频里的 AI 生成视频功能，用刚更新过的商品图继续生成视频。'
  },
  'select-product': {
    title: '选择平台、店铺和商品',
    screenText: '选择平台、店铺和要生成的视频商品',
    voiceover: '这里选择平台、店铺和商品。批量处理时，可以一次选多个商品，提高上新和素材制作效率。'
  },
  'generate-video': {
    title: '立即生成商品视频',
    screenText: '一键生成商品视频',
    voiceover: '选好商品后点击立即生成，让系统基于商品图生成商品视频。'
  },
  'video-result': {
    title: '查看视频生成结果',
    screenText: '图片变视频，商品更容易被看完',
    voiceover: '生成后查看视频结果。主图拉点击，视频拉停留，组合起来更适合电商转化。'
  },
  'result-summary': {
    title: '一套流程打通图和视频',
    screenText: 'AI优化图 + AI生成视频',
    voiceover: '这套流程适合老商品翻新，也适合批量上新。先优化图，再生成视频，让商品素材更完整。'
  }
};

const ASSET_REQUIREMENTS = {
  'hook-old-product': {
    requiredTags: ['hook-old-product'],
    acceptedTypes: ['operation-screenshot', 'before-after', 'generated-image']
  },
  'ai-image-optimize': {
    requiredTags: ['ai-image-optimize'],
    acceptedTypes: ['operation-screenshot', 'dropdown-open']
  },
  'optimized-result': {
    requiredTags: ['optimized-result'],
    acceptedTypes: ['generated-image', 'before-after']
  },
  'confirm-publish': {
    requiredTags: ['confirm-publish'],
    acceptedTypes: ['publish-confirm', 'operation-screenshot']
  },
  'ai-video-entry': {
    requiredTags: ['ai-video-entry'],
    acceptedTypes: ['operation-screenshot']
  },
  'select-product': {
    requiredTags: ['select-product'],
    acceptedTypes: ['operation-screenshot', 'dropdown-open']
  },
  'generate-video': {
    requiredTags: ['generate-video'],
    acceptedTypes: ['operation-screenshot']
  },
  'video-result': {
    requiredTags: ['video-result'],
    acceptedTypes: ['video-result']
  },
  'result-summary': {
    requiredTags: ['result-summary'],
    acceptedTypes: ['video-result', 'before-after', 'generated-image']
  }
};

function selectAsset(manifest, requiredTags, acceptedTypes) {
  return findAssets(manifest, requiredTags, acceptedTypes)
    .find(asset => asset.status === 'active') || null;
}

export function buildPlaybookRecipe(manifest = {}) {
  const sourceManifest = manifest && typeof manifest === 'object' ? manifest : { assets: [] };
  const scenes = PLAYBOOK_SCENES.map(sceneKey => {
    const copy = COPY[sceneKey];
    const requirements = ASSET_REQUIREMENTS[sceneKey];
    const asset = selectAsset(sourceManifest, requirements.requiredTags, requirements.acceptedTypes);

    return {
      sceneKey,
      title: copy.title,
      requiredTags: [...requirements.requiredTags],
      acceptedTypes: [...requirements.acceptedTypes],
      screenText: copy.screenText,
      voiceover: copy.voiceover,
      duration: estimateDuration(copy.voiceover, 4.5, 9),
      selectedAssetId: asset ? asset.id : null,
      missingAsset: !asset
    };
  });

  return {
    version: 1,
    kind: 'playbook-recipe',
    playbook: 'ai-image-to-video',
    createdAt: new Date().toISOString(),
    sceneCount: scenes.length,
    missingAssetCount: scenes.filter(scene => scene.missingAsset).length,
    totalDuration: Number(scenes.reduce((sum, scene) => sum + scene.duration, 0).toFixed(2)),
    scenes
  };
}
