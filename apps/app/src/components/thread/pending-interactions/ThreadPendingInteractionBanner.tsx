import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  isApprovalPendingInteractionPayload,
  isPluginPendingInteraction,
  isPluginExtensionPendingInteraction,
  isUserQuestionPendingInteractionPayload,
  type PendingInteraction,
  type PendingInteractionApprovalDecision
} from '@zana-ai/zcc-domain/thread-runtime';
import { MarkdownContent } from '../../MarkdownContent.js';
import { product } from '../../../lib/product-client.js';
import { canAutomaticallyFocus } from '../../../lib/automatic-focus.js';
import {
  approvalDecisionIndexForKey,
  approvalDecisionLabel,
  approvalDecisionTabIndex,
  approvalDecisionTone,
  buildPendingInteractionApprovalResolution,
  initialApprovalDecisionIndex,
  pendingInteractionSubjectDetails,
  shouldShowPendingInteractionReason,
  type PendingInteractionDetail
} from './pending-interaction-formatting.js';
import { QuestionInteractionBanner } from './QuestionInteractionBanner.js';
import { PendingInteractionShell } from './PendingInteractionShell.js';
import { ThreadPluginInteractionBanner } from './ThreadPluginInteractionBanner.js';

interface SourceThread {
  href: string;
  title: string;
}

export function ThreadPendingInteractionBanner({
  interaction,
  threadId,
  sourceThread
}: {
  interaction: PendingInteraction;
  threadId: string;
  sourceThread?: SourceThread;
}) {
  if (isPluginPendingInteraction(interaction) || isPluginExtensionPendingInteraction(interaction)) {
    return (
      <ThreadPluginInteractionBanner
        interaction={interaction}
        threadId={threadId}
        sourceThread={sourceThread}
      />
    );
  }
  if (isUserQuestionPendingInteractionPayload(interaction.payload)) {
    return (
      <QuestionInteractionBanner
        interactionId={interaction.id}
        questions={interaction.payload.questions}
        resolving={interaction.status === 'resolving'}
        onSubmit={(answers) => product.threads.interactions.resolve(threadId, interaction.id, { kind: 'user_answer', answers })}
        threadId={threadId}
        sourceThread={sourceThread}
      />
    );
  }
  if (!isApprovalPendingInteractionPayload(interaction.payload)) return null;
  return (
    <ApprovalPendingInteractionBanner
      interaction={interaction}
      threadId={threadId}
      sourceThread={sourceThread}
    />
  );
}

function BannerShell({
  className,
  title,
  titleAccessory,
  sourceThread,
  errorMessage,
  footer,
  footerAriaLabel,
  onFooterKeyDown,
  children
}: {
  className?: string;
  title?: string;
  titleAccessory?: ReactNode;
  sourceThread?: SourceThread;
  errorMessage?: string | null;
  footer?: ReactNode;
  footerAriaLabel?: string;
  onFooterKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  children?: ReactNode;
}) {
  return (
    <PendingInteractionShell
      className={className}
      title={title}
      titleAccessory={titleAccessory}
      sourceThread={sourceThread}
      errorMessage={errorMessage}
      footer={footer}
      footerAriaLabel={footerAriaLabel}
      onFooterKeyDown={onFooterKeyDown}
    >
      {children}
    </PendingInteractionShell>
  );
}

function ApprovalPendingInteractionBanner({
  interaction,
  threadId,
  sourceThread
}: {
  interaction: PendingInteraction;
  threadId: string;
  sourceThread?: SourceThread;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const payload = isApprovalPendingInteractionPayload(interaction.payload) ? interaction.payload : null;
  const details = useMemo(() => pendingInteractionSubjectDetails(interaction), [interaction]);
  const decisions = payload?.availableDecisions ?? [];
  const [activeInteractionId, setActiveInteractionId] = useState(interaction.id);
  const [activeIndex, setActiveIndex] = useState(() => initialApprovalDecisionIndex(decisions));
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  if (activeInteractionId !== interaction.id) {
    setActiveInteractionId(interaction.id);
    setActiveIndex(initialApprovalDecisionIndex(decisions));
  }
  useEffect(() => {
    const button = buttonRefs.current[initialApprovalDecisionIndex(decisions)];
    if (button && canAutomaticallyFocus(button)) button.focus();
  }, [interaction.id]); // eslint-disable-line react-hooks/exhaustive-deps -- only consider autofocus for a new prompt
  if (!payload) return null;
  const title = payload.subject.kind === 'command'
    ? 'Waiting for approval'
    : payload.subject.kind === 'file_change'
      ? 'Waiting for file approval'
      : payload.subject.kind === 'permission_grant'
        ? 'Waiting for permission'
        : payload.subject.kind === 'plan'
          ? (payload.reason ?? 'Ready to code?')
          : 'Waiting for approval';
  const submit = (decision: PendingInteractionApprovalDecision) => {
    setBusy(true);
    setError(null);
    void product.threads.interactions.resolve(
      threadId,
      interaction.id,
      buildPendingInteractionApprovalResolution(interaction, decision)
    ).catch((caught: unknown) => {
      // Success keeps the card locked: it stays mounted until the resolve event or refetch
      // removes it, and re-enabling it in that gap invites a double submit.
      setError(caught instanceof Error ? caught.message : 'Failed to resolve pending interaction');
      setBusy(false);
    });
  };
  const moveFocus = (index: number) => {
    setActiveIndex(index);
    buttonRefs.current[index]?.focus();
  };
  const onFooterKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (busy || interaction.status === 'resolving') return;
    if (event.key === 'Enter' || event.key === ' ') {
      const decision = decisions[activeIndex];
      if (!decision) return;
      event.preventDefault();
      submit(decision);
      return;
    }
    const next = approvalDecisionIndexForKey(event.key, activeIndex, decisions.length);
    if (next === undefined) return;
    event.preventDefault();
    moveFocus(next);
  };
  return (
    <BannerShell
      className={payload.subject.kind === 'command' ? 'thread-pending-command' : undefined}
      title={title}
      sourceThread={sourceThread}
      errorMessage={error}
      footerAriaLabel="Approval decisions"
      onFooterKeyDown={onFooterKeyDown}
      footer={decisions.map((decision, index) => (
        <button
          key={decision}
          ref={(node) => {
            buttonRefs.current[index] = node;
          }}
          type="button"
          className={`thread-pending-banner-decision is-${approvalDecisionTone(decision)}`}
          data-testid={`thread-pending-decision-${decision}`}
          tabIndex={approvalDecisionTabIndex(index, activeIndex)}
          disabled={busy || interaction.status === 'resolving'}
          onFocus={() => setActiveIndex(index)}
          onClick={() => submit(decision)}
        >
          {approvalDecisionLabel(decision, payload.subject.kind)}
        </button>
      ))}
    >
      {payload.subject.kind === 'plan' ? (
        <div className="thread-pending-banner-plan" data-testid="thread-pending-plan">
          <div className="thread-pending-banner-plan-body">
            <MarkdownContent text={payload.subject.plan} />
          </div>
          {payload.subject.planFilePath ? (
            <p className="thread-pending-banner-plan-file">{payload.subject.planFilePath}</p>
          ) : null}
        </div>
      ) : (
        <>
          {shouldShowPendingInteractionReason(payload.reason, details) ? (
            <p className="thread-pending-banner-reason">{payload.reason}</p>
          ) : null}
          {payload.subject.kind === 'command' ? (
            <CommandApprovalDetails key={interaction.id} command={payload.subject.command} details={details} />
          ) : details.length > 0 ? (
            <div className="thread-pending-banner-details">
              {details.map((detail, index) => (
                <ApprovalDetailBlock key={`${detail.label}:${index}`} detail={detail} />
              ))}
            </div>
          ) : null}
        </>
      )}
    </BannerShell>
  );
}

function CommandApprovalDetails({ command, details }: { command: string; details: PendingInteractionDetail[] }) {
  const extraDetails = details.filter((detail) => detail.label !== 'Command' && detail.label !== 'Session grant');
  return (
    <>
      <pre className="thread-pending-banner-code" data-testid="thread-pending-banner-code" aria-label="Command">
        {`$ ${command}`}
      </pre>
      {details.filter((detail) => detail.label === 'Session grant').map((detail) => (
        <ApprovalDetailBlock key={detail.label} detail={detail} />
      ))}
      {extraDetails.length > 0 ? (
        <details className="thread-pending-command-extra">
          <summary>Details</summary>
          <div className="thread-pending-banner-details">
            {extraDetails.map((detail, index) => (
              <ApprovalDetailBlock key={`${detail.label}:${index}`} detail={detail} />
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}

function ApprovalDetailBlock({ detail }: { detail: PendingInteractionDetail }) {
  if (detail.kind === 'code') {
    return (
      <div className="thread-pending-banner-detail is-code">
        <span className="thread-pending-banner-detail-label">{detail.label}</span>
        <pre className="thread-pending-banner-code" data-testid="thread-pending-banner-code">
          {detail.label === 'Command' ? `$ ${detail.value}` : detail.value}
        </pre>
      </div>
    );
  }
  return (
    <div className="thread-pending-banner-detail">
      <span className="thread-pending-banner-detail-label">{detail.label}</span>
      <span className="thread-pending-banner-detail-value">{detail.value}</span>
    </div>
  );
}
