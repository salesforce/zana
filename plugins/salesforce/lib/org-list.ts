import type { PublicListedOrg } from './types.js';

export function orgMatchesAlias(org: Pick<PublicListedOrg, 'alias' | 'username'>, alias: string): boolean {
  const target = alias.trim().toLowerCase();
  if (!target) return false;
  return org.alias.trim().toLowerCase() === target || org.username.trim().toLowerCase() === target;
}

export function resolveListedSelection(
  orgs: PublicListedOrg[],
  settingAlias: string,
  resolvedAlias: string | null
): string {
  const setting = settingAlias.trim();
  if (setting && orgs.some((org) => orgMatchesAlias(org, setting))) return setting;
  const resolved = (resolvedAlias ?? '').trim();
  if (resolved && orgs.some((org) => orgMatchesAlias(org, resolved))) return resolved;
  return setting || resolved || orgs.find((org) => org.isDefault)?.alias || orgs[0]?.alias || '';
}

export function orgOptionLabel(org: PublicListedOrg): string {
  const name = org.alias || org.username;
  const user = org.username && org.username !== org.alias ? ` · ${org.username}` : '';
  const def = org.isDefault ? ' · CLI default' : '';
  return `${name} (${org.kind})${user}${def}`;
}

export function formatOrgRoster(orgs: PublicListedOrg[], selectedAlias: string | null): string {
  if (orgs.length === 0) return 'No Salesforce CLI orgs. Run `sf org login web`, then retry.';
  const lines = orgs.map((org) => {
    const mark = orgMatchesAlias(org, selectedAlias ?? '') || (org.isDefault && !selectedAlias) ? '*' : ' ';
    return `${mark} ${org.alias || org.username}  ${org.username}  ${org.kind}`;
  });
  return `Connected orgs:\n${lines.join('\n')}`;
}

export function orgRosterInstructions(orgs: PublicListedOrg[], selectedAlias: string | null): string {
  if (orgs.length === 0) return '';
  return `\n\nConnected Salesforce CLI orgs (family tools use the * target selected in the Salesforce plugin):\n${formatOrgRoster(orgs, selectedAlias)}`;
}
