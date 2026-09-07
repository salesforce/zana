import { describe, expect, it } from 'vitest';
import {
  defaultCliAlias,
  isUsableAccessToken,
  parseAccessToken,
  parseCliVersion,
  parseOrgDisplay,
  parseOrgList
} from '../lib/sf-cli.js';

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
      {
        alias: 'prod',
        username: 'a@example.com',
        kind: 'production',
        isDefault: true,
        orgId: '',
        instanceUrl: 'https://org.my.salesforce.com',
        connectedStatus: ''
      },
      {
        alias: 'scratch',
        username: 's@example.com',
        kind: 'scratch',
        isDefault: false,
        orgId: '',
        instanceUrl: '',
        connectedStatus: ''
      }
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

  it('dedupes the same username across CLI buckets and keeps default/id', () => {
    const listed = parseOrgList(
      JSON.stringify({
        result: {
          nonScratchOrgs: [
            { alias: 'prod', username: 'a@example.com', orgId: '00Daa', instanceUrl: 'https://org.my.salesforce.com' }
          ],
          devHubs: [
            {
              alias: 'prod',
              username: 'a@example.com',
              isDefaultDevHubUsername: true,
              isSandbox: false,
              isScratch: false
            }
          ]
        }
      })
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      alias: 'prod',
      username: 'a@example.com',
      isDefault: true,
      orgId: '00Daa',
      kind: 'production'
    });
  });

  it('returns null when display JSON is missing credentials', () => {
    expect(parseOrgDisplay('{"result":{"username":"x"}}', 'a', '62.0')).toBeNull();
    expect(parseOrgDisplay('not-json', 'a', '62.0')).toBeNull();
  });

  it('parses org display without a usable token after CLI secret redaction', () => {
    const org = parseOrgDisplay(
      JSON.stringify({
        result: {
          alias: 'gus',
          username: 'dev@example.com',
          instanceUrl: 'https://gus.my.salesforce.com',
          accessToken: "[REDACTED] Use 'sf org auth show-access-token' to view"
        }
      }),
      'gus',
      '62.0'
    );
    expect(org?.username).toBe('dev@example.com');
    expect(org?.instanceUrl).toBe('https://gus.my.salesforce.com');
    expect(org?.accessToken).toBe('');
    expect(isUsableAccessToken(org?.accessToken ?? '')).toBe(false);
  });

  it('normalizes Bearer-prefixed tokens and rejects redacted CLI secrets', () => {
    expect(isUsableAccessToken('TOKEN')).toBe(true);
    expect(isUsableAccessToken("[REDACTED] Use 'sf org auth show-access-token' to view")).toBe(false);
    expect(isUsableAccessToken('')).toBe(false);
    expect(parseAccessToken(JSON.stringify({ result: { accessToken: '00Dxx!AQEA' } }))).toBe('00Dxx!AQEA');
    expect(parseAccessToken(JSON.stringify({ result: { accessToken: 'Bearer 00Dxx!AQEA' } }))).toBe('00Dxx!AQEA');
    expect(parseAccessToken(JSON.stringify({ result: '00Dxx!AQEA' }))).toBe('00Dxx!AQEA');
    expect(parseAccessToken(JSON.stringify({ result: { accessToken: '[REDACTED] hidden' } }))).toBeNull();
    expect(parseAccessToken('{"result":{}}')).toBeNull();
    expect(parseAccessToken('not-json')).toBeNull();
  });

  it('parses CLI version from the first line', () => {
    expect(parseCliVersion('@salesforce/cli/2.50.0 darwin-arm64 node-v22\nmore\n')).toBe(
      '@salesforce/cli/2.50.0 darwin-arm64 node-v22'
    );
    expect(parseCliVersion('')).toBeNull();
  });
});
