import {
  AlertTriangle,
  CheckCircle2,
  Laptop,
  Monitor,
  Pencil,
  RefreshCw,
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
import { machineCanReconnect } from './machine-reconnect.js';
import { machineConnectionCopy, permissionLabel } from './machine-status.js';

function StatusIcon({ tone }: { tone: ProviderCliTone | 'error' }) {
  if (tone === 'ok') return <CheckCircle2 size={15} aria-hidden="true" />;
  return <AlertTriangle size={15} aria-hidden="true" />;
}

export function MachineCliInventory({
  hostId,
  rows,
  busyKey,
  installErrors = {},
  onInstall
}: {
  hostId: string;
  rows: MachineProviderCliRow[];
  busyKey: string | null;
  installErrors?: Record<string, string>;
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
            const key = `${hostId}:${row.provider}`;
            const busy = busyKey === key;
            const error = installErrors[key];
            const tone = error ? 'error' : copy.tone;
            return (
              <li
                key={row.provider}
                className={`machine-cli-row machine-cli-row--${tone}`}
              >
                <span className="machine-cli-icon">
                  <StatusIcon tone={tone} />
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
                {error ? (
                  <p
                    className="machine-cli-row-error"
                    role="alert"
                    data-testid={`machine-cli-error-${hostId}-${row.provider}`}
                  >
                    {error}
                  </p>
                ) : null}
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
  installErrors = {},
  renaming,
  renameValue,
  reconnecting,
  reconnectError,
  onRenameValue,
  onRenameStart,
  onRenameCommit,
  onPermissionChange,
  onRetryUpdate,
  onRemove,
  onReconnect,
  onInstall
}: {
  host: Host;
  projectCount: number;
  now: number;
  cliRows: MachineProviderCliRow[];
  busyKey: string | null;
  installErrors?: Record<string, string>;
  renaming: boolean;
  renameValue: string;
  reconnecting: boolean;
  reconnectError: string | null;
  onRenameValue: (value: string) => void;
  onRenameStart: () => void;
  onRenameCommit: () => void;
  onPermissionChange: (mode: Host['maxPermissionMode']) => void;
  onRetryUpdate: () => void;
  onRemove: () => void;
  onReconnect: () => void;
  onInstall: (provider: ProviderCliKey, actionKind: ProviderCliInstallActionKind) => void;
}) {
  const connection = machineConnectionCopy(host, now);
  const HostIcon = host.isPrimary ? Laptop : Monitor;
  const projectLabel = `${projectCount} ${projectCount === 1 ? 'project' : 'projects'}`;
  const showReconnect = machineCanReconnect(host);

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
              title={`Agents on this machine cannot exceed ${permissionLabel(host.maxPermissionMode)}`}
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
          {showReconnect ? (
            <button
              type="button"
              className="settings-btn"
              disabled={reconnecting}
              onClick={onReconnect}
              aria-label={`Reconnect ${host.name}`}
              data-testid={`machine-reconnect-${host.id}`}
            >
              <RefreshCw size={13} aria-hidden="true" className={reconnecting ? 'spinning' : undefined} />
              {reconnecting ? 'Reconnecting…' : 'Reconnect'}
            </button>
          ) : null}
          {host.lastRejectedProtocolVersion ? (
            <button type="button" className="settings-btn" onClick={onRetryUpdate}>
              Retry update
            </button>
          ) : null}
          {host.isPrimary ? null : (
            <button
              type="button"
              className="settings-btn danger"
              disabled={reconnecting}
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
          installErrors={installErrors}
          onInstall={onInstall}
        />
      ) : (
        <div className="machine-cli-offline-wrap">
          <p className="machine-cli-offline">Connect this machine to see harness CLI versions.</p>
          {reconnectError ? (
            <p className="machine-reconnect-error" role="alert">{reconnectError}</p>
          ) : null}
        </div>
      )}
    </li>
  );
}
