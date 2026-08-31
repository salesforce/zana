import { defineConfig, configDefaults } from 'vitest/config';
import { resolve } from 'node:path';

// Vitest doesn't read electron.vite.config.ts, so the extension-SDK alias is
// declared here too. Keeps `@zana-ai/zcc-extension-sdk[/subpath]` resolving in tests
// (e.g. the markdown helper, now re-exported through the SDK).
export default defineConfig({
  define: {
    __ZCC_DEV_WS_PORT__: 'undefined',
    __ZCC_BUNDLED_APP_URL__: JSON.stringify(''),
    __ZCC_BUNDLED_RELAY_TOKEN__: JSON.stringify('')
  },
  test: {
    // Runs once per worker before any test file — scrubs inherited GIT_* vars
    // so a git-spawning test can never operate on the OUTER repo under the
    // pre-push hook (see vitest.setup.ts for the full rationale).
    setupFiles: [resolve(__dirname, './vitest.setup.ts')],
    // e2e/ holds Playwright `*.spec.ts` that launch a real Electron app — they
    // are NOT vitest unit tests and must not be collected by `npm test`.
    // .claude/worktrees/** are git worktrees for other in-progress branches
    // (git-ignored): their tests belong to THAT checkout and may import symbols
    // that don't exist on this branch — collect them and `pnpm test` fails on
    // unrelated code and masks real failures.
    exclude: [
      ...configDefaults.exclude,
      'e2e/**',
      '.claude/worktrees/**',
      'salesforce-only/**',
      'packages/agent-runtime/src/integration*.test.ts',
      'packages/host-daemon-contract/test/**',
      'packages/server-contract/test/**',
      // bundled-bin asserts against packages/cli/dist (the built zcc bin) and
      // does not build it — the root `pnpm test` deliberately never runs a
      // build. It runs via packages/cli's own `test` script (`build && vitest`),
      // so collecting it here fails on a stale/absent dist.
      'packages/cli/src/__tests__/bundled-bin.test.ts'
    ]
  },
  resolve: {
    alias: [
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
        find: /^@zana-ai\/zcc-agent-process-utils$/,
        replacement: resolve(__dirname, 'packages/agent-process-utils/src/index.ts')
      },
      {
        find: /^@zana-ai\/zcc-agent-runtime\/test$/,
        replacement: resolve(__dirname, 'packages/agent-runtime/src/test/index.ts')
      },
      {
        find: /^@zana-ai\/zcc-agent-runtime$/,
        replacement: resolve(__dirname, 'packages/agent-runtime/src/index.ts')
      },
      {
        find: /^@zana-ai\/zcc-thread-view$/,
        replacement: resolve(__dirname, 'packages/thread-view/src/index.ts')
      },
      {
        find: /^@zana-ai\/zcc-provider-bridge-protocol\/assembler$/,
        replacement: resolve(__dirname, 'packages/provider-bridge-protocol/src/assembler/index.ts')
      },
      {
        find: /^@zana-ai\/zcc-provider-bridge-protocol\/bridge-kit$/,
        replacement: resolve(__dirname, 'packages/provider-bridge-protocol/src/bridge-kit/index.ts')
      },
      {
        find: /^@zana-ai\/zcc-provider-bridge-protocol\/conformance$/,
        replacement: resolve(__dirname, 'packages/provider-bridge-protocol/src/conformance/index.ts')
      },
      {
        find: /^@zana-ai\/zcc-provider-bridge-protocol\/testing$/,
        replacement: resolve(__dirname, 'packages/provider-bridge-protocol/src/testing/index.ts')
      },
      {
        find: /^@zana-ai\/zcc-provider-bridge-protocol$/,
        replacement: resolve(__dirname, 'packages/provider-bridge-protocol/src/index.ts')
      },
      {
        find: /^@zana-ai\/zcc-host-daemon-contract\/(.*)$/,
        replacement: resolve(__dirname, 'packages/host-daemon-contract/src/$1.ts')
      },
      {
        find: /^@zana-ai\/zcc-host-daemon-contract$/,
        replacement: resolve(__dirname, 'packages/host-daemon-contract/src/index.ts')
      },
      {
        find: /^@zana-ai\/zcc-server-contract$/,
        replacement: resolve(__dirname, 'packages/server-contract/src/index.ts')
      },
      {
        find: /^@zana-ai\/zcc-hono-typed-routes$/,
        replacement: resolve(__dirname, 'packages/hono-typed-routes/src/index.ts')
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
        find: /^@zana-ai\/zcc-contracts\/host-rpc$/,
        replacement: resolve(__dirname, 'packages/contracts/src/host-rpc.ts')
      },
      {
        find: /^@zana-ai\/zcc-db$/,
        replacement: resolve(__dirname, 'packages/db/src/index.ts')
      },
      {
        find: /^@zana-ai\/zcc-host-workspace$/,
        replacement: resolve(__dirname, 'packages/host-workspace/src/index.ts')
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
        find: /^@zana-ai\/zcc-plugin-sdk\/testing\/app$/,
        replacement: resolve(__dirname, 'packages/plugin-sdk/src/testing/app.ts')
      },
      {
        find: /^@zana-ai\/zcc-plugin-sdk\/testing$/,
        replacement: resolve(__dirname, 'packages/plugin-sdk/src/testing/index.ts')
      },
      {
        find: /^@zana-ai\/zcc-plugin-sdk\/provider-bridge\/testing$/,
        replacement: resolve(
          __dirname,
          'packages/plugin-sdk/src/provider-bridge-testing.ts',
        )
      },
      {
        find: /^@zana-ai\/zcc-plugin-sdk\/(.*)$/,
        replacement: resolve(__dirname, 'packages/plugin-sdk/src/$1.ts')
      },
      {
        find: /^@zana-ai\/zcc-plugin-templates$/,
        replacement: resolve(__dirname, 'packages/plugin-templates/src/index.ts')
      },
      {
        find: /^@zana-ai\/zcc-plugin-build$/,
        replacement: resolve(__dirname, 'packages/plugin-build/src/index.ts')
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
      {
        find: /^@zcc\/harness-sdk$/,
        replacement: resolve(__dirname, 'packages/harness-sdk/src/index.ts')
      },
      {
        find: /^@zcc\/harness-sdk\/(.*)$/,
        replacement: resolve(__dirname, 'packages/harness-sdk/src/$1.ts')
      },
      { find: /^@\//, replacement: resolve(__dirname, 'apps/app/src') + '/' }
    ]
  }
});
