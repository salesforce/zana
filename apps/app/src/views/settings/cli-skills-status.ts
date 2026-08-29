import type { CliSkillMachineStatus } from '@zana-ai/zcc-server-contract';

export interface CliSkillMachineRow {
  hostId: string;
  hostName: string;
  status: CliSkillMachineStatus;
}

export type CliSkillTone = 'ok' | 'warn' | 'muted';
export type CliSkillAction = 'install' | 'update';

export interface CliSkillPresentation {
  label: string;
  hint: string;
  tone: CliSkillTone;
  action: CliSkillAction | null;
  actionLabel: string | null;
}

const COPY: Record<CliSkillMachineStatus, CliSkillPresentation> = {
  installed: {
    label: 'Installed',
    hint: 'Current zcc-cli skill on this machine',
    tone: 'ok',
    action: null,
    actionLabel: null
  },
  outdated: {
    label: 'Needs update',
    hint: 'Older zcc-cli skill — install the current copy',
    tone: 'warn',
    action: 'update',
    actionLabel: 'Update'
  },
  missing: {
    label: 'Not installed',
    hint: 'No zcc-cli skill on this machine yet',
    tone: 'warn',
    action: 'install',
    actionLabel: 'Install'
  },
  unknown: {
    label: 'Unavailable',
    hint: 'Machine is offline or could not be checked',
    tone: 'muted',
    action: null,
    actionLabel: null
  }
};

export function cliSkillPresentation(status: CliSkillMachineStatus): CliSkillPresentation {
  return COPY[status];
}

export function pendingCliSkillHostIds(machines: CliSkillMachineRow[]): string[] {
  return machines
    .filter((row) => cliSkillPresentation(row.status).action !== null)
    .map((row) => row.hostId);
}

export function cliSkillBulkLabel(machines: CliSkillMachineRow[]): string | null {
  const pending = machines.filter((row) => cliSkillPresentation(row.status).action !== null);
  if (pending.length < 2) return null;
  const allMissing = pending.every((row) => row.status === 'missing');
  const verb = allMissing ? 'Install all' : 'Update all';
  return `${verb} (${pending.length})`;
}

export function cliSkillInstallError(results: Array<{ ok: boolean; hostName: string; errorMessage?: string }>): string | null {
  const failed = results.filter((row) => !row.ok);
  if (failed.length === 0) return null;
  return failed.map((row) => `${row.hostName}: ${row.errorMessage ?? 'failed'}`).join(' · ');
}
