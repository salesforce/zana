import type { WorkbenchStatus } from '../../lib/workbench-contract.js';
import type { DoctorReport } from '../../lib/types.js';
import { orgMatchesAlias } from '../../lib/org-list.js';

/** Roster availability is advisory; every org operation still checks its connection. */
export function orgReadiness(status: WorkbenchStatus | null, doctor: DoctorReport | null) {
  const alias = status?.selectedAlias || status?.defaultOrg || '';
  const org = status?.orgs?.find(row => orgMatchesAlias(row, alias));
  if (status?.orgsError || (doctor && !doctor.cliOk)) return {
    kind: 'unavailable' as const, title: 'Org connections unavailable',
    detail: status?.orgsError || doctor?.cliError || 'Check Salesforce CLI, then try again.',
  };
  if (!alias) return {
    kind: 'not-selected' as const, title: 'Choose an org when you need it',
    detail: 'Queries, Apex tests, deployments and Agentforce previews need a connected org. You can create and edit Agentforce drafts locally now.',
  };
  if (!org) return {
    kind: 'unavailable' as const, title: 'Selected org is unavailable',
    detail: `${alias} is not in your CLI connections. Sign in or choose another org for this project.`,
  };
  if ((doctor && !doctor.org) || (org.connectedStatus && !['connected', 'unknown'].includes(org.connectedStatus.toLowerCase()))) return {
    kind: 'unavailable' as const, title: 'Reconnect your org',
    detail: `The connection to ${alias} needs attention. Sign in again or choose another org. Your local drafts are available.`,
  };
  return { kind: 'selected' as const, title: 'Org selected', detail: alias };
}
