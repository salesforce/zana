import { describe, expect, it } from 'vitest';
import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import { machineConnectionCopy, permissionLabel } from './machine-status.js';

function host(overrides: Partial<Host> = {}): Host {
  return {
    id: 'h1',
    name: 'box',
    type: 'persistent',
    status: 'connected',
    maxPermissionMode: 'full',
    lastSeenAt: 1_700_000_000_000,
    lastRejectedProtocolVersion: null,
    isPrimary: false,
    canRepairViaSsh: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  };
}

describe('machineConnectionCopy', () => {
  it('labels connected, stale, and protocol-mismatch hosts', () => {
    expect(machineConnectionCopy(host(), 1_700_000_000_000).label).toBe('Online');
    expect(machineConnectionCopy(host({ status: 'disconnected', lastSeenAt: null }), 0)).toEqual({
      label: 'Offline',
      tone: 'muted'
    });
    expect(machineConnectionCopy(
      host({ status: 'disconnected', lastSeenAt: 1_700_000_000_000 }),
      1_700_000_000_000
    ).label).toBe('Offline · just now');
    expect(machineConnectionCopy(
      host({ status: 'disconnected', lastSeenAt: 1_700_000_000_000 }),
      1_700_000_000_000 + 5 * 60_000
    ).label).toBe('Offline · last seen 5m ago');
    expect(machineConnectionCopy(host({ lastRejectedProtocolVersion: 12 }), 0)).toEqual({
      label: 'Needs update',
      tone: 'warn'
    });
  });

  it('maps permission ceilings to short labels', () => {
    expect(permissionLabel('accept-edits')).toBe('Accept edits');
    expect(permissionLabel('auto')).toBe('Auto');
    expect(permissionLabel('full')).toBe('Full');
  });
});
