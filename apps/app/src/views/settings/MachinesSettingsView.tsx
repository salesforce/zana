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
import { Field, Section } from '@/components/settings/FormFields';
import { useHosts } from '../../hooks/useHosts.js';
import { AddMachineDialog } from './AddMachineDialog.js';
import { MachineCard } from './MachineCard.js';
import {
  defaultSshHost,
  sshHostOptionsFromProjects
} from './machine-pairing.js';
import {
  actionableProviderCliRows,
  orderedProviderCliRows
} from './machine-provider-clis.js';

interface MachinesTabProps {
  config: AppConfig;
  onConfigDraft: (config: AppConfig) => void;
  onUpdate: (patch: Partial<AppConfig>) => Promise<void>;
}

export function MachinesSettingsView({
  config,
  onConfigDraft,
  onUpdate
}: MachinesTabProps) {
  const hosts = useHosts();
  const projects = useData((s) => s.projects);
  const [adding, setAdding] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [cliByHost, setCliByHost] = useState<Record<string, ProviderCliStatusResponse>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
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

  async function runInstall(
    hostId: string,
    provider: ProviderCliKey,
    actionKind: ProviderCliInstallActionKind
  ): Promise<void> {
    const key = `${hostId}:${provider}`;
    setBusyKey(key);
    try {
      await product.hosts.installProviderCli(hostId, { provider, actionKind });
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
        help="Pair another computer so projects and threads can run there. SSH remotes stay a separate path — they use this machine’s daemon to ssh in. Connected machines follow the server version automatically; Codex, Claude Code, and the other harness CLIs update from the rows below."
      >
        <Field
          label="Public app URL"
          help="Hostname remotes use to reach this app (Heroku, Tailscale Serve, …). Change this field or the one-line public-app-url file at the repo root. Env ZCC_APP_URL wins over both. Product HTTP still binds loopback."
        >
          <input
            type="url"
            placeholder="https://your-app.herokuapp.com"
            value={config.publicAppUrl ?? ''}
            onChange={(event) => onConfigDraft({ ...config, publicAppUrl: event.target.value })}
            onBlur={(event) => onUpdate({ publicAppUrl: event.target.value.trim() || undefined })}
          />
        </Field>
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
