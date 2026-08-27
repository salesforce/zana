import type { OrgKind, ResolvedOrg } from './types.js';

export interface OrgResolutionInput {
  settingAlias?: string;
  envAlias?: string;
  cliDefaultAlias?: string;
}

function trimAlias(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** setting → SF_TARGET_ORG → CLI default. Does not contact the org. */
export function resolveTargetOrgAlias(input: OrgResolutionInput): string | null {
  const setting = trimAlias(input.settingAlias);
  if (setting) return setting;
  const env = trimAlias(input.envAlias);
  if (env) return env;
  const cli = trimAlias(input.cliDefaultAlias);
  return cli || null;
}

export function envTargetOrg(env: NodeJS.ProcessEnv = process.env): string {
  return trimAlias(env.SF_TARGET_ORG) || trimAlias(env.SFDX_DEFAULTUSERNAME);
}

export function classifyOrgKind(flags: {
  isScratchOrg?: boolean;
  isScratch?: boolean;
  isSandbox?: boolean;
  instanceUrl?: string;
}): OrgKind {
  if (flags.isScratchOrg === true || flags.isScratch === true) return 'scratch';
  const url = (flags.instanceUrl ?? '').toLowerCase();
  if (
    flags.isSandbox === true
    || url.includes('.sandbox.')
    || url.includes('--')
    || /\.cs\d+\./.test(url)
  ) {
    return 'sandbox';
  }
  if (flags.isSandbox === false && flags.isScratchOrg === false && flags.isScratch === false) {
    return 'production';
  }
  if (url.includes('.my.salesforce.com') && !url.includes('.sandbox.') && !url.includes('--')) {
    return 'production';
  }
  if (url || flags.isSandbox !== undefined || flags.isScratchOrg !== undefined) return 'unknown';
  return 'unknown';
}

export function publicOrgView(org: ResolvedOrg) {
  return {
    alias: org.alias,
    username: org.username,
    orgId: org.orgId,
    instanceUrl: org.instanceUrl,
    apiVersion: org.apiVersion,
    kind: org.kind,
    isDefault: org.isDefault
  };
}

export function isConfirmingOrg(kind: OrgKind): boolean {
  return kind === 'production' || kind === 'unknown';
}
