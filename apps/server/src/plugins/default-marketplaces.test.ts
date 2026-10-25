import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMMUNITY_MARKETPLACE_SOURCE,
  DEFAULT_OFFICIAL_MARKETPLACE_URL,
  resolveCommunityMarketplaceSource,
  resolveOfficialMarketplaceUrl
} from './default-marketplaces.js';

describe('resolveOfficialMarketplaceUrl', () => {
  it('defaults to the public HTTPS feed when unset', () => {
    expect(resolveOfficialMarketplaceUrl({})).toBe(DEFAULT_OFFICIAL_MARKETPLACE_URL);
    expect(resolveOfficialMarketplaceUrl({ ZCC_OFFICIAL_MARKETPLACE_URL: '  ' })).toBe(
      DEFAULT_OFFICIAL_MARKETPLACE_URL
    );
  });

  it('skips seeding when set to off or 0', () => {
    expect(resolveOfficialMarketplaceUrl({ ZCC_OFFICIAL_MARKETPLACE_URL: 'off' })).toBeNull();
    expect(resolveOfficialMarketplaceUrl({ ZCC_OFFICIAL_MARKETPLACE_URL: '0' })).toBeNull();
  });

  it('uses an explicit https override and ignores plain http', () => {
    expect(resolveOfficialMarketplaceUrl({
      ZCC_OFFICIAL_MARKETPLACE_URL: 'https://example.test/marketplace.json'
    })).toBe('https://example.test/marketplace.json');
    expect(resolveOfficialMarketplaceUrl({
      ZCC_OFFICIAL_MARKETPLACE_URL: 'http://example.test/marketplace.json'
    })).toBeNull();
  });
});

describe('resolveCommunityMarketplaceSource', () => {
  it('prefers the community override and preserves legacy deployment overrides', () => {
    expect(resolveCommunityMarketplaceSource({ ZCC_COMMUNITY_MARKETPLACE_SOURCE: ' path:/tmp/public ', ZCC_INTERNAL_MARKETPLACE_SOURCE: 'off' })).toBe('path:/tmp/public');
    expect(resolveCommunityMarketplaceSource({ ZCC_COMMUNITY_MARKETPLACE_SOURCE: 'off', ZCC_INTERNAL_MARKETPLACE_SOURCE: 'path:/tmp/private' })).toBeNull();
    expect(resolveCommunityMarketplaceSource({ ZCC_COMMUNITY_MARKETPLACE_SOURCE: '0' })).toBeNull();
    expect(resolveCommunityMarketplaceSource({ ZCC_COMMUNITY_MARKETPLACE_SOURCE: ' ', ZCC_INTERNAL_MARKETPLACE_SOURCE: 'path:/tmp/private' })).toBe('path:/tmp/private');
  });

  it('defaults to the public GitHub catalog when unset', () => {
    expect(resolveCommunityMarketplaceSource({})).toBe('git:https://github.com/salesforce/zana-marketplace.git');
    expect(resolveCommunityMarketplaceSource({ ZCC_INTERNAL_MARKETPLACE_SOURCE: '  ' })).toBe(
      DEFAULT_COMMUNITY_MARKETPLACE_SOURCE
    );
  });

  it('skips seeding when set to off or 0', () => {
    expect(resolveCommunityMarketplaceSource({ ZCC_INTERNAL_MARKETPLACE_SOURCE: 'off' })).toBeNull();
    expect(resolveCommunityMarketplaceSource({ ZCC_INTERNAL_MARKETPLACE_SOURCE: '0' })).toBeNull();
    expect(resolveCommunityMarketplaceSource({ ZCC_INTERNAL_MARKETPLACE_SOURCE: ' off ' })).toBeNull();
  });

  it('uses an explicit override', () => {
    expect(resolveCommunityMarketplaceSource({ ZCC_INTERNAL_MARKETPLACE_SOURCE: 'path:/tmp/cat' }))
      .toBe('path:/tmp/cat');
  });
});
