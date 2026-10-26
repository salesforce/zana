import { describe, expect, it } from 'vitest';
import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import { primaryMachineLabel } from './machine-projects.js';
import { sessionLocation } from './session-location.js';

const host = (id: string, isPrimary = false): Host => ({
  id, name: id === 'remote' ? 'Devbox' : id, isPrimary, type: 'persistent', status: 'connected',
  maxPermissionMode: 'full', canRepairViaSsh: false, lastSeenAt: 1,
  lastRejectedProtocolVersion: null, createdAt: 1, updatedAt: 1
});
const hosts = [host('primary', true), host('remote')];

describe('sessionLocation', () => {
  it('uses the recorded host for Default Project rather than its metadata owner', () => {
    expect(sessionLocation('remote', { hostId: 'primary' }, hosts)).toEqual({
      hostId: 'remote', machineName: 'Devbox', remote: true, remoteToolProxy: false
    });
    expect(sessionLocation('primary', { hostId: 'remote' }, hosts)).toEqual({
      hostId: 'primary', machineName: primaryMachineLabel(), remote: false, remoteToolProxy: false
    });
  });

  it('keeps offline identity, follows renames and never labels a missing host local', () => {
    expect(sessionLocation('remote', undefined, [hosts[0], { ...hosts[1], status: 'disconnected', name: 'Renamed box' }]))
      .toMatchObject({ hostId: 'remote', machineName: 'Renamed box', remote: true });
    expect(sessionLocation('removed', undefined, hosts))
      .toMatchObject({ hostId: 'removed', machineName: 'Unavailable machine', remote: true });
    expect(sessionLocation('remote', undefined, []))
      .toMatchObject({ hostId: 'remote', machineName: 'Unavailable machine', remote: true });
  });

  it('uses project and primary fallbacks only for records without a host', () => {
    expect(sessionLocation(undefined, { hostId: 'remote' }, hosts).machineName).toBe('Devbox');
    expect(sessionLocation('', undefined, hosts).machineName).toBe(primaryMachineLabel());
    expect(sessionLocation(null, undefined, [])).toEqual({
      hostId: undefined, machineName: undefined, remote: false, remoteToolProxy: false
    });
  });

  it('distinguishes an SSH agent from an agent using remote tools', () => {
    const project = { hostId: 'remote', remote: { host: 'devbox' } };
    expect(sessionLocation('remote', project, hosts)).toMatchObject({ remote: true, remoteToolProxy: false });
    expect(sessionLocation('primary', project, hosts)).toMatchObject({ remote: false, remoteToolProxy: true });
    expect(sessionLocation('primary', { remote: { host: 'unpaired' } }, hosts).remoteToolProxy).toBe(true);
  });
});
