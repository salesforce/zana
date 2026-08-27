import { describe, expect, it } from 'vitest';
import {
  buildOfficialMarketplace,
  pluginEntryFromPackage,
  readFirstPartyPluginEntries
} from '../../scripts/generate-marketplace.mjs';
import {
  marketplaceCardsFromIndex,
  officialMarketplaceAddCommand,
  officialMarketplaceFeedUrl,
  officialMarketplaceIndex
} from '../official-marketplace';

describe('official marketplace.json', () => {
  it('builds pointer entries from first-party package.json files', () => {
    const entry = pluginEntryFromPackage(
      {
        name: '@zcc-ext/docs',
        description: 'pkg description',
        zcc: {
          name: 'Docs',
          description: 'Durable project knowledge',
          branding: { icon: 'Library' }
        }
      },
      'docs'
    );
    expect(entry).toMatchObject({
      id: 'docs',
      displayName: 'Docs',
      tags: ['official'],
      source: { git: { url: 'https://github.com/salesforce/zana', subdir: 'plugins/docs', ref: 'HEAD' } }
    });
    expect(pluginEntryFromPackage({ name: '@zcc-ext/docs', zcc: { name: 'Docs' } }, 'other')).toBeNull();
  });

  it('committed feed parses as schemaVersion 1 official catalog', () => {
    const index = officialMarketplaceIndex();
    expect(index.schemaVersion).toBe(1);
    expect(index.name).toBe('official');
    expect(index.plugins.length).toBeGreaterThanOrEqual(7);
    expect(index.plugins.every((plugin) => plugin.source.git?.subdir === `plugins/${plugin.id}`)).toBe(
      true
    );
    expect(marketplaceCardsFromIndex(index).some((card) => card.id === 'docs')).toBe(true);
  });

  it('lists every first-party plugin dir when plugins/ is present', () => {
    const fromDisk = buildOfficialMarketplace(readFirstPartyPluginEntries());
    if (fromDisk.plugins.length === 0) return;
    const committed = officialMarketplaceIndex();
    expect(committed.plugins.map((plugin) => plugin.id).sort()).toEqual(
      fromDisk.plugins.map((plugin) => plugin.id).sort()
    );
  });
});

describe('officialMarketplaceAddCommand', () => {
  it('builds the add command from PUBLIC_BASE_URL, stripping a trailing slash', () => {
    expect(officialMarketplaceFeedUrl('https://zcc-7808c5bc8f3d.herokuapp.com/')).toBe(
      'https://zcc-7808c5bc8f3d.herokuapp.com/marketplace/v1/marketplace.json'
    );
    expect(officialMarketplaceAddCommand('https://zcc-7808c5bc8f3d.herokuapp.com/')).toBe(
      'zcc marketplace add https://zcc-7808c5bc8f3d.herokuapp.com/marketplace/v1/marketplace.json'
    );
  });

  it('keeps a local origin when PUBLIC_BASE_URL is the dev default', () => {
    expect(officialMarketplaceAddCommand('http://localhost:4321')).toBe(
      'zcc marketplace add http://localhost:4321/marketplace/v1/marketplace.json'
    );
  });
});
