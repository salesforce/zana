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
});
