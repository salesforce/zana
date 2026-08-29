import { describe, expect, it } from 'vitest';
import { rewriteLocalhostLinkHref } from './localhost-link-rewrite-preference.js';

describe('rewriteLocalhostLinkHref', () => {
  it('replaces loopback hosts with the viewer hostname', () => {
    expect(rewriteLocalhostLinkHref({
      currentHostname: 'office.example',
      enabled: true,
      href: 'http://localhost:3000/docs'
    })).toBe('http://office.example:3000/docs');
    expect(rewriteLocalhostLinkHref({
      currentHostname: 'office.example',
      enabled: true,
      href: 'https://127.0.0.1/health'
    })).toBe('https://office.example/health');
  });

  it('leaves href unchanged when disabled, missing, or not loopback', () => {
    expect(rewriteLocalhostLinkHref({
      currentHostname: 'office.example',
      enabled: false,
      href: 'http://localhost:3000/'
    })).toBe('http://localhost:3000/');
    expect(rewriteLocalhostLinkHref({
      currentHostname: 'office.example',
      enabled: true,
      href: 'https://example.test/x'
    })).toBe('https://example.test/x');
    expect(rewriteLocalhostLinkHref({
      currentHostname: undefined,
      enabled: true,
      href: 'http://localhost/'
    })).toBe('http://localhost/');
  });
});
