import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    // host-daemon SOURCE consumes a few leaf modules from @zana-ai/zcc-server
    // (mcp-config.ts → plugins/plugin-skills, execution-consent-store.ts →
    // services/harness-routing/storage). Those aren't a declared workspace dep
    // on purpose: server already depends on host-daemon, so a package.json
    // host-daemon→server edge would make turbo's topological `^build` cyclic.
    // tsc resolves them via the repo tsconfig `paths`; vitest needs an explicit
    // alias. Subpath regex first (maps '<pkg>/<sub>' → 'src/<sub>.ts'), then the
    // exact package. The consumed server modules are node:* leaves (no cascade).
    alias: [
      { find: /^@zana-ai\/zcc-server\/(.*)$/, replacement: resolve(__dirname, '../server/src') + '/$1.ts' },
      { find: /^@zana-ai\/zcc-server$/, replacement: resolve(__dirname, '../server/src/index.ts') }
    ]
  },
  test: {
    environment: 'node',
    // Scrub inherited GIT_* repo-context vars per worker (see vitest.setup.ts +
    // the git-env-scrub guard). Standalone per-package run must wire it itself.
    setupFiles: [resolve(__dirname, '../../vitest.setup.ts')]
  }
});
