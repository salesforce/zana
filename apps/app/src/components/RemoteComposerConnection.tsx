import { useState } from 'react';
import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import type { Project } from '@zana-ai/zcc-domain/product';
import { product } from '../lib/product-client.js';
import { runHostInstallWithDrawer } from '../lib/host-install-run.js';
import { usePublicAppUrl } from '../hooks/usePublicAppUrl.js';
import { useUi } from '../store.js';
import { ComposerHostActionChip } from './ComposerHostActionChip.js';
import { HostSshIdentityDialog } from './HostSshIdentityDialog.js';
import { bootstrapOutcome, composerBootstrapErrorMessage, resolveComposerHostAction } from './composer-host-status.js';

/** Repair the project's fixed remote target without introducing a machine picker. */
export function RemoteComposerConnection({ project, hosts, onConnected, onError }: {
  project: Project;
  hosts: Host[];
  onConnected: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const publicAppUrl = usePublicAppUrl();
  const [busy, setBusy] = useState(false);
  const [sshPick, setSshPick] = useState<{ hostId: string; name: string } | null>(null);
  const action = resolveComposerHostAction({ hosts, project, publicAppUrl });

  async function connect(hostId?: string) {
    setBusy(true);
    onError(null);
    try {
      await runHostInstallWithDrawer({
        kind: hostId ? 'fix' : 'install',
        target: project.remote!.host,
        startLogs: [hostId ? 'Reconnecting…' : 'Installing…'],
        run: async (onEvent) => {
          try { await product.relay.renewJoinWindow(); } catch { /* Bootstrap also renews pairing. */ }
          return hostId ? product.hosts.repair(hostId, onEvent) : product.hosts.bootstrap(project.id, onEvent);
        },
        // Replayed by the drawer's Retry too.
        onSettled: async (events) => {
          const outcome = bootstrapOutcome(events);
          if (!outcome.ok) {
            onError(composerBootstrapErrorMessage(outcome));
            if (outcome.code === 'ssh_identity_required' && hostId) {
              setSshPick({ hostId, name: hosts.find(host => host.id === hostId)?.name ?? project.remote!.host });
            }
          } else {
            onError(null);
            await onConnected();
          }
        }
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not reconnect the remote machine');
    } finally { setBusy(false); }
  }

  return <>
    <ComposerHostActionChip
      action={action}
      busyLabel={busy ? 'Reconnecting…' : null}
      onAction={() => {
        if (busy) { useUi.getState().setHostInstallDrawerOpen(true); return; }
        if (action.kind === 'install') void connect();
        if (action.kind === 'fix') {
          if (action.needsSshPick) setSshPick({ hostId: action.hostId, name: hosts.find(host => host.id === action.hostId)?.name ?? project.remote!.host });
          else void connect(action.hostId);
        }
      }}
    />
    {sshPick && <HostSshIdentityDialog
      hostName={sshPick.name}
      onClose={() => setSshPick(null)}
      onSubmit={async (identity) => {
        await product.hosts.updateSshIdentity(sshPick.hostId, identity);
        const hostId = sshPick.hostId;
        setSshPick(null);
        await connect(hostId);
      }}
    />}
  </>;
}
