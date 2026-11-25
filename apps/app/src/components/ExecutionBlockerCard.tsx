import { useEffect, useId, useRef, useState, type Ref } from 'react';
import type { ExecutionBoardProjection } from '@zana-ai/zcc-domain/product';
import { formatAge } from '@/lib/squad-worker-visibility';

export type ExecutionBlocker = NonNullable<ExecutionBoardProjection['currentBlocker']>;
export type BlockerDeliveryState = NonNullable<ExecutionBlocker['delivery']>['state'];

interface Props {
  blocker: ExecutionBlocker;
  deliveryState?: BlockerDeliveryState;
  recorded: boolean;
  closed: boolean;
  timedOut: boolean;
  answer?: string;
  workTitle?: string;
  busy: boolean;
  sectionRef: Ref<HTMLElement>;
  onRespond: (answer: string) => void;
  onRetry: (deliveryId: string) => void;
}

const ANSWER_LIMIT = 16 * 1024;
const deliveryLabels = {
  PENDING: 'Pending delivery',
  LEASED: 'Awaiting worker acknowledgement',
  FAILED: 'Delivery failed',
  DELIVERED: 'Delivered'
};

export function ExecutionBlockerCard({
  blocker, deliveryState, recorded, closed, timedOut, answer, workTitle, busy, sectionRef, onRespond, onRetry
}: Props) {
  const questionId = useId();
  const inputId = useId();
  const limitId = useId();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const focusReceipt = useRef(false);
  const [draft, setDraft] = useState('');
  const [editingDeliveryId, setEditingDeliveryId] = useState<string>();
  const { delivery, notice } = blocker;
  const coordinator = blocker.audience === 'coordinator';
  const phase = deliveryState === 'DELIVERED' ? 'delivered'
    : recorded ? 'recorded'
    : closed ? 'closed'
    : deliveryState === 'FAILED' ? 'failed'
    : deliveryState === 'PENDING' || deliveryState === 'LEASED' ? 'queued'
    : coordinator ? 'coordinator' : 'open';
  const editingFailed = phase === 'failed' && !!delivery && delivery.id === editingDeliveryId;
  const showForm = (phase === 'open' || editingFailed) && !coordinator;
  const message = draft.trim();
  const tooLarge = new TextEncoder().encode(message).byteLength > ANSWER_LIMIT;
  const statusLabel = {
    open: 'Needs your response', queued: 'Answer queued', failed: 'Delivery failed',
    delivered: 'Answer delivered', recorded: 'Answer recorded',
    closed: 'Squad run closed', coordinator: 'Coordinator deciding'
  }[phase];
  const hint = {
    open: undefined,
    queued: 'Waiting for the worker to acknowledge it.',
    failed: editingFailed ? undefined : 'The worker did not confirm receipt.',
    delivered: 'The worker acknowledged the answer.',
    recorded: 'The run recorded the answer.',
    closed: timedOut ? 'Timed out while waiting for this blocker.' : 'This question is retained in the run history.',
    coordinator: 'The Squad coordinator is handling this question.'
  }[phase];

  useEffect(() => {
    if (showForm || !focusReceipt.current) return;
    focusReceipt.current = false;
    statusRef.current?.focus({ preventScroll: true });
  }, [showForm]);
  useEffect(() => {
    if (editingFailed) fieldRef.current?.focus();
  }, [editingFailed]);

  return (
    <section ref={sectionRef} className="execution-blocker" aria-labelledby={questionId}>
      <header className="execution-blocker-heading">
        <div className="execution-blocker-top">
          <span ref={statusRef} tabIndex={-1} role={phase === 'failed' ? 'alert' : 'status'} className="execution-blocker-badge" data-phase={phase}>{statusLabel}</span>
          {phase === 'open' && blocker.waitingSince !== undefined && (
            <span className="execution-blocker-wait" data-testid="execution-blocker-wait">Waiting {formatAge(Date.now() - blocker.waitingSince)}</span>
          )}
        </div>
        <h4 id={questionId} className="execution-blocker-question">{blocker.question}</h4>
        {workTitle && <p className="execution-blocker-step">Work step · {workTitle}</p>}
      </header>

      {showForm ? (
        <form className="execution-blocker-body" onSubmit={(event) => {
          event.preventDefault();
          if (!message || tooLarge || busy) return;
          focusReceipt.current = true;
          onRespond(message);
        }}>
          {!!blocker.options?.length && (
            <p className="execution-blocker-options"><strong>Suggested answers</strong> · <span>{blocker.options.join(' · ')}</span></p>
          )}
          <label className="execution-blocker-label" htmlFor={inputId}>Your answer</label>
          <textarea
            ref={fieldRef}
            id={inputId}
            aria-describedby={tooLarge ? limitId : undefined}
            aria-invalid={tooLarge || undefined}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Give the worker a decision, missing detail, or approval…"
            rows={3}
          />
          <div className="execution-blocker-actions">
            {tooLarge && <span id={limitId} className="execution-blocker-limit" role="status">Your answer exceeds 16 KB.</span>}
            <button className="btn primary" type="submit" disabled={busy || !message || tooLarge}>Send answer</button>
          </div>
        </form>
      ) : (
        <div className="execution-blocker-body">
          {answer && (
            <div className="execution-blocker-receipt"><small>Your answer</small><p>{answer}</p></div>
          )}
          <p className="execution-blocker-hint">{hint}</p>
          {phase === 'failed' && delivery && !coordinator && (
            <div className="execution-blocker-actions">
              <button type="button" className="btn" disabled={busy} onClick={() => {
                setDraft(answer ?? '');
                setEditingDeliveryId(delivery.id);
              }}>Write a new answer</button>
              {delivery.retryEligible && <button type="button" className="btn primary" disabled={busy} onClick={() => onRetry(delivery.id)}>Retry delivery</button>}
            </div>
          )}
        </div>
      )}

      {(notice || delivery) && (
        <details className="execution-blocker-diagnostics">
          <summary>Delivery details</summary>
          <dl>
            {notice && <>
              <dt>Inbox notice</dt><dd>{notice.status.toLowerCase()}</dd>
              <dt>Inbox attempts</dt><dd>{notice.attempts}</dd>
              {notice.inboxItemId && <><dt>Inbox item</dt><dd>{notice.inboxItemId}</dd></>}
            </>}
            {delivery && <>
              <dt>Delivery status</dt><dd>{deliveryLabels[delivery.state]}</dd>
              <dt>Delivery attempts</dt><dd>{delivery.attempt} of {delivery.maxAttempts}</dd>
              {delivery.error && <><dt>Last error</dt><dd>{delivery.error}</dd></>}
            </>}
          </dl>
        </details>
      )}
    </section>
  );
}
