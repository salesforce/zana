import { describe, expect, it } from 'vitest';
import {
  formatOrgRoster,
  orgMatchesAlias,
  orgOptionLabel,
  orgRosterInstructions,
  resolveListedSelection
} from '../lib/org-list.js';
import { parseOrgsRpc, settingOrgAlias } from './app/OrgPicker.js';
import type { PublicListedOrg } from '../lib/types.js';

const sandbox: PublicListedOrg = {
  alias: 'dev',
  username: 'dev@example.com',
  kind: 'sandbox',
  isDefault: true,
  orgId: '00D1',
  instanceUrl: 'https://foo--dev.sandbox.my.salesforce.com',
  connectedStatus: 'Connected'
};
const prod: PublicListedOrg = {
  alias: 'prod',
  username: 'prod@example.com',
  kind: 'production',
  isDefault: false,
  orgId: '00D2',
  instanceUrl: 'https://org.my.salesforce.com',
  connectedStatus: 'Connected'
};

describe('org list helpers', () => {
  it('matches alias or username case-insensitively', () => {
    expect(orgMatchesAlias(sandbox, 'DEV')).toBe(true);
    expect(orgMatchesAlias(sandbox, 'dev@example.com')).toBe(true);
    expect(orgMatchesAlias(sandbox, 'prod')).toBe(false);
  });

  it('prefers the plugin setting, then resolved alias, then CLI default', () => {
    expect(resolveListedSelection([sandbox, prod], 'prod', 'dev')).toBe('prod');
    expect(resolveListedSelection([sandbox, prod], '', 'prod')).toBe('prod');
    expect(resolveListedSelection([sandbox, prod], '', null)).toBe('dev');
    expect(resolveListedSelection([], '', null)).toBe('');
  });

  it('formats a roster without tokens and marks the target', () => {
    const roster = formatOrgRoster([sandbox, prod], 'prod');
    expect(roster).toContain('* prod');
    expect(roster).toContain('  dev');
    expect(roster).not.toContain('TOKEN');
    expect(orgOptionLabel(sandbox)).toContain('CLI default');
    expect(orgRosterInstructions([sandbox], 'dev')).toContain('family tools');
    expect(orgRosterInstructions([], null)).toBe('');
    expect(formatOrgRoster([], null)).toMatch(/sf org login web/);
  });

  it('parses the orgs RPC payload and setting alias', () => {
    expect(parseOrgsRpc({ ok: true, orgs: [sandbox], selectedAlias: 'dev' })).toMatchObject({
      ok: true,
      selectedAlias: 'dev'
    });
    expect(parseOrgsRpc({ ok: false, error: 'missing', orgs: [] })).toMatchObject({
      ok: false,
      error: 'missing'
    });
    expect(parseOrgsRpc(null).ok).toBe(false);
    expect(settingOrgAlias({ defaultOrg: ' prod ' })).toBe('prod');
    expect(settingOrgAlias(undefined)).toBe('');
  });
});
