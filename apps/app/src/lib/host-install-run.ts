import type { HostBootstrapEvent } from '@zana-ai/zcc-desktop-contract';
import { bootstrapOutcome, composerBootstrapErrorMessage } from '../components/composer-host-status.js';
import { useUi } from '../store.js';
import type { HostInstallKind } from './host-install-drawer.js';

export async function runHostInstallWithDrawer(input: {
  kind: HostInstallKind;
  target: string;
  startLogs?: string[];
  run: (onEvent: (event: HostBootstrapEvent) => void) => Promise<HostBootstrapEvent[]>;
}): Promise<HostBootstrapEvent[]> {
  const ui = useUi.getState();
  ui.openHostInstallDrawer({ kind: input.kind, target: input.target });
  if (input.startLogs?.length) ui.appendHostInstallLogs(input.startLogs);
  try {
    const events = await input.run((event) => ui.applyHostInstallEvent(event));
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
    return events;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Host install failed';
    ui.finishHostInstallDrawer({ ok: false, message });
    throw error;
  }
}
