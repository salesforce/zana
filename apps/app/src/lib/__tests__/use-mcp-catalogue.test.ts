import { describe, expect, it } from 'vitest';
import { catalogueName, catalogueServer } from '../use-mcp-catalogue.js';

describe('catalogueName', () => {
  it('strips the plugin/extension key prefix down to the server name', () => {
    expect(catalogueName({ key: 'plugin:acme:search', source: 'plugin' })).toBe('search');
    expect(catalogueName({ key: 'ext:acme:search', source: 'extension' })).toBe('search');
  });

  it('keeps a user or project server name whole, even when it contains a colon', () => {
    expect(catalogueName({ key: 'corp:github', source: 'user' })).toBe('corp:github');
    expect(catalogueName({ key: 'service:internal', source: 'project' })).toBe('service:internal');
  });

  it('feeds catalogueServer, which also carries availability and a reason', () => {
    expect(catalogueServer({ key: 'corp:github', source: 'user', available: false, reason: 'not-carried' })).toEqual({
      key: 'corp:github', source: 'user', name: 'corp:github', available: false, reason: 'not-carried'
    });
  });
});
