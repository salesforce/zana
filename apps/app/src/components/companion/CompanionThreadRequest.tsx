import { useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import type { CompanionRequest } from '@zana-ai/zcc-domain/product';
import { product } from '../../lib/product-client.js';
import { splitRecommendedLabel } from '../thread/pending-interactions/pending-interaction-question-form.js';

/** Thread questions stay read-only: their original controls live in the thread. */
export function CompanionThreadRequest({ request, onBack }: { request: CompanionRequest; onBack: () => void }) {
  const context = request.threadContext!;
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const messageId = useId();
  const questions = context.questions ?? [];
  const normalize = (text: string) => text.trim().replace(/\s+/g, ' ');
  const message = context.lastMessage;
  const showMessage = message && ![context.prompt, ...questions.map(q => q.prompt)]
    .some(prompt => normalize(prompt) === normalize(message.text));
  useLayoutEffect(() => {
    const element = messageRef.current;
    if (!element || expanded) return;
    const measure = () => setCanExpand(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, message?.text, message?.truncated, showMessage]);
  const open = () => void product.companion.open({ kind: 'request', requestId: request.id });

  return (
    <div className="cc-question">
      <header className="cc-question-head">
        <button type="button" className="cc-icon-btn" onClick={onBack} aria-label="Back to the list"><ArrowLeft size={15} /></button>
        <div className="cc-question-from">
          <span className="cc-question-agent">{request.agentTitle}</span>
          <span className="cc-question-project"><span className="cc-project-dot" style={{ background: request.projectColor ?? 'var(--text-dim)' }} />{request.projectName}</span>
        </div>
        <button type="button" className="cc-icon-btn" onClick={open} aria-label="Open in Zana"><ExternalLink size={14} /></button>
      </header>
      <div className="cc-question-body">
        {showMessage && <section className="cc-thread-context" aria-label="Last assistant message">
          <div className="cc-thread-label">Last message</div>
          <p ref={messageRef} id={messageId} className={`cc-thread-message${expanded ? '' : ' is-clamped'}`}>{message.text}{message.truncated ? '…' : ''}</p>
          {(canExpand || expanded) && <button type="button" className="cc-link" aria-expanded={expanded} aria-controls={messageId} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show less' : message.truncated ? 'Show more' : 'Show full message'}</button>}
          {message.truncated && <p className="cc-note">Message preview shortened. Open the thread for the full message.</p>}
        </section>}
        {questions.length > 0 ? questions.map((q, index) => <section key={q.id} className="cc-thread-question" aria-label={`Question ${index + 1} of ${questions.length}`}>
          <div className="cc-thread-label cc-thread-attention">{questions.length > 1 ? `Question ${index + 1} of ${questions.length}` : 'Question'}</div>
          <p className="cc-question-prompt">{q.prompt}</p>
          {!!q.options?.length && <ol className="cc-thread-options" aria-label="Answer choices">{q.options.map((option, i) => {
            const { label, recommended } = splitRecommendedLabel(option.label);
            return <li key={option.value} className="cc-option">
              <span className="cc-option-num" aria-hidden>{i + 1}</span>
              <span className="cc-option-label">{label}{option.description && <span className="cc-thread-option-description">{option.description}</span>}</span>
              {recommended && <span className="cc-tag">Recommended</span>}
            </li>;
          })}</ol>}
          {q.multiSelect && <p className="cc-note">Choose one or more answers in the thread.</p>}
          {q.allowFreeText && <p className="cc-note">{q.options?.length ? 'You can also write your own answer in the thread.' : 'Write your answer in the thread.'}</p>}
        </section>) : <p className="cc-question-prompt">{context.prompt}</p>}
      </div>
      <footer className="cc-question-foot"><span className="cc-note cc-thread-footer-note">Answer in the full thread</span><span className="cc-spacer" /><button type="button" className="cc-btn-primary" onClick={open}>Open in Zana</button></footer>
    </div>
  );
}
