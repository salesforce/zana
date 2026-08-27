import { describe, expect, it } from 'vitest';
import { PAIRING_ALLOWLIST, isAllowedHttp, isAllowedWs, normalizePairingPath } from './allowlist.mjs';

describe('pairing allowlist', () => {
  it('includes interactive-request so enrolled daemons can post approvals', () => {
    expect(PAIRING_ALLOWLIST.http.map((row) => row.path)).toEqual([
      '/install.sh',
      '/install/version',
      '/install/zcc-host.tgz',
      '/internal/hosts/enroll',
      '/internal/hosts/interactive-request',
      '/internal/hosts/interactive-request/interrupt'
    ]);
    expect(isAllowedHttp('POST', '/internal/hosts/interactive-request')).toBe(true);
    expect(isAllowedWs('/internal/hosts/ws/')).toBe(true);
  });

  it('rejects product API and the laptop control channel', () => {
    expect(isAllowedHttp('GET', '/api/v1/config')).toBe(false);
    expect(isAllowedWs('/_zcc/relay')).toBe(false);
    expect(normalizePairingPath('/install.sh/')).toBe('/install.sh');
  });
});
