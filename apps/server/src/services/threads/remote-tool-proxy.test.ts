import { describe, expect, it } from 'vitest';
import type { Project } from '@zana-ai/zcc-domain/product';
import {
  boundRemoteHostId,
  isRemoteToolProxyActive,
  remoteWorkspacePath,
  REMOTE_HOST_DAEMON_REQUIRED,
  threadLaunchRemote
} from './remote-tool-proxy.js';

const sshProject: Project = {
  id: 'p-ssh',
  name: 'Remote app',
  path: '/tmp/placeholder',
  createdAt: 1,
  lastActiveAt: 1,
  remote: { host: 'devbox', user: 'me', remotePath: '/src', proxyJump: 'bastion' }
};

describe('isRemoteToolProxyActive', () => {
  it('is off for new SSH threads, bound or not', () => {
    expect(isRemoteToolProxyActive(sshProject)).toBe(false);
    expect(isRemoteToolProxyActive(sshProject, 'h-primary')).toBe(false);
    expect(isRemoteToolProxyActive({ ...sshProject, hostId: 'h-enrolled' })).toBe(false);
    expect(isRemoteToolProxyActive({ ...sshProject, hostId: 'h-enrolled' }, 'h-primary')).toBe(false);
    expect(isRemoteToolProxyActive({ ...sshProject, hostId: 'h-enrolled' }, 'h-enrolled')).toBe(false);
    expect(isRemoteToolProxyActive({
      id: 'p-local',
      name: 'Local',
      path: '/tmp/local',
      createdAt: 1,
      lastActiveAt: 1
    })).toBe(false);
  });
});

describe('boundRemoteHostId', () => {
  it('requires a bound daemon on SSH remotes', () => {
    expect(boundRemoteHostId(sshProject)).toBeNull();
    expect(boundRemoteHostId({ ...sshProject, hostId: 'h-enrolled' })).toBe('h-enrolled');
    expect(boundRemoteHostId({
      id: 'p-local',
      name: 'Local',
      path: '/tmp/local',
      createdAt: 1,
      lastActiveAt: 1
    })).toBeUndefined();
    expect(REMOTE_HOST_DAEMON_REQUIRED).toBe('host-daemon-required');
  });
});

describe('remoteWorkspacePath', () => {
  it('uses the placeholder on this machine and the remote path on the enrolled host', () => {
    expect(remoteWorkspacePath(sshProject, true)).toBe('/tmp/placeholder');
    expect(remoteWorkspacePath(sshProject, false)).toBe('/src');
    expect(remoteWorkspacePath({
      id: 'p-local',
      name: 'Local',
      path: '/tmp/local',
      createdAt: 1,
      lastActiveAt: 1
    }, false)).toBe('/tmp/local');
  });
});

describe('threadLaunchRemote', () => {
  it('copies store-authorized SSH identity without inventing a host', () => {
    expect(threadLaunchRemote(sshProject)).toEqual({
      host: 'devbox',
      user: 'me',
      remotePath: '/src',
      proxyJump: 'bastion'
    });
    expect(threadLaunchRemote({
      id: 'p-local',
      name: 'Local',
      path: '/tmp/local',
      createdAt: 1,
      lastActiveAt: 1
    })).toBeUndefined();
  });
});
