import { describe, expect, it } from 'vitest';
import type { Project } from '@zana-ai/zcc-domain/product';
import { isRemoteToolProxyActive, threadLaunchRemote } from './remote-tool-proxy.js';

const sshProject: Project = {
  id: 'p-ssh',
  name: 'Remote app',
  path: '/tmp/placeholder',
  createdAt: 1,
  lastActiveAt: 1,
  remote: { host: 'devbox', user: 'me', remotePath: '/src', proxyJump: 'bastion' }
};

describe('isRemoteToolProxyActive', () => {
  it('is on only for an unbound SSH project with the setting true', () => {
    expect(isRemoteToolProxyActive(sshProject, { remoteToolProxy: true })).toBe(true);
  });

  it('is off by default, when bound to a host, or when the project is local', () => {
    expect(isRemoteToolProxyActive(sshProject, {})).toBe(false);
    expect(isRemoteToolProxyActive(sshProject, { remoteToolProxy: false })).toBe(false);
    expect(isRemoteToolProxyActive({ ...sshProject, hostId: 'h-enrolled' }, { remoteToolProxy: true })).toBe(false);
    expect(isRemoteToolProxyActive({
      id: 'p-local',
      name: 'Local',
      path: '/tmp/local',
      createdAt: 1,
      lastActiveAt: 1
    }, { remoteToolProxy: true })).toBe(false);
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
