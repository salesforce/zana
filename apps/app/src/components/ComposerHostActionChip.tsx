import { Download, Loader2, Wrench } from 'lucide-react';
import { composerHostActionChipLabel, type ComposerHostAction } from './composer-host-status.js';

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
  const label = busyLabel ?? composerHostActionChipLabel(action);
  if (!label) return null;
  const clickable = action.kind === 'install' || action.kind === 'fix';
  const title = action.kind === 'ready' ? undefined : action.reason;
  return (
    <div className="thread-command-host-action">
      <button
        type="button"
        className={[
          'thread-command-host-action-btn',
          clickable ? 'is-cta' : '',
          action.kind === 'install' && !busyLabel ? 'is-install' : ''
        ].filter(Boolean).join(' ')}
        data-testid="composer-host-action"
        title={title}
        aria-label={title ?? label}
        disabled={!clickable}
        onClick={onAction}
      >
        {busyLabel ? (
          <Loader2 size={12} className="thread-command-send-spin" aria-hidden="true" />
        ) : action.kind === 'install' ? (
          <Download size={12} aria-hidden="true" />
        ) : action.kind === 'fix' ? (
          <Wrench size={12} aria-hidden="true" />
        ) : null}
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
