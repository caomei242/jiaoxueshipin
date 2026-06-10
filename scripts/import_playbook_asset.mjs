#!/usr/bin/env node
import { importAsset } from '../lib/playbook/assets.mjs';
import { PLAYBOOK_DEFAULT_OUTPUT_DIR } from '../lib/playbook/paths.mjs';

function readFlagValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseTags(value) {
  return String(value || '')
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const flags = {
    output: process.env.PLAYBOOK_OUTPUT_DIR || PLAYBOOK_DEFAULT_OUTPUT_DIR,
    tags: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--output':
        flags.output = readFlagValue(argv, index, arg);
        index += 1;
        break;
      case '--source':
        flags.source = readFlagValue(argv, index, arg);
        index += 1;
        break;
      case '--type':
        flags.type = readFlagValue(argv, index, arg);
        index += 1;
        break;
      case '--title':
        flags.title = readFlagValue(argv, index, arg);
        index += 1;
        break;
      case '--tags':
        flags.tags = parseTags(readFlagValue(argv, index, arg));
        index += 1;
        break;
      case '--id':
        flags.id = readFlagValue(argv, index, arg);
        index += 1;
        break;
      case '--store':
        flags.store = readFlagValue(argv, index, arg);
        index += 1;
        break;
      case '--platform':
        flags.platform = readFlagValue(argv, index, arg);
        index += 1;
        break;
      case '--notes':
        flags.notes = readFlagValue(argv, index, arg);
        index += 1;
        break;
      default:
        throw new Error(`unknown arg: ${arg}`);
    }
  }

  if (!flags.source) {
    throw new Error('--source is required');
  }
  if (!flags.type) {
    throw new Error('--type is required');
  }

  return flags;
}

const flags = parseArgs(process.argv.slice(2));
const entry = await importAsset(flags.output, {
  source: flags.source,
  type: flags.type,
  title: flags.title,
  tags: flags.tags,
  id: flags.id,
  store: flags.store,
  platform: flags.platform,
  notes: flags.notes
});

console.log(JSON.stringify(entry, null, 2));
