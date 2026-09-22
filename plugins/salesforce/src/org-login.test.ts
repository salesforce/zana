import { describe, expect, it } from 'vitest';
import {
  ORG_LOGIN_INSTANCE_URLS,
  orgLoginArgs,
  parseOrgLoginInput,
  SF_ORG_LOGIN_TIMEOUT_MS
} from '../lib/org-login.js';

describe('org login helpers', () => {
  it('defaults to production and omits a blank alias', () => {
    const parsed = parseOrgLoginInput({});
    expect(parsed).toEqual({
      ok: true,
      instance: 'production',
      instanceUrl: ORG_LOGIN_INSTANCE_URLS.production,
      alias: null
    });
    expect(orgLoginArgs(parsed as Extract<typeof parsed, { ok: true }>)).toEqual([
      'org',
      'login',
      'web',
      '--json',
      '--instance-url',
      'https://login.salesforce.com'
    ]);
  });

  it('builds sandbox login argv with an alias', () => {
    const parsed = parseOrgLoginInput({ instance: 'sandbox', alias: 'dev' });
    expect(parsed).toMatchObject({ ok: true, instance: 'sandbox', alias: 'dev' });
    expect(orgLoginArgs(parsed as Extract<typeof parsed, { ok: true }>)).toEqual([
      'org',
      'login',
      'web',
      '--json',
      '--instance-url',
      'https://test.salesforce.com',
      '--alias',
      'dev'
    ]);
  });

  it('rejects unknown instances and path-like aliases', () => {
    expect(parseOrgLoginInput({ instance: 'custom' })).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(parseOrgLoginInput({ alias: '../prod' })).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(SF_ORG_LOGIN_TIMEOUT_MS).toBeGreaterThan(30_000);
  });

  it.each(['company.my.salesforce.com', 'https://company.my.salesforce.com/', 'https://company--qa.sandbox.my.salesforce.com'])('supports My Domain %s', instanceUrl => {
    expect(parseOrgLoginInput({ instance: 'custom', instanceUrl })).toMatchObject({ ok: true, instanceUrl: `https://${instanceUrl.replace(/^https:\/\//, '').replace(/\/$/, '')}` });
  });

  it.each(['', 'http://company.my.salesforce.com', 'https://evil.example', 'https://salesforce.com.evil.example', 'https://user:password@company.my.salesforce.com', 'https://company.my.salesforce.com:8443', 'https://company.my.salesforce.com/path', 'https://company.my.salesforce.com?token=secret', 'https://company.my.salesforce.com#secret', 'https://company.\nmy.salesforce.com', 'https://company.my.salesforce.com\\path', 'https://' + 'x'.repeat(256) + '.salesforce.com'])('rejects unsafe custom login URL %s', instanceUrl => {
    expect(parseOrgLoginInput({ instance: 'custom', instanceUrl })).toMatchObject({ ok: false });
  });

  it.each(['--flag', 'bad\nname', 'bad\0name', 'bad/name', 'bad\\name', '.', '..', 'x'.repeat(256)])('rejects unsafe alias %s', alias => {
    expect(parseOrgLoginInput({ alias })).toMatchObject({ ok: false });
  });
});
