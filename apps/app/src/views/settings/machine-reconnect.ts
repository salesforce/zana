import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import { bootstrapOutcome } from '../../components/composer-host-status.js';

export function machineCanReconnect(host: Host): boolean {
  return !host.isPrimary && host.status !== 'connected';
}

export type MachineReconnectResult =
  | { ok: true; hostId: string }
  | { ok: false; message: string; needsSshPick?: boolean };

export async function reconnectMachine(input: {
  hostId: string;
  canRepairViaSsh: boolean;
  /** After the user just bound SSH, skip the pre-flight picker and call repair. */
  afterSshPick?: boolean;
  repair: (id: string) => Promise<Array<{
    type: string;
    hostId?: string;
    code?: string;
    message?: string;
    pairingCommand?: string;
  }>>;
}): Promise<MachineReconnectResult> {
  if (!input.afterSshPick && !input.canRepairViaSsh) {
    return {
      ok: false,
      message: 'Pick an SSH host so Zana can reconnect this machine.',
      needsSshPick: true
    };
  }
  try {
    const outcome = bootstrapOutcome(await input.repair(input.hostId));
    if (!outcome.ok) {
      return {
        ok: false,
        message: outcome.message,
        ...(outcome.code === 'ssh_identity_required' ? { needsSshPick: true } : {})
      };
    }
    return { ok: true, hostId: outcome.hostId };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Could not reconnect this machine'
    };
  }
}
