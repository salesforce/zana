import type { PeerLinkHookFailure } from '@zana-ai/zcc-server-contract';

/** "<A> is transferring with <host>." per plugin, then " Stop anyway?". */
export function activeUseText(labels: string[], host: string): string {
  return `${labels.map((label) => `${label} is transferring with ${host}.`).join(' ')} Stop anyway?`;
}

/** Names each plugin that failed its cleanup hook and why. */
export function hookFailureText(failures: Pick<PeerLinkHookFailure, 'label' | 'reason'>[]): string {
  return failures
    .map((failure) => `${failure.label} didn't finish cleaning up (${failure.reason === 'timeout' ? 'timed out' : 'failed'}).`)
    .join(' ');
}

export function ActiveUseConfirm({ active, host, onStop, onCancel, busy }: {
  active: { label: string }[];
  host: string;
  onStop: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <div className="peers-confirm" role="alertdialog" aria-label={`Active transfer with ${host}`}>
      <p className="peers-confirm-text">{activeUseText(active.map((entry) => entry.label), host)}</p>
      <div className="peers-dialog-actions"><button type="button" className="btn" onClick={onCancel}>Keep syncing</button><button type="button" className="btn danger" disabled={busy} onClick={onStop}>Stop anyway</button></div>
    </div>
  );
}

export function RemovePluginsConfirm({ text, onConfirm, onCancel, busy }: {
  text: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <div className="peers-confirm" role="alertdialog" aria-label="Confirm removing computer link">
      <p className="peers-confirm-text">{text} This happens on this computer now; the other computer does not need to be online.</p>
      <div className="peers-dialog-actions"><button type="button" className="btn" onClick={onCancel}>Keep</button><button type="button" className="btn danger" disabled={busy} onClick={onConfirm}>Remove</button></div>
    </div>
  );
}

export function HookFailureDialog({ failures, onRetry, onRemoveAnyway, onCancel, busy }: {
  failures: PeerLinkHookFailure[];
  onRetry: () => void;
  onRemoveAnyway: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <div className="peers-confirm" role="alertdialog" aria-label="Plugin cleanup did not finish">
      <p className="peers-confirm-text">{hookFailureText(failures)}</p>
      <div className="peers-dialog-actions"><button type="button" className="btn" disabled={busy} onClick={onRetry}>Retry</button><button type="button" className="btn danger" disabled={busy} onClick={onRemoveAnyway}>Remove anyway</button><button type="button" className="btn" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}
