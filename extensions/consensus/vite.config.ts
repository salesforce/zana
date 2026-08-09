import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';
import { resolve } from 'node:path';

/**
 * Library-mode build: one entry in, one ESM out.
 *
 * We run Vite twice (renderer, then main) selected by the BUILD_TARGET env var,
 * because each side externalizes a different set:
 *   - renderer: externalize what the HOST owns — react, react-dom,
 *     react/jsx-runtime, lucide-react. The host injects React via activate();
 *     a second copy breaks hooks.
 *   - main: externalize electron + Node built-ins (the host's runtime provides
 *     them). Bundle everything else the extension brings.
 *
 * Output filenames MUST match the `entry` field in extension.json
 * (renderer.js / main.mjs). The main entry is .mjs (not .js): the host loads it
 * via import() of a FILE PATH, where Node resolves ESM-vs-CJS by extension +
 * nearest package.json `type`. A `.js` ESM bundle in an install dir without
 * `type:module` parses as CJS → "Unexpected token 'export'". .mjs is
 * unambiguously ESM. (The renderer bundle is blob-imported, always ESM → .js.)
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
    replacement: resolve(__dirname, '../../packages/extension-sdk/src/$1.ts'),
  },
  {
    find: /^@zana-ai\/zcc-extension-sdk$/,
    replacement: resolve(__dirname, '../../packages/extension-sdk/src/index.ts'),
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
            fileName: () => 'main.mjs',
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
          rollupOptions: {
            external: [
              'react',
              'react-dom',
              'react/jsx-runtime',
              'lucide-react',
            ],
          },
        },
      }
);
