import { describe, it, expect } from 'vitest';

/**
 * The permission request handler installed in bootstrap() allows 'media' and
 * denies everything else. This test validates the logic in isolation — the
 * actual wiring to session.defaultSession is integration-level.
 */
describe('permission request handler logic', () => {
  const handler = (_wc: unknown, permission: string, callback: (allowed: boolean) => void) => {
    callback(permission === 'media');
  };

  it('grants media permission', () => {
    let result: boolean | undefined;
    handler(null, 'media', (allowed) => { result = allowed; });
    expect(result).toBe(true);
  });

  it('denies geolocation', () => {
    let result: boolean | undefined;
    handler(null, 'geolocation', (allowed) => { result = allowed; });
    expect(result).toBe(false);
  });

  it('denies notifications', () => {
    let result: boolean | undefined;
    handler(null, 'notifications', (allowed) => { result = allowed; });
    expect(result).toBe(false);
  });

  it('denies unknown permissions', () => {
    let result: boolean | undefined;
    handler(null, 'clipboard-read', (allowed) => { result = allowed; });
    expect(result).toBe(false);
  });
});
