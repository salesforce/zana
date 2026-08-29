import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests that launch the REAL built Electron app (out/main/index.js)
 * via Playwright's `_electron` driver and drive the real renderer + main + IPC.
 * Unit tests stay in vitest (`*.test.ts` under src/); these are the integration
 * layer that vitest can't reach — they need a booted app.
 *
 * Isolation: each test gets a throwaway HOME (see e2e/fixtures), so the suite
 * never reads or writes the developer's real ~/.zcc. Electron tests must NOT run
 * concurrently in one process (each launch is a full app), so workers = 1.
 *
 * Prereq: a build exists (`npm run build`). The webServer field is unused — we
 * launch the app ourselves inside the electronApp fixture.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.artifacts',
  // Marketplace functionality is temporarily out of scope for the core E2E
  // suite. Its tests remain runnable explicitly by file path.
  testIgnore: [
    '**/marketplace*.spec.ts',
    '**/install-from-git.spec.ts',
  ],
  // One Electron app at a time; specs within a file still run in order.
  workers: 1,
  fullyParallel: false,
  // A booted Electron app + install round-trip is slower than a DOM unit test.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    // Artifacts only on failure — a booted app is heavy to trace always-on.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
