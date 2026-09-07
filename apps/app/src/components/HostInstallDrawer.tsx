import { useEffect, useRef } from 'react';
import { HardDrive, Loader2, X } from 'lucide-react';
import { copyText } from '../lib/copy-text.js';
import {
  HOST_INSTALL_SUCCESS_CLOSE_MS,
  hostInstallDrawerShouldAutoClose,
  hostInstallDrawerTitle,
  type HostInstallDrawerState
} from '../lib/host-install-drawer.js';
import { useUi } from '../store.js';

/**
 * Right-edge slide-over for live host-daemon Install/Fix logs — the structural
 * twin of {@link NotificationsDrawer}. Opened automatically when composer
 * Install/Fix (or Add remote) starts, and reopened from the busy chip.
 */
export function HostInstallDrawerView({
  busy,
  kind,
  target,
  logs,
  error,
  pairingCommand,
  onClose,
  onCopyPairing
}: Pick<HostInstallDrawerState, 'busy' | 'kind' | 'target' | 'logs' | 'error' | 'pairingCommand'> & {
  onClose: () => void;
  onCopyPairing?: () => void;
}) {
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs]);

  const title = hostInstallDrawerTitle({ busy, kind, error });

  return (
    <aside className="notifications-drawer host-install-drawer" aria-label="Host daemon install log" data-testid="host-install-drawer">
      <header className="notifications-drawer-header">
        {busy ? (
          <Loader2 size={14} className="notifications-drawer-icon thread-command-send-spin" aria-hidden="true" />
        ) : (
          <HardDrive size={14} className="notifications-drawer-icon" aria-hidden="true" />
        )}
        <span className="notifications-drawer-title">{title}</span>
        {target ? <span className="notifications-drawer-count">{target}</span> : null}
        <span className="grow" />
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close install log"
          title="Close"
        >
          <X size={16} />
        </button>
      </header>

      {logs.length === 0 && !error ? (
        <div className="notifications-drawer-empty">
          <HardDrive size={26} aria-hidden="true" />
          <h4>Waiting for install output</h4>
          <p>SSH progress and the remote daemon log will show up here.</p>
        </div>
      ) : (
        <pre ref={logRef} className="host-install-drawer-log" data-testid="host-install-log">
          {logs.join('\n')}
        </pre>
      )}

      {error ? (
        <div className="host-install-drawer-error" data-testid="host-install-error">
          {error}
        </div>
      ) : null}

      {pairingCommand && onCopyPairing ? (
        <footer className="notifications-drawer-footer">
          <button
            type="button"
            className="notifications-drawer-view-all"
            data-testid="host-install-copy-command"
            onClick={onCopyPairing}
          >
            Copy install command
          </button>
        </footer>
      ) : null}
    </aside>
  );
}

export function HostInstallDrawer() {
  const state = useUi((s) => s.hostInstallDrawer);
  const setOpen = useUi((s) => s.setHostInstallDrawerOpen);
  const closeAfterSuccessRef = useRef(false);

  useEffect(() => {
    if (state.busy) closeAfterSuccessRef.current = true;
  }, [state.busy]);

  useEffect(() => {
    if (!hostInstallDrawerShouldAutoClose(state) || !closeAfterSuccessRef.current) return;
    closeAfterSuccessRef.current = false;
    const timer = window.setTimeout(() => {
      const current = useUi.getState().hostInstallDrawer;
      if (!hostInstallDrawerShouldAutoClose(current)) return;
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
      error={state.error}
      pairingCommand={state.pairingCommand}
      onClose={() => setOpen(false)}
      onCopyPairing={state.pairingCommand
        ? () => void copyText(state.pairingCommand!)
        : undefined}
    />
  );
}
