import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  isApprovalPendingInteractionPayload,
  isPluginPendingInteraction,
  isUserQuestionPendingInteractionPayload,
  type PendingInteraction,
  type PendingInteractionApprovalDecision,
  type PendingInteractionUserAnswer,
  type PluginPendingInteraction,
  type UserQuestionPendingInteractionPayload
} from '@zana-ai/zcc-domain/thread-runtime';
import { product } from '../../../lib/product-client.js';
import { listPendingInteractionSlots, subscribePluginSlots } from '../../../plugins/plugin-slots.js';
import {
  approvalDecisionLabel,
  buildPendingInteractionApprovalResolution,
  formatPendingInteractionSubjectDetailLines
} from './pending-interaction-formatting.js';

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
  children
}: {
  title?: string;
  sourceThread?: SourceThread;
  errorMessage?: string | null;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="thread-pending-banner" data-testid="thread-pending-banner">
      {sourceThread ? (
        <Link className="thread-pending-banner-source" to={sourceThread.href}>
          From child thread: {sourceThread.title}
        </Link>
      ) : null}
      {title ? <h3 className="thread-pending-banner-title">{title}</h3> : null}
      {children}
      {footer ? <div className="thread-pending-banner-actions">{footer}</div> : null}
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
  const details = useMemo(() => formatPendingInteractionSubjectDetailLines(interaction), [interaction]);
  if (!payload) return null;
  const title = payload.subject.kind === 'command'
    ? 'Waiting for approval'
    : payload.subject.kind === 'file_change'
      ? 'Waiting for file approval'
      : payload.subject.kind === 'permission_grant'
        ? 'Waiting for permission'
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
  return (
    <BannerShell
      title={title}
      sourceThread={sourceThread}
      errorMessage={error}
      footer={payload.availableDecisions.map((decision) => (
        <button
          key={decision}
          type="button"
          className="thread-pending-banner-decision"
          data-testid={`thread-pending-decision-${decision}`}
          disabled={busy || interaction.status === 'resolving'}
          onClick={() => submit(decision)}
        >
          {approvalDecisionLabel(decision)}
        </button>
      ))}
    >
      {payload.reason ? <p className="thread-pending-banner-reason">{payload.reason}</p> : null}
      {details.length > 0 ? (
        <ul className="thread-pending-banner-details">
          {details.map((line) => <li key={line}>{line}</li>)}
        </ul>
      ) : null}
    </BannerShell>
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
  const [answers, setAnswers] = useState<Record<string, PendingInteractionUserAnswer>>(() => {
    const initial: Record<string, PendingInteractionUserAnswer> = {};
    for (const question of payload.questions) {
      initial[question.id] = { selected: [], freeText: question.allowFreeText ? '' : undefined };
    }
    return initial;
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const resolutionAnswers: Record<string, PendingInteractionUserAnswer> = {};
    for (const [id, answer] of Object.entries(answers)) {
      resolutionAnswers[id] = {
        selected: answer.selected,
        ...(answer.freeText && answer.freeText.trim() ? { freeText: answer.freeText } : {})
      };
    }
    void product.threads.interactions.resolve(threadId, interaction.id, {
      kind: 'user_answer',
      answers: resolutionAnswers
    }).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : 'Failed to answer question');
    }).finally(() => setBusy(false));
  };
  return (
    <BannerShell sourceThread={sourceThread} errorMessage={error}>
      <form className="thread-pending-question-form" onSubmit={submit}>
        {payload.questions.map((question) => {
          const answer = answers[question.id] ?? { selected: [] };
          return (
            <fieldset key={question.id} className="thread-pending-question">
              <legend>{question.prompt}</legend>
              {(question.options ?? []).map((option) => (
                <label key={option.value}>
                  <input
                    type={question.multiSelect ? 'checkbox' : 'radio'}
                    name={question.id}
                    value={option.value}
                    checked={answer.selected.includes(option.value)}
                    onChange={() => {
                      setAnswers((current) => {
                        const selected = question.multiSelect
                          ? current[question.id]?.selected.includes(option.value)
                            ? current[question.id]!.selected.filter((value) => value !== option.value)
                            : [...(current[question.id]?.selected ?? []), option.value]
                          : [option.value];
                        return {
                          ...current,
                          [question.id]: { ...current[question.id], selected, freeText: current[question.id]?.freeText }
                        };
                      });
                    }}
                  />
                  {option.label}
                </label>
              ))}
              {question.allowFreeText ? (
                <input
                  className="thread-pending-question-input"
                  value={answer.freeText ?? ''}
                  placeholder="Answer…"
                  aria-label={question.prompt}
                  onChange={(event) => {
                    const freeText = event.target.value;
                    setAnswers((current) => ({
                      ...current,
                      [question.id]: { selected: current[question.id]?.selected ?? [], freeText }
                    }));
                  }}
                />
              ) : null}
            </fieldset>
          );
        })}
        <button
          type="submit"
          className="thread-pending-banner-decision"
          data-testid="thread-pending-question-submit"
          disabled={busy || interaction.status === 'resolving'}
        >
          Submit
        </button>
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
