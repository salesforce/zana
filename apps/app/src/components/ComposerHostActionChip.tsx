import { Loader2 } from 'lucide-react';
import type { ComposerHostAction } from './composer-host-status.js';

export function ComposerHostActionChip({
  action,
  busyLabel,
  pairingCommand,
  onAction,
  onCopyPairing
}: {
  action: ComposerHostAction;
  busyLabel?: string | null;
  pairingCommand?: string | null;
  onAction: () => void;
  onCopyPairing?: () => void;
}) {
  if (action.kind === 'ready') return null;
  const label = busyLabel
    ?? (action.kind === 'blocked' ? 'Unavailable' : action.label);
  const clickable = (action.kind === 'install' || action.kind === 'fix') && !busyLabel;
  return (
    <div className="thread-command-chip thread-command-host-action">
      <button
        type="button"
        className="thread-command-host-action-btn"
        data-testid="composer-host-action"
        title={action.reason}
        disabled={!clickable}
        onClick={onAction}
      >
        {busyLabel ? <Loader2 size={12} className="thread-command-send-spin" aria-hidden="true" /> : null}
        {label}
      </button>
      {pairingCommand && onCopyPairing ? (
        <button
          type="button"
          className="thread-command-host-copy"
          data-testid="composer-host-copy-command"
          onClick={onCopyPairing}
        >
          Copy install command
        </button>
      ) : null}
    </div>
  );
}
