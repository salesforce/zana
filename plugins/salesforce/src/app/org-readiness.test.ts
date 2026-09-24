import { expect, it } from 'vitest';
import { orgReadiness } from './org-readiness.js';
import type { DoctorReport, PublicListedOrg } from '../../lib/types.js';

const org: PublicListedOrg = { alias: 'dev', username: 'user@example.com', connectedStatus: 'Connected', kind: 'sandbox', isDefault: false, orgId: '00D1', instanceUrl: 'https://example.com' };
const selected = { selectedAlias: 'dev', orgs: [org] };
const doctor = (value: Partial<DoctorReport>) => value as DoctorReport;

it('keeps org selection optional for local authoring', () => {
  expect(orgReadiness(null, null).kind).toBe('not-selected');
  expect(orgReadiness({ orgs: [org] }, null).kind).toBe('not-selected');
  expect(orgReadiness(selected, null).kind).toBe('selected');
  expect(orgReadiness({ defaultOrg: 'USER@EXAMPLE.COM', orgs: [org] }, null).kind).toBe('selected');
});

it('distinguishes inventory failures, missing targets and expired connections', () => {
  expect(orgReadiness({ ...selected, orgsError: 'CLI unavailable' }, null)).toMatchObject({ kind: 'unavailable', detail: 'CLI unavailable' });
  expect(orgReadiness(selected, doctor({ cliOk: false, cliError: 'CLI broken' })).detail).toBe('CLI broken');
  expect(orgReadiness(selected, doctor({ cliOk: false })).detail).toContain('Check Salesforce CLI');
  expect(orgReadiness({ defaultOrg: 'missing', orgs: [org] }, null).title).toBe('Selected org is unavailable');
  expect(orgReadiness({ defaultOrg: 'missing' }, null).kind).toBe('unavailable');
  expect(orgReadiness(selected, doctor({ cliOk: true, org: null })).title).toBe('Reconnect your org');
  expect(orgReadiness(selected, doctor({ cliOk: true, org: { alias: 'dev' } as never })).kind).toBe('selected');
  for (const connectedStatus of ['RefreshTokenAuthError', 'Expired']) {
    expect(orgReadiness({ ...selected, orgs: [{ ...org, connectedStatus }] }, null).title).toBe('Reconnect your org');
  }
  for (const connectedStatus of ['', 'Unknown']) {
    expect(orgReadiness({ ...selected, orgs: [{ ...org, connectedStatus }] }, null).kind).toBe('selected');
  }
});
