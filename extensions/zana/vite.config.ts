import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Library-mode build for the zana DISK extension. Two targets (selected by
 * BUILD_TARGET), each emitting a single self-contained ESM file whose name
 * matches `entry` in extension.json.
 *
 * This extension is a MERGE of the former `zana` built-in main module and the
 * `zana-tickets` renderer surface into ONE disk extension:
 *   - MAIN (main.mjs): the capability provider. It reaches ticket/sprint/
 *     artifact/profile DATA through the brokered `ctx.mcp('zana', …)` capability
 *     (the host MCP pool spawns `zana-mcp-server` per workspace) — NOT native
 *     SQLite, which cannot cross the extension utilityProcess boundary. It
 *     externalizes electron + node builtins; the shared `@shared/*` types
 *     (incl. the runtime `isClosedZanaStatus`) and the SDK are bundled from
 *     source via the aliases below.
 *   - RENDERER (renderer.js): the per-project Tickets board, blob-imported by
 *     the host (no import map → ZERO unresolved bare imports). react /
 *     react/jsx-runtime alias to in-bundle shims; lucide-react / react-markdown
 *     / remark-gfm / zustand are BUNDLED. Net external: [] — fully self-contained.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const target = process.env.BUILD_TARGET ?? 'renderer';

const nodeBuiltins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

/** Shared-type + SDK source aliases so no bare `@shared`/`@zcc` import survives. */
const sharedAliases = [
  { find: /^@shared\/(.*)$/, replacement: resolve(__dirname, '../../src/shared/$1') },
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
        resolve: { alias: sharedAliases },
        build: {
          outDir: 'dist',
          emptyOutDir: false,
          minify: false,
          lib: {
            entry: resolve(__dirname, 'src/main-entry.ts'),
            formats: ['es'],
            // .mjs (not .js): the host loads the main entry via import() of a
            // FILE PATH; a `.js` ESM bundle in a dir with no `type:module` is
            // parsed as CJS → "Unexpected token 'export'". .mjs is unambiguously
            // ESM. (The renderer bundle is blob-imported, always ESM, stays .js.)
            fileName: () => 'main.mjs'
          },
          rollupOptions: { external: ['electron', ...nodeBuiltins] }
        }
      }
    : {
        // The shims must win over the real packages for `react` and
        // `react/jsx-runtime` ONLY — everything else resolves normally & bundles.
        resolve: {
          alias: [
            { find: /^react\/jsx-runtime$/, replacement: resolve(__dirname, 'src/jsx-runtime-shim.ts') },
            { find: /^react\/jsx-dev-runtime$/, replacement: resolve(__dirname, 'src/jsx-runtime-shim.ts') },
            { find: /^react$/, replacement: resolve(__dirname, 'src/react-shim.ts') },
            ...sharedAliases
          ]
        },
        esbuild: {
          // Automatic runtime → JSX compiles to jsx()/jsxs() from
          // 'react/jsx-runtime', which the alias above points at our shim.
          jsx: 'automatic'
        },
        build: {
          outDir: 'dist',
          emptyOutDir: true,
          // Always emit production JSX (jsx-runtime, not jsx-dev-runtime) so the
          // built artifact is stable regardless of NODE_ENV at build time.
          minify: false,
          lib: {
            entry: resolve(__dirname, 'src/renderer-entry.tsx'),
            formats: ['es'],
            fileName: () => 'renderer.js'
          },
          rollupOptions: {
            // Self-contained: react/jsx-runtime aliased to shims; every runtime
            // dep (lucide-react, react-markdown, remark-gfm, zustand) bundles.
            external: []
          }
        }
      }
);
