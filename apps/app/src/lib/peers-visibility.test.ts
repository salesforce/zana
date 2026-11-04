import { describe, expect, it } from 'vitest';
import { pluginSupportsPeers } from './peers-visibility.js';

describe('pluginSupportsPeers', () => {
  it('returns true when enabled and peers both declared true', () => {
    expect(pluginSupportsPeers({ enabled: true, peers: true })).toBe(true);
  });

  it('returns false when enabled is true but peers is false', () => {
    expect(pluginSupportsPeers({ enabled: true, peers: false })).toBe(false);
  });

  it('returns false when enabled is true but peers is undefined (not declared)', () => {
    expect(pluginSupportsPeers({ enabled: true })).toBe(false);
  });

  it('returns false when peers is true but plugin is disabled', () => {
    expect(pluginSupportsPeers({ enabled: false, peers: true })).toBe(false);
  });

  it('returns false when both enabled and peers are false', () => {
    expect(pluginSupportsPeers({ enabled: false, peers: false })).toBe(false);
  });

  it('returns false when disabled and peers undefined', () => {
    expect(pluginSupportsPeers({ enabled: false })).toBe(false);
  });

  it('is strictly identity-based: truthy-but-not-true values do not count', () => {
    // enabled must be exactly `true`; a truthy non-boolean must not pass.
    expect(
      pluginSupportsPeers({ enabled: 1 as unknown as boolean, peers: true })
    ).toBe(false);
    // peers must be exactly `true`; a truthy non-boolean must not pass.
    expect(
      pluginSupportsPeers({ enabled: true, peers: 1 as unknown as boolean })
    ).toBe(false);
  });
});
