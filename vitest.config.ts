import { defineConfig, configDefaults } from 'vitest/config';
import { resolve } from 'node:path';

// Vitest doesn't read electron.vite.config.ts, so the extension-SDK alias is
// declared here too. Keeps `@zana-ai/zcc-extension-sdk[/subpath]` resolving in tests
// (e.g. the markdown helper, now re-exported through the SDK).
export default defineConfig({
  test: {
    // Runs once per worker before any test file — scrubs inherited GIT_* vars
    // so a git-spawning test can never operate on the OUTER repo under the
    // pre-push hook (see vitest.setup.ts for the full rationale).
    setupFiles: ['./vitest.setup.ts'],
    // e2e/ holds Playwright `*.spec.ts` that launch a real Electron app — they
    // are NOT vitest unit tests and must not be collected by `npm test`.
    // .claude/worktrees/** are git worktrees for other in-progress branches
    // (git-ignored): their tests belong to THAT checkout and may import symbols
    // (e.g. `@shared/launch-provider`) that don't exist on this branch — collect
    // them and `npm test` fails on unrelated code and masks real failures.
    exclude: [...configDefaults.exclude, 'e2e/**', '.claude/worktrees/**', 'salesforce-only/**']
  },
  resolve: {
    alias: [
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
        find: /^@zana-ai\/zcc-server\/static-host$/,
        replacement: resolve(__dirname, 'apps/server/src/static-host.ts')
      },
      {
        find: /^@zana-ai\/zcc-host-daemon$/,
        replacement: resolve(__dirname, 'apps/host-daemon/src/index.ts')
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
      {
        find: /^@zcc\/harness-sdk$/,
        replacement: resolve(__dirname, 'packages/harness-sdk/src/index.ts')
      },
      {
        find: /^@zcc\/harness-sdk\/(.*)$/,
        replacement: resolve(__dirname, 'packages/harness-sdk/src/$1.ts')
      },
      { find: '@shared', replacement: resolve(__dirname, 'src/shared') },
      { find: '@renderer', replacement: resolve(__dirname, 'src/renderer') }
    ]
  }
});
