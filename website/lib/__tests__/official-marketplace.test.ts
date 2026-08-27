import { describe, expect, it } from 'vitest';
import {
  buildOfficialMarketplace,
  pluginEntryFromPackage,
  readFirstPartyPluginEntries
} from '../../scripts/generate-marketplace.mjs';
import { marketplaceCardsFromIndex, officialMarketplaceIndex } from '../official-marketplace';

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
