import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, ExternalLink } from 'lucide-react';
import type { CompanionRequest } from '@zana-ai/zcc-domain/product';
import { product } from '../../lib/product-client.js';
import { answerFor, buildReply, emptyQState, splitRecommended, type QState } from '../../lib/inbox-answer.js';
import { UNANSWERABLE_COPY } from './companion-model.js';
import { CompanionThreadRequest } from './CompanionThreadRequest.js';

const FAIL_COPY: Record<string, string> = {
  ended: 'The agent is no longer running.',
  background: 'Background jobs can only be answered from the app.',
  execution: 'Respond to execution blockers from the app.',
  empty: 'Type an answer first.',
  unknown: 'This request is no longer pending.'
};

/**
 * Expanded Needs You card (level 3): the question with numbered options, a
 * "Recommended" tag, Other, Skip and Send. On success it shows "Sent ✓" briefly,
 * then `onResolved` removes the request — the agent continues on its own.
 */
export function CompanionQuestion(props: {
  request: CompanionRequest;
  onBack: () => void;
  onResolved: (request: CompanionRequest) => void;
}) {
  return props.request.threadContext
    ? <CompanionThreadRequest key={props.request.id} request={props.request} onBack={props.onBack} />
    : <AgentQuestion key={props.request.id} {...props} />;
}

function AgentQuestion({
  request,
  onBack,
  onResolved
}: {
  request: CompanionRequest;
  onBack: () => void;
  onResolved: (request: CompanionRequest) => void;
}) {
  const questions = request.questions ?? [];
  const [states, setStates] = useState<QState[]>(() => questions.map(emptyQState));
  const [freeText, setFreeText] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const aliveRef = useRef(true);
  const resolveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const openLabel = request.reason === 'thread-error' ? 'Open thread' : 'Open in Zana';

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      clearTimeout(resolveTimer.current);
    };
  }, []);

  const isQuestion = request.kind === 'question' && questions.length > 0;
  const answers = questions.map((q, i) => answerFor(q, states[i] ?? emptyQState()));
  const canSend =
    request.answerable && !sending && !sent && (isQuestion ? answers.every((a) => a.trim()) : !!freeText.trim());

  const patch = (qi: number, next: QState) => setStates((prev) => prev.map((s, i) => (i === qi ? next : s)));
  const pick = (qi: number, id: string) => {
    const q = questions[qi];
    const st = states[qi] ?? emptyQState();
    if (q.multiSelect) {
      const selected = new Set(st.selected);
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      patch(qi, { ...st, selected });
    } else {
      patch(qi, { ...st, selected: new Set([id]), otherActive: false });
    }
  };

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    const text = isQuestion ? buildReply(questions, answers) : freeText;
    try {
      const res = await product.companion.answer(request.id, text);
      if (!aliveRef.current) return;
      if (res.ok) {
        setSent(true);
        resolveTimer.current = setTimeout(() => onResolved(request), 900);
      } else {
        setError(FAIL_COPY[res.reason ?? 'unknown'] ?? FAIL_COPY.unknown);
      }
    } catch {
      if (aliveRef.current) setError('Could not send the answer.');
    } finally {
      if (aliveRef.current) setSending(false);
    }
  };

  // Number keys pick options on a single question; Enter sends.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof Element && !!e.target.closest('input, textarea');
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || (!typing && !e.shiftKey))) {
        e.preventDefault();
        void send();
        return;
      }
      if (typing || questions.length !== 1) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= questions[0].options.length) {
        pick(0, questions[0].options[n - 1].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  if (sent) {
    return (
      <div className="cc-sent" role="status">
        <span className="cc-sent-check">
          <Check size={18} />
        </span>
        Sent — {request.agentTitle} is continuing
      </div>
    );
  }

  return (
    <div className="cc-question" ref={rootRef} tabIndex={-1}>
      <header className="cc-question-head">
        <button type="button" className="cc-icon-btn" onClick={onBack} aria-label="Back to the list">
          <ArrowLeft size={15} />
        </button>
        <div className="cc-question-from">
          <span className="cc-question-agent">{request.agentTitle}</span>
          <span className="cc-question-project">
            <span className="cc-project-dot" style={{ background: request.projectColor ?? 'var(--text-dim)' }} />
            {request.projectName}
          </span>
        </div>
        <button
          type="button"
          className="cc-icon-btn"
          title={openLabel}
          aria-label={openLabel}
          onClick={() => void product.companion.open({ kind: 'request', requestId: request.id })}
        >
          <ExternalLink size={14} />
        </button>
      </header>

      <div className="cc-question-body">
        {request.prompt && <p className="cc-question-prompt">{request.prompt}</p>}

        {isQuestion &&
          questions.map((q, qi) => {
            const st = states[qi] ?? emptyQState();
            return (
              <fieldset key={qi} className="cc-q" disabled={!request.answerable}>
                {questions.length > 1 && q.prompt && <legend className="cc-q-legend">{q.prompt}</legend>}
                {q.options.map((o, oi) => {
                  const { label, recommended } = splitRecommended(o.label);
                  const selected = st.selected.has(o.id);
                  return (
                    <button
                      type="button"
                      key={o.id}
                      className={`cc-option${selected ? ' is-selected' : ''}`}
                      aria-pressed={selected}
                      onClick={() => pick(qi, o.id)}
                    >
                      <span className="cc-option-num">{oi + 1}</span>
                      <span className="cc-option-label">{label}</span>
                      {recommended && <span className="cc-tag">Recommended</span>}
                    </button>
                  );
                })}
                {q.allowOther && (
                  <input
                    className={`cc-other${st.otherActive ? ' is-active' : ''}`}
                    placeholder="Other…"
                    value={st.otherText}
                    onChange={(e) =>
                      patch(qi, {
                        ...st,
                        otherText: e.target.value,
                        otherActive: !!e.target.value.trim(),
                        selected: q.multiSelect || !e.target.value.trim() ? st.selected : new Set()
                      })
                    }
                  />
                )}
              </fieldset>
            );
          })}

        {!isQuestion && request.answerable && (
          <textarea
            className="cc-reply"
            rows={3}
            placeholder="Reply to the agent…"
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            autoFocus
          />
        )}

        {!request.answerable && request.reason && <p className="cc-note">{UNANSWERABLE_COPY[request.reason]}</p>}
        {error && <p className="cc-error" role="alert">{error}</p>}
      </div>

      <footer className="cc-question-foot">
        {request.kind === 'question' && (
          <button type="button" className="cc-btn-ghost" onClick={() => onResolved(request)}>
            Skip
          </button>
        )}
        <span className="cc-spacer" />
        {request.answerable ? (
          <button type="button" className="cc-btn-primary" disabled={!canSend} onClick={() => void send()}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        ) : (
          <button
            type="button"
            className="cc-btn-primary"
            onClick={() => void product.companion.open({ kind: 'request', requestId: request.id })}
          >
            {openLabel}
          </button>
        )}
      </footer>
    </div>
  );
}
