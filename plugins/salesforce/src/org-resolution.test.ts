import { describe, expect, it } from 'vitest';
import { classifyOrgKind, envTargetOrg, isConfirmingOrg, resolveTargetOrgAlias } from '../lib/org-resolution.js';

describe('org resolution', () => {
  it('prefers setting, then env, then CLI default', () => {
    expect(resolveTargetOrgAlias({ settingAlias: ' a ', envAlias: 'b', cliDefaultAlias: 'c' })).toBe('a');
    expect(resolveTargetOrgAlias({ envAlias: 'b', cliDefaultAlias: 'c' })).toBe('b');
    expect(resolveTargetOrgAlias({ cliDefaultAlias: 'c' })).toBe('c');
    expect(resolveTargetOrgAlias({})).toBeNull();
  });

  it('reads SF_TARGET_ORG then SFDX_DEFAULTUSERNAME', () => {
    expect(envTargetOrg({ SF_TARGET_ORG: 'sandbox' })).toBe('sandbox');
    expect(envTargetOrg({ SFDX_DEFAULTUSERNAME: 'legacy' })).toBe('legacy');
    expect(envTargetOrg({})).toBe('');
  });

  it('classifies scratch, sandbox, production, and unknown', () => {
    expect(classifyOrgKind({ isScratchOrg: true })).toBe('scratch');
    expect(classifyOrgKind({ isSandbox: true })).toBe('sandbox');
    expect(classifyOrgKind({ instanceUrl: 'https://foo--dev.sandbox.my.salesforce.com' })).toBe('sandbox');
    expect(classifyOrgKind({ isScratchOrg: false, isScratch: false, isSandbox: false })).toBe('production');
    expect(classifyOrgKind({ instanceUrl: 'https://org.my.salesforce.com' })).toBe('production');
    expect(classifyOrgKind({ instanceUrl: 'https://foo.cs12.my.salesforce.com' })).toBe('sandbox');
    expect(classifyOrgKind({ instanceUrl: 'https://login.example.test' })).toBe('unknown');
    expect(classifyOrgKind({})).toBe('unknown');
    expect(isConfirmingOrg('production')).toBe(true);
    expect(isConfirmingOrg('sandbox')).toBe(false);
  });
});
