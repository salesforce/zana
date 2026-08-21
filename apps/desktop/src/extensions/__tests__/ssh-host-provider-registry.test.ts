import { describe, expect, it } from 'vitest';
import {
  asSshHosts,
  asSshSyncResult,
  mergeSshHosts,
  SshHostProviderRegistry
} from '../ssh-host-provider-registry.js';

describe('SshHostProviderRegistry', () => {
  it('clears only the extension that owns the active provider selection', () => {
    const registry = new SshHostProviderRegistry();
    registry.register('alpha');
    registry.clear('beta');
    expect(registry.activeModuleId()).toBe('alpha');
    registry.clear('alpha');
    expect(registry.activeModuleId()).toBeNull();
  });

  it('only forwards valid structured host fields across the extension boundary', () => {
    expect(
      asSshHosts([
        { alias: 'workspace', hostname: 'host', user: 'sfwork', proxyJump: 'bastion', ignored: 'x' },
        { hostname: 'missing-alias' },
        'not-an-object'
      ])
    ).toEqual([{ alias: 'workspace', hostname: 'host', user: 'sfwork', proxyJump: 'bastion' }]);
  });

  it('fails closed for malformed provider sync responses', () => {
    expect(asSshSyncResult(null)).toEqual({ hosts: [] });
    expect(asSshSyncResult({ hosts: [{ alias: 'workspace' }], warning: 42 })).toEqual({
      hosts: [{ alias: 'workspace' }],
      warning: undefined
    });
  });

  it('keeps generic SSH hosts while letting refreshed provider fields win', () => {
    expect(
      mergeSshHosts(
        [
          { alias: 'github.com' },
          { alias: 'workspace', hostname: 'stale', user: 'sfwork' }
        ],
        [{ alias: 'workspace', hostname: 'fresh', user: 'sfwork' }]
      )
    ).toEqual([
      { alias: 'github.com' },
      { alias: 'workspace', hostname: 'fresh', user: 'sfwork' }
    ]);
  });
});
