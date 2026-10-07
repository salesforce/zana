import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlugin } from '../../packages/plugin-build/src/build-plugin.js';

const root = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(resolve(root, '../../package.json'), 'utf8'));
await buildPlugin(root, version);
