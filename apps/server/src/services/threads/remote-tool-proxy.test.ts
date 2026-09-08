import { describe, expect, it } from 'vitest';
import type { Project } from '@zana-ai/zcc-domain/product';
import {
  boundRemoteHostId,
  isRemoteToolProxyActive,
  remoteWorkspacePath,
  resolveHarnessWorkspacePath,
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
  const localProject: Project = {
    id: 'p-local',
    name: 'Local',
    path: '/tmp/local',
    createdAt: 1,
    lastActiveAt: 1
  };
  const sshWithoutPath: Project = {
    ...sshProject,
    remote: { host: 'devbox', user: 'me', proxyJump: 'bastion' }
  };

  it('uses the placeholder on this machine and the remote path on the enrolled host', () => {
    expect(remoteWorkspacePath(sshProject, true)).toBe('/tmp/placeholder');
    expect(remoteWorkspacePath(sshProject, true, '/opt/workspace')).toBe('/tmp/placeholder');
    expect(remoteWorkspacePath(sshProject, false)).toBe('/src');
    expect(remoteWorkspacePath(localProject, false)).toBe('/tmp/local');
  });

  it('lets the per-project remotePath win over the global default', () => {
    expect(remoteWorkspacePath(sshProject, false, '/opt/workspace')).toBe('/src');
  });

  it('falls back to the machine default, then the global remoteDefaultPath', () => {
    expect(remoteWorkspacePath(sshWithoutPath, false, '/opt/workspace', [{
      id: 'h-dev',
      name: 'Devbox',
      isPrimary: false,
      sshHost: 'devbox',
      defaultWorkspacePath: '/home/sfwork/core'
    }])).toBe('/home/sfwork/core');
    expect(remoteWorkspacePath(sshWithoutPath, false, '/opt/workspace')).toBe('/opt/workspace');
    expect(remoteWorkspacePath(sshWithoutPath, false, '  /opt/workspace  ')).toBe('/opt/workspace');
  });

  it('does not use the local placeholder when both remote paths are empty', () => {
    expect(remoteWorkspacePath(sshWithoutPath, false)).toBeNull();
    expect(remoteWorkspacePath(sshWithoutPath, false, '')).toBeNull();
    expect(remoteWorkspacePath(sshWithoutPath, false, '   ')).toBeNull();
  });
});

describe('resolveHarnessWorkspacePath', () => {
  const sshWithoutPath: Project = {
    ...sshProject,
    remote: { host: 'devbox' }
  };

  it('returns the resolved path without probing home', async () => {
    const probeHostHome = async () => {
      throw new Error('should not probe');
    };
    await expect(resolveHarnessWorkspacePath({
      project: sshProject,
      remoteToolProxy: false,
      remoteDefaultPath: '/opt/workspace',
      probeHostHome
    })).resolves.toBe('/src');
    await expect(resolveHarnessWorkspacePath({
      project: sshWithoutPath,
      remoteToolProxy: false,
      remoteDefaultPath: '/opt/workspace',
      probeHostHome
    })).resolves.toBe('/opt/workspace');
    await expect(resolveHarnessWorkspacePath({
      project: {
        id: 'p-local',
        name: 'Local',
        path: '/tmp/local',
        createdAt: 1,
        lastActiveAt: 1
      },
      remoteToolProxy: false,
      probeHostHome
    })).resolves.toBe('/tmp/local');
  });

  it('probes the execution host home when both remote paths are empty', async () => {
    const probeHostHome = async () => '/home/me';
    await expect(resolveHarnessWorkspacePath({
      project: sshWithoutPath,
      remoteToolProxy: false,
      probeHostHome
    })).resolves.toBe('/home/me');
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
    const sshWithoutPath = { ...sshProject, remote: { host: 'devbox', user: 'me', proxyJump: 'bastion' } };
    expect(threadLaunchRemote(sshWithoutPath, '/opt/workspace/core')).toEqual({
      host: 'devbox',
      user: 'me',
      remotePath: '/opt/workspace/core',
      proxyJump: 'bastion'
    });
    expect(threadLaunchRemote(sshWithoutPath, null)).toEqual({
      host: 'devbox',
      user: 'me',
      proxyJump: 'bastion'
    });
  });
});
