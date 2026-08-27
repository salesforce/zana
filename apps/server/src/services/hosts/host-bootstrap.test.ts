import { describe, expect, it } from 'vitest';
import {
  HostBootstrapError,
  parseSshIdentity,
  requirePublicAppUrl,
  resolveHostBootstrapPlan,
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

  it('reuses a connected enrolled host instead of installing again', () => {
    expect(resolveHostBootstrapPlan({ existing: null, connected: false })).toEqual({ kind: 'install' });
    expect(resolveHostBootstrapPlan({
      existing: { id: 'h-primary', isPrimary: true },
      connected: true
    })).toEqual({ kind: 'install' });
    expect(resolveHostBootstrapPlan({
      existing: { id: 'h-remote', isPrimary: false },
      connected: true
    })).toEqual({ kind: 'bind', hostId: 'h-remote' });
    expect(resolveHostBootstrapPlan({
      existing: { id: 'h-remote', isPrimary: false },
      connected: false
    })).toEqual({ kind: 'repair', hostId: 'h-remote' });
  });

  it('fails with relay_offline when a token is configured but the tunnel is down', () => {
    const ctx = {
      config: { getConfig: () => ({ publicAppUrl: 'https://zcc.herokuapp.com' }) },
      pairingRelay: { state: () => 'offline' as const }
    };
    try {
      requirePublicAppUrl(ctx as never);
      throw new Error('expected relay_offline');
    } catch (error) {
      expect(error).toBeInstanceOf(HostBootstrapError);
      expect(error).toMatchObject({ code: 'relay_offline' });
    }
  });

  it('allows bootstrap against a public origin when the relay is unconfigured', () => {
    const ctx = {
      config: { getConfig: () => ({ publicAppUrl: 'https://box.tailnet.ts.net' }) },
      pairingRelay: { state: () => 'unconfigured' as const }
    };
    expect(requirePublicAppUrl(ctx as never)).toBe('https://box.tailnet.ts.net');
  });

  it('returns the origin when the relay is connected', () => {
    const ctx = {
      config: { getConfig: () => ({ publicAppUrl: 'https://zcc.herokuapp.com' }) },
      pairingRelay: { state: () => 'connected' as const }
    };
    expect(requirePublicAppUrl(ctx as never)).toBe('https://zcc.herokuapp.com');
  });
});
