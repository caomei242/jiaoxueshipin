#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, OFFICIAL_DOC_URL, REFERENCE_VIDEO_URL, TARGET_TEST_STORE } from '../lib/config.mjs';
import { outputPath, readJson } from '../lib/fs-utils.mjs';

const flags = parseArgs(process.argv.slice(2));
const capture = await readJson(outputPath(flags.outputDir, 'capture', 'capture.json'));
let scripts = null;
try {
  scripts = await readJson(outputPath(flags.outputDir, 'scripts', 'tutorial-scripts.json'));
} catch {
  scripts = null;
}

async function listExisting(dir) {
  try {
    return (await fs.readdir(dir)).map(name => path.join(dir, name));
  } catch {
    return [];
  }
}

const videos = await listExisting(outputPath(flags.outputDir, 'videos'));
const srtFiles = await listExisting(outputPath(flags.outputDir, 'scripts')).then(files => files.filter(file => file.endsWith('.srt')));
const manifests = await listExisting(outputPath(flags.outputDir, 'manifests')).then(files => files.filter(file => file.endsWith('.json')));

async function readManifest(file) {
  try {
    return await readJson(file);
  } catch {
    return null;
  }
}

const storyboardManifests = (await Promise.all(manifests.map(async file => ({
  file,
  manifest: await readManifest(file)
}))))
  .filter(item => item.manifest?.renderer === 'storyboard-preview')
  .filter(item => item.manifest?.style === 'nanny');

const storyboardVideos = storyboardManifests
  .map(item => item.manifest.outputVideo)
  .filter(Boolean);
const preferredVideos = storyboardVideos.length
  ? storyboardVideos
  : videos.filter(file => file.includes('nanny-horizontal-storyboard'));
const preferredSrtFiles = srtFiles.filter(file => path.basename(file) === 'nanny.srt');

function unique(values) {
  return [...new Set(values)];
}

function shanghaiTimestamp() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day} ${value.hour}:${value.minute}:${value.second} Asia/Shanghai`;
}

const report = [
  '# 客户新手教程视频自动化报告',
  '',
  `- 生成时间：${shanghaiTimestamp()}`,
  `- 输出目录：${flags.outputDir}`,
  `- 目标页面：${capture.targetUrl}`,
  `- 目标测试店：${capture.targetTestStore || TARGET_TEST_STORE}`,
  `- 参考视频：${REFERENCE_VIDEO_URL}`,
  `- 官方教程：${OFFICIAL_DOC_URL}`,
  `- 模式：${capture.dryRun ? 'dry-run，仅抓页面和脚本' : '正式构建，允许安全生成但不发布'}`,
  `- 是否点击立即生成：${capture.safety.clickedGenerate ? '是' : '否'}`,
  `- 是否点击发布/充值：${capture.safety.clickedPublish || capture.safety.clickedRecharge ? '是（异常，请复核）' : '否'}`,
  `- 是否降级：${capture.safety.degraded ? '是' : '否'}`,
  '',
  '## 降级或风险说明',
  '',
  capture.safety.reasons.length ? capture.safety.reasons.map(reason => `- ${reason}`).join('\n') : '- 无',
  '',
  '## 产物',
  '',
  scripts ? `- 口播脚本：${outputPath(flags.outputDir, 'scripts', 'tutorial-scripts.json')}` : '- 口播脚本：未生成',
  preferredSrtFiles.length ? preferredSrtFiles.map(file => `- 字幕：${file}`).join('\n') : '- 字幕：未生成',
  unique(preferredVideos).length ? unique(preferredVideos).map(file => `- 视频：${file}`).join('\n') : '- 视频：未生成',
  storyboardManifests.length ? storyboardManifests.map(item => `- Manifest：${item.file}（renderer=${item.manifest.renderer}，${item.manifest.scenes?.length || 0} 镜）`).join('\n') : '- Manifest：未生成 storyboard-preview',
  '',
  '## 截图证据',
  '',
  ...capture.screenshots.map(shot => `- ${shot.title}：${shot.file}`),
  ''
].join('\n');

const reportPath = outputPath(flags.outputDir, 'build-report.md');
await fs.writeFile(reportPath, report, 'utf8');
console.log(`report=${reportPath}`);
