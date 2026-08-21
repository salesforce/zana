import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';
import { resolve } from 'node:path';

/**
 * Library-mode build for the zana-hub DISK extension: one entry in, one ESM
 * out, run twice (renderer, then main) selected by BUILD_TARGET. Mirrors the
 * consensus extension exactly — the simplest viable shape:
 *
 *   - RENDERER: externalize what the HOST owns (react / react-dom /
 *     react/jsx-runtime / lucide-react). The panel imports NONE of them — React
 *     arrives via activate({ React }) and the tree is built with
 *     React.createElement (no JSX → no jsx-runtime import), so nothing bare
 *     survives into the blob-imported bundle. Listing them external is belt-and-
 *     braces in case a future edit adds an import.
 *   - MAIN: externalize electron + Node builtins (the host runtime provides
 *     them). zana-main reads ~/.zana via ctx.fs (a brokered capability), so it
 *     imports no Node fs directly and the rest bundles cleanly.
 *
 * Output filenames MUST match `entry` in extension.json (renderer.js /
 * main.mjs). main is .mjs so the host's import() of the file path treats it as
 * ESM; the renderer bundle is blob-imported, always ESM → .js.
 */
const target = process.env.BUILD_TARGET ?? 'renderer';

const nodeBuiltins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

const sdkAliases = [
  {
    find: /^@zana-ai\/zcc-extension-sdk\/(.*)$/,
    replacement: resolve(__dirname, '../../packages/extension-sdk/src/$1.ts')
  },
  {
    find: /^@zana-ai\/zcc-extension-sdk$/,
    replacement: resolve(__dirname, '../../packages/extension-sdk/src/index.ts')
  }
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
            fileName: () => 'main.mjs'
          },
          rollupOptions: {
            external: ['electron', ...nodeBuiltins]
          }
        }
      }
    : {
        resolve: { alias: sdkAliases },
        build: {
          outDir: 'dist',
          emptyOutDir: true,
          lib: {
            entry: 'src/renderer/panel.tsx',
            formats: ['es'],
            fileName: () => 'renderer.js'
          },
          rollupOptions: {
            external: ['react', 'react-dom', 'react/jsx-runtime', 'lucide-react']
          }
        }
      }
);
