import { describe, it, expect, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import {
  PermissionBroker,
  PermissionDenied,
  grantFromManifest,
  type GrantProvider
} from '../permission-broker.js';

const EXT_DIR = join(tmpdir(), 'cc-ext-perm', 'alpha');

function brokerWith(provider: GrantProvider, builtins: string[] = ['slack']) {
  const audit = vi.fn();
  const broker = new PermissionBroker({
    builtinIds: new Set(builtins),
    grants: provider,
    audit
  });
  return { broker, audit };
}

/** A disk ext that declares process-spawn(sf,git) + fs:read/write + net(api.x). */
function alphaGrant() {
  return grantFromManifest(
    ['exec', 'fs:read', 'fs:write', 'net'],
    {
      execAllowlist: ['sf', 'git'],
      fsRoots: [join(EXT_DIR, 'data')],
      egressAllowlist: ['api.example.com']
    },
    EXT_DIR
  );
}

describe('PermissionBroker — deny-by-default', () => {
  it('built-ins are always allowed and bypass the grant provider', () => {
    const provider = vi.fn(() => null);
    const { broker } = brokerWith(provider);
    expect(broker.can('slack', 'exec', { kind: 'exec', bin: 'rm' })).toBe(true);
    expect(broker.isBuiltin('slack')).toBe(true);
    expect(provider).not.toHaveBeenCalled();
  });

  it('an unknown disk ext (no grant) is denied everything', () => {
    const { broker } = brokerWith(() => null);
    expect(broker.can('ghost', 'storage')).toBe(false);
    expect(broker.can('ghost', 'inbox:push')).toBe(false);
  });

  it('a declared permission is allowed; an undeclared one is denied', () => {
    const grant = grantFromManifest(['inbox:push'], undefined, EXT_DIR);
    const { broker } = brokerWith((id) => (id === 'alpha' ? grant : null));
    expect(broker.can('alpha', 'inbox:push')).toBe(true);
    expect(broker.can('alpha', 'session:launch')).toBe(false);
    expect(broker.can('alpha', 'exec', { kind: 'exec', bin: 'sf' })).toBe(false);
  });

  it('process-spawn is gated by the bin allowlist; a path/shell bin is rejected', () => {
    const { broker } = brokerWith((id) => (id === 'alpha' ? alphaGrant() : null));
    expect(broker.can('alpha', 'exec', { kind: 'exec', bin: 'sf' })).toBe(true);
    expect(broker.can('alpha', 'exec', { kind: 'exec', bin: 'git' })).toBe(true);
    expect(broker.can('alpha', 'exec', { kind: 'exec', bin: 'rm' })).toBe(false);
    expect(broker.can('alpha', 'exec', { kind: 'exec', bin: '/bin/sf' })).toBe(false);
    expect(broker.can('alpha', 'exec', { kind: 'exec', bin: '../sf' })).toBe(false);
  });

  it('execAllowlist "*" grants any bin BUT the basename guard still holds', () => {
    const grant = grantFromManifest(['exec'], { execAllowlist: ['*'] }, EXT_DIR);
    const { broker } = brokerWith((id) => (id === 'alpha' ? grant : null));
    // Any basename is allowed under the wildcard.
    expect(broker.can('alpha', 'exec', { kind: 'exec', bin: 'sf' })).toBe(true);
    expect(broker.can('alpha', 'exec', { kind: 'exec', bin: 'rm' })).toBe(true);
    expect(broker.can('alpha', 'exec', { kind: 'exec', bin: 'anything' })).toBe(true);
    // The wildcard widens WHICH bins, never HOW they're named: a path or a
    // shell-ish string is STILL rejected (no `sh -c` injection via `*`).
    expect(broker.can('alpha', 'exec', { kind: 'exec', bin: '/bin/rm' })).toBe(false);
    expect(broker.can('alpha', 'exec', { kind: 'exec', bin: '../rm' })).toBe(false);
    // And a bare `exec` with NO allowlist still denies everything (deny-by-default).
    const noScope = grantFromManifest(['exec'], undefined, EXT_DIR);
    const { broker: b2 } = brokerWith((id) => (id === 'alpha' ? noScope : null));
    expect(b2.can('alpha', 'exec', { kind: 'exec', bin: 'sf' })).toBe(false);
  });

  it('egressAllowlist "*" grants any host; no allowlist denies all', () => {
    const grant = grantFromManifest(['net'], { egressAllowlist: ['*'] }, EXT_DIR);
    const { broker } = brokerWith((id) => (id === 'alpha' ? grant : null));
    expect(broker.can('alpha', 'net', { kind: 'net', host: 'api.example.com' })).toBe(true);
    expect(broker.can('alpha', 'net', { kind: 'net', host: 'anything.evil.com' })).toBe(true);
    const noScope = grantFromManifest(['net'], undefined, EXT_DIR);
    const { broker: b2 } = brokerWith((id) => (id === 'alpha' ? noScope : null));
    expect(b2.can('alpha', 'net', { kind: 'net', host: 'api.example.com' })).toBe(false);
  });

  it('fs is scoped to granted roots + the ext dir; traversal is rejected', () => {
    const { broker } = brokerWith((id) => (id === 'alpha' ? alphaGrant() : null));
    expect(broker.can('alpha', 'fs:read', { kind: 'fs', path: join(EXT_DIR, 'data', 'x.json') })).toBe(true);
    expect(broker.can('alpha', 'fs:read', { kind: 'fs', path: join(EXT_DIR, 'bundle.js') })).toBe(true);
    expect(broker.can('alpha', 'fs:read', { kind: 'fs', path: '/etc/passwd' })).toBe(false);
    expect(
      broker.can('alpha', 'fs:read', { kind: 'fs', path: join(EXT_DIR, 'data', '..', '..', 'evil') })
    ).toBe(false);
    expect(broker.can('alpha', 'fs:read', { kind: 'fs', path: 'data/x.json' })).toBe(false);
  });

  it('fs:write never touches a sensitive root even if a granted root would cover it', () => {
    const grant = grantFromManifest(['fs:read', 'fs:write'], { fsRoots: [homedir()] }, EXT_DIR);
    const { broker } = brokerWith((id) => (id === 'alpha' ? grant : null));
    const sshKey = resolve(homedir(), '.ssh', 'id_rsa');
    expect(broker.can('alpha', 'fs:read', { kind: 'fs', path: sshKey })).toBe(true);
    expect(broker.can('alpha', 'fs:write', { kind: 'fs', path: sshKey })).toBe(false);
    const ccFile = resolve(homedir(), '.zcc', 'config.json');
    expect(broker.can('alpha', 'fs:write', { kind: 'fs', path: ccFile })).toBe(false);
    const devFile = resolve(homedir(), '.zcc-dev', 'config.json');
    expect(broker.can('alpha', 'fs:write', { kind: 'fs', path: devFile })).toBe(false);
  });

  it('fs:write is blocked for ZCC_DATA_DIR even when that root is granted', () => {
    const extra = join(tmpdir(), `zcc-custom-data-${process.pid}`);
    mkdirSync(extra, { recursive: true });
    const prev = process.env.ZCC_DATA_DIR;
    process.env.ZCC_DATA_DIR = extra;
    try {
      const grant = grantFromManifest(
        ['fs:read', 'fs:write'],
        { fsRoots: [homedir(), extra] },
        EXT_DIR
      );
      const { broker } = brokerWith((id) => (id === 'alpha' ? grant : null));
      expect(broker.can('alpha', 'fs:write', { kind: 'fs', path: join(extra, 'config.json') })).toBe(
        false
      );
    } finally {
      if (prev === undefined) delete process.env.ZCC_DATA_DIR;
      else process.env.ZCC_DATA_DIR = prev;
    }
  });

  // 0.4: the sensitive-root blocklist now also covers provider auth/session
  // caches — a granted `~`-wide fsRoot must not let a disk ext tamper with them.
  it('fs:write is blocked for the provider auth/session roots (0.4)', () => {
    const grant = grantFromManifest(['fs:read', 'fs:write'], { fsRoots: [homedir()] }, EXT_DIR);
    const { broker } = brokerWith((id) => (id === 'alpha' ? grant : null));
    const codexAuth = resolve(homedir(), '.codex', 'auth.json');
    const gcloud = resolve(homedir(), '.config', 'gcloud', 'credentials.db');
    const claudeSession = resolve(homedir(), '.claude', 'sessions', 'x.json');
    for (const p of [codexAuth, gcloud, claudeSession]) {
      expect(broker.can('alpha', 'fs:write', { kind: 'fs', path: p })).toBe(false);
    }
  });

  it('net is gated by the egress host allowlist (case-insensitive)', () => {
    const { broker } = brokerWith((id) => (id === 'alpha' ? alphaGrant() : null));
    expect(broker.can('alpha', 'net', { kind: 'net', host: 'api.example.com' })).toBe(true);
    expect(broker.can('alpha', 'net', { kind: 'net', host: 'API.EXAMPLE.COM' })).toBe(true);
    expect(broker.can('alpha', 'net', { kind: 'net', host: 'evil.com' })).toBe(false);
  });

  it('stream is gated by the endpoint-handle allowlist; an off-allowlist handle is denied', () => {
    const grant = grantFromManifest(
      ['stream'],
      { streamAllowlist: ['service.events'] },
      EXT_DIR
    );
    const { broker } = brokerWith((id) => (id === 'alpha' ? grant : null));
    expect(broker.can('alpha', 'stream', { kind: 'stream', endpoint: 'service.events' })).toBe(true);
    expect(broker.can('alpha', 'stream', { kind: 'stream', endpoint: 'service.other' })).toBe(false);
    // Bare `stream` with NO allowlist denies everything (deny-by-default).
    const noScope = grantFromManifest(['stream'], undefined, EXT_DIR);
    const { broker: b2 } = brokerWith((id) => (id === 'alpha' ? noScope : null));
    expect(b2.can('alpha', 'stream', { kind: 'stream', endpoint: 'service.events' })).toBe(false);
    // An ext that never declared `stream` is denied regardless of allowlist.
    const noPerm = grantFromManifest([], { streamAllowlist: ['service.events'] }, EXT_DIR);
    const { broker: b3 } = brokerWith((id) => (id === 'alpha' ? noPerm : null));
    expect(b3.can('alpha', 'stream', { kind: 'stream', endpoint: 'service.events' })).toBe(false);
  });

  it('streamAllowlist "*" grants any endpoint handle; no allowlist denies all', () => {
    const grant = grantFromManifest(['stream'], { streamAllowlist: ['*'] }, EXT_DIR);
    const { broker } = brokerWith((id) => (id === 'alpha' ? grant : null));
    expect(broker.can('alpha', 'stream', { kind: 'stream', endpoint: 'service.events' })).toBe(true);
    expect(broker.can('alpha', 'stream', { kind: 'stream', endpoint: 'anything' })).toBe(true);
  });

  it('assert throws PermissionDenied on a denied check and audits both outcomes', () => {
    const { broker, audit } = brokerWith((id) => (id === 'alpha' ? alphaGrant() : null));
    broker.assert('alpha', 'exec', { kind: 'exec', bin: 'sf' });
    expect(() => broker.assert('alpha', 'exec', { kind: 'exec', bin: 'rm' })).toThrow(PermissionDenied);
    const outcomes = audit.mock.calls.map((c) => c[0].allow);
    expect(outcomes).toContain(true);
    expect(outcomes).toContain(false);
  });
});

describe('grantFromManifest — P3-D seam shape', () => {
  it('granted == declared today; the ext dir is always an fs root', () => {
    const grant = grantFromManifest(['storage', 'net'], { egressAllowlist: ['A.com'] }, EXT_DIR);
    expect(grant.permissions.has('storage')).toBe(true);
    expect(grant.permissions.has('net')).toBe(true);
    expect(grant.permissions.has('exec')).toBe(false);
    expect(grant.fsRoots).toContain(resolve(EXT_DIR));
    expect([...grant.egressAllowlist]).toEqual(['a.com']);
  });

  it('expands a ~-prefixed fsRoot to the home dir', () => {
    const grant = grantFromManifest(['fs:read'], { fsRoots: ['~/work'] }, EXT_DIR);
    expect(grant.fsRoots).toContain(resolve(homedir(), 'work'));
  });
});
