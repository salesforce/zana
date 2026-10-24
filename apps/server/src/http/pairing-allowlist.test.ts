import { describe, expect, it } from 'vitest';
import { PAIRING_ALLOWLIST, PEER_LINK_ALLOWLIST, isAllowedHttp, isAllowedWs, resolvePairingTarget } from './pairing-allowlist.js';

describe('pairing allowlist', () => {
  it('forwards install and the complete authenticated host callback surface', () => {
    expect(isAllowedHttp('GET', '/install.sh')).toBe(true);
    expect(isAllowedHttp('HEAD', '/install/zcc-host.tgz')).toBe(true);
    expect(isAllowedHttp('POST', '/internal/hosts/enroll')).toBe(true);
    expect(isAllowedHttp('POST', '/internal/hosts/interactive-request')).toBe(true);
    expect(isAllowedHttp('POST', '/internal/hosts/interactive-request/interrupt')).toBe(true);
    expect(isAllowedHttp('GET', `/internal/plugins/provider-acp/host/${'ab'.repeat(32)}`)).toBe(true);
    expect(isAllowedHttp('POST', '/internal/hosts/tool-call')).toBe(true);
    expect(isAllowedHttp('POST', '/internal/hosts/cli-callback')).toBe(true);
    expect(isAllowedHttp('GET', '/internal/hosts/cli-callback')).toBe(false);
    expect(isAllowedWs('/internal/hosts/ws')).toBe(true);
    expect(isAllowedWs('/internal/hosts/ws/')).toBe(true);
  });

  it('rejects product HTTP and the laptop control channel as forwarded paths', () => {
    expect(isAllowedHttp('GET', '/api/v1/config')).toBe(false);
    expect(isAllowedHttp('GET', '/ws')).toBe(false);
    expect(isAllowedWs('/ws')).toBe(false);
    expect(isAllowedHttp('POST', '/install.sh')).toBe(false);
  });
});

describe('resolvePairingTarget', () => {
  const origin = 'http://127.0.0.1:8781';

  it('pins origin-form targets to the product origin and keeps the query', () => {
    const target = resolvePairingTarget('/internal/hosts/enroll?x=1', origin);
    expect(target?.url.toString()).toBe('http://127.0.0.1:8781/internal/hosts/enroll?x=1');
    expect(target?.path).toBe('/internal/hosts/enroll');
    expect(resolvePairingTarget('/internal/hosts/ws/', origin)?.path).toBe('/internal/hosts/ws');
  });

  it('rejects authority-bearing, backslash, absolute, and control-character targets', () => {
    for (const bad of [
      '//127.0.0.1:9999/internal/hosts/enroll',
      '///127.0.0.1:9999/internal/hosts/enroll',
      '/\\127.0.0.1:9999/internal/hosts/enroll',
      '/\\/127.0.0.1/internal/hosts/enroll',
      '/internal\\hosts/enroll',
      'http://127.0.0.1:9999/internal/hosts/enroll',
      'internal/hosts/enroll',
      '/\t/127.0.0.1:9999/internal/hosts/enroll',
      '/internal/hosts/enroll\n',
      '',
      undefined,
      42
    ]) {
      expect(resolvePairingTarget(bad, origin), String(bad)).toBeNull();
    }
  });

  it('resolves dot segments so the allowlist sees the destination path', () => {
    const target = resolvePairingTarget('/internal/hosts/enroll/../../../api/terminals', origin);
    expect(target?.url.origin).toBe(origin);
    expect(target?.path).toBe('/api/terminals');
    expect(isAllowedHttp('POST', target!.path)).toBe(false);
    const encoded = resolvePairingTarget('/internal/hosts/enroll/%2e%2e/%2e%2e/%2e%2e/api/terminals', origin);
    expect(encoded?.path).toBe('/api/terminals');
  });

  it('allows a query string that contains slashes', () => {
    expect(resolvePairingTarget('/install.sh?next=//evil.example/x', origin)?.url.host).toBe('127.0.0.1:8781');
  });
});

describe('peer link allowlist', () => {
  it('stays a strict, separate subset of the pairing surface', () => {
    expect(PEER_LINK_ALLOWLIST.http).toEqual([{ methods: ['POST'], path: '/internal/hosts/enroll' }]);
    expect(PEER_LINK_ALLOWLIST.ws).toEqual(['/internal/hosts/ws']);
    expect(PEER_LINK_ALLOWLIST).not.toBe(PAIRING_ALLOWLIST);
    expect(isAllowedHttp('POST', '/internal/hosts/enroll', PEER_LINK_ALLOWLIST)).toBe(true);
    expect(isAllowedHttp('GET', '/internal/hosts/enroll', PEER_LINK_ALLOWLIST)).toBe(false);
    expect(isAllowedHttp('GET', '/install.sh', PEER_LINK_ALLOWLIST)).toBe(false);
    expect(isAllowedHttp('POST', '/internal/hosts/tool-call', PEER_LINK_ALLOWLIST)).toBe(false);
    expect(isAllowedWs('/internal/hosts/ws', PEER_LINK_ALLOWLIST)).toBe(true);
    expect(isAllowedWs('/ws', PEER_LINK_ALLOWLIST)).toBe(false);
  });

  it('supports pattern rows in a supplied list', () => {
    const list = { http: [{ methods: ['GET'], pathPattern: '^/x/[a-z]+$' }], ws: [] };
    expect(isAllowedHttp('GET', '/x/abc', list)).toBe(true);
    expect(isAllowedHttp('GET', '/x/ABC', list)).toBe(false);
    expect(isAllowedHttp('GET', '/y', { http: [{ methods: ['GET'] }], ws: [] })).toBe(false);
  });
});
