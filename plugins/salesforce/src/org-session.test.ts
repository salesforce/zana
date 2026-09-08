import { describe, expect, it } from 'vitest';
import { isPublicOrgView, orgSessionLabel, parseOrgRpc } from '../lib/org-session.js';
import type { PublicOrgView } from '../lib/types.js';

const org: PublicOrgView = {
  alias: 'dev',
  username: 'dev@example.com',
  orgId: '00Dxx',
  instanceUrl: 'https://foo--dev.sandbox.my.salesforce.com',
  apiVersion: '62.0',
  kind: 'sandbox',
  isDefault: true
};

describe('org session helpers', () => {
  it('parses a connected org RPC and never requires a token field', () => {
    expect(parseOrgRpc({ ok: true, org })).toEqual({ ok: true, org });
    expect(isPublicOrgView({ ...org, accessToken: 'SECRET' })).toBe(true);
    expect(JSON.stringify(parseOrgRpc({ ok: true, org: { ...org, accessToken: 'SECRET' } }))).not.toContain('SECRET');
    expect(parseOrgRpc({ ok: false, error: 'No target org.', code: 'no_org' })).toMatchObject({
      ok: false,
      error: 'No target org.',
      code: 'no_org'
    });
    expect(parseOrgRpc(null).ok).toBe(false);
  });

  it('labels a connected org for playground and preview chrome', () => {
    expect(orgSessionLabel(org)).toBe('dev (sandbox)');
    expect(orgSessionLabel(null)).toBeNull();
  });
});
