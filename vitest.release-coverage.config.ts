import { configDefaults, defineConfig } from 'vitest/config';
import root from './vitest.config';

// These package suites are excluded from the routine root run. Release changes
// still need their real build and authentication failure-path coverage.
const { projects: _projects, ...rootTest } = root.test ?? {};

export default defineConfig({
  ...root,
  test: {
    ...rootTest,
    include: [
      'packages/host-daemon-contract/test/**/*.test.ts',
      'packages/plugin-build/src/build-plugin-app.test.ts',
      'packages/plugin-build/src/build-plugin-server.test.ts',
      'plugins/provider-codex/src/ai/chatgpt-client.test.ts',
    ],
    exclude: configDefaults.exclude,
  },
});
