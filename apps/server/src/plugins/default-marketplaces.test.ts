import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INTERNAL_MARKETPLACE_SOURCE,
  DEFAULT_COMMUNITY_MARKETPLACE_SOURCE,
  resolveCommunityMarketplaceSource,
  DEFAULT_OFFICIAL_MARKETPLACE_URL,
  resolveInternalMarketplaceSource,
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

describe('resolveInternalMarketplaceSource', () => {
  it('defaults to the git.soma catalog when unset', () => {
    expect(resolveInternalMarketplaceSource({})).toBe(DEFAULT_INTERNAL_MARKETPLACE_SOURCE);
    expect(resolveInternalMarketplaceSource({ ZCC_INTERNAL_MARKETPLACE_SOURCE: '  ' })).toBe(
      DEFAULT_INTERNAL_MARKETPLACE_SOURCE
    );
  });

  it('skips seeding when set to off or 0', () => {
    expect(resolveInternalMarketplaceSource({ ZCC_INTERNAL_MARKETPLACE_SOURCE: 'off' })).toBeNull();
    expect(resolveInternalMarketplaceSource({ ZCC_INTERNAL_MARKETPLACE_SOURCE: '0' })).toBeNull();
    expect(resolveInternalMarketplaceSource({ ZCC_INTERNAL_MARKETPLACE_SOURCE: ' off ' })).toBeNull();
  });

  it('uses an explicit override', () => {
    expect(resolveInternalMarketplaceSource({ ZCC_INTERNAL_MARKETPLACE_SOURCE: 'path:/tmp/cat' }))
      .toBe('path:/tmp/cat');
  });
});

describe('resolveCommunityMarketplaceSource', () => {
  it('defaults to public GitHub independently of internal deployment overrides', () => {
    expect(resolveCommunityMarketplaceSource({})).toBe(DEFAULT_COMMUNITY_MARKETPLACE_SOURCE);
    expect(DEFAULT_COMMUNITY_MARKETPLACE_SOURCE).toBe('git:https://github.com/salesforce/zana-marketplace.git');
    for (const internal of ['off', '0', 'path:/tmp/internal']) {
      expect(resolveCommunityMarketplaceSource({ ZCC_INTERNAL_MARKETPLACE_SOURCE: internal })).toBe(DEFAULT_COMMUNITY_MARKETPLACE_SOURCE);
    }
    expect(resolveCommunityMarketplaceSource({ ZCC_COMMUNITY_MARKETPLACE_SOURCE: ' ' })).toBe(DEFAULT_COMMUNITY_MARKETPLACE_SOURCE);
  });

  it('honors its own override and disable flags without changing the internal catalog', () => {
    for (const publicSource of ['off', '0']) {
      const env = { ZCC_COMMUNITY_MARKETPLACE_SOURCE: publicSource };
      expect(resolveCommunityMarketplaceSource(env)).toBeNull();
      expect(resolveInternalMarketplaceSource(env)).toBe(DEFAULT_INTERNAL_MARKETPLACE_SOURCE);
    }
    expect(resolveCommunityMarketplaceSource({ ZCC_COMMUNITY_MARKETPLACE_SOURCE: ' path:/tmp/public ' })).toBe('path:/tmp/public');
  });
});
