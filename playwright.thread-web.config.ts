import { defineConfig, devices } from '@playwright/test';

const appPort = process.env.ZCC_DEV_APP_PORT ?? '15173';
const baseURL = process.env.ZCC_E2E_APP_URL ?? `http://127.0.0.1:${appPort}`;

export default defineConfig({
  testDir: './e2e-web',
  testMatch: 'thread-create-send.spec.ts',
  outputDir: './e2e-web/.artifacts',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'node scripts/e2e-thread-stack.mjs',
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      ZCC_FAKE_PROVIDER: '1',
      ZCC_SKIP_DESKTOP: '1',
      ZCC_SERVER_PORT: process.env.ZCC_SERVER_PORT ?? '18780',
      ZCC_DEV_APP_PORT: appPort
    }
  }
});
