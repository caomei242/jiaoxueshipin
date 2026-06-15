#!/usr/bin/env node
import path from 'node:path';
import { loadTutorialCatalog, publicCatalog } from '../lib/tutorials/catalog.mjs';

const catalog = await loadTutorialCatalog();
const publicData = publicCatalog(catalog);
const requiredIds = [
  'ai-image-optimize-nanny',
  'ai-batch-video-nanny',
  'ai-image-to-video-playbook'
];

for (const id of requiredIds) {
  if (!publicData.tutorials.some(tutorial => tutorial.id === id)) {
    throw new Error(`missing required tutorial: ${id}`);
  }
}

function assertVideoInsideOutput(tutorial) {
  if (!tutorial.outputDir) throw new Error(`tutorial ${tutorial.id} missing public outputDir`);
  if (!tutorial.videoPath) throw new Error(`tutorial ${tutorial.id} missing public videoPath`);

  const relativePath = path.relative(tutorial.outputDir, tutorial.videoPath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`tutorial ${tutorial.id} videoPath escapes outputDir`);
  }
}

for (const tutorial of publicData.tutorials) {
  assertVideoInsideOutput(tutorial);

  const loadedTutorial = catalog.tutorials.find(item => item.id === tutorial.id);
  if (!loadedTutorial) throw new Error(`loaded catalog missing tutorial: ${tutorial.id}`);

  if (tutorial.status === 'active' && tutorial.buildEnabled && !loadedTutorial.build.command) {
    throw new Error(`active build-enabled tutorial ${tutorial.id} missing build command`);
  }

  if (!tutorial.buildEnabled && !tutorial.buildDisabledReason) {
    throw new Error(`disabled tutorial ${tutorial.id} missing disabled reason`);
  }
}

console.log(JSON.stringify({
  ok: true,
  tabs: publicData.tabs.map(tab => tab.label),
  tutorials: publicData.tutorials.map(tutorial => ({
    id: tutorial.id,
    title: tutorial.title,
    status: tutorial.status
  }))
}, null, 2));
