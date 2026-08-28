import { describe, expect, it } from 'vitest';
import type { Project } from '@zana-ai/zcc-domain/product';
import { isRemoteToolProxyActive, remoteWorkspacePath, threadLaunchRemote } from './remote-tool-proxy.js';

const sshProject: Project = {
  id: 'p-ssh',
  name: 'Remote app',
  path: '/tmp/placeholder',
  createdAt: 1,
  lastActiveAt: 1,
  remote: { host: 'devbox', user: 'me', remotePath: '/src', proxyJump: 'bastion' }
};

describe('isRemoteToolProxyActive', () => {
  it('is on for an unbound SSH project', () => {
    expect(isRemoteToolProxyActive(sshProject)).toBe(true);
    expect(isRemoteToolProxyActive(sshProject, 'h-primary')).toBe(true);
  });

  it('is on when a bound SSH project still runs on this machine', () => {
    expect(isRemoteToolProxyActive({ ...sshProject, hostId: 'h-enrolled' })).toBe(true);
    expect(isRemoteToolProxyActive({ ...sshProject, hostId: 'h-enrolled' }, 'h-primary')).toBe(true);
  });

  it('is off when executing on the enrolled host or when the project is local', () => {
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
