import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
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
import { TAILSCALE_SERVE_HINT } from './machine-pairing.js';
import {
  actionableProviderCliRows,
  orderedProviderCliRows,
  providerCliBadge
} from './machine-provider-clis.js';

interface MachinesTabProps {
  config: AppConfig;
  onConfigDraft: (config: AppConfig) => void;
  onUpdate: (patch: Partial<AppConfig>) => Promise<void>;
}

function permissionLabel(mode: Host['maxPermissionMode']): string {
  if (mode === 'accept-edits') return 'Accept edits';
  if (mode === 'auto') return 'Auto';
  return 'Full';
}

function machineMeta(host: Host, projectCount: number, now: number): string {
  const parts: string[] = [];
  if (host.lastRejectedProtocolVersion) {
    parts.push('Needs update');
  } else if (host.status === 'connected') {
    parts.push('Online');
  } else if (host.lastSeenAt) {
    const ago = Math.max(0, Math.round((now - host.lastSeenAt) / 60_000));
    parts.push(ago < 1 ? 'Offline · just now' : `Offline · last seen ${ago}m ago`);
  } else {
    parts.push('Offline');
  }
  parts.push(`${projectCount} ${projectCount === 1 ? 'project' : 'projects'}`);
  parts.push(`Ceiling: ${permissionLabel(host.maxPermissionMode)}`);
  return parts.join(' · ');
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
          help={`Used in the join command and to allowlist Tailscale Serve Host headers. Product HTTP still binds loopback. Example: ${TAILSCALE_SERVE_HINT}`}
        >
          <input
            type="url"
            placeholder="https://box.tailnet.ts.net"
            value={config.publicAppUrl ?? ''}
            onChange={(event) => onConfigDraft({ ...config, publicAppUrl: event.target.value })}
            onBlur={(event) => onUpdate({ publicAppUrl: event.target.value.trim() || undefined })}
          />
        </Field>
        <div className="machines-toolbar">
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            Add machine
          </button>
          {actionable.length > 0 ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busyKey !== null}
              onClick={() => {
                void (async () => {
                  for (const item of actionable) {
                    await runInstall(item.hostId, item.provider, item.action.kind);
                  }
                })();
              }}
            >
              Update all ({actionable.length})
            </button>
          ) : null}
        </div>
        <ul className="machines-list" data-testid="machines-list">
          {hosts.map((host) => (
            <li key={host.id} className="machines-row">
              <span
                className={`machine-status-dot${host.status === 'connected' ? ' machine-status-dot--on' : ''}`}
                aria-label={host.status}
              />
              <div className="machines-row-copy">
                {renameId === host.id ? (
                  <input
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onBlur={() => {
                      const name = renameValue.trim();
                      setRenameId(null);
                      if (name && name !== host.name) {
                        void product.hosts.update(host.id, { name });
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                    }}
                    autoFocus
                  />
                ) : (
                  <strong>
                    {host.name}
                    {host.isPrimary ? <span className="settings-badge">this machine</span> : null}
                  </strong>
                )}
                <p>{machineMeta(host, counts.get(host.id) ?? 0, now)}</p>
                {host.status === 'connected' ? (
                  <ul className="machine-cli-list" data-testid={`machine-cli-list-${host.id}`}>
                    {orderedProviderCliRows(cliByHost[host.id]).map((row) => {
                      const badge = providerCliBadge(row.status);
                      const busy = busyKey === `${host.id}:${row.provider}`;
                      return (
                        <li key={row.provider} className="machine-cli-row">
                          <div>
                            <strong>{row.status.displayName}</strong>
                            <p>
                              {row.status.currentVersion ?? 'Not installed'}
                              {row.status.latestVersion && row.status.needsUpdate
                                ? ` → ${row.status.latestVersion}`
                                : ''}
                            </p>
                          </div>
                          <div className="machine-cli-row-actions">
                            {badge ? <span className="settings-badge settings-badge--warn">{badge}</span> : null}
                            {row.status.installAction ? (
                              <button
                                type="button"
                                className="btn"
                                disabled={busyKey !== null}
                                onClick={() => void runInstall(host.id, row.provider, row.status.installAction!.kind)}
                              >
                                {busy ? 'Working…' : row.status.installAction.label}
                              </button>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
              <div className="machines-row-actions">
                <label className="machines-ceiling">
                  <span>Permission ceiling</span>
                  <select
                    value={host.maxPermissionMode}
                    onChange={(event) => {
                      void product.hosts.updatePermissionCeiling(
                        host.id,
                        event.target.value as Host['maxPermissionMode']
                      );
                    }}
                  >
                    <option value="accept-edits">Accept edits</option>
                    <option value="auto">Auto</option>
                    <option value="full">Full</option>
                  </select>
                </label>
                <button type="button" className="btn" onClick={() => {
                  setRenameId(host.id);
                  setRenameValue(host.name);
                }}
                >
                  Rename
                </button>
                {host.lastRejectedProtocolVersion ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void product.hosts.retryUpdate(host.id)}
                  >
                    Retry update
                  </button>
                ) : null}
                {host.isPrimary ? null : (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      if (window.confirm(`Remove ${host.name}?`)) {
                        void product.hosts.remove(host.id);
                      }
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Section>
      <AddMachineDialog
        open={adding}
        onClose={() => setAdding(false)}
        publicAppUrl={config.publicAppUrl}
      />
    </>
  );
}

export { MachinesSettingsView as MachinesTab };
