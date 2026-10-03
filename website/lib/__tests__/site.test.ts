import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it('uses the app release version when no deployment override is supplied', async () => {
  vi.stubEnv('NEXT_PUBLIC_APP_VERSION', undefined);
  const { site } = await import('../site');
  const app = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
  expect(site.latestVersion).toBe(app.version);
});

it('honors an explicitly configured deployment release version', async () => {
  vi.stubEnv('NEXT_PUBLIC_APP_VERSION', '9.8.7');
  const { site } = await import('../site');
  expect(site.latestVersion).toBe('9.8.7');
});
