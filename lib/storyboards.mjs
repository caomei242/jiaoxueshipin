import { TARGET_TEST_STORE } from './config.mjs';

function buildAfterSceneId(capture) {
  return capture?.safety?.clickedGenerate ? 'after-generate' : 'degraded';
}

function hasGeneratedResult(capture) {
  return Boolean(capture?.safety?.generatedResult);
}

function afterScene(capture, style) {
  const generated = hasGeneratedResult(capture);
  return {
    id: buildAfterSceneId(capture),
    title: generated ? '查看生成效果' : '停在安全页',
    action: generated ? '只看效果，不发布、不替换。' : '没出结果就先排查，不点发布类按钮。',
    voiceover: generated
      ? (style === 'shortform' ? '最后看效果。不满意就重试，发布前人工确认。' : '生成后先看效果。不满意就重试，发布前人工确认。')
      : (style === 'shortform' ? '没出结果，先查店铺、商品、位置和点数。不要点发布或替换。' : '如果没出结果，先查店铺、商品、位置和点数。不要点发布、替换或提交。'),
    subtitle: generated ? '先看效果，不发布、不替换。' : '没出结果先排查，不点发布类按钮。',
    focusLabel: generated ? 'AI优化后' : null,
    emphasis: generated ? '先复核' : '安全停住'
  };
}

function buildNannyScenes(capture) {
  return [
    {
      id: 'single-shop-entry',
      title: '切到多店管理',
      action: '左上角点击“切换至多店管理”。',
      voiceover: '第一步，左上角点击切换至多店管理。',
      subtitle: '左上角点击“切换至多店管理”。',
      focusLabel: '切换至多店管理',
      emphasis: '从这里进'
    },
    {
      id: 'entry',
      title: '进 AI优化商品图',
      action: '左侧通用工具里点击 AI优化商品图。',
      voiceover: '第二步，左侧通用工具，点击 AI优化商品图。',
      subtitle: '通用工具里点 AI优化商品图。',
      focusLabel: 'AI优化商品图',
      emphasis: '工具入口'
    },
    {
      id: 'platform-dropdown-open',
      title: '选平台',
      action: '平台下拉里选自己的平台。',
      voiceover: '第三步，先选平台。抖音、淘宝、快手、京东、微信小店、小红书，用哪个选哪个。',
      subtitle: '先选平台，用哪个选哪个。',
      focusLabel: '抖音',
      emphasis: '平台先选对'
    },
    {
      id: 'shop-dropdown-open',
      title: '打开店铺',
      action: '点店铺选择，展开店铺列表。',
      voiceover: `第四步，打开店铺选择。这里演示用测试店 ${TARGET_TEST_STORE}，你给客户录的时候就选客户自己的店。`,
      subtitle: `打开店铺列表，勾选 ${TARGET_TEST_STORE}。`,
      focusLabel: TARGET_TEST_STORE,
      emphasis: '先选店铺'
    },
    {
      id: 'shop-selected',
      title: '勾选店铺',
      action: `勾选 ${TARGET_TEST_STORE} 测试店。`,
      voiceover: `第五步，勾选 ${TARGET_TEST_STORE} 测试店。看到已选数量后继续。客户实操时，换成自己的店。`,
      subtitle: `勾选 ${TARGET_TEST_STORE}，看已选数量。`,
      focusLabel: '已选1个店铺',
      emphasis: '确认已选'
    },
    {
      id: 'settings',
      title: '看设置区',
      action: '先看图片位置、logo、卖点、AI 标识。',
      voiceover: '第六步，先看设置区。这里先看图片位置，再看 SKU、logo 和卖点。',
      subtitle: '先看图片位置、SKU、logo、卖点。',
      focusLabel: '选择位置',
      emphasis: '先配设置'
    },
    {
      id: 'position-selected',
      title: '选图片位置',
      action: '先勾当前主图位置；需要 3:4 或 SKU 就继续往下勾。',
      voiceover: '第七步，先勾图片位置。一比一主图、三比四主图、SKU 图，需要哪一种就勾哪一种。',
      subtitle: '需要哪种图，就勾哪种位置。',
      focusLabel: 'SKU图',
      emphasis: '位置别选错'
    },
    {
      id: 'image-slot-dropdown-open',
      title: '选主图位置',
      action: '勾选 1:1 主图后，右侧点“请选择”，选择主图1到主图5里要优化的那张。',
      voiceover: '第八步，如果勾了一比一主图，右侧这个请选择要点开。主图一到主图五，想凸显哪一张，就选哪一张。',
      subtitle: '点“请选择”，选主图1到主图5。',
      focusLabel: '请选择',
      emphasis: '选具体主图'
    },
    {
      id: 'options-selected',
      title: '讲三个设置',
      action: '解释 SKU图、保留品牌logo、主图1支持卖点。',
      voiceover: '第九步，三个设置要看一下。SKU 图是优化规格图；保留品牌 logo 是尽量不动原来的品牌标；主图一支持卖点，选是就会更突出卖点，想画面干净就选否。',
      subtitle: 'SKU图、保留logo、主图卖点按需求选择。',
      focusLabel: '保留品牌logo',
      emphasis: '按需求选择'
    },
    {
      id: 'product-list',
      title: '看商品列表',
      action: '确认商品列表加载出来。',
      voiceover: '第十步，看商品列表。没有商品，就先同步商品或换店铺。',
      subtitle: '先确认商品列表加载。',
      focusLabel: '商品信息',
      emphasis: '看到商品再选'
    },
    {
      id: 'product-selected',
      title: '勾选商品',
      action: '勾选本次要优化的宝贝。',
      voiceover: '第十一步，勾选要优化的宝贝。选中后再生成。',
      subtitle: '勾选目标商品。',
      focusLabel: null,
      emphasis: '先选宝贝'
    },
    {
      id: 'before-generate',
      title: '点立即生成',
      action: '复核后点击立即生成。',
      voiceover: '第十二步，复核平台、店铺、位置和商品。都对了，点击立即生成。',
      subtitle: '复核无误，点击立即生成。',
      focusLabel: '立即生成',
      emphasis: '只生成'
    },
    {
      id: 'generate-confirm',
      title: '确认生成',
      action: '确认是生成扣点提示，再点确定。',
      voiceover: '第十三步，确认弹窗。确认这是生成扣点提示，再点确定。',
      subtitle: '确认生成扣点，再点确定。',
      focusLabel: '确定',
      emphasis: '不是发布'
    },
    afterScene(capture, 'nanny')
  ];
}

function buildShortformScenes(capture) {
  return [
    {
      id: 'single-shop-entry',
      title: '切多店',
      action: '左上角切换至多店管理。',
      voiceover: '先点左上角，切换至多店管理。',
      subtitle: '左上角切多店管理。',
      focusLabel: '切换至多店管理',
      emphasis: '先切多店'
    },
    {
      id: 'entry',
      title: '进工具',
      action: '通用工具里点 AI优化商品图。',
      voiceover: '再到通用工具，点 AI优化商品图。',
      subtitle: '点 AI优化商品图。',
      focusLabel: 'AI优化商品图',
      emphasis: '工具入口'
    },
    {
      id: 'platform-dropdown-open',
      title: '选平台',
      action: '平台先选对。',
      voiceover: '平台先选对。不是只给抖店，按实际平台选。',
      subtitle: '平台先选对。',
      focusLabel: '抖音',
      emphasis: '平台别错'
    },
    {
      id: 'shop-selected',
      title: '选店铺',
      action: `勾选 ${TARGET_TEST_STORE} 测试店。`,
      voiceover: `然后勾选 ${TARGET_TEST_STORE}。店铺选中，商品列表才会对。`,
      subtitle: `勾选 ${TARGET_TEST_STORE}。`,
      focusLabel: '已选1个店铺',
      emphasis: '店铺先选'
    },
    {
      id: 'position-selected',
      title: '选位置',
      action: '勾选要做的图片位置。',
      voiceover: '位置这里别乱选。先勾当前主图，需要三比四或 SKU，就继续往下勾。',
      subtitle: '先勾主图；需要 3:4/SKU 继续往下勾。',
      focusLabel: 'SKU图',
      emphasis: '位置别错'
    },
    {
      id: 'image-slot-dropdown-open',
      title: '选主图',
      action: '点“请选择”，选主图1到主图5。',
      voiceover: '右侧请选择也要点。主图一到主图五，想优化哪张就选哪张。',
      subtitle: '选主图1到主图5。',
      focusLabel: '请选择',
      emphasis: '选具体图'
    },
    {
      id: 'options-selected',
      title: '设置作用',
      action: '讲 SKU图、logo、卖点设置。',
      voiceover: 'SKU 图管规格图，保留 logo 管品牌标，主图卖点管画面要不要更强调卖点。',
      subtitle: 'SKU、logo、卖点按需求选。',
      focusLabel: '保留品牌logo',
      emphasis: '别乱勾'
    },
    {
      id: 'product-selected',
      title: '选商品',
      action: '勾选目标商品。',
      voiceover: '商品列表里，勾选这次要优化的宝贝。',
      subtitle: '勾选目标商品。',
      focusLabel: null,
      emphasis: '选宝贝'
    },
    {
      id: 'before-generate',
      title: '立即生成',
      action: '复核后点击立即生成。',
      voiceover: '最后复核一遍，平台、店铺、位置、商品。没问题就点立即生成。',
      subtitle: '复核后点立即生成。',
      focusLabel: '立即生成',
      emphasis: '只生成'
    },
    {
      id: 'generate-confirm',
      title: '点确定',
      action: '确认是生成提示，再点确定。',
      voiceover: '看到扣点确认框，确认是生成提示，再点确定。',
      subtitle: '确认生成，再点确定。',
      focusLabel: '确定',
      emphasis: '不发布'
    },
    afterScene(capture, 'shortform')
  ];
}

export function buildStoryboards(capture) {
  return {
    nanny: buildNannyScenes(capture),
    shortform: buildShortformScenes(capture)
  };
}
