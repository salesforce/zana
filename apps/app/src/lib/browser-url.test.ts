import { describe, expect, it } from 'vitest';
import {
  getBrowserUrlHost,
  getBrowserUrlSecurity,
  resolveBrowserAddressInput
} from './browser-url.js';

describe('resolveBrowserAddressInput', () => {
  it('returns null for blank input', () => {
    expect(resolveBrowserAddressInput('')).toBeNull();
    expect(resolveBrowserAddressInput('   ')).toBeNull();
  });

  it('preserves an explicit http(s) URL', () => {
    expect(resolveBrowserAddressInput('https://example.com')).toBe('https://example.com');
    expect(resolveBrowserAddressInput('  http://example.com/x  ')).toBe('http://example.com/x');
  });

  it('prepends https:// to a public bare host', () => {
    expect(resolveBrowserAddressInput('example.com')).toBe('https://example.com');
    expect(resolveBrowserAddressInput('example.com:8080/path')).toBe('https://example.com:8080/path');
    expect(resolveBrowserAddressInput('8.8.8.8')).toBe('https://8.8.8.8');
  });

  it('prepends http:// to bare localhost and loopback inputs', () => {
    expect(resolveBrowserAddressInput('localhost:5173')).toBe('http://localhost:5173');
    expect(resolveBrowserAddressInput('foo.localhost')).toBe('http://foo.localhost');
    expect(resolveBrowserAddressInput('127.0.0.1:3000/path')).toBe('http://127.0.0.1:3000/path');
    expect(resolveBrowserAddressInput('[::1]:5173')).toBe('http://[::1]:5173');
  });

  it('builds a search URL for non-URL input', () => {
    expect(resolveBrowserAddressInput('hello world')).toBe(
      'https://www.google.com/search?q=hello%20world'
    );
  });

  it('routes a non-http scheme to search rather than navigating to it', () => {
    expect(resolveBrowserAddressInput('javascript:alert(1)')).toBe(
      'https://www.google.com/search?q=javascript%3Aalert(1)'
    );
    expect(resolveBrowserAddressInput('file:///etc/passwd')).toBe(
      'https://www.google.com/search?q=file%3A%2F%2F%2Fetc%2Fpasswd'
    );
  });

  it('routes blocked local hosts to search rather than navigating to them', () => {
    expect(resolveBrowserAddressInput('192.168.1.12:3000')).toBe(
      'https://www.google.com/search?q=192.168.1.12%3A3000'
    );
    expect(resolveBrowserAddressInput('0.0.0.0:5173')).toBe(
      'https://www.google.com/search?q=0.0.0.0%3A5173'
    );
  });
});

describe('getBrowserUrlSecurity', () => {
  it('classifies the scheme', () => {
    expect(getBrowserUrlSecurity('https://example.com')).toBe('secure');
    expect(getBrowserUrlSecurity('http://example.com')).toBe('insecure');
    expect(getBrowserUrlSecurity('')).toBe('none');
    expect(getBrowserUrlSecurity('not a url')).toBe('none');
  });
});

describe('getBrowserUrlHost', () => {
  it('returns the host for a parseable URL', () => {
    expect(getBrowserUrlHost('https://news.ycombinator.com/item?id=1')).toBe('news.ycombinator.com');
  });

  it('falls back to the raw value when unparseable', () => {
    expect(getBrowserUrlHost('')).toBe('');
    expect(getBrowserUrlHost('not a url')).toBe('not a url');
  });
});
