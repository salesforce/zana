import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JOIN_TTL_MS,
  isJoinHttp,
  isOriginFormTarget,
  isRelaySessionId,
  mintRelaySessionId,
  pairingSessionServerUrl,
  parseRelaySessionPath,
  resolveJoinTtlMs
} from './session-path.mjs';

describe('relay session path', () => {
  it('mints an unguessable zcrs_ id', () => {
    const id = mintRelaySessionId();
    expect(isRelaySessionId(id)).toBe(true);
    expect(mintRelaySessionId()).not.toBe(id);
  });

  it('parses /t/<id>/… and strips the prefix', () => {
    const id = 'zcrs_abcdefghijklmnopqr1234';
    expect(parseRelaySessionPath(`/t/${id}/install.sh`)).toEqual({
      sessionId: id,
      rest: '/install.sh'
    });
    expect(parseRelaySessionPath(`/t/${id}/internal/hosts/ws`)).toEqual({
      sessionId: id,
      rest: '/internal/hosts/ws'
    });
    expect(parseRelaySessionPath(`/t/${id}`)).toEqual({ sessionId: id, rest: '/' });
    expect(parseRelaySessionPath('/install.sh')).toBeNull();
    expect(parseRelaySessionPath('/t/not-a-session/install.sh')).toBeNull();
  });

  it('keeps an authority override in the stripped remainder so the hub can refuse it', () => {
    const id = 'zcrs_abcdefghijklmnopqr1234';
    const parsed = parseRelaySessionPath(`/t/${id}//127.0.0.1:9/internal/hosts/enroll`);
    expect(parsed?.rest).toBe('//127.0.0.1:9/internal/hosts/enroll');
    expect(isOriginFormTarget(parsed?.rest)).toBe(false);
  });

  it('accepts only origin-form request targets', () => {
    expect(isOriginFormTarget('/install.sh')).toBe(true);
    expect(isOriginFormTarget('/install.sh?next=//evil.example')).toBe(true);
    expect(isOriginFormTarget('//evil.example/internal/hosts/enroll')).toBe(false);
    expect(isOriginFormTarget('/\\evil.example/internal/hosts/enroll')).toBe(false);
    expect(isOriginFormTarget('/\t/evil.example/internal/hosts/enroll')).toBe(false);
    expect(isOriginFormTarget('http://evil.example/internal/hosts/enroll')).toBe(false);
    expect(isOriginFormTarget(undefined)).toBe(false);
  });

  it('classifies join HTTP vs runtime paths', () => {
    expect(isJoinHttp('GET', '/install.sh')).toBe(true);
    expect(isJoinHttp('HEAD', '/install/zcc-host.tgz')).toBe(true);
    expect(isJoinHttp('POST', '/internal/hosts/enroll')).toBe(true);
    expect(isJoinHttp('POST', '/internal/hosts/interactive-request')).toBe(false);
    expect(isJoinHttp('GET', '/internal/hosts/ws')).toBe(false);
  });

  it('builds a session origin and clamps join TTL', () => {
    expect(pairingSessionServerUrl('https://zcc.example/', 'zcrs_abc')).toBe(
      'https://zcc.example/t/zcrs_abc'
    );
    expect(resolveJoinTtlMs({})).toBe(DEFAULT_JOIN_TTL_MS);
    expect(resolveJoinTtlMs({ override: 2_000 })).toBe(2_000);
    expect(resolveJoinTtlMs({ env: { ZCC_RELAY_JOIN_TTL_MS: '9999999' } })).toBe(15 * 60 * 1000);
  });
});
