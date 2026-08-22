import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { zccBrowserBootstrapPlugin } from './apps/app/vite-plugin-browser-bootstrap';
import { DEFAULT_SERVER_PORT, serverPortFromEnv } from './apps/server/src/http/ports';

// Resolve the extension SDK (`@zana-ai/zcc-extension-sdk` + subpaths) to its source
// in all three bundles. The SDK is the canonical extension contract; core and
// plugins both consume it. Subpaths (`/renderer`, `/main`, `/helpers`) map to
// the matching source file; the bare specifier maps to the package entry.
const sdkAlias = [
  {
    find: /^@zana-ai\/zcc-llm$/,
    replacement: resolve(__dirname, 'packages/llm/src/index.ts')
  },
  {
    find: /^@zana-ai\/zcc-path-confine$/,
    replacement: resolve(__dirname, 'packages/path-confine/src/index.ts')
  },
  {
    find: /^@zana-ai\/zcc-spawn-plan$/,
    replacement: resolve(__dirname, 'packages/spawn-plan/src/index.ts')
  },
  {
    find: /^@zana-ai\/zcc-process-utils$/,
    replacement: resolve(__dirname, 'packages/process-utils/src/index.ts')
  },
  {
    find: /^@zana-ai\/zcc-ui\/(.*)$/,
    replacement: resolve(__dirname, 'packages/ui/src/$1.tsx')
  },
  {
    find: /^@zana-ai\/zcc-desktop-contract$/,
    replacement: resolve(__dirname, 'packages/desktop-contract/src/index.ts')
  },
  {
    find: /^@zana-ai\/zcc-domain\/(.*)$/,
    replacement: resolve(__dirname, 'packages/domain/src/$1.ts')
  },
  {
    find: /^@zana-ai\/zcc-contracts\/canonical-json$/,
    replacement: resolve(__dirname, 'packages/contracts/src/canonical-json.ts')
  },
  {
    find: /^@zana-ai\/zcc-contracts\/terminal-execution$/,
    replacement: resolve(__dirname, 'packages/contracts/src/terminal-execution.ts')
  },
  {
    find: /^@zana-ai\/zcc-contracts\/project-settings$/,
    replacement: resolve(__dirname, 'packages/contracts/src/project-settings.ts')
  },
  {
    find: /^@zana-ai\/zcc-contracts\/runtime$/,
    replacement: resolve(__dirname, 'packages/contracts/src/runtime.ts')
  },
  {
    find: /^@zana-ai\/zcc-server$/,
    replacement: resolve(__dirname, 'apps/server/src/index.ts')
  },
  {
    find: /^@zana-ai\/zcc-server\/(.*)$/,
    replacement: resolve(__dirname, 'apps/server/src/$1.ts')
  },
  {
    find: /^@zana-ai\/zcc-host-daemon$/,
    replacement: resolve(__dirname, 'apps/host-daemon/src/index.ts')
  },
  {
    find: /^@zana-ai\/zcc-host-daemon\/(.*)$/,
    replacement: resolve(__dirname, 'apps/host-daemon/src/$1.ts')
  },
  {
    find: /^@zana-ai\/zcc-plugin-sdk$/,
    replacement: resolve(__dirname, 'packages/plugin-sdk/src/index.ts')
  },
  {
    find: /^@zana-ai\/zcc-plugin-sdk\/(.*)$/,
    replacement: resolve(__dirname, 'packages/plugin-sdk/src/$1.ts')
  },
  {
    find: /^@zana-ai\/zcc-domain$/,
    replacement: resolve(__dirname, 'packages/domain/src/index.ts')
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
  },
  {
    find: /^@\//,
    replacement: resolve(__dirname, 'apps/app/src') + '/'
  }
];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sdkAlias, conditions: ['source'] },
    build: {
      // In `dev`, watch app-module sources under `plugins/` as well as `src/`.
      // A module's main side (e.g. plugins/docs) is pulled into the main
      // bundle via the registry, but lives outside `src/`; without this the
      // dev watcher won't restart the main process when a plugin file changes,
      // leaving a stale main that answers `modules:call` with "Unknown module".
      watch: { include: ['src/**', 'plugins/**', 'apps/**', 'packages/**'] },
      rollupOptions: {
        // `host-child` is the core-owned bootstrap that runs inside each
        // per-extension `utilityProcess` (P3-A). Build it as a SEPARATE main
        // entry so it lands at `out/main/host-child.js` beside `index.js`; the
        // spawn factory resolves it via `join(__dirname, 'host-child.js')` at
        // runtime. It's a Node/utilityProcess context — same externalize-node/
        // electron treatment as the main entry (externalizeDepsPlugin above).
        input: {
          index: resolve(__dirname, 'apps/desktop/src/bootstrap.ts'),
          main: resolve(__dirname, 'apps/desktop/src/main.ts'),
          'host-child': resolve(__dirname, 'apps/desktop/src/extensions/host-child.ts'),
          'server-runtime': resolve(__dirname, 'apps/server/src/utility-entry.ts'),
          'host-runtime': resolve(__dirname, 'apps/host-daemon/src/utility-entry.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sdkAlias, conditions: ['source'] },
    build: {
      watch: { include: ['src/**', 'plugins/**', 'packages/**', 'apps/**'] },
      rollupOptions: {
        input: { index: resolve(__dirname, 'apps/desktop/src/preload.ts') },
        // A SANDBOXED preload (webPreferences.sandbox:true) MUST be CommonJS —
        // Electron cannot load an ESM preload in a sandboxed renderer, and it
        // fails SILENTLY (the preload never runs, so `window.cc` is undefined
        // and the renderer crashes on first access). Force CJS `index.js`
        // output instead of the default `.mjs`. The path in apps/desktop/src/host.ts
        // must match (`../preload/index.js`).
        output: {
          format: 'cjs',
          entryFileNames: 'index.js'
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'apps/app'),
    resolve: {
      conditions: ['source'],
      alias: [
        ...sdkAlias,
        { find: /^@\//, replacement: resolve(__dirname, 'apps/app/src') + '/' }
      ],
      dedupe: ['monaco-editor']
    },
    plugins: [react(), zccBrowserBootstrapPlugin()],
    define: {
      __ZCC_DEV_WS_PORT__: JSON.stringify(serverPortFromEnv())
    },
    server: {
      // Vite root is apps/app; the slack built-in and other plugins live at
      // repo-root `plugins/`. Allow the workspace so those imports are served.
      fs: { allow: [resolve(__dirname)] },
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${process.env.ZCC_SERVER_PORT ?? DEFAULT_SERVER_PORT}`,
          changeOrigin: true
        },
        '/ws': {
          target: `http://127.0.0.1:${process.env.ZCC_SERVER_PORT ?? DEFAULT_SERVER_PORT}`,
          changeOrigin: true,
          ws: true
        }
      }
    },
    // Monaco workers are ESM side-effect scripts. Do not alias
    // `monaco-editor/esm/vs` to a filesystem path — that bypasses optimizeDeps
    // exclude and Vite 8 prebundles workers with no `default` export.
    worker: { format: 'es' },
    optimizeDeps: { exclude: ['monaco-editor', '@monaco-editor/react'] },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'apps/app/index.html')
      }
    }
  }
});
