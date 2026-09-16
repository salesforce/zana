import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildPluginServer } from '../../packages/plugin-build/src/build-plugin.ts';
import { buildPluginHost } from '../../packages/plugin-build/src/build-plugin-host.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
await buildPluginServer(root, version, { minify: false });
await buildPluginHost(root, version);
