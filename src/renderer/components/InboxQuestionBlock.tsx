import { useState } from 'react';
import { CornerDownLeft, MessageSquare } from 'lucide-react';
import type { InboxEntry, InboxQuestion } from '@shared/types';
import { replyToInboxEntry, useInboxAnswered } from '../store';
import { MarkdownContent } from './MarkdownContent';

/**
 * Structured multiple-choice question form — the interactive half of the
 * `inbox_ask` loop, and the Cursor-IDE "Questions" panel analogue. Extracted
 * from `InboxDetail` so BOTH the inbox detail pane AND the agent terminal modal
 * render the SAME form (a question surfaced in the inbox also appears in the
 * agent's modal when you open it — see {@link AgentTerminalModal}). Keeping one
 * component means the two surfaces can't drift.
 *
 * Handles BOTH shapes uniformly via a flat `questions` list (see
 * {@link inboxQuestions}): a lone question renders its options directly; multiple
 * questions each render their own `prompt` heading + options, stacked in one
 * card. The `prompt` prop renders the question's own text as a heading INSIDE
 * the card (so the user always sees WHAT they're answering, right above the
 * options — the card is self-contained on every surface). Continue is enabled
 * only once EVERY question has an answer.
 *
 * On Continue the answers are injected into the originating pty via the SAME
 * `replyToInboxEntry` channel the free-text box uses — so an agent that asked
 * via `inbox_ask` and blocked gets the answer as if typed. For a single question
 * the raw answer is sent; for several, a labelled "Q: …\nA: …" block per
 * question. Skip marks the entry answered without sending anything (the user
 * declined). ⌘/Ctrl+Enter submits when everything is answered.
 */

/** Per-question answer state, one entry per question in the card. */
export interface QState {
  /** Selected option ids (a Set even in radio mode, holding 0 or 1). */
  selected: Set<string>;
  otherText: string;
  otherActive: boolean;
}

export const emptyQState = (): QState => ({ selected: new Set(), otherText: '', otherActive: false });

/**
 * Build one question's answer string from its state. Radio joins to one label;
 * multi joins with newlines. The Other text is appended when active + non-empty
 * (and is the whole answer in radio mode).
 */
export function answerFor(question: InboxQuestion, st: QState): string {
  const multi = question.multiSelect === true;
  const chosen = question.options.filter((o) => st.selected.has(o.id)).map((o) => o.label);
  const other = st.otherActive && st.otherText.trim() ? st.otherText.trim() : '';
  if (multi) {
    const parts = [...chosen];
    if (other) parts.push(other);
    return parts.join(', ');
  }
  if (st.otherActive && other) return other;
  return chosen[0] ?? '';
}

export function QuestionBlock({
  entry,
  questions,
  prompt,
  sessionId,
  sessionTitle,
  onAnswerDeadSession,
  deadSessionBusy = false
}: {
  entry: InboxEntry;
  questions: InboxQuestion[];
  /** The question's own text, shown as a heading INSIDE the card so it's
   *  self-contained (the user sees WHAT they're answering right above the
   *  options). For a lone question this is the entry's question text (its
   *  `comments`); for a multi-question card it's the shared preamble. Callers
   *  pass it so the block never depends on separately-rendered context above it.
   *  Omit / empty ⇒ no heading (multi-question items still render their own
   *  per-question `prompt`). Markdown is allowed. */
  prompt?: string;
  /** The LIVE session to inject into — the originating tab, or a reopened one.
   *  Absent in dead-session mode; then `onAnswerDeadSession` carries the answer
   *  by reopening the agent (resume / fresh) with it as the first turn. */
  sessionId?: string;
  sessionTitle: string;
  /** Dead-session delivery: reopen the agent with the answer as its first turn.
   *  Set (with no `sessionId`) when the originating session has ended. */
  onAnswerDeadSession?: (answer: string) => Promise<boolean>;
  /** True while a reopen is in flight (disables Continue in dead-session mode). */
  deadSessionBusy?: boolean;
}) {
  const answered = useInboxAnswered((s) => !!s.answeredIds[entry.id]);
  const [states, setStates] = useState<QState[]>(() => questions.map(emptyQState));
  const [sending, setSending] = useState(false);
  const [reopened, setReopened] = useState(false);

  const dead = !sessionId && !!onAnswerDeadSession;
  const busy = sending || deadSessionBusy;
  const isMulti = questions.length > 1;
  const collapsed = answered && !reopened;

  const patch = (qi: number, next: QState) =>
    setStates((prev) => prev.map((s, i) => (i === qi ? next : s)));

  const toggle = (qi: number, id: string) => {
    const q = questions[qi];
    const st = states[qi] ?? emptyQState();
    const multi = q.multiSelect === true;
    if (multi) {
      const selected = new Set(st.selected);
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      patch(qi, { ...st, selected });
    } else {
      // Radio: picking an option deselects the (mutually exclusive) Other row.
      patch(qi, { ...st, selected: new Set([id]), otherActive: false });
    }
  };

  // Per-question answers, in question order. A question is "answered" when its
  // string is non-empty; Continue needs every one answered. `states[i]` can lag
  // `questions` for a render if the entry gains a question in place (the mount is
  // keyed by entry.id, so a switch to a different entry resets cleanly) — fall
  // back to an empty state so we never read `.selected` off undefined.
  const answers = questions.map((q, i) => answerFor(q, states[i] ?? emptyQState()));
  const canSend = answers.every((a) => a.trim().length > 0);

  // What actually gets injected. One question → its raw answer (unchanged from
  // the single-question behaviour). Many → a labelled block so the agent can tell
  // the answers apart.
  const buildReply = (): string => {
    if (!isMulti) return answers[0] ?? '';
    return questions
      .map((q, i) => `Q${i + 1}: ${q.prompt ?? ''}\nA: ${answers[i]}`)
      .join('\n\n');
  };

  const submit = async () => {
    if (busy || !canSend) return;
    setSending(true);
    const ok = dead
      ? await onAnswerDeadSession!(buildReply())
      : await replyToInboxEntry(entry.id, sessionId!, buildReply());
    setSending(false);
    if (ok) setReopened(false);
  };

  const skip = () => {
    // Skip declines to answer: no injection, just mark answered so the form
    // collapses. The agent stays blocked (that's the user's choice) unless it
    // later gets a real reply.
    useInboxAnswered.getState().markAnswered(entry.id);
    setReopened(false);
  };

  if (collapsed) {
    return (
      <div className="inbox-reply answered">
        <span className="inbox-reply-answered-label">
          <CornerDownLeft size={13} strokeWidth={1.75} />
          Answered <span className="strong">{sessionTitle}</span>
        </span>
        <button type="button" className="inbox-reply-again" onClick={() => setReopened(true)}>
          Answer again
        </button>
      </div>
    );
  }

  const caption = isMulti
    ? `Your input · ${questions.length} questions`
    : questions[0]?.multiSelect
      ? 'Your input · pick any'
      : 'Your input';

  return (
    <div className="inbox-question">
      <span className="inbox-question-caption">
        <MessageSquare size={12} strokeWidth={2} />
        {caption}
      </span>
      {prompt && prompt.trim() && (
        <div className="inbox-question-heading">
          <MarkdownContent text={prompt.trim()} />
        </div>
      )}
      {questions.map((q, qi) => {
        const multi = q.multiSelect === true;
        const st = states[qi] ?? emptyQState();
        return (
          <div className="inbox-question-item" key={qi}>
            {/* A per-question heading only when several are stacked; a lone
                question's prompt already shows in the entry's Comments. */}
            {isMulti && q.prompt && (
              <div className="inbox-question-prompt">
                <span className="inbox-question-index">{qi + 1}</span>
                <MarkdownContent text={q.prompt} />
              </div>
            )}
            <div className="inbox-question-options" role={multi ? 'group' : 'radiogroup'}>
              {q.options.map((opt) => {
                // In radio mode an active Other row deselects every option; in
                // multi mode options and Other coexist.
                const on = st.selected.has(opt.id) && (multi || !st.otherActive);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    className={`inbox-question-option ${on ? 'is-selected' : ''}`}
                    role={multi ? 'checkbox' : 'radio'}
                    aria-checked={on}
                    onClick={() => toggle(qi, opt.id)}
                  >
                    <span className="inbox-question-key">{opt.id}</span>
                    <span className="inbox-question-label">{opt.label}</span>
                  </button>
                );
              })}
              {q.allowOther && (
                <div
                  className={`inbox-question-option inbox-question-other ${st.otherActive ? 'is-selected' : ''}`}
                >
                  <span className="inbox-question-key">
                    {String.fromCharCode(65 + q.options.length)}
                  </span>
                  <input
                    className="inbox-question-other-input"
                    value={st.otherText}
                    placeholder="Other…"
                    aria-label="Other answer"
                    onFocus={() =>
                      patch(qi, {
                        ...st,
                        otherActive: true,
                        selected: multi ? st.selected : new Set()
                      })
                    }
                    onChange={(e) => patch(qi, { ...st, otherText: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        void submit();
                      }
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        );
      })}
      <div className="inbox-question-actions">
        <button type="button" className="inbox-question-skip" onClick={skip} disabled={busy}>
          Skip
        </button>
        <button
          type="button"
          className="inbox-question-continue"
          onClick={() => void submit()}
          disabled={busy || !canSend}
          title="Continue (⌘↵)"
        >
          {busy ? (dead ? 'Reopening…' : 'Sending…') : dead ? 'Reopen & answer' : 'Continue'}
          <CornerDownLeft size={13} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
