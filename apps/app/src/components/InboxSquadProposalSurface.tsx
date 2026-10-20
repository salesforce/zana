import type { InboxHostAction } from '@zana-ai/zcc-domain/product';

export interface InboxSquadProposalSurfaceProps {
  hostAction: InboxHostAction | undefined;
  ownershipLoading: boolean;
  ownershipError: boolean;
  projectAlive: boolean;
  reviewBusy: boolean;
  dismissBusy: boolean;
  reviewError: string | null;
  dismissError: string | null;
  onRetry(): void;
  onReview(): void;
  onDismiss(): void;
}

/**
 * The Squad launch proposal card's answer surface. Dismiss needs main's host action: until
 * the first lookup lands, say so; a later re-resolve keeps the known action, and the
 * buttons, mounted so focus survives.
 */
export function InboxSquadProposalSurface(props: InboxSquadProposalSurfaceProps) {
  const { hostAction } = props;
  if (props.ownershipError) {
    return (
      <div className="inbox-reply" role="alert">
        Couldn't check this Squad launch.
        <button type="button" onClick={props.onRetry}>Retry</button>
      </div>
    );
  }
  if (props.ownershipLoading && !hostAction) {
    return <div className="inbox-reply" role="status">Checking this Squad launch…</div>;
  }
  if (!hostAction || hostAction.unavailable || hostAction.status === 'done') {
    return (
      <div className="inbox-reply">
        <div className="inbox-detail-unavailable" role="status">{hostAction?.message ?? 'This Squad launch is no longer available.'}</div>
      </div>
    );
  }
  const busy = props.reviewBusy || props.dismissBusy;
  // Main's reason (e.g. "This Squad launch is starting.") wins over the generic dismiss text.
  const notice = hostAction.message || props.dismissError;
  return (
    <div className="inbox-reply" data-testid="squad-proposal-surface">
      <p>Review opens the Squad composer filled in. Nothing starts until you press Launch.</p>
      {notice ? <p role="alert">{notice}</p> : null}
      {props.reviewError ? <p role="alert">{props.reviewError}</p> : null}
      <div className="inbox-reply-actions">
        <button type="button" className="btn primary" disabled={busy || !props.projectAlive} onClick={props.onReview}>
          {props.reviewBusy ? 'Opening…' : 'Review Squad launch'}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={props.onDismiss}>Dismiss</button>
      </div>
    </div>
  );
}
