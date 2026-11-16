import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('PostHog retirement', () => {
  it.each([
    '.github/workflows/release.yml',
    'electron.vite.config.ts',
    'scripts/dev-local.mjs',
    'apps/server/src/bundled-globals.d.ts',
    'apps/server/src/plugins/plugin-service.ts'
  ])('does not load or bundle a PostHog key in %s', file => {
    const source = readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8');
    expect(source).not.toMatch(/ZCC_POSTHOG_API_KEY|__ZCC_BUNDLED_POSTHOG_API_KEY__|applyBundledPosthogApiKey/);
  });

  it.each(['marketplace/marketplace.json', 'website/content/marketplace/marketplace.json'])(
    'does not advertise PostHog in %s', file => {
      const catalog = JSON.parse(readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8'));
      expect(catalog.plugins.map((plugin: { id: string }) => plugin.id)).not.toContain('posthog-analytics');
    }
  );
});
