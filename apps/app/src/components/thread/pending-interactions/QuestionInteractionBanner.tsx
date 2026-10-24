import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Check } from 'lucide-react';
import { platformShortcut } from '../../../lib/platformShortcut.js';
import type { PendingInteractionUserAnswer, PendingInteractionUserQuestionQuestion } from '@zana-ai/zcc-domain/thread-runtime';
import { loadQuestionDraft, saveQuestionDraft, clearQuestionDraft, questionDraftKey } from './question-drafts.js';
import { PendingInteractionShell } from './PendingInteractionShell.js';
import {
  OTHER_OPTION_LABEL,
  isQuestionAnswered,
  pendingQuestionBannerTitle,
  questionChoiceIndexForKey,
  shouldShowFreeTextInput,
  shouldShowOtherChoice,
  splitInlineCode,
  splitRecommendedLabel,
  toggleOtherChoice,
  toggleQuestionOption,
  toUserAnswerResolution,
  type QuestionAnswerDraft
} from './pending-interaction-question-form.js';

// The primary button's chord; both modifiers work on every platform, as in Inbox.
const PRIMARY_KEYSHORTCUTS = 'Control+Enter Meta+Enter';

function InlineText({ text }: { text: string }) {
  if (!text.includes('`')) return <>{text}</>;
  return (
    <>
      {splitInlineCode(text).map((segment, index) => (
        segment.code ? <code key={index}>{segment.text}</code> : <span key={index}>{segment.text}</span>
      ))}
    </>
  );
}

function QuestionOptionButton({
  checked,
  description,
  disabled,
  label,
  multiSelect,
  shortcut,
  onSelect
}: {
  checked: boolean;
  description?: string;
  disabled: boolean;
  label: string;
  multiSelect: boolean;
  shortcut?: number;
  onSelect: () => void;
}) {
  const { label: cleanLabel, recommended } = splitRecommendedLabel(label);
  return (
    <button
      type="button"
      className={`thread-pending-option${checked ? ' is-selected' : ''}${multiSelect ? ' is-multi' : ''}`}
      aria-pressed={checked}
      aria-keyshortcuts={shortcut ? String(shortcut) : undefined}
      disabled={disabled}
      onClick={onSelect}
    >
      {shortcut ? <span className="thread-pending-option-key" aria-hidden="true">{shortcut}</span> : null}
      <span className="thread-pending-option-mark" aria-hidden="true">
        {checked ? <Check size={10} strokeWidth={3} /> : null}
      </span>
      <span className="thread-pending-option-copy">
        <span className="thread-pending-option-label">
          <InlineText text={cleanLabel} />
          {recommended ? (
            <span className="thread-pending-option-badge" data-testid="thread-pending-option-recommended">Recommended</span>
          ) : null}
        </span>
        {description ? (
          <span className="thread-pending-option-desc"><InlineText text={description} /></span>
        ) : null}
      </span>
    </button>
  );
}

export function QuestionInteractionBanner({
  interactionId,
  questions,
  threadId,
  resolving = false,
  sourceThread,
  onSubmit,
  onCancel
}: {
  interactionId: string;
  questions: PendingInteractionUserQuestionQuestion[];
  threadId: string;
  resolving?: boolean;
  sourceThread?: { href: string; title: string };
  onSubmit: (answers: Record<string, PendingInteractionUserAnswer>) => Promise<unknown>;
  onCancel?: () => Promise<unknown>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const draftKey = questionDraftKey(threadId, interactionId);
  const signature = JSON.stringify(questions);
  const identity = `${draftKey}:${signature}`;
  const [draft, setDraft] = useState(() => ({ identity, ...loadQuestionDraft(draftKey, questions) }));
  if (draft.identity !== identity) setDraft({ identity, ...loadQuestionDraft(draftKey, questions) });
  const activeDraft = draft.identity === identity ? draft : { identity, ...loadQuestionDraft(draftKey, questions) };
  const currentIndex = activeDraft.index;
  const answers = activeDraft.answers;
  const setCurrentIndex = (value: number | ((index: number) => number)) => {
    const index = typeof value === 'function' ? value(currentIndex) : value;
    const next = { ...activeDraft, index };
    saveQuestionDraft(draftKey, next);
    setDraft(next);
  };
  const total = questions.length;
  const current = questions[Math.min(currentIndex, Math.max(total - 1, 0))] ?? null;
  const disabled = busy || resolving;
  const formRef = useRef<HTMLFormElement>(null);
  const refocusAfterMove = useRef(false);
  useEffect(() => {
    // A move can unmount the focused control; keep focus in the panel so the
    // next key (digit, Enter, ⌘↵) still reaches it.
    if (!refocusAfterMove.current) return;
    refocusAfterMove.current = false;
    const form = formRef.current;
    if (!form || form.contains(document.activeElement)) return;
    const target = form.querySelector<HTMLElement>('.thread-pending-option.is-selected')
      ?? form.querySelector<HTMLElement>('.thread-pending-option, .thread-pending-question-input');
    target?.focus();
  }, [currentIndex]);
  const isAnswered = (question: PendingInteractionUserQuestionQuestion) => (
    isQuestionAnswered(question, answers[question.id] ?? { selected: [], otherSelected: false })
  );
  const allAnswered = questions.length > 0 && questions.every(isAnswered);
  const updateAnswer = (
    questionId: string,
    update: (answer: QuestionAnswerDraft) => QuestionAnswerDraft
  ) => {
    const next = { ...activeDraft, answers: { ...answers,
      [questionId]: update(answers[questionId] ?? { selected: [], otherSelected: false })
    } };
    saveQuestionDraft(draftKey, next);
    setDraft(next);
  };
  const finish = (action: () => Promise<unknown>, fallback: string) => {
    if (disabled) return;
    setBusy(true);
    setError(null);
    void Promise.resolve().then(action).then(() => clearQuestionDraft(draftKey, activeDraft)).catch((caught: unknown) => {
      // Stay locked after success until the host removes the card; only failure unlocks it.
      setError(caught instanceof Error ? caught.message : fallback);
      setBusy(false);
    });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!allAnswered) return;
    finish(() => onSubmit(toUserAnswerResolution(questions, answers)), 'Failed to answer question');
  };
  const isLast = currentIndex >= total - 1;
  const currentOptions = current?.options ?? [];
  const showOther = current ? shouldShowOtherChoice(current) : false;
  const choiceCount = currentOptions.length + (showOther ? 1 : 0);
  const selectChoice = (index: number) => {
    if (!current) return;
    const option = currentOptions[index];
    if (option) {
      updateAnswer(current.id, (draft) => toggleQuestionOption(current, draft, option.value));
    } else if (showOther && index === currentOptions.length) {
      updateAnswer(current.id, (draft) => toggleOtherChoice(current, draft));
    }
  };
  // Back/Next and keyboard moves can unmount the focused control (Back on
  // question 1, Next becoming Submit, an option); moveTo keeps focus in the panel.
  const moveTo = (index: number) => {
    refocusAfterMove.current = true;
    setCurrentIndex(index);
  };
  // What the primary button does: Next, Submit, or (last question, something
  // earlier unanswered) jump back to the first unanswered question.
  const advance = (form: HTMLFormElement) => {
    if (!isLast) moveTo(Math.min(currentIndex + 1, total - 1));
    else if (allAnswered) form.requestSubmit();
    else if (current && isAnswered(current)) moveTo(questions.findIndex((question) => !isAnswered(question)));
  };
  const onFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    // ⌘↵ / Ctrl+↵ works from anywhere in the panel, including the free-text box.
    // preventDefault also stops Enter from activating a focused Back or step button.
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      if (!disabled) advance(event.currentTarget);
      return;
    }
    if (disabled || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
    const choice = questionChoiceIndexForKey(event.key, choiceCount);
    if (choice >= 0) {
      event.preventDefault();
      selectChoice(choice);
      return;
    }
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (!(event.target instanceof HTMLElement) || !event.target.closest('.thread-pending-option')) return;
    event.preventDefault();
    advance(event.currentTarget);
  };
  return (
    <PendingInteractionShell
      className="thread-pending-question-banner"
      title={pendingQuestionBannerTitle(total)}
      titleAccessory={total === 1 && current?.shortLabel ? (
        <span className="thread-pending-question-chip" data-testid="thread-pending-question-chip">{current.shortLabel}</span>
      ) : null}
      sourceThread={sourceThread}
      errorMessage={error}
    >
      <form ref={formRef} className="thread-pending-question-form" onSubmit={submit} onKeyDown={onFormKeyDown}>
        {total > 1 ? (
          <div className="thread-pending-question-steps">
            <div className="thread-pending-question-step-list">
              {questions.map((question, index) => {
                const answered = isAnswered(question);
                return (
                  <button
                    key={question.id}
                    type="button"
                    className={`thread-pending-question-step${index === currentIndex ? ' is-active' : ''}${answered ? ' is-answered' : ''}`}
                    data-testid="thread-pending-question-step"
                    title={question.prompt}
                    disabled={disabled}
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
            <legend><InlineText text={current.prompt} /></legend>
            <div className="thread-pending-option-list">
              {currentOptions.map((option, index) => {
                const answer = answers[current.id] ?? { selected: [], otherSelected: false };
                return (
                  <QuestionOptionButton
                    key={option.value}
                    checked={answer.selected.includes(option.value)}
                    description={option.description}
                    disabled={disabled}
                    label={option.label}
                    multiSelect={current.multiSelect}
                    shortcut={index < 9 ? index + 1 : undefined}
                    onSelect={() => selectChoice(index)}
                  />
                );
              })}
              {showOther ? (
                <QuestionOptionButton
                  checked={Boolean(answers[current.id]?.otherSelected)}
                  disabled={disabled}
                  label={OTHER_OPTION_LABEL}
                  multiSelect={current.multiSelect}
                  shortcut={currentOptions.length < 9 ? currentOptions.length + 1 : undefined}
                  onSelect={() => selectChoice(currentOptions.length)}
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
          {choiceCount > 1 ? (
            <span className="thread-pending-question-hint" aria-hidden="true">
              <kbd>1</kbd>–<kbd>{Math.min(choiceCount, 9)}</kbd> to choose · <kbd>↵</kbd> to {isLast ? 'submit' : 'continue'}
            </span>
          ) : null}
          {onCancel ? (
            <button
              type="button"
              className="thread-pending-banner-decision is-ghost"
              disabled={disabled}
              onClick={() => finish(onCancel, 'Could not cancel question')}
            >
              Cancel
            </button>
          ) : null}
          {currentIndex > 0 ? (
            <button
              type="button"
              className="thread-pending-banner-decision is-ghost"
              data-testid="thread-pending-question-back"
              disabled={disabled}
              onClick={() => moveTo(Math.max(currentIndex - 1, 0))}
            >
              Back
            </button>
          ) : null}
          {isLast ? (
            <button
              type="submit"
              className="thread-pending-banner-decision is-primary"
              data-testid="thread-pending-question-submit"
              title={platformShortcut('Submit (⌘↵)')}
              aria-keyshortcuts={PRIMARY_KEYSHORTCUTS}
              disabled={disabled || !allAnswered}
            >
              Submit
            </button>
          ) : (
            <button
              type="button"
              className="thread-pending-banner-decision is-primary"
              data-testid="thread-pending-question-next"
              title={platformShortcut('Next (⌘↵)')}
              aria-keyshortcuts={PRIMARY_KEYSHORTCUTS}
              disabled={disabled}
              onClick={() => moveTo(Math.min(currentIndex + 1, total - 1))}
            >
              Next
            </button>
          )}
        </div>
      </form>
    </PendingInteractionShell>
  );
}
