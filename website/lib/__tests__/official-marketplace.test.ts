import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildMarketplace } from '../../../marketplace/scripts/build.mjs';
import {
  FALLBACK_PUBLIC_MARKETPLACE_ORIGIN,
  marketplaceCardsFromIndex,
  officialMarketplaceAddCommand,
  officialMarketplaceFeedUrl,
  officialMarketplaceIndex
} from '../official-marketplace';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const MARKETPLACE_ROOT = join(REPO_ROOT, 'marketplace');

describe('official marketplace.json', () => {
  it('committed feed parses as schemaVersion 1 official catalog', () => {
    const index = officialMarketplaceIndex();
    expect(index.schemaVersion).toBe(1);
    expect(index.name).toBe('official');
    expect(index.plugins.length).toBeGreaterThanOrEqual(7);
    expect(
      index.plugins.every((plugin) => plugin.source.git?.subdir === `plugins/${plugin.id}`)
    ).toBe(true);
    expect(
      marketplaceCardsFromIndex(index).some((card) => card.id === 'docs' || card.id === 'memory')
    ).toBe(true);
  });

  it('marketplace/entries build matches the committed website feed', () => {
    const { index } = buildMarketplace(MARKETPLACE_ROOT, {
      validate: false,
      outputs: []
    });
    const committed = JSON.parse(
      readFileSync(join(REPO_ROOT, 'website/content/marketplace/marketplace.json'), 'utf8')
    );
    expect(index.name).toBe('official');
    expect(index.plugins.map((plugin) => plugin.id).sort()).toEqual(
      committed.plugins.map((plugin) => plugin.id).sort()
    );
  });
});

describe('officialMarketplaceAddCommand', () => {
  it('uses PUBLIC_BASE_URL when it is a public origin, stripping a trailing slash', () => {
    expect(officialMarketplaceFeedUrl(`${FALLBACK_PUBLIC_MARKETPLACE_ORIGIN}/`)).toBe(
      `${FALLBACK_PUBLIC_MARKETPLACE_ORIGIN}/marketplace/v1/marketplace.json`
    );
    expect(officialMarketplaceAddCommand(`${FALLBACK_PUBLIC_MARKETPLACE_ORIGIN}/`)).toBe(
      `zcc marketplace add ${FALLBACK_PUBLIC_MARKETPLACE_ORIGIN}/marketplace/v1/marketplace.json`
    );
  });

  it('does not advertise localhost — falls back to the public catalog origin', () => {
    expect(officialMarketplaceAddCommand('http://localhost:4321')).toBe(
      `zcc marketplace add ${FALLBACK_PUBLIC_MARKETPLACE_ORIGIN}/marketplace/v1/marketplace.json`
    );
    expect(officialMarketplaceAddCommand('')).toBe(
      `zcc marketplace add ${FALLBACK_PUBLIC_MARKETPLACE_ORIGIN}/marketplace/v1/marketplace.json`
    );
  });

  it('follows a later PUBLIC_BASE_URL without a code change', () => {
    expect(officialMarketplaceAddCommand('https://zana.example')).toBe(
      'zcc marketplace add https://zana.example/marketplace/v1/marketplace.json'
    );
  });
});
