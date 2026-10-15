import { describe, expect, it } from 'vitest';
import { fetchHeadersToPairs, headerPairsToRecord, isStrippedPairingHeader, loopbackHostHeader } from './pairing-headers.js';

describe('pairing-headers', () => {
  it('strips hop-by-hop and forwarding headers case-insensitively', () => {
    for (const name of ['Connection', 'Host', 'ORIGIN', 'X-Forwarded-For', 'Forwarded', 'Transfer-Encoding']) {
      expect(isStrippedPairingHeader(name)).toBe(true);
    }
    expect(isStrippedPairingHeader('content-type')).toBe(false);
  });

  it('formats the pinned loopback host for IPv4 and IPv6', () => {
    expect(loopbackHostHeader(8780)).toBe('127.0.0.1:8780');
    expect(loopbackHostHeader(8780, '::1')).toBe('[::1]:8780');
  });

  it('pins host, drops stripped headers, and joins duplicates', () => {
    const record = headerPairsToRecord(
      [['Host', 'evil.test'], ['x-real-ip', '1.2.3.4'], ['accept', 'a'], ['accept', 'b'], ['', 'x']],
      '127.0.0.1:1'
    );
    expect({ ...record }).toEqual({ host: '127.0.0.1:1', accept: 'a, b' });
  });

  it('drops headers nominated by Connection', () => {
    const record = headerPairsToRecord(
      [['Connection', 'close, X-Secret-Hop'], ['x-secret-hop', '1'], ['x-keep', '2']],
      'h:1'
    );
    expect({ ...record }).toEqual({ host: 'h:1', 'x-keep': '2' });
  });

  it('uses a null-prototype record', () => {
    const record = headerPairsToRecord([['__proto__', 'x']], 'h:1');
    expect(Object.getPrototypeOf(record)).toBeNull();
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it('filters response headers', () => {
    const pairs = fetchHeadersToPairs(new Headers({ 'content-type': 'text/plain', 'keep-alive': 'timeout=5' }));
    expect(pairs).toEqual([['content-type', 'text/plain']]);
  });
});
