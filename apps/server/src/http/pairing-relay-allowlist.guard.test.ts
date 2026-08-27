import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PAIRING_ALLOWLIST, isAllowedHttp, isAllowedWs } from './pairing-allowlist.js';
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

  it('forwards install, enroll, interactive-request, and host ws only', () => {
    expect(isAllowedHttp('GET', '/install.sh')).toBe(true);
    expect(isAllowedHttp('HEAD', '/install/zcc-host.tgz')).toBe(true);
    expect(isAllowedHttp('POST', '/internal/hosts/enroll')).toBe(true);
    expect(isAllowedHttp('POST', '/internal/hosts/interactive-request')).toBe(true);
    expect(isAllowedHttp('POST', '/internal/hosts/interactive-request/interrupt')).toBe(true);
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

describe('pairing relay protocol', () => {
  it('round-trips a binary frame', async () => {
    const js = await import('../../../../website/relay/protocol.mjs');
    const payload = Buffer.from('hello-tarball-chunk');
    const ts = encodeFrame(TYPE.HTTP_RES, FLAG.FIN, 42, payload);
    const fromJs = js.encodeFrame(js.TYPE.HTTP_RES, js.FLAG.FIN, 42, payload);
    expect(ts.equals(fromJs)).toBe(true);
    expect(decodeFrame(ts)).toEqual(js.decodeFrame(fromJs));
    expect(decodeFrame(ts)).toMatchObject({ type: TYPE.HTTP_RES, flags: FLAG.FIN, streamId: 42 });
  });
});
