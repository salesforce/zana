import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  define: {
    __ZCC_BUNDLED_APP_URL__: JSON.stringify(''),
    __ZCC_BUNDLED_RELAY_TOKEN__: JSON.stringify('')
  },
  resolve: {
    // Array form so host-daemon subpaths resolve via regex. A bare string alias
    // for '@zana-ai/zcc-host-daemon' prefix-matches subpaths too, rewriting
    // '.../harness/x' onto '.../src/index.ts/harness/x' (ENOTDIR). The subpath
    // regex (checked first) maps '@zana-ai/zcc-host-daemon/<sub>' → 'src/<sub>.ts';
    // the exact regex maps the bare package to 'src/index.ts'.
    alias: [
      { find: /^@zana-ai\/zcc-host-daemon\/(.*)$/, replacement: resolve(__dirname, '../host-daemon/src') + '/$1.ts' },
      { find: /^@zana-ai\/zcc-host-daemon$/, replacement: resolve(__dirname, '../host-daemon/src/index.ts') },
      { find: /^@zana-ai\/zcc-domain\/(.*)$/, replacement: resolve(__dirname, '../../packages/domain/src') + '/$1.ts' },
      { find: /^@zana-ai\/zcc-domain$/, replacement: resolve(__dirname, '../../packages/domain/src/index.ts') },
      { find: /^@zana-ai\/zcc-extension-sdk\/(.*)$/, replacement: resolve(__dirname, '../../packages/extension-sdk/src') + '/$1.ts' },
      { find: /^@zana-ai\/zcc-extension-sdk$/, replacement: resolve(__dirname, '../../packages/extension-sdk/src/index.ts') },
      { find: /^@zana-ai\/zcc-desktop-contract\/(.*)$/, replacement: resolve(__dirname, '../../packages/desktop-contract/src') + '/$1.ts' },
      { find: /^@zana-ai\/zcc-desktop-contract$/, replacement: resolve(__dirname, '../../packages/desktop-contract/src/index.ts') },
      // Some server tests transitively load host-daemon SOURCE (host.ts/pty.ts →
      // host-daemon src), which re-imports leaf @zana-ai/zcc-server subpaths.
      // Self-alias so those re-imports resolve to this package's own src.
      { find: /^@zana-ai\/zcc-server\/(.*)$/, replacement: resolve(__dirname, 'src') + '/$1.ts' },
      { find: '@zana-ai/zcc-process-utils', replacement: resolve(__dirname, '../../packages/process-utils/src/index.ts') },
      { find: '@zana-ai/zcc-path-confine', replacement: resolve(__dirname, '../../packages/path-confine/src/index.ts') },
      { find: '@zana-ai/zcc-llm', replacement: resolve(__dirname, '../../packages/llm/src/index.ts') },
      // plugin-sdk subpaths mapped exactly to their export table (a bare string
      // alias prefix-matches subpaths → 'src/index.ts/app' ENOTDIR; and several
      // subpaths don't map to 'src/<sub>.ts'). Specific-first.
      { find: /^@zana-ai\/zcc-plugin-sdk\/testing\/app$/, replacement: resolve(__dirname, '../../packages/plugin-sdk/src/testing/app.ts') },
      { find: /^@zana-ai\/zcc-plugin-sdk\/testing$/, replacement: resolve(__dirname, '../../packages/plugin-sdk/src/testing/index.ts') },
      { find: /^@zana-ai\/zcc-plugin-sdk\/provider-bridge\/testing$/, replacement: resolve(__dirname, '../../packages/plugin-sdk/src/provider-bridge-testing.ts') },
      { find: /^@zana-ai\/zcc-plugin-sdk\/provider-bridge$/, replacement: resolve(__dirname, '../../packages/plugin-sdk/src/provider-bridge.ts') },
      { find: /^@zana-ai\/zcc-plugin-sdk\/(app|server)$/, replacement: resolve(__dirname, '../../packages/plugin-sdk/src') + '/$1.ts' },
      { find: /^@zana-ai\/zcc-plugin-sdk$/, replacement: resolve(__dirname, '../../packages/plugin-sdk/src/index.ts') },
      { find: '@zana-ai/zcc-plugin-templates', replacement: resolve(__dirname, '../../packages/plugin-templates/src/index.ts') }
    ]
  },
  test: {
    environment: 'node',
    // Scrub inherited GIT_* repo-context vars per worker (the documented git-env
    // leak defense — see vitest.setup.ts + git-env-scrub.guard.test.ts). The
    // per-package config runs standalone (turbo `vitest run --config`), so it
    // must wire the scrub itself; without it, git-heavy e2e tests flake under
    // full-suite concurrency and the guard trips on any leaked GIT_*.
    setupFiles: [resolve(__dirname, '../../vitest.setup.ts')]
  }
});
