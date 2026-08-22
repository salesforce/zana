import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zccBrowserBootstrapPlugin } from './vite-plugin-browser-bootstrap';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

const sdkAlias = [
  { find: /^@zana-ai\/zcc-llm$/, replacement: resolve(repoRoot, 'packages/llm/src/index.ts') },
  { find: /^@zana-ai\/zcc-path-confine$/, replacement: resolve(repoRoot, 'packages/path-confine/src/index.ts') },
  { find: /^@zana-ai\/zcc-spawn-plan$/, replacement: resolve(repoRoot, 'packages/spawn-plan/src/index.ts') },
  { find: /^@zana-ai\/zcc-process-utils$/, replacement: resolve(repoRoot, 'packages/process-utils/src/index.ts') },
  { find: /^@zana-ai\/zcc-ui\/(.*)$/, replacement: resolve(repoRoot, 'packages/ui/src/$1.tsx') },
  { find: /^@zana-ai\/zcc-desktop-contract$/, replacement: resolve(repoRoot, 'packages/desktop-contract/src/index.ts') },
  { find: /^@zana-ai\/zcc-domain\/(.*)$/, replacement: resolve(repoRoot, 'packages/domain/src/$1.ts') },
  { find: /^@zana-ai\/zcc-domain$/, replacement: resolve(repoRoot, 'packages/domain/src/index.ts') },
  { find: /^@zana-ai\/zcc-plugin-sdk$/, replacement: resolve(repoRoot, 'packages/plugin-sdk/src/index.ts') },
  { find: /^@zana-ai\/zcc-plugin-sdk\/(.*)$/, replacement: resolve(repoRoot, 'packages/plugin-sdk/src/$1.ts') },
  { find: /^@zana-ai\/zcc-extension-sdk$/, replacement: resolve(repoRoot, 'packages/extension-sdk/src/index.ts') },
  { find: /^@zana-ai\/zcc-extension-sdk\/(.*)$/, replacement: resolve(repoRoot, 'packages/extension-sdk/src/$1.ts') },
  { find: /^@zcc\/harness-sdk$/, replacement: resolve(repoRoot, 'packages/harness-sdk/src/index.ts') },
  { find: /^@zcc\/harness-sdk\/(.*)$/, replacement: resolve(repoRoot, 'packages/harness-sdk/src/$1.ts') },
  { find: /^@\//, replacement: resolve(here, 'src') + '/' }
];

export const sharedViteConfig: UserConfig = {
  root: here,
  resolve: {
    conditions: ['source'],
    alias: sdkAlias,
    dedupe: ['monaco-editor']
  },
  plugins: [react(), zccBrowserBootstrapPlugin()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['monaco-editor', '@monaco-editor/react'] },
  build: {
    rollupOptions: {
      input: resolve(here, 'index.html')
    }
  }
};

export default defineConfig(sharedViteConfig);
