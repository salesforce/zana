import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Resolve the extension SDK (`@zana-ai/zcc-extension-sdk` + subpaths) to its source
// in all three bundles. The SDK is the canonical extension contract; core and
// plugins both consume it. Subpaths (`/renderer`, `/main`, `/helpers`) map to
// the matching source file; the bare specifier maps to the package entry.
const sdkAlias = [
  {
    find: /^@zana-ai\/zcc-contracts\/canonical-json$/,
    replacement: resolve(__dirname, 'packages/contracts/src/canonical-json.ts')
  },
  {
    find: /^@zana-ai\/zcc-contracts\/terminal-execution$/,
    replacement: resolve(__dirname, 'packages/contracts/src/terminal-execution.ts')
  },
  {
    find: /^@zana-ai\/zcc-contracts\/runtime$/,
    replacement: resolve(__dirname, 'packages/contracts/src/runtime.ts')
  },
  {
    find: /^@zana-ai\/zcc-server\/static-host$/,
    replacement: resolve(__dirname, 'apps/server/src/static-host.ts')
  },
  {
    find: /^@zana-ai\/zcc-host-daemon$/,
    replacement: resolve(__dirname, 'apps/host-daemon/src/index.ts')
  },
  {
    find: /^@zana-ai\/zcc-extension-sdk$/,
    replacement: resolve(__dirname, 'packages/extension-sdk/src/index.ts')
  },
  {
    find: /^@zana-ai\/zcc-extension-sdk\/(.*)$/,
    replacement: resolve(__dirname, 'packages/extension-sdk/src/$1.ts')
  },
  // The harness SDK (`@zcc/harness-sdk`) — the dependency-free harness-descriptor
  // contracts, resolved to source in-repo exactly like the extension SDK above.
  {
    find: /^@zcc\/harness-sdk$/,
    replacement: resolve(__dirname, 'packages/harness-sdk/src/index.ts')
  },
  {
    find: /^@zcc\/harness-sdk\/(.*)$/,
    replacement: resolve(__dirname, 'packages/harness-sdk/src/$1.ts')
  }
];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sdkAlias },
    build: {
      // In `dev`, watch app-module sources under `plugins/` as well as `src/`.
      // A module's main side (e.g. plugins/slack/main) is pulled into the main
      // bundle via the registry, but lives outside `src/`; without this the
      // dev watcher won't restart the main process when a plugin file changes,
      // leaving a stale main that answers `modules:call` with "Unknown module".
      watch: { include: ['src/**', 'plugins/**', 'apps/**'] },
      rollupOptions: {
        // `host-child` is the core-owned bootstrap that runs inside each
        // per-extension `utilityProcess` (P3-A). Build it as a SEPARATE main
        // entry so it lands at `out/main/host-child.js` beside `index.js`; the
        // spawn factory resolves it via `join(__dirname, 'host-child.js')` at
        // runtime. It's a Node/utilityProcess context — same externalize-node/
        // electron treatment as the main entry (externalizeDepsPlugin above).
        input: {
          index: resolve(__dirname, 'src/main/bootstrap.ts'),
          main: resolve(__dirname, 'src/main/index.ts'),
          'host-child': resolve(__dirname, 'src/main/extensions/host-child.ts'),
          'server-runtime': resolve(__dirname, 'apps/server/src/utility-entry.ts'),
          'host-runtime': resolve(__dirname, 'apps/host-daemon/src/utility-entry.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sdkAlias },
    build: {
      watch: { include: ['src/**', 'plugins/**'] },
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        // A SANDBOXED preload (webPreferences.sandbox:true) MUST be CommonJS —
        // Electron cannot load an ESM preload in a sandboxed renderer, and it
        // fails SILENTLY (the preload never runs, so `window.cc` is undefined
        // and the renderer crashes on first access). Force CJS `index.js`
        // output instead of the default `.mjs`. The path in src/main/index.ts
        // must match (`../preload/index.js`).
        output: {
          format: 'cjs',
          entryFileNames: 'index.js'
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: [
        ...sdkAlias,
        // Built-in plugins share core renderer controls but live outside
        // `src/renderer`, so use this explicit source alias instead of a brittle
        // relative path back into the host UI.
        { find: '@renderer', replacement: resolve(__dirname, 'src/renderer') },
        // Monaco 0.56 restricts its public exports, while its Vite worker
        // entrypoints remain under `esm/vs`. Resolve that subtree directly.
        {
          find: 'monaco-editor/esm/vs',
          replacement: resolve(__dirname, 'node_modules/monaco-editor/esm/vs')
        },
        { find: '@shared', replacement: resolve(__dirname, 'src/shared') }
      ],
      dedupe: ['monaco-editor']
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    }
  }
});
