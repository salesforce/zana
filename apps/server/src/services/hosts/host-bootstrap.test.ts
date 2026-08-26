import { describe, expect, it } from 'vitest';
import {
  HostBootstrapError,
  parseSshIdentity,
  sshRemoteFromProject
} from './host-bootstrap.js';

describe('host bootstrap helpers', () => {
  it('parses a confined SSH identity', () => {
    expect(parseSshIdentity({ host: 'devbox', user: 'me', proxyJump: 'bastion' })).toEqual({
      host: 'devbox',
      user: 'me',
      proxyJump: 'bastion'
    });
  });

  it('rejects a flag-shaped host', () => {
    expect(() => parseSshIdentity({ host: '-oProxyCommand=x' })).toThrow(HostBootstrapError);
  });

  it('reads SSH identity from a remote project record', () => {
    expect(sshRemoteFromProject({
      id: 'p1',
      name: 'Remote',
      path: '/tmp/placeholder',
      createdAt: 1,
      lastActiveAt: 1,
      remote: { host: 'devbox', user: 'me', remotePath: '/home/me/app' }
    })).toEqual({ host: 'devbox', user: 'me', remotePath: '/home/me/app' });
    expect(sshRemoteFromProject({
      id: 'p2',
      name: 'Local',
      path: '/tmp/app',
      createdAt: 1,
      lastActiveAt: 1
    })).toBeNull();
  });
});
