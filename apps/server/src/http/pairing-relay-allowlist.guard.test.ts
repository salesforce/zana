import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PAIRING_ALLOWLIST, isAllowedHttp, isAllowedWs, resolvePairingTarget } from './pairing-allowlist.js';
import { FLAG, TYPE, decodeFrame, encodeFrame } from './pairing-relay-protocol.js';

const jsonPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../website/relay/allowlist.json'
);

describe('pairing relay allowlist guard', () => {
  it('keeps the laptop allowlist identical to website/relay/allowlist.json', () => {
    const json = JSON.parse(readFileSync(jsonPath, 'utf8')) as typeof PAIRING_ALLOWLIST;
    expect(PAIRING_ALLOWLIST).toEqual(json);
  });

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
    expect(isAllowedHttp('GET', '/_zcc/relay')).toBe(false);
    expect(isAllowedWs('/_zcc/relay')).toBe(false);
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

describe('pairing relay protocol', () => {
  it('round-trips a binary frame', async () => {
    const js = await import('../../../../website/relay/protocol.mjs');
    const payload = Buffer.from('hello-tarball-chunk');
    const ts = encodeFrame(TYPE.HTTP_RES, FLAG.FIN, 42, payload);
    const fromJs = js.encodeFrame(js.TYPE.HTTP_RES, js.FLAG.FIN, 42, payload);
    expect(ts.equals(fromJs)).toBe(true);
    expect(decodeFrame(ts)).toEqual(js.decodeFrame(fromJs));
    expect(decodeFrame(ts)).toMatchObject({ type: TYPE.HTTP_RES, flags: FLAG.FIN, streamId: 42 });
    expect(js.TYPE.HELLO).toBe(TYPE.HELLO);
    expect(js.TYPE.JOIN_RENEW).toBe(TYPE.JOIN_RENEW);
    expect(TYPE.HELLO).toBe(8);
    expect(TYPE.JOIN_RENEW).toBe(9);
  });
});
