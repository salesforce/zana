import { describe, expect, it } from 'vitest';
import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import { defaultHostId } from './useHosts.js';

function host(patch: Partial<Host> & Pick<Host, 'id' | 'name'>): Host {
  return {
    type: 'persistent',
    status: 'connected',
    maxPermissionMode: 'full',
    lastSeenAt: 1,
    lastRejectedProtocolVersion: null,
    isPrimary: false,
    canRepairViaSsh: false,
    createdAt: 1,
    updatedAt: 1,
    ...patch
  };
}

const primary = host({ id: 'h-primary', name: 'Laptop', isPrimary: true });
const remote = host({ id: 'h-remote', name: 'Devbox' });

describe('defaultHostId', () => {
  it('uses the bound daemon for SSH remotes and skips this machine', () => {
    expect(defaultHostId([primary, remote], { remote: { host: 'devbox' } })).toBeUndefined();
    expect(defaultHostId([primary, remote], {
      remote: { host: 'devbox' },
      hostId: 'h-remote'
    })).toBe('h-remote');
  });

  it('keeps local projects on their bound host or the primary', () => {
    expect(defaultHostId([primary, remote])).toBe('h-primary');
    expect(defaultHostId([primary, remote], { hostId: 'h-remote' })).toBe('h-remote');
  });
});
