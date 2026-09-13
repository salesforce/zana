import { describe, expect, it } from 'vitest';
import {
  PLUGIN_STORE_CATEGORIES,
  PLUGIN_STORE_CATEGORY_NAMES,
  categoryFromMarketplaceFields,
  resolvePluginStoreCategory
} from './plugin-store-category.js';

describe('plugin store categories', () => {
  it('keeps one metadata row per curated name', () => {
    expect(PLUGIN_STORE_CATEGORIES.map((category) => category.name)).toEqual([
      ...PLUGIN_STORE_CATEGORY_NAMES
    ]);
  });

  it('resolves the first matching curated name', () => {
    expect(resolvePluginStoreCategory('nope', 'Developer tools', 'Interface')).toBe(
      'Developer tools'
    );
    expect(resolvePluginStoreCategory('  Host access  ')).toBe('Host access');
    expect(resolvePluginStoreCategory('Themes', undefined)).toBeUndefined();
  });

  it('reads category from the field, extra, or a matching tag', () => {
    expect(categoryFromMarketplaceFields({ category: 'Interface' })).toBe('Interface');
    expect(
      categoryFromMarketplaceFields({ extra: { category: 'Agent interaction' } })
    ).toBe('Agent interaction');
    expect(
      categoryFromMarketplaceFields({ tags: ['official', 'Workflow management'] })
    ).toBe('Workflow management');
    expect(categoryFromMarketplaceFields({ tags: ['community'] })).toBeUndefined();
  });
});
