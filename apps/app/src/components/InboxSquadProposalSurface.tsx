import type { InboxHostAction } from '@zana-ai/zcc-domain/product';

export interface InboxSquadProposalSurfaceProps {
  hostAction: InboxHostAction | undefined;
  ownershipLoading: boolean;
  ownershipError: boolean;
  projectAlive: boolean;
  planCheck?: { mustFix: number; check: number; fixedForYou: number };
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
      <PlanCheckLine planCheck={props.planCheck} />
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

/** "Plan check:" with each count in its severity colour (Must fix red, to check amber, fixed for you green). */
function PlanCheckLine({ planCheck }: { planCheck?: { mustFix: number; check: number; fixedForYou: number } }) {
  if (!planCheck) return null;
  const parts: Array<{ severity: 'blocking' | 'warning' | 'repair'; text: string }> = [];
  if (planCheck.mustFix) parts.push({ severity: 'blocking', text: `${planCheck.mustFix} Must fix before this can launch` });
  if (planCheck.check) parts.push({ severity: 'warning', text: `${planCheck.check} to check` });
  if (planCheck.fixedForYou) parts.push({ severity: 'repair', text: `${planCheck.fixedForYou} fixed for you` });
  return (
    <p className="inbox-plan-check" data-testid="inbox-plan-check">
      Plan check:{' '}
      {parts.length
        ? parts.map((part, index) => (
          <span key={part.severity}>{index ? ', ' : ''}<span className="inbox-plan-check-item" data-severity={part.severity}>{part.text}</span></span>
        ))
        : <span className="inbox-plan-check-item" data-severity="ok">No problems found</span>}
      . Review shows the details.
    </p>
  );
}
