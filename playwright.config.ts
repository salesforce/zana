import { randomUUID } from 'node:crypto';
import { defineConfig } from '@playwright/test';

// Set once in the coordinator, inherited by workers and subprocesses.
const runId = process.env.ZCC_E2E_RUN_ID ||= `${Date.now()}-${process.pid}-${randomUUID().slice(0, 8)}`;

export default defineConfig({
  testDir: './e2e',
  outputDir: `./e2e/.artifacts/runs/${runId}`,
  globalSetup: './e2e/fixtures/runtime-setup.ts',
  // Marketplace specs stay in the suite so Plugins browse/install is covered.
  // install-from-git remains opt-in: leftover UI plus the modern `package.json`
  // `zcc` path.
  testIgnore: process.env.ZCC_E2E_INSTALL_FROM_GIT === '1'
    ? []
    : ['**/install-from-git.spec.ts'],
  // One Electron app at a time; specs within a file still run in order.
  workers: 1,
  fullyParallel: false,
  // A booted Electron app + install round-trip is slower than a DOM unit test.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: `playwright-report/${runId}` }]] : 'list',
  use: {
    // Artifacts only on failure — a booted app is heavy to trace always-on.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
