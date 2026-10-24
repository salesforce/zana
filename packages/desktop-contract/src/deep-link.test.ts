import { describe, expect, it } from 'vitest';
import {
  DEEP_LINK_MAX_LENGTH,
  DEEP_LINK_MAX_PAYLOAD_LENGTH,
  findDeepLinkInArgv,
  formatDeepLink,
  parseAnyDeepLink,
  parseDeepLink,
  resolveDeepLinkChannel
} from './deep-link.js';

const accept = { acceptSchemes: ['zana', 'zana-dev'] };

describe('parseDeepLink', () => {
  it('parses a plugin link with a nested route and payload', () => {
    const result = parseDeepLink('zana://plugin/design-docs/peer/join?d=abc_-123', accept);
    expect(result).toEqual({
      ok: true,
      link: { scheme: 'zana', pluginId: 'design-docs', route: 'peer/join', payload: 'abc_-123' }
    });
  });

  it('allows a missing payload and normalizes slashes and scheme case', () => {
    const result = parseDeepLink('ZANA://plugin/notes/open/', accept);
    expect(result).toEqual({ ok: true, link: { scheme: 'zana', pluginId: 'notes', route: 'open', payload: null } });
    expect(parseDeepLink('zana://plugin/notes/open?', accept)).toMatchObject({ ok: true, link: { payload: null } });
  });

  it('decodes percent-encoded payloads and round-trips formatDeepLink', () => {
    const link = formatDeepLink('zana://', 'notes', 'open', 'a+b/c=d');
    expect(parseDeepLink(link, accept)).toMatchObject({ ok: true, link: { payload: 'a+b/c=d' } });
  });

  it('rejects a scheme the channel does not accept', () => {
    expect(parseDeepLink('zana-dev://plugin/a/b', { acceptSchemes: ['zana'] })).toEqual({ ok: false, reason: 'wrong-scheme' });
    expect(parseDeepLink('https://plugin/a/b', accept)).toEqual({ ok: false, reason: 'wrong-scheme' });
    expect(parseDeepLink('zana://plugin/a/b', { acceptSchemes: [] })).toEqual({ ok: false, reason: 'wrong-scheme' });
  });

  it.each([
    ['zana://other/a/b', 'malformed'],
    ['zana://plugin', 'malformed'],
    ['zana://plugin/', 'bad-plugin-id'],
    ['zana://plugin/Bad/route', 'bad-plugin-id'],
    ['zana://plugin/a_b/route', 'bad-plugin-id'],
    ['zana://plugin/a/', 'bad-route'],
    ['zana://plugin/a', 'bad-route'],
    ['zana://plugin/a/../b', 'bad-route'],
    ['zana://plugin/a/./b', 'bad-route'],
    ['zana://plugin/a/%2e%2e/b', 'bad-route'],
    ['zana://plugin/a/b//c', 'bad-route'],
    ['zana://plugin/a/B', 'bad-route'],
    ['zana://plugin/a/b#frag', 'malformed'],
    ['zana://plugin/a/b?x=1', 'bad-query'],
    ['zana://plugin/a/b?d=1&d=2', 'bad-query'],
    ['zana://plugin/a/b?d', 'bad-query'],
    ['zana://plugin/a/b?d=a b', 'control-characters'],
    ['zana://plugin/a/b?d=%E0%A4%A', 'bad-encoding'],
    ['zana://plugin/a/b?d=%00', 'bad-encoding'],
    ['zana://plugin/a/b?d=%0A', 'bad-encoding'],
    ['zana://plugin/a/b?d=é', 'bad-query']
  ])('rejects %s (%s)', (raw, reason) => {
    expect(parseDeepLink(raw, accept)).toEqual({ ok: false, reason });
  });

  it('rejects control characters anywhere', () => {
    expect(parseDeepLink('zana://plugin/a/b\n', accept)).toEqual({ ok: false, reason: 'control-characters' });
    expect(parseDeepLink('zana://plugin/a/b\u0000', accept)).toEqual({ ok: false, reason: 'control-characters' });
    expect(parseDeepLink('zana://plugin/a/b\u202e', accept)).toMatchObject({ ok: false });
  });

  it('caps total length and decoded payload length', () => {
    const long = `zana://plugin/a/b?d=${'x'.repeat(DEEP_LINK_MAX_LENGTH)}`;
    expect(parseDeepLink(long, accept)).toEqual({ ok: false, reason: 'too-long' });
    const atCap = `zana://plugin/a/b?d=${'x'.repeat(DEEP_LINK_MAX_PAYLOAD_LENGTH)}`;
    expect(parseDeepLink(atCap, accept)).toMatchObject({ ok: true });
    const over = `zana://plugin/a/b?d=${'x'.repeat(DEEP_LINK_MAX_PAYLOAD_LENGTH + 1)}`;
    expect(parseDeepLink(over, accept)).toEqual({ ok: false, reason: 'payload-too-long' });
  });

  it('never throws on non-string or hostile input', () => {
    for (const hostile of [undefined, null, 5, {}, [], Symbol('x'), () => 1, '\ud800', '%'.repeat(10)]) {
      expect(() => parseDeepLink(hostile, accept)).not.toThrow();
      expect(parseDeepLink(hostile, accept).ok).toBe(false);
    }
    expect(parseDeepLink({}, accept)).toEqual({ ok: false, reason: 'not-a-string' });
  });
});

describe('resolveDeepLinkChannel', () => {
  it('owns the prod scheme when packaged and registers it', () => {
    expect(resolveDeepLinkChannel({ isPackaged: true, env: {} })).toEqual({
      scheme: 'zana',
      acceptSchemes: ['zana'],
      base: 'zana://',
      registerWithOs: true
    });
  });

  it('owns the dev scheme unpackaged and registers only when asked', () => {
    const base = resolveDeepLinkChannel({ isPackaged: false, env: {} });
    expect(base).toMatchObject({ scheme: 'zana-dev', base: 'zana-dev://', registerWithOs: false });
    expect(resolveDeepLinkChannel({ isPackaged: false, env: { ZCC_REGISTER_DEV_PROTOCOL: '1' } }).registerWithOs).toBe(true);
    expect(resolveDeepLinkChannel({ isPackaged: false, env: { ZCC_REGISTER_DEV_PROTOCOL: 'true' } }).registerWithOs).toBe(false);
  });

  it('owns nothing under E2E unless a test scheme is named, and never registers', () => {
    expect(resolveDeepLinkChannel({ isPackaged: false, env: { ZCC_E2E_HOME: '/tmp/h' } })).toEqual({
      scheme: null,
      acceptSchemes: [],
      base: null,
      registerWithOs: false
    });
    const named = resolveDeepLinkChannel({
      isPackaged: true,
      env: { ZCC_E2E_HOME: '/tmp/h', ZCC_E2E_DEEP_LINK_SCHEME: 'Zana-E2E', ZCC_REGISTER_DEV_PROTOCOL: '1' }
    });
    expect(named).toEqual({ scheme: 'zana-e2e', acceptSchemes: ['zana-e2e'], base: 'zana-e2e://', registerWithOs: false });
    expect(resolveDeepLinkChannel({ isPackaged: false, env: { ZCC_E2E_HOME: '/h', ZCC_E2E_DEEP_LINK_SCHEME: 'bad scheme!' } }).scheme).toBeNull();
  });

  it('ignores the E2E scheme override outside E2E', () => {
    expect(resolveDeepLinkChannel({ isPackaged: false, env: { ZCC_E2E_DEEP_LINK_SCHEME: 'evil' } }).scheme).toBe('zana-dev');
  });
});

describe('findDeepLinkInArgv', () => {
  it('finds the first valid link, tolerating Windows quoting', () => {
    expect(findDeepLinkInArgv(['/app', '--flag', '"zana://plugin/a/b?d=1"'], ['zana'])).toBe('zana://plugin/a/b?d=1');
  });

  it('skips invalid and wrong-scheme entries and non-strings', () => {
    expect(findDeepLinkInArgv([1, null, 'zana-dev://plugin/a/b', 'zana://nope', 'x'], ['zana'])).toBeNull();
    expect(findDeepLinkInArgv([], ['zana'])).toBeNull();
  });
});

describe('parseAnyDeepLink', () => {
  it('keeps plugin links working and rejects non-plugin links', () => {
    expect(parseAnyDeepLink('zana://plugin/notes/open?d=x', accept)).toEqual({
      ok: true,
      kind: 'plugin',
      link: { scheme: 'zana', pluginId: 'notes', route: 'open', payload: 'x' }
    });
    expect(parseAnyDeepLink('zana://plugin/Bad_Id/open', accept)).toEqual({ ok: false, reason: 'bad-plugin-id' });
    expect(parseAnyDeepLink('zana://peers/join?d=x', accept)).toEqual({ ok: false, reason: 'malformed' });
  });
});
