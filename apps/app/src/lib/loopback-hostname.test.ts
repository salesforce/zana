import { describe, expect, it } from 'vitest';
import { isLoopbackHostname } from './loopback-hostname.js';

describe('isLoopbackHostname', () => {
  it('recognizes localhost, .localhost, and loopback IPs', () => {
    expect(isLoopbackHostname('localhost')).toBe(true);
    expect(isLoopbackHostname('foo.localhost')).toBe(true);
    expect(isLoopbackHostname('127.0.0.1')).toBe(true);
    expect(isLoopbackHostname('[::1]')).toBe(true);
    expect(isLoopbackHostname('::1')).toBe(true);
  });

  it('rejects public and private non-loopback hosts', () => {
    expect(isLoopbackHostname('example.com')).toBe(false);
    expect(isLoopbackHostname('192.168.1.1')).toBe(false);
    expect(isLoopbackHostname('0.0.0.0')).toBe(false);
  });
});
