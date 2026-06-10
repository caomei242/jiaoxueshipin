import { createRequire } from 'node:module';
import { NODE_MODULES_DIR } from './config.mjs';

const requireFromBundle = createRequire(`${NODE_MODULES_DIR}/`);

export const sharp = requireFromBundle('sharp');
