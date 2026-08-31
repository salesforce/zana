import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Plus } from 'lucide-react';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import type {
  ProviderCliInstallActionKind,
  ProviderCliKey,
  ProviderCliStatusResponse
} from '@zana-ai/zcc-contracts/host-rpc';
import { product } from '../../lib/product-client.js';
import { useData } from '@/store';
import { Section } from '@/components/settings/FormFields';
import { useHosts } from '../../hooks/useHosts.js';
import { HostSshIdentityDialog } from '../../components/HostSshIdentityDialog.js';
import { AddMachineDialog } from './AddMachineDialog.js';
import { MachineCard } from './MachineCard.js';
import {
  defaultSshHost,
  sshHostOptionsFromProjects
} from './machine-pairing.js';
import { reconnectMachine } from './machine-reconnect.js';
import {
  actionableProviderCliRows,
  installProviderCliOnMachine,
  orderedProviderCliRows
} from './machine-provider-clis.js';

interface MachinesTabProps {
  config: AppConfig;
  onConfigDraft: (config: AppConfig) => void;
  onUpdate: (patch: Partial<AppConfig>) => Promise<void>;
}

export function MachinesSettingsView({
  config
}: MachinesTabProps) {
  const hosts = useHosts();
  const projects = useData((s) => s.projects);
  const [adding, setAdding] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [cliByHost, setCliByHost] = useState<Record<string, ProviderCliStatusResponse>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [installErrors, setInstallErrors] = useState<Record<string, string>>({});
  const [repairingId, setRepairingId] = useState<string | null>(null);
  const [repairError, setRepairError] = useState<{ hostId: string; message: string } | null>(null);
  const [relaunchingId, setRelaunchingId] = useState<string | null>(null);
  const [relaunchError, setRelaunchError] = useState<{ hostId: string; message: string } | null>(null);
  const [sshPick, setSshPick] = useState<{ hostId: string; name: string } | null>(null);
  const now = Date.now();
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const project of projects) {
      if (!project.hostId) continue;
      map.set(project.hostId, (map.get(project.hostId) ?? 0) + 1);
    }
    return map;
  }, [projects]);
  const connectedSignature = hosts
    .filter((host) => host.status === 'connected')
    .map((host) => host.id)
    .join(',');

  const refreshCliStatus = useCallback(async () => {
    const connected = hosts.filter((host) => host.status === 'connected');
    const entries = await Promise.all(connected.map(async (host) => {
      try {
        const status = await product.hosts.providerCliStatus(host.id);
        return [host.id, status] as const;
      } catch {
        return [host.id, {}] as const;
      }
    }));
    setCliByHost(Object.fromEntries(entries));
  }, [hosts]);

  useEffect(() => {
    void refreshCliStatus();
  }, [connectedSignature, refreshCliStatus]);

  const actionable = useMemo(() => actionableProviderCliRows(cliByHost), [cliByHost]);

  async function runReconnect(hostId: string, afterSshPick = false): Promise<void> {
    const host = hosts.find((row) => row.id === hostId);
    if (!host) return;
    setRepairError(null);
    if (!afterSshPick && !host.canRepairViaSsh) {
      setSshPick({ hostId: host.id, name: host.name });
      return;
    }
    setRepairingId(host.id);
    try {
      const result = await reconnectMachine({
        hostId: host.id,
        canRepairViaSsh: host.canRepairViaSsh,
        afterSshPick,
        repair: (id) => product.hosts.repair(id)
      });
      if (result.ok) return;
      if (result.needsSshPick) {
        setSshPick({ hostId: host.id, name: host.name });
        return;
      }
      setRepairError({ hostId: host.id, message: result.message });
    } finally {
      setRepairingId(null);
    }
  }

  async function runRelaunch(hostId: string): Promise<void> {
    setRelaunchError(null);
    setRelaunchingId(hostId);
    try {
      const result = await product.hosts.relaunchLocal();
      if (!result.ok) {
        setRelaunchError({ hostId, message: result.message });
      }
    } catch (err) {
      setRelaunchError({
        hostId,
        message: err instanceof Error ? err.message : 'Could not relaunch this machine'
      });
    } finally {
      setRelaunchingId(null);
    }
  }

  async function runInstall(
    hostId: string,
    provider: ProviderCliKey,
    actionKind: ProviderCliInstallActionKind
  ): Promise<void> {
    const key = `${hostId}:${provider}`;
    setBusyKey(key);
    setInstallErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    try {
      const outcome = await installProviderCliOnMachine({
        hostId,
        provider,
        actionKind,
        install: product.hosts.installProviderCli
      });
      if (!outcome.ok) {
        setInstallErrors((prev) => ({ ...prev, [key]: outcome.message }));
      }
      await refreshCliStatus();
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <>
      <Section
        anchorId="machines"
        title="Machines"
        help="Pair another computer so projects and agents can run there. SSH remotes stay a separate path — they use this machine’s daemon to ssh in. Connected machines follow the server version automatically; Codex, Claude Code, and the other harness CLIs update from the rows below."
      >
        <div className="machines-toolbar">
          <button type="button" className="settings-btn" onClick={() => setAdding(true)}>
            <Plus size={13} aria-hidden="true" />
            Add a machine
          </button>
          {actionable.length > 0 ? (
            <button
              type="button"
              className="settings-btn primary"
              disabled={busyKey !== null}
              onClick={() => {
                void (async () => {
                  for (const item of actionable) {
                    await runInstall(item.hostId, item.provider, item.action.kind);
                  }
                })();
              }}
            >
              <Download size={13} aria-hidden="true" />
              Update all ({actionable.length})
            </button>
          ) : null}
        </div>
        <ul className="machines-list" data-testid="machines-list">
          {hosts.map((host) => (
            <MachineCard
              key={host.id}
              host={host}
              projectCount={counts.get(host.id) ?? 0}
              now={now}
              cliRows={orderedProviderCliRows(cliByHost[host.id])}
              busyKey={busyKey}
              installErrors={installErrors}
              renaming={renameId === host.id}
              renameValue={renameValue}
              onRenameValue={setRenameValue}
              onRenameStart={() => {
                setRenameId(host.id);
                setRenameValue(host.name);
              }}
              onRenameCommit={() => {
                const name = renameValue.trim();
                setRenameId(null);
                if (name && name !== host.name) {
                  void product.hosts.update(host.id, { name });
                }
              }}
              onPermissionChange={(mode) => {
                void product.hosts.updatePermissionCeiling(host.id, mode);
              }}
              onRetryUpdate={() => void product.hosts.retryUpdate(host.id)}
              reconnecting={repairingId === host.id}
              reconnectError={repairError?.hostId === host.id ? repairError.message : null}
              relaunching={relaunchingId === host.id}
              relaunchError={relaunchError?.hostId === host.id ? relaunchError.message : null}
              onReconnect={() => void runReconnect(host.id)}
              onRelaunch={() => void runRelaunch(host.id)}
              onRemove={() => {
                if (window.confirm(`Remove ${host.name}?`)) {
                  void product.hosts.remove(host.id);
                }
              }}
              onInstall={(provider, actionKind) => void runInstall(host.id, provider, actionKind)}
            />
          ))}
        </ul>
      </Section>
      {sshPick ? (
        <HostSshIdentityDialog
          hostName={sshPick.name}
          onClose={() => setSshPick(null)}
          onSubmit={async (identity) => {
            const hostIdToRepair = sshPick.hostId;
            await product.hosts.updateSshIdentity(hostIdToRepair, identity);
            setSshPick(null);
            await runReconnect(hostIdToRepair, true);
          }}
        />
      ) : null}
      <AddMachineDialog
        open={adding}
        onClose={() => setAdding(false)}
        publicAppUrl={config.publicAppUrl}
        sshHosts={sshHostOptionsFromProjects(projects)}
        defaultSshHost={defaultSshHost(projects, config.lastProjectId)}
      />
    </>
  );
}

export { MachinesSettingsView as MachinesTab };
