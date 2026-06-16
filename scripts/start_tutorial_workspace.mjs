#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTutorial, loadTutorialCatalog } from '../lib/tutorials/catalog.mjs';
import { findOfficialDocs, loadOfficialDocs } from '../lib/tutorials/official-docs.mjs';
import { ensureDir, writeJson } from '../lib/fs-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

function readFlagValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function parseArgs(argv) {
  const flags = { tutorialId: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--tutorial') {
      flags.tutorialId = readFlagValue(argv, index, arg);
      index += 1;
    } else {
      throw new Error(`unknown arg: ${arg}`);
    }
  }
  if (!flags.tutorialId) throw new Error('--tutorial is required');
  return flags;
}

function htmlEscape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function plannedScenesFor(tutorial) {
  if (tutorial.id === 'ai-batch-video-nanny') {
    return [
      {
        id: 'entry',
        title: '进入 AI批量生成视频',
        capture: '左侧展开 AI视频，点击 AI批量生成视频，目标店为道理门。',
        subtitle: '左侧进入 AI视频，点击 AI批量生成视频。',
        voiceover: '先在左侧找到 A I 视频，进入 A I 批量生成视频。'
      },
      {
        id: 'mode',
        title: '选择修改方式',
        capture: '展示“条件筛选修改 / 按照商品修改”，默认先拍保姆教程常用入口。',
        subtitle: '按教程需求选择修改方式。',
        voiceover: '这里可以按条件筛选，也可以按照商品来处理。新手教程先看常用的商品选择流程。'
      },
      {
        id: 'platform',
        title: '选择平台',
        capture: '平台下拉必须展开，能看到抖音、淘宝、快手、京东、微信小店、小红书等选项。',
        subtitle: '先选平台，用哪个选哪个。',
        voiceover: '先选平台，用哪个平台就选哪个平台。'
      },
      {
        id: 'shop-dropdown',
        title: '选择店铺',
        capture: '店铺下拉必须展开，能看到道理门和勾选框。',
        subtitle: '展开店铺下拉，勾选道理门。',
        voiceover: '再展开店铺列表，勾选要处理的店铺。测试店这里选道理门。'
      },
      {
        id: 'settings',
        title: '看视频设置',
        capture: '展示视频模型、原商品有视频时跳过/覆盖等设置，不发布、不充值。',
        subtitle: '先看视频生成设置。',
        voiceover: '设置区先确认视频模型，以及原商品已经有视频时是跳过还是覆盖。'
      },
      {
        id: 'product-filter',
        title: '筛选商品',
        capture: '展示商品标题、商品ID、货号、SKU、价格、库存等筛选项。',
        subtitle: '用筛选条件找到要生成视频的商品。',
        voiceover: '如果商品多，可以用标题、商品 I D、S K U、价格或库存先筛选。'
      },
      {
        id: 'product-list',
        title: '加载商品列表',
        capture: '商品列表首屏要清楚，表头和第一行商品都要露出。',
        subtitle: '确认商品列表加载出来。',
        voiceover: '确认商品列表已经加载出来，没有商品就先同步商品或换店铺。'
      },
      {
        id: 'select-product',
        title: '勾选商品',
        capture: '勾选目标商品，鼠标放在勾选框右下方，不遮挡商品名。',
        subtitle: '勾选要生成视频的商品。',
        voiceover: '勾选要生成视频的商品。只想做一部分，就只勾选那几条。'
      },
      {
        id: 'generate',
        title: '点击立即生成',
        capture: '立即生成按钮完整可见；只生成测试内容，不自动发布、不充值。',
        subtitle: '确认无误后，点击立即生成。',
        voiceover: '平台、店铺、商品都确认好以后，再点击立即生成。'
      },
      {
        id: 'record-entry',
        title: '进入生成记录',
        capture: '生成后进入生成记录，展示任务状态和查看入口。',
        subtitle: '生成后到生成记录查看进度。',
        voiceover: '生成后到生成记录里看任务进度，处理完成后再查看结果。'
      },
      {
        id: 'result-review',
        title: '查看生成结果',
        capture: '展示生成后的视频结果或任务详情，说明先人工确认。',
        subtitle: '先人工确认结果，再决定是否使用。',
        voiceover: '生成结果先人工确认，没问题再使用，不满意就重新调整后再生成。'
      }
    ];
  }

  return [
    {
      id: 'starter',
      title: '待采集',
      capture: '先采集真实后台操作截图。',
      subtitle: '先采集真实操作。',
      voiceover: '先采集真实操作截图，再生成保姆教程。'
    }
  ];
}

function renderOfficialDocsBlock(officialDocs) {
  if (!officialDocs.length) return '';
  const items = officialDocs.map(doc => `
        <li>
          <b>${htmlEscape(doc.title)}</b>
          <span>${htmlEscape(doc.url)}</span>
        </li>`).join('');
  return `
      <div class="official-docs">
        <h2>官方文档参考</h2>
        <p>下面文档只作为流程、术语和注意事项底稿；正式画面仍以真实后台截图为准。</p>
        <ul>${items}</ul>
      </div>`;
}

function renderStarterBoard(tutorial, scenes, reportPath, officialDocs) {
  const rows = scenes.map((scene, index) => `
      <article class="scene">
        <div class="num">${index + 1}</div>
        <div>
          <h2>${htmlEscape(scene.title)}</h2>
          <p><b>要拍什么：</b>${htmlEscape(scene.capture)}</p>
          <p><b>屏幕字幕：</b>${htmlEscape(scene.subtitle)}</p>
          <p><b>口播草稿：</b>${htmlEscape(scene.voiceover)}</p>
        </div>
      </article>`).join('');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(tutorial.title)}制作板</title>
  <style>
    :root { color-scheme: light; --bg: #f4f7fb; --panel: #fff; --ink: #111827; --muted: #667085; --line: #d0d5dd; --brand: #2563eb; --warn: #c2410c; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; color: var(--ink); background: var(--bg); }
    header { padding: 24px 28px; color: white; background: #111827; }
    h1 { margin: 0 0 8px; font-size: 24px; }
    header p { margin: 0; color: #cbd5e1; }
    main { padding: 22px 28px 36px; }
    .notice, .scene { border: 1px solid var(--line); border-radius: 8px; background: var(--panel); box-shadow: 0 10px 24px rgba(16, 24, 40, .06); }
    .notice { margin-bottom: 16px; padding: 16px; border-left: 4px solid var(--warn); }
    .notice p { margin: 6px 0; color: #7c2d12; line-height: 1.7; }
    .official-docs { margin-bottom: 16px; padding: 16px; border: 1px solid #bfdbfe; border-radius: 8px; background: #eff6ff; }
    .official-docs h2 { margin: 0 0 8px; }
    .official-docs p { margin: 0 0 8px; color: #1e3a8a; }
    .official-docs ul { margin: 0; padding-left: 18px; color: #1e40af; }
    .official-docs li { margin: 5px 0; }
    .official-docs span { display: block; color: #475569; font-size: 13px; word-break: break-all; }
    .scene { display: grid; grid-template-columns: 44px 1fr; gap: 12px; margin-bottom: 12px; padding: 16px; }
    .num { display: grid; width: 36px; height: 36px; place-items: center; border-radius: 999px; color: white; background: var(--brand); font-weight: 900; }
    h2 { margin: 0 0 8px; font-size: 18px; }
    p { margin: 8px 0; color: var(--muted); line-height: 1.65; }
    code { padding: 2px 5px; border-radius: 5px; background: #eef2ff; }
  </style>
</head>
<body>
  <header>
    <h1>${htmlEscape(tutorial.title)}制作板</h1>
    <p>${htmlEscape(tutorial.subtitle)}</p>
  </header>
  <main>
    <section class="notice">
      <p><b>当前状态：</b>已经可以开始制作，但还没有真实操作截图，所以暂时不能一键出片。</p>
      <p><b>下一步：</b>按下面镜头清单去真实后台采集截图；采集完成后再生成正式可批改审片台。</p>
      <p><b>报告：</b><code>${htmlEscape(reportPath)}</code></p>
    </section>
    ${renderOfficialDocsBlock(officialDocs)}
    ${rows}
  </main>
</body>
</html>`;
}

const flags = parseArgs(process.argv.slice(2));
const catalog = await loadTutorialCatalog();
const tutorial = findTutorial(catalog, flags.tutorialId);
if (!tutorial) throw new Error(`tutorial not found: ${flags.tutorialId}`);
const officialDocsData = await loadOfficialDocs();
const officialDocs = findOfficialDocs(officialDocsData, tutorial.officialDocIds);

const dirs = {
  output: tutorial.outputDir,
  capture: path.join(tutorial.outputDir, 'capture'),
  storyboard: path.join(tutorial.outputDir, 'storyboard'),
  scripts: path.join(tutorial.outputDir, 'scripts'),
  manifests: path.join(tutorial.outputDir, 'manifests'),
  reports: path.join(tutorial.outputDir, 'reports'),
  videos: path.join(tutorial.outputDir, 'videos')
};

for (const dir of Object.values(dirs)) await ensureDir(dir);

const scenes = plannedScenesFor(tutorial);
const createdAt = new Date().toISOString();
const reportPath = path.join(dirs.reports, 'start-report.md');
const workspaceManifest = {
  createdAt,
  tutorialId: tutorial.id,
  title: tutorial.title,
  subtitle: tutorial.subtitle,
  targetStore: tutorial.targetStore,
  officialDocs,
  outputDir: tutorial.outputDir,
  status: 'started-needs-real-capture',
  rootDir: ROOT_DIR,
  nextStep: '采集真实后台操作截图后，再生成正式可批改审片台。',
  scenes
};

await writeJson(path.join(dirs.manifests, 'workspace.json'), workspaceManifest);
await writeJson(path.join(dirs.capture, 'capture-plan.json'), {
  createdAt,
  tutorialId: tutorial.id,
  targetStore: tutorial.targetStore,
  safety: {
    doNotRecharge: true,
    doNotPublishBeforeReview: true,
    useRealOperationScreenshots: true,
    noFakeFrames: true
  },
  officialDocs,
  scenes
});
await writeJson(path.join(dirs.storyboard, 'starter-scenes.json'), { createdAt, scenes });

const voiceoverDraft = [
  `# ${tutorial.title} 保姆教程口播草稿`,
  '',
  '这份是开工草稿，不是最终客户稿。等真实截图采集完，再生成正式审片台逐镜批改。',
  '',
  ...scenes.flatMap((scene, index) => [
    `## ${index + 1}. ${scene.title}`,
    '',
    `屏幕字幕：${scene.subtitle}`,
    '',
    `口播：${scene.voiceover}`,
    ''
  ])
].join('\n');

await fs.writeFile(path.join(dirs.scripts, 'nanny-draft.md'), voiceoverDraft, 'utf8');
await fs.writeFile(path.join(dirs.storyboard, 'shooting-board.html'), renderStarterBoard(tutorial, scenes, reportPath, officialDocs), 'utf8');

const report = [
  `# ${tutorial.title} 制作开工报告`,
  '',
  `- 生成时间：${createdAt}`,
  `- 教程 ID：${tutorial.id}`,
  `- 测试店：${tutorial.targetStore}`,
  `- 输出目录：${tutorial.outputDir}`,
  ...officialDocs.flatMap(doc => [`- 官方文档：${doc.title}｜${doc.url}`]),
  '- 当前状态：已创建制作工作区，待采集真实后台截图。',
  '- 安全边界：不自动充值，不自动发布，不用假画面出片。',
  '',
  '## 已生成文件',
  '',
  `- 制作板：${path.join(dirs.storyboard, 'shooting-board.html')}`,
  `- 采集计划：${path.join(dirs.capture, 'capture-plan.json')}`,
  `- 口播草稿：${path.join(dirs.scripts, 'nanny-draft.md')}`,
  `- 工作区清单：${path.join(dirs.manifests, 'workspace.json')}`,
  '',
  '## 下一步',
  '',
  '1. 打开真实后台，进入 AI视频 > AI批量生成视频。',
  '2. 按 `capture/capture-plan.json` 逐镜采集真实截图。',
  '3. 截图齐后生成正式可批改审片台，再开放一键出片。',
  ''
].join('\n');
await fs.writeFile(reportPath, report, 'utf8');

console.log(JSON.stringify({
  ok: true,
  tutorialId: tutorial.id,
  outputDir: tutorial.outputDir,
  boardPath: path.join(dirs.storyboard, 'shooting-board.html'),
  reportPath,
  sceneCount: scenes.length
}, null, 2));
