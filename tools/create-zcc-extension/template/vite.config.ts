import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';
import { resolve } from 'node:path';

/**
 * Library-mode build: one entry in, one ESM out.
 *
 * We run Vite twice (renderer, then main) selected by the BUILD_TARGET env var,
 * because each side externalizes a different set:
 *   - renderer: this scaffold uses injected React via activate() and
 *     React.createElement, so it has no runtime React import to resolve. JSX or
 *     UI-library users need host-React shims; do not externalize bare React
 *     imports from a blob-loaded bundle.
 *   - main: externalize electron + Node built-ins. Disk extensions still use
 *     permission-gated ctx capabilities instead of raw Node APIs; bundle
 *     everything else the extension brings.
 *
 * Output filenames MUST match the `entry` field in extension.json
 * (renderer.js / main.js).
 *
 * Build both with:  npm run build   (see package.json scripts)
 */
const target = process.env.BUILD_TARGET ?? 'renderer';

const nodeBuiltins = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
];

const sdkAliases = [
  {
    find: /^@zana-ai\/zcc-extension-sdk\/(.*)$/,
    replacement: resolve(__dirname, '../../../packages/extension-sdk/src/$1.ts'),
  },
  {
    find: /^@zana-ai\/zcc-extension-sdk$/,
    replacement: resolve(__dirname, '../../../packages/extension-sdk/src/index.ts'),
  },
];

export default defineConfig(
  target === 'main'
    ? {
        resolve: { alias: sdkAliases },
        build: {
          outDir: 'dist',
          emptyOutDir: false,
          lib: {
            entry: 'src/main/index.ts',
            formats: ['es'],
            fileName: () => 'main.js',
          },
          rollupOptions: {
            external: ['electron', ...nodeBuiltins],
          },
        },
      }
    : {
        resolve: { alias: sdkAliases },
        build: {
          outDir: 'dist',
          emptyOutDir: true,
          lib: {
            entry: 'src/renderer/panel.tsx',
            formats: ['es'],
            fileName: () => 'renderer.js',
          },
        },
      }
);
