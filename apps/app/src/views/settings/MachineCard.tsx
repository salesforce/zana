import {
  AlertTriangle,
  CheckCircle2,
  Laptop,
  Monitor,
  Pencil,
  Trash2
} from 'lucide-react';
import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import type { ProviderCliInstallActionKind, ProviderCliKey } from '@zana-ai/zcc-contracts/host-rpc';
import {
  machineCliInventorySummary,
  providerCliPresentation,
  type MachineProviderCliRow,
  type ProviderCliTone
} from './machine-provider-clis.js';
import { machineConnectionCopy, permissionLabel } from './machine-status.js';

function StatusIcon({ tone }: { tone: ProviderCliTone }) {
  if (tone === 'ok') return <CheckCircle2 size={15} aria-hidden="true" />;
  return <AlertTriangle size={15} aria-hidden="true" />;
}

export function MachineCliInventory({
  hostId,
  rows,
  busyKey,
  onInstall
}: {
  hostId: string;
  rows: MachineProviderCliRow[];
  busyKey: string | null;
  onInstall: (provider: ProviderCliKey, actionKind: ProviderCliInstallActionKind) => void;
}) {
  const summary = machineCliInventorySummary(rows);
  return (
    <div className="machine-cli-panel">
      <div className="machine-cli-panel-head">
        <span>Harness CLIs</span>
        {summary ? <span className="machine-cli-panel-summary">{summary}</span> : null}
      </div>
      {rows.length === 0 ? (
        <p className="machine-cli-empty">Checking harness CLIs…</p>
      ) : (
        <ul className="machine-cli-list" data-testid={`machine-cli-list-${hostId}`}>
          {rows.map((row) => {
            const copy = providerCliPresentation(row.status);
            const busy = busyKey === `${hostId}:${row.provider}`;
            return (
              <li
                key={row.provider}
                className={`machine-cli-row machine-cli-row--${copy.tone}`}
              >
                <span className="machine-cli-icon">
                  <StatusIcon tone={copy.tone} />
                </span>
                <div className="machine-cli-copy">
                  <strong>{row.status.displayName}</strong>
                  <p className="machine-cli-version">
                    <span>{copy.currentLabel}</span>
                    {copy.latestLabel ? (
                      <>
                        <span className="machine-cli-version-arrow" aria-hidden="true">→</span>
                        <span className="machine-cli-version-latest">{copy.latestLabel}</span>
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="machine-cli-row-actions">
                  {row.status.installAction ? (
                    <button
                      type="button"
                      className="settings-btn"
                      disabled={busyKey !== null}
                      onClick={() => onInstall(row.provider, row.status.installAction!.kind)}
                    >
                      {busy ? 'Working…' : row.status.installAction.label}
                    </button>
                  ) : (
                    <span
                      className={`settings-badge${copy.tone === 'ok' ? ' settings-badge--ok' : ' settings-badge--warn'}`}
                    >
                      {copy.badge}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function MachineCard({
  host,
  projectCount,
  now,
  cliRows,
  busyKey,
  renaming,
  renameValue,
  onRenameValue,
  onRenameStart,
  onRenameCommit,
  onPermissionChange,
  onRetryUpdate,
  onRemove,
  onInstall
}: {
  host: Host;
  projectCount: number;
  now: number;
  cliRows: MachineProviderCliRow[];
  busyKey: string | null;
  renaming: boolean;
  renameValue: string;
  onRenameValue: (value: string) => void;
  onRenameStart: () => void;
  onRenameCommit: () => void;
  onPermissionChange: (mode: Host['maxPermissionMode']) => void;
  onRetryUpdate: () => void;
  onRemove: () => void;
  onInstall: (provider: ProviderCliKey, actionKind: ProviderCliInstallActionKind) => void;
}) {
  const connection = machineConnectionCopy(host, now);
  const HostIcon = host.isPrimary ? Laptop : Monitor;
  const projectLabel = `${projectCount} ${projectCount === 1 ? 'project' : 'projects'}`;

  return (
    <li className={`machine-card${host.status === 'connected' ? ' machine-card--online' : ''}`}>
      <div className="machine-card-header">
        <span
          className={`machine-status-dot${host.status === 'connected' ? ' machine-status-dot--on' : ''}`}
          aria-label={host.status}
        />
        <HostIcon size={16} className="machine-card-kind" aria-hidden="true" />
        <div className="machine-card-identity">
          {renaming ? (
            <input
              className="machine-card-rename"
              value={renameValue}
              onChange={(event) => onRenameValue(event.target.value)}
              onBlur={onRenameCommit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
              }}
              autoFocus
              aria-label="Machine name"
            />
          ) : (
            <strong title={host.name}>
              {host.name}
              {host.isPrimary ? <span className="settings-badge">this machine</span> : null}
            </strong>
          )}
          <p>
            <span className={`machine-status-pill machine-status-pill--${connection.tone}`}>
              {connection.label}
            </span>
            <span className="machine-card-meta-sep" aria-hidden="true">·</span>
            {projectLabel}
          </p>
        </div>
        <div className="machine-card-actions">
          <label className="machines-ceiling">
            <span>Permission ceiling</span>
            <select
              value={host.maxPermissionMode}
              title={`Threads on this machine cannot exceed ${permissionLabel(host.maxPermissionMode)}`}
              onChange={(event) => {
                onPermissionChange(event.target.value as Host['maxPermissionMode']);
              }}
            >
              <option value="accept-edits">Accept edits</option>
              <option value="auto">Auto</option>
              <option value="full">Full</option>
            </select>
          </label>
          <button
            type="button"
            className="settings-btn"
            onClick={onRenameStart}
            aria-label={`Rename ${host.name}`}
          >
            <Pencil size={13} aria-hidden="true" />
            Rename
          </button>
          {host.lastRejectedProtocolVersion ? (
            <button type="button" className="settings-btn" onClick={onRetryUpdate}>
              Retry update
            </button>
          ) : null}
          {host.isPrimary ? null : (
            <button
              type="button"
              className="settings-btn danger"
              onClick={onRemove}
              aria-label={`Remove ${host.name}`}
            >
              <Trash2 size={13} aria-hidden="true" />
              Remove
            </button>
          )}
        </div>
      </div>
      {host.status === 'connected' ? (
        <MachineCliInventory
          hostId={host.id}
          rows={cliRows}
          busyKey={busyKey}
          onInstall={onInstall}
        />
      ) : (
        <p className="machine-cli-offline">Connect this machine to see harness CLI versions.</p>
      )}
    </li>
  );
}
