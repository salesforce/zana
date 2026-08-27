import { describe, expect, it } from 'vitest';
import { defaultCliAlias, parseCliVersion, parseOrgDisplay, parseOrgList } from '../lib/sf-cli.js';

describe('sf CLI parsers', () => {
  it('parses org list buckets without exposing tokens', () => {
    const listed = parseOrgList(
      JSON.stringify({
        result: {
          nonScratchOrgs: [
            {
              alias: 'prod',
              username: 'a@example.com',
              isDefaultUsername: true,
              isSandbox: false,
              isScratch: false,
              instanceUrl: 'https://org.my.salesforce.com'
            }
          ],
          scratchOrgs: [{ alias: 'scratch', username: 's@example.com', isScratch: true }]
        }
      })
    );
    expect(listed).toEqual([
      { alias: 'prod', username: 'a@example.com', kind: 'production', isDefault: true },
      { alias: 'scratch', username: 's@example.com', kind: 'scratch', isDefault: false }
    ]);
    expect(defaultCliAlias(listed)).toBe('prod');
  });

  it('parses org display and keeps the token only on the resolved org object', () => {
    const org = parseOrgDisplay(
      JSON.stringify({
        result: {
          alias: 'sandbox',
          username: 'dev@example.com',
          orgId: '00Dxx0000000001',
          instanceUrl: 'https://foo--dev.sandbox.my.salesforce.com/',
          accessToken: 'SECRET',
          apiVersion: '62.0',
          isSandbox: true,
          isScratchOrg: false
        }
      }),
      'fallback',
      '61.0'
    );
    expect(org?.accessToken).toBe('SECRET');
    expect(org?.instanceUrl).toBe('https://foo--dev.sandbox.my.salesforce.com');
    expect(org?.kind).toBe('sandbox');
    expect(JSON.stringify(org)).toContain('SECRET');
  });

  it('parses a top-level result array', () => {
    const listed = parseOrgList(JSON.stringify({ result: [{ username: 'a@x.com', alias: 'a' }] }));
    expect(listed[0]?.username).toBe('a@x.com');
    expect(parseOrgList('{"result":[null, 3, {"alias":""}]}')).toEqual([]);
    expect(parseOrgList('[]')).toEqual([]);
  });

  it('returns null when display JSON is missing credentials', () => {
    expect(parseOrgDisplay('{"result":{"username":"x"}}', 'a', '62.0')).toBeNull();
    expect(parseOrgDisplay('not-json', 'a', '62.0')).toBeNull();
  });

  it('parses CLI version from the first line', () => {
    expect(parseCliVersion('@salesforce/cli/2.50.0 darwin-arm64 node-v22\nmore\n')).toBe(
      '@salesforce/cli/2.50.0 darwin-arm64 node-v22'
    );
    expect(parseCliVersion('')).toBeNull();
  });
});
