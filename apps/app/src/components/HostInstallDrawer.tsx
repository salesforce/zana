import { useEffect, useRef, useState } from 'react';
import { Copy, HardDrive, Loader2, X } from 'lucide-react';
import { copyText } from '../lib/copy-text.js';
import { lastHostInstallRepairTarget, retryLastHostInstall } from '../lib/host-install-run.js';
import { HostRepairAgentAction } from './HostRepairAgentAction.js';
import type { ReactNode } from 'react';
import { HostInstallStages } from './HostInstallStages.js';
import {
  HOST_INSTALL_SUCCESS_CLOSE_MS,
  hostInstallDrawerShouldAutoClose,
  hostInstallDrawerTitle,
  type HostInstallDrawerState
} from '../lib/host-install-drawer.js';
import { useUi } from '../store.js';
import './quick-access-panel.css';

/**
 * Compact quick access panel for live host-daemon Install/Fix logs, styled like
 * {@link NotificationsDrawer}. Opened automatically when composer
 * Install/Fix (or Add remote) starts, and reopened from the busy chip.
 */
export function HostInstallDrawerView({
  busy,
  kind,
  target,
  logs,
  stages = [],
  error,
  pairingCommand,
  onClose,
  onCopyPairing,
  onRetry,
  onLogOpenChange,
  repairAction
}: Pick<HostInstallDrawerState, 'busy' | 'kind' | 'target' | 'logs' | 'error' | 'pairingCommand'> & {
  stages?: HostInstallDrawerState['stages'];
  onClose: () => void;
  onCopyPairing?: () => void;
  onRetry?: () => void;
  onLogOpenChange?: (open: boolean) => void;
  repairAction?: ReactNode;
}) {
  const hasStages = stages.length > 0;
  const [logOpen, setLogOpen] = useState<boolean | null>(null);
  const showLog = logOpen ?? !hasStages;
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs]);

  const title = hostInstallDrawerTitle({ busy, kind, error });

  return (
    <aside className="quick-access-panel host-install-drawer" aria-label="Host daemon install log" data-testid="host-install-drawer"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}>
      <header className="quick-access-header">
        {busy ? (
          <Loader2 size={16} className="host-install-drawer-icon thread-command-send-spin" aria-hidden="true" />
        ) : (
          <HardDrive size={16} className="host-install-drawer-icon" aria-hidden="true" />
        )}
        <h2 className="host-install-drawer-title" role="status">{title}</h2>
        <button
          type="button"
          className="quick-access-icon-button"
          onClick={onClose}
          aria-label="Close install log"
          title="Close (Esc)"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      <div className="quick-access-summary">Remote daemon{target ? ` · ${target}` : ''}</div>

      <div className="quick-access-content host-install-drawer-content">
        {error ? (
          <div role="alert" className="host-install-drawer-error" data-testid="host-install-error">
            {error}
          </div>
        ) : null}

        {hasStages ? <HostInstallStages stages={stages} onRetry={busy ? undefined : onRetry} /> : null}

        {hasStages && logs.length > 0 ? (
          <button
            type="button"
            className="host-install-log-toggle"
            data-testid="host-install-log-toggle"
            aria-expanded={showLog}
            onClick={() => {
              setLogOpen(!showLog);
              onLogOpenChange?.(!showLog);
            }}
          >
            {showLog ? 'Hide log' : 'Show log'}
          </button>
        ) : null}

        {hasStages && !showLog ? null : logs.length === 0 && !error ? (
          <div className="quick-access-empty">
            <span className="quick-access-empty-icon"><HardDrive size={22} aria-hidden="true" /></span>
            <h3>Waiting for install output</h3>
            <p>SSH progress and the remote daemon log will show up here.</p>
          </div>
        ) : logs.length > 0 ? (
          <pre ref={logRef} className="host-install-drawer-log" data-testid="host-install-log">
            {logs.join('\n')}
          </pre>
        ) : null}
        {!busy && error ? repairAction : null}
      </div>

      {pairingCommand && onCopyPairing ? (
        <footer className="quick-access-footer">
          <button
            type="button"
            data-testid="host-install-copy-command"
            onClick={onCopyPairing}
          >
            Copy install command<Copy size={14} aria-hidden="true" />
          </button>
        </footer>
      ) : null}
    </aside>
  );
}

export function HostInstallDrawer() {
  const state = useUi((s) => s.hostInstallDrawer);
  const setOpen = useUi((s) => s.setHostInstallDrawerOpen);
  const repairTarget = lastHostInstallRepairTarget(state.target);
  const closeAfterSuccessRef = useRef(false);
  // A user reading the log keeps the panel; success must not yank it away.
  const logOpenRef = useRef(false);

  useEffect(() => {
    if (state.busy) closeAfterSuccessRef.current = true;
  }, [state.busy]);

  useEffect(() => {
    if (!state.open) logOpenRef.current = false;
  }, [state.open]);

  useEffect(() => {
    if (!hostInstallDrawerShouldAutoClose(state) || !closeAfterSuccessRef.current) return;
    closeAfterSuccessRef.current = false;
    const timer = window.setTimeout(() => {
      const current = useUi.getState().hostInstallDrawer;
      if (!hostInstallDrawerShouldAutoClose(current) || logOpenRef.current) return;
      setOpen(false);
    }, HOST_INSTALL_SUCCESS_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [state, setOpen]);

  if (!state.open) return null;
  return (
    <HostInstallDrawerView
      busy={state.busy}
      kind={state.kind}
      target={state.target}
      logs={state.logs}
      stages={state.stages}
      error={state.error}
      repairAction={repairTarget ? <HostRepairAgentAction state={state} target={repairTarget} /> : undefined}
      pairingCommand={state.pairingCommand}
      onClose={() => setOpen(false)}
      onRetry={() => void retryLastHostInstall().catch(() => {})}
      onLogOpenChange={(open) => { logOpenRef.current = open; }}
      onCopyPairing={state.pairingCommand
        ? () => void copyText(state.pairingCommand!)
        : undefined}
    />
  );
}
