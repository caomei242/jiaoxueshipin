import { TARGET_TEST_STORE } from './config.mjs';

function clean(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/[“”]/g, '"')
    .trim();
}

function stripCodeFence(text) {
  return String(text || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function parseJsonObject(text) {
  const raw = stripCodeFence(text);
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('copy api did not return JSON');
    return JSON.parse(match[0]);
  }
}

function trimEndPunctuation(text) {
  return clean(text).replace(/[。.!！?？；;，,]+$/g, '');
}

function shortSentence(text, fallback, max = 22) {
  const base = trimEndPunctuation(text || fallback)
    .replace(/^这一[步镜]要拍[:：]?/g, '')
    .replace(/^画面要求[:：]?/g, '')
    .replace(/^先/g, '先');
  if (base.length <= max) return base;
  const cut = base.slice(0, max);
  return cut.replace(/[，,、][^，,、]*$/g, '') || cut;
}

function templateFor(sceneId) {
  const templates = {
    'single-shop-entry': {
      subtitle: '左上角切多店管理',
      voiceover: `先确认是${TARGET_TEST_STORE}测试店，再点左上角切换至多店管理。`
    },
    entry: {
      subtitle: '进入 AI优化商品图',
      voiceover: '左侧打开通用工具，点击 AI优化商品图。'
    },
    'platform-dropdown-open': {
      subtitle: '选择对应平台',
      voiceover: '这里先点开平台下拉，用哪个平台就选哪个平台。'
    },
    'shop-dropdown-open': {
      subtitle: '选择要处理的店铺',
      voiceover: '这里点开店铺下拉，选择要处理的店铺。列表展开后，先确认店铺名再勾选。'
    },
    'shop-selected': {
      subtitle: '确认已选店铺',
      voiceover: '看到顶部显示已选店铺数量，再继续往下操作。'
    },
    settings: {
      subtitle: '先看设置区',
      voiceover: '先看设置区，这里主要看图片位置、SKU、logo和卖点。'
    },
    'position-selected': {
      subtitle: '按需求勾图片位置',
      voiceover: '需要优化哪类图片，就勾选 1:1主图、3:4主图或 SKU图。'
    },
    'image-slot-dropdown-open': {
      subtitle: '选主图1到主图5',
      voiceover: '点开“请选择”，这里可以指定要优化第几张主图，比如主图1到主图5。'
    },
    'options-selected': {
      subtitle: 'SKU、logo、卖点按需选',
      voiceover: 'SKU图用于规格图；保留品牌logo避免误擦；主图卖点决定是否让AI提炼卖点。'
    },
    'product-list': {
      subtitle: '确认商品列表加载',
      voiceover: '先确认商品列表已经加载出来，再选择要处理的商品。'
    },
    'product-selected': {
      subtitle: '勾选目标商品',
      voiceover: '勾选要生成主图的商品，别一次选错商品。'
    },
    'before-generate': {
      subtitle: '确认后点立即生成',
      voiceover: '前面设置都确认无误后，再点击立即生成。'
    },
    'generate-confirm': {
      subtitle: '确认扣点生成',
      voiceover: '弹窗会提示扣点，确认后点确定开始生成。'
    },
    degraded: {
      subtitle: '异常先排查',
      voiceover: '如果没有商品或结果没出来，先排查店铺、商品和记录，不要点发布类按钮。'
    }
  };
  return templates[sceneId] || {
    subtitle: '按画面提示操作',
    voiceover: '按画面上的红框和鼠标位置完成这一部操作。'
  };
}

function keywordOverride(sceneId, text) {
  if (/主图\s*1|主图1|位置\s*1|位置1|1\s*[到至-]\s*5|1-5/.test(text)) {
    return {
      subtitle: '选主图1到主图5',
      voiceover: '点开“请选择”，这里可以指定要优化第几张主图，比如主图1到主图5。'
    };
  }
  if (/SKU|logo|Logo|卖点/.test(text)) {
    return {
      subtitle: 'SKU、logo、卖点按需选',
      voiceover: 'SKU图用于规格图，保留品牌logo避免被改掉，主图卖点按商品需求开启。'
    };
  }
  if (/下拉|展开|选项/.test(text)) {
    if (sceneId === 'platform-dropdown-open') {
      return {
        subtitle: '选择对应平台',
        voiceover: '这里先点开平台下拉，用哪个平台就选哪个平台。'
      };
    }
    if (sceneId === 'shop-dropdown-open') {
      return {
        subtitle: '选择要处理的店铺',
        voiceover: '这里点开店铺下拉，选择要处理的店铺。列表展开后，先确认店铺名再勾选。'
      };
    }
    return {
      subtitle: '打开下拉选择',
      voiceover: '这里点开下拉框，按自己的商品情况选择对应选项。'
    };
  }
  if (/鼠标|遮挡|挡字|右下/.test(text)) {
    return {
      subtitle: '按提示点击',
      voiceover: '跟着画面里的鼠标位置点击，注意先看清按钮文字再操作。'
    };
  }
  return null;
}

export function generateSceneCopy(payload) {
  const sceneId = payload.sceneId || payload.id || '';
  const base = templateFor(sceneId);
  const combined = clean([
    payload.action,
    payload.reviewNote,
    payload.subtitle,
    payload.voiceover
  ].filter(Boolean).join('。'));
  const override = keywordOverride(sceneId, combined);
  const source = override || base;
  const action = clean(payload.action) || source.voiceover;
  const subtitle = shortSentence(source.subtitle, base.subtitle, 20);
  const voiceover = clean(source.voiceover);
  return {
    action,
    subtitle,
    voiceover
  };
}

function normalizeGeneratedCopy(payload, generated) {
  const fallback = generateSceneCopy(payload);
  return {
    action: clean(generated.action || payload.action || fallback.action),
    subtitle: shortSentence(generated.subtitle, fallback.subtitle, 20),
    voiceover: clean(generated.voiceover || fallback.voiceover)
  };
}

function copyApiConfig() {
  return {
    baseUrl: (process.env.TUTORIAL_COPY_API_BASE || 'http://127.0.0.1:63990/v1').replace(/\/+$/, ''),
    apiKey: process.env.TUTORIAL_COPY_API_KEY || '',
    model: process.env.TUTORIAL_COPY_MODEL || 'gpt-5.4-mini'
  };
}

export function sceneCopyProviderStatus() {
  const config = copyApiConfig();
  return {
    configured: Boolean(config.apiKey),
    baseUrl: config.baseUrl,
    model: config.model
  };
}

function buildCopyPrompt(payload) {
  const sceneId = payload.sceneId || payload.id || '';
  return [
    `镜头ID：${sceneId}`,
    `镜头标题：${payload.title || ''}`,
    `画面要求：${payload.action || ''}`,
    `当前屏幕文字：${payload.subtitle || ''}`,
    `当前口播：${payload.voiceover || ''}`,
    `给AI的改稿意见：${payload.reviewNote || ''}`,
    `目标测试店：${TARGET_TEST_STORE}`
  ].join('\n');
}

export async function generateSceneCopyFromApi(payload) {
  const config = copyApiConfig();
  if (!config.apiKey) return null;

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            '你是客户教程视频的中文口播编辑。',
            '输出必须是严格 JSON，不要 Markdown，不要解释。',
            'JSON 结构：{"action":"...","subtitle":"...","voiceover":"..."}。',
            '写给客户听，不要写给拍摄人员看。',
            '禁止出现：客户看清楚、这一镜、要拍、画面、镜头、鼠标放、拍摄、脚本。',
            'subtitle 控制在 20 个中文字符内。',
            'voiceover 控制在 55 个中文字符内，口语、直接、能照着操作。',
            'action 可以保留原画面要求，但要更明确。'
          ].join('\n')
        },
        {
          role: 'user',
          content: buildCopyPrompt(payload)
        }
      ]
    })
  });

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(`copy api ${response.status}: ${message.slice(0, 240)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  const parsed = parseJsonObject(content);
  return {
    copy: normalizeGeneratedCopy(payload, parsed),
    provider: 'copy-api',
    model: data.model || config.model
  };
}

export async function generateSceneCopySmart(payload) {
  try {
    const apiResult = await generateSceneCopyFromApi(payload);
    if (apiResult) return apiResult;
  } catch (error) {
    return {
      copy: generateSceneCopy(payload),
      provider: 'local-copywriter-fallback',
      error: error.message
    };
  }
  return {
    copy: generateSceneCopy(payload),
    provider: 'local-copywriter'
  };
}
