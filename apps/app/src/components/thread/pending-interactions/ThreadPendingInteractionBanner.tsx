import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  isApprovalPendingInteractionPayload,
  isPluginPendingInteraction,
  isUserQuestionPendingInteractionPayload,
  type PendingInteraction,
  type PendingInteractionApprovalDecision,
  type PluginPendingInteraction,
  type UserQuestionPendingInteractionPayload
} from '@zana-ai/zcc-domain/thread-runtime';
import { MarkdownContent } from '../../MarkdownContent.js';
import { product } from '../../../lib/product-client.js';
import { listPendingInteractionSlots, subscribePluginSlots } from '../../../plugins/plugin-slots.js';
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
import {
  OTHER_OPTION_LABEL,
  createInitialQuestionAnswers,
  isQuestionAnswered,
  pendingQuestionBannerTitle,
  shouldShowFreeTextInput,
  shouldShowOtherChoice,
  toggleOtherChoice,
  toggleQuestionOption,
  toUserAnswerResolution,
  type QuestionAnswerDraft
} from './pending-interaction-question-form.js';

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
  if (isPluginPendingInteraction(interaction)) {
    return (
      <PluginPendingInteractionBanner
        interaction={interaction}
        threadId={threadId}
        sourceThread={sourceThread}
      />
    );
  }
  if (isUserQuestionPendingInteractionPayload(interaction.payload)) {
    return (
      <QuestionPendingInteractionBanner
        interaction={interaction}
        payload={interaction.payload}
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
  title,
  sourceThread,
  errorMessage,
  footer,
  footerAriaLabel,
  onFooterKeyDown,
  children
}: {
  title?: string;
  sourceThread?: SourceThread;
  errorMessage?: string | null;
  footer?: ReactNode;
  footerAriaLabel?: string;
  onFooterKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  children?: ReactNode;
}) {
  return (
    <div className="thread-pending-banner thread-composer-stack-card" data-testid="thread-pending-banner">
      {sourceThread ? (
        <Link className="thread-pending-banner-source" to={sourceThread.href}>
          From child agent: {sourceThread.title}
        </Link>
      ) : null}
      {title ? <h3 className="thread-pending-banner-title">{title}</h3> : null}
      {children}
      {footer ? (
        <div
          className="thread-pending-banner-actions"
          role={footerAriaLabel ? 'toolbar' : undefined}
          aria-label={footerAriaLabel}
          data-testid={footerAriaLabel ? 'thread-pending-decision-toolbar' : undefined}
          onKeyDown={onFooterKeyDown}
        >
          {footer}
        </div>
      ) : null}
      {errorMessage ? <p className="thread-pending-banner-error">{errorMessage}</p> : null}
    </div>
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
    const alreadyFocused = document.activeElement?.closest('[data-testid="thread-pending-decision-toolbar"]');
    if (alreadyFocused) return;
    buttonRefs.current[initialApprovalDecisionIndex(decisions)]?.focus();
  }, [interaction.id]); // eslint-disable-line react-hooks/exhaustive-deps -- only steal focus when a new prompt appears
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
      setError(caught instanceof Error ? caught.message : 'Failed to resolve pending interaction');
    }).finally(() => setBusy(false));
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
          {details.length > 0 ? (
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

function QuestionOptionButton({
  checked,
  description,
  disabled,
  label,
  multiSelect,
  onSelect
}: {
  checked: boolean;
  description?: string;
  disabled: boolean;
  label: string;
  multiSelect: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`thread-pending-option${checked ? ' is-selected' : ''}${multiSelect ? ' is-multi' : ''}`}
      aria-pressed={checked}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="thread-pending-option-mark" aria-hidden="true">
        {checked ? <Check size={10} strokeWidth={3} /> : null}
      </span>
      <span className="thread-pending-option-copy">
        <span className="thread-pending-option-label">{label}</span>
        {description ? <span className="thread-pending-option-desc">{description}</span> : null}
      </span>
    </button>
  );
}

function QuestionPendingInteractionBanner({
  interaction,
  payload,
  threadId,
  sourceThread
}: {
  interaction: PendingInteraction;
  payload: UserQuestionPendingInteractionPayload;
  threadId: string;
  sourceThread?: SourceThread;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeId, setActiveId] = useState(interaction.id);
  const [answers, setAnswers] = useState<Record<string, QuestionAnswerDraft>>(
    () => createInitialQuestionAnswers(payload.questions)
  );
  if (activeId !== interaction.id) {
    setActiveId(interaction.id);
    setAnswers(createInitialQuestionAnswers(payload.questions));
    setCurrentIndex(0);
  }
  const questions = payload.questions;
  const total = questions.length;
  const current = questions[Math.min(currentIndex, Math.max(total - 1, 0))] ?? null;
  const disabled = busy || interaction.status === 'resolving';
  const allAnswered = questions.every((question) => (
    isQuestionAnswered(question, answers[question.id] ?? { selected: [], otherSelected: false })
  ));
  const updateAnswer = (
    questionId: string,
    update: (answer: QuestionAnswerDraft) => QuestionAnswerDraft
  ) => {
    setAnswers((currentAnswers) => ({
      ...currentAnswers,
      [questionId]: update(currentAnswers[questionId] ?? { selected: [], otherSelected: false })
    }));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (disabled || !allAnswered) return;
    setBusy(true);
    setError(null);
    void product.threads.interactions.resolve(threadId, interaction.id, {
      kind: 'user_answer',
      answers: toUserAnswerResolution(questions, answers)
    }).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : 'Failed to answer question');
    }).finally(() => setBusy(false));
  };
  const isLast = currentIndex >= total - 1;
  return (
    <BannerShell
      title={pendingQuestionBannerTitle(total)}
      sourceThread={sourceThread}
      errorMessage={error}
    >
      <form className="thread-pending-question-form" onSubmit={submit}>
        {total > 1 ? (
          <div className="thread-pending-question-steps">
            <div className="thread-pending-question-step-list">
              {questions.map((question, index) => {
                const answered = isQuestionAnswered(
                  question,
                  answers[question.id] ?? { selected: [], otherSelected: false }
                );
                return (
                  <button
                    key={question.id}
                    type="button"
                    className={`thread-pending-question-step${index === currentIndex ? ' is-active' : ''}${answered ? ' is-answered' : ''}`}
                    data-testid="thread-pending-question-step"
                    title={question.prompt}
                    onClick={() => setCurrentIndex(index)}
                  >
                    {question.shortLabel ?? String(index + 1)}
                  </button>
                );
              })}
            </div>
            <span className="thread-pending-question-progress">{currentIndex + 1} of {total}</span>
          </div>
        ) : null}
        {current ? (
          <fieldset className="thread-pending-question" disabled={disabled}>
            <legend>{current.prompt}</legend>
            <div className="thread-pending-option-list">
              {(current.options ?? []).map((option) => {
                const answer = answers[current.id] ?? { selected: [], otherSelected: false };
                return (
                  <QuestionOptionButton
                    key={option.value}
                    checked={answer.selected.includes(option.value)}
                    description={option.description}
                    disabled={disabled}
                    label={option.label}
                    multiSelect={current.multiSelect}
                    onSelect={() => updateAnswer(current.id, (draft) => (
                      toggleQuestionOption(current, draft, option.value)
                    ))}
                  />
                );
              })}
              {shouldShowOtherChoice(current) ? (
                <QuestionOptionButton
                  checked={Boolean(answers[current.id]?.otherSelected)}
                  disabled={disabled}
                  label={OTHER_OPTION_LABEL}
                  multiSelect={current.multiSelect}
                  onSelect={() => updateAnswer(current.id, (draft) => toggleOtherChoice(current, draft))}
                />
              ) : null}
            </div>
            {shouldShowFreeTextInput(
              current,
              answers[current.id] ?? { selected: [], otherSelected: false }
            ) ? (
              <textarea
                className="thread-pending-question-input"
                data-testid="thread-pending-question-input"
                value={answers[current.id]?.freeText ?? ''}
                placeholder="Type your own answer…"
                aria-label={current.prompt}
                rows={3}
                onChange={(event) => {
                  const freeText = event.target.value;
                  updateAnswer(current.id, (draft) => ({ ...draft, freeText }));
                }}
              />
            ) : null}
          </fieldset>
        ) : null}
        <div className="thread-pending-banner-actions">
          {currentIndex > 0 ? (
            <button
              type="button"
              className="thread-pending-banner-decision is-ghost"
              data-testid="thread-pending-question-back"
              disabled={disabled}
              onClick={() => setCurrentIndex((index) => Math.max(index - 1, 0))}
            >
              Back
            </button>
          ) : null}
          {isLast ? (
            <button
              type="submit"
              className="thread-pending-banner-decision is-primary"
              data-testid="thread-pending-question-submit"
              disabled={disabled || !allAnswered}
            >
              Submit
            </button>
          ) : (
            <button
              type="button"
              className="thread-pending-banner-decision is-primary"
              data-testid="thread-pending-question-next"
              disabled={disabled}
              onClick={() => setCurrentIndex((index) => Math.min(index + 1, total - 1))}
            >
              Next
            </button>
          )}
        </div>
      </form>
    </BannerShell>
  );
}

function PluginPendingInteractionBanner({
  interaction,
  threadId,
  sourceThread
}: {
  interaction: PluginPendingInteraction;
  threadId: string;
  sourceThread?: SourceThread;
}) {
  const [generation, setGeneration] = useState(0);
  useEffect(() => subscribePluginSlots(() => setGeneration((current) => current + 1)), []);
  const slot = listPendingInteractionSlots().find(
    (entry) => entry.id === interaction.origin.rendererId && entry.pluginId === interaction.origin.pluginId
  );
  void generation;
  if (!slot) {
    return (
      <BannerShell title={interaction.payload.title} sourceThread={sourceThread}>
        <p className="thread-pending-banner-reason">Plugin form is not registered.</p>
      </BannerShell>
    );
  }
  const Component = slot.component;
  return (
    <BannerShell title={interaction.payload.title} sourceThread={sourceThread}>
      <Component
        interaction={{
          id: interaction.id,
          threadId: interaction.threadId,
          title: interaction.payload.title,
          payload: interaction.payload.data,
          createdAt: interaction.createdAt,
          expiresAt: interaction.expiresAt ?? null
        }}
        submit={async (value) => {
          await product.threads.interactions.respond(threadId, interaction.id, value);
        }}
        cancel={async () => {
          await product.threads.interactions.cancel(threadId, interaction.id);
        }}
      />
    </BannerShell>
  );
}
