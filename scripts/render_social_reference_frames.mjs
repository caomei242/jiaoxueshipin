#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { sharp } from '../lib/sharp-loader.mjs';

const WIDTH = 1920;
const HEIGHT = 1080;

function readArg(argv, flag, fallback) {
  const index = argv.indexOf(flag);
  if (index === -1) return fallback;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function imageExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function makeFrame({ source, output, caption, badge }) {
  const base = await sharp(source)
    .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'center' })
    .png()
    .toBuffer();

  const overlay = `
  <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    ${badge ? `
      <rect x="48" y="48" width="292" height="54" rx="14" fill="#101827" fill-opacity="0.86"/>
      <text x="74" y="84" fill="#d7ff62" font-size="25" font-weight="800" font-family="PingFang SC, Hiragino Sans GB, Arial, sans-serif">${escapeXml(badge)}</text>
    ` : ''}
    ${caption ? `
      <rect x="610" y="1004" width="700" height="42" rx="8" fill="#070b14" fill-opacity="0.82"/>
      <text x="960" y="1032" text-anchor="middle" fill="#ffffff" font-size="24" font-weight="800" font-family="PingFang SC, Hiragino Sans GB, Arial, sans-serif">${escapeXml(caption)}</text>
    ` : ''}
  </svg>`;

  await sharp(base)
    .composite([{ input: Buffer.from(overlay), left: 0, top: 0 }])
    .png()
    .toFile(output);
}

function srtTime(seconds) {
  const ms = Math.round(seconds * 1000);
  const hh = Math.floor(ms / 3600000);
  const mm = Math.floor((ms % 3600000) / 60000);
  const ss = Math.floor((ms % 60000) / 1000);
  const mmm = ms % 1000;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')},${String(mmm).padStart(3, '0')}`;
}

async function main() {
  const outputDir = path.resolve(readArg(
    process.argv,
    '--output',
    '/Users/gd/Desktop/主业/客户教程视频/稿定商品-AI优化商品图/2026-06-11-social-reference-v1'
  ));
  const referenceFramesDir = path.resolve(readArg(
    process.argv,
    '--reference-frames',
    path.join(outputDir, 'reference-frames')
  ));

  const framesDir = path.join(outputDir, 'frames', 'social-reference-horizontal');
  const audioDir = path.join(outputDir, 'audio', 'social-reference-horizontal');
  const manifestDir = path.join(outputDir, 'manifests');
  const scriptsDir = path.join(outputDir, 'scripts');
  const videosDir = path.join(outputDir, 'videos');
  const reportsDir = path.join(outputDir, 'reports');

  await Promise.all([
    fs.mkdir(framesDir, { recursive: true }),
    fs.mkdir(audioDir, { recursive: true }),
    fs.mkdir(manifestDir, { recursive: true }),
    fs.mkdir(scriptsDir, { recursive: true }),
    fs.mkdir(videosDir, { recursive: true }),
    fs.mkdir(reportsDir, { recursive: true })
  ]);

  const referenceFrames = [
    'reference-frame-01-0.0s.png',
    'reference-frame-02-2.5s.png',
    'reference-frame-03-5.0s.png',
    'reference-frame-04-8.5s.png',
    'reference-frame-05-12.0s.png',
    'reference-frame-06-16.0s.png',
    'reference-frame-07-20.0s.png',
    'reference-frame-08-24.5s.png'
  ].map(file => path.join(referenceFramesDir, file));

  const missing = [];
  for (const frame of referenceFrames) {
    if (!(await imageExists(frame))) missing.push(frame);
  }
  if (missing.length > 0) {
    throw new Error(`missing extracted reference frames:\n${missing.join('\n')}`);
  }

  const scenes = [
    {
      source: referenceFrames[0],
      caption: '',
      badge: '',
      duration: 2.4,
      voice: '先用生成效果图把价值打出来，让客户第一眼看到优化前后。'
    },
    {
      source: referenceFrames[1],
      caption: '',
      badge: '',
      duration: 2.6,
      voice: '这里不是单张修图，而是把一批商品主图批量变成更适合点击的素材。'
    },
    {
      source: referenceFrames[2],
      caption: '',
      badge: '',
      duration: 2.6,
      voice: '前面先放效果矩阵，客户能马上理解商品图优化后的样子。'
    },
    {
      source: referenceFrames[3],
      caption: '',
      badge: '',
      duration: 3.0,
      voice: '然后切到真实后台，先选择平台和店铺。'
    },
    {
      source: referenceFrames[4],
      caption: '',
      badge: '',
      duration: 3.0,
      voice: '回到后台，先选择平台、店铺和图片位置。'
    },
    {
      source: referenceFrames[5],
      caption: '',
      badge: '',
      duration: 4.0,
      voice: '一比一主图可以选择主图一到主图五，标题、属性和原图会一起参与质量判断。'
    },
    {
      source: referenceFrames[6],
      caption: '',
      badge: '',
      duration: 3.7,
      voice: '生成后先看结果列表，单张不满意可以跳过，不会强制发布。'
    },
    {
      source: referenceFrames[7],
      caption: '',
      badge: '',
      duration: 3.8,
      voice: '确认没问题后，再发布到当前商品，后面就可以继续拿这些图去生成视频。'
    }
  ];

  const manifestScenes = [];
  let cursor = 0;
  let srt = '';
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index];
    const framePath = path.join(framesDir, `scene-${String(index + 1).padStart(2, '0')}.png`);
    const audioPath = path.join(audioDir, `scene-${String(index + 1).padStart(2, '0')}.m4a`);
    await makeFrame({ source: scene.source, output: framePath, caption: scene.caption, badge: scene.badge });
    manifestScenes.push({
      index: index + 1,
      framePath,
      audioPath,
      duration: scene.duration,
      voiceover: scene.voice
    });
    srt += `${index + 1}\n${srtTime(cursor)} --> ${srtTime(cursor + scene.duration)}\n${scene.voice}\n\n`;
    cursor += scene.duration;
  }

  const manifestPath = path.join(manifestDir, 'social-reference-horizontal.json');
  const videoPath = path.join(videosDir, 'ai-image-social-reference-horizontal.mp4');
  const manifest = {
    renderer: 'social-reference-template',
    width: WIDTH,
    height: HEIGHT,
    totalDuration: Number(cursor.toFixed(2)),
    referenceVideo: '/Users/gd/Desktop/ai优化商品图.mp4',
    outputVideo: videoPath,
    scenes: manifestScenes
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(scriptsDir, 'social-reference-horizontal.srt'), srt, 'utf8');
  await fs.writeFile(path.join(scriptsDir, 'social-reference-voiceover.txt'), scenes.map((scene, index) => `${index + 1}. ${scene.voice}`).join('\n'), 'utf8');

  const report = [
    '# Social Reference Build Report',
    '',
    `- Generated at: ${new Date().toISOString()}`,
    '- Purpose: match the supplied reference video structure instead of the old storyboard-review style.',
    '- Source reference: /Users/gd/Desktop/ai优化商品图.mp4',
    `- Scene count: ${scenes.length}`,
    `- Duration: ${manifest.totalDuration}s`,
    `- Manifest: ${manifestPath}`,
    `- Video: ${videoPath}`,
    '- Structure: effect matrix hook -> real backend operation -> generated result confirmation.'
  ].join('\n');
  await fs.writeFile(path.join(reportsDir, 'social-reference-build-report.md'), `${report}\n`, 'utf8');

  process.stdout.write(JSON.stringify({ manifestPath, videoPath, framesDir, sceneCount: scenes.length, totalDuration: manifest.totalDuration }, null, 2));
}

main().catch(error => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
