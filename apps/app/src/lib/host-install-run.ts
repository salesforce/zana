import type { HostBootstrapEvent } from '@zana-ai/zcc-desktop-contract';
import { bootstrapOutcome, composerBootstrapErrorMessage } from '../components/composer-host-status.js';
import { useUi } from '../store.js';
import type { HostInstallKind } from './host-install-drawer.js';

export type HostRepairTarget = { hostId: string } | { projectId: string } | { ssh: { host: string; user?: string } };

export interface HostInstallRunInput {
  kind: HostInstallKind;
  target: string;
  /** Fixed target of the failed attempt, reused by the local repair agent. */
  repairTarget?: HostRepairTarget;
  startLogs?: string[];
  run: (onEvent: (event: HostBootstrapEvent) => void) => Promise<HostBootstrapEvent[]>;
  /**
   * Caller post-processing of the final events (set host, reload projects, surface errors).
   * Lives on the input so the drawer's Retry replays it, not just `run`. Awaited after the
   * drawer is finished, for both ok and failed outcomes. NOT called when `run` throws; the
   * thrown error propagates to the caller (and a retry that throws reaches the drawer caller).
   */
  onSettled?: (events: HostBootstrapEvent[]) => void | Promise<void>;
}

let lastRun: HostInstallRunInput | null = null;

export function lastHostInstallRepairTarget(target: string | null): HostRepairTarget | null {
  return lastRun?.target === target ? lastRun.repairTarget ?? null : null;
}

/** Re-run the most recent install/fix through the drawer (the drawer's Retry). */
export async function retryLastHostInstall(): Promise<HostBootstrapEvent[] | null> {
  if (!lastRun) return null;
  return runHostInstallWithDrawer(lastRun);
}

export async function runHostInstallWithDrawer(input: HostInstallRunInput): Promise<HostBootstrapEvent[]> {
  lastRun = input;
  const ui = useUi.getState();
  ui.openHostInstallDrawer({ kind: input.kind, target: input.target });
  if (input.startLogs?.length) ui.appendHostInstallLogs(input.startLogs);
  let events: HostBootstrapEvent[];
  try {
    events = await input.run((event) => ui.applyHostInstallEvent(event));
    const outcome = bootstrapOutcome(events);
    if (!outcome.ok) {
      ui.finishHostInstallDrawer({
        ok: false,
        message: composerBootstrapErrorMessage(outcome),
        ...(outcome.pairingCommand ? { pairingCommand: outcome.pairingCommand } : {})
      });
    } else {
      ui.finishHostInstallDrawer({ ok: true });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Host install failed';
    ui.finishHostInstallDrawer({ ok: false, message });
    throw error;
  }
  await input.onSettled?.(events);
  return events;
}
