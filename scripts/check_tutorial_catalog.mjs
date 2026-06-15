#!/usr/bin/env node
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

console.log(JSON.stringify({
  ok: true,
  tabs: publicData.tabs.map(tab => tab.label),
  tutorials: publicData.tutorials.map(tutorial => ({
    id: tutorial.id,
    title: tutorial.title,
    status: tutorial.status
  }))
}, null, 2));
