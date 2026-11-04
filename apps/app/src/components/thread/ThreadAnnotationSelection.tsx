import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { ContextReference } from '@zana-ai/zcc-domain/context-reference';
import { addThreadContext } from '../../plugins/thread-context-target.js';
import { readThreadAnnotation } from './thread-annotation-selection.js';
import './thread-annotations.css';

export function ThreadAnnotationSelection({
  rootRef,
  threadId,
}: {
  rootRef: RefObject<HTMLElement | null>;
  threadId: string;
}) {
  const [selection, setSelection] =
    useState<ReturnType<typeof readThreadAnnotation>>(null);
  const [draft, setDraft] = useState<ContextReference | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    let frame = 0;
    const hide = () => setSelection(null);
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setSelection(
          rootRef.current
            ? readThreadAnnotation(
                rootRef.current,
                threadId,
                window.getSelection(),
              )
            : null,
        ),
      );
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    document.addEventListener('selectionchange', read);
    document.addEventListener('keydown', escape);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('selectionchange', read);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [rootRef, threadId]);
  useEffect(() => {
    setSelection(null);
    setDraft(null);
  }, [threadId]);
  useEffect(() => {
    if (!draft) return;
    previousFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    input.current?.focus();
    return () => {
      previousFocus.current?.focus({ preventScroll: true });
    };
  }, [draft]);
  const insert = (reference: ContextReference) => {
    if (!addThreadContext(threadId, reference)) {
      setError(
        'The composer is unavailable or full. Keep this annotation and try again.',
      );
      return;
    }
    setDraft(null);
    setSelection(null);
    setError('');
    window.getSelection()?.removeAllRanges();
  };
  return (
    <>
      {selection &&
        !draft &&
        createPortal(
          <div
            role="toolbar"
            aria-label="Selected passage"
            className="thread-annotation-menu"
            style={{
              left: Math.max(
                8,
                Math.min(selection.rect.left, window.innerWidth - 240),
              ),
              top: Math.max(
                8,
                Math.min(selection.rect.top - 42, window.innerHeight - 48),
              ),
            }}
            onPointerDown={(event) => event.preventDefault()}
          >
            <button
              type="button"
              onClick={() => {
                setDraft(selection.reference);
                setComment('');
                setError('');
              }}
            >
              Annotate
            </button>
            <button type="button" onClick={() => insert(selection.reference)}>
              Add quote
            </button>
            {error && <span role="alert">{error}</span>}
          </div>,
          document.body,
        )}
      {draft &&
        createPortal(
          <div
            className="thread-annotation-backdrop"
            data-browser-dimming-modal="true"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setDraft(null);
            }}
          >
            <form
              role="dialog"
              aria-modal="true"
              aria-label="Annotate passage"
              className="thread-annotation-dialog"
              onSubmit={(event) => {
                event.preventDefault();
                if (comment.trim())
                  insert({ ...draft, comment: comment.trim() });
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  setDraft(null);
                }
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.requestSubmit();
                }
                if (event.key === 'Tab') {
                  const controls = Array.from(
                    event.currentTarget.querySelectorAll<HTMLElement>(
                      'button:not(:disabled),textarea',
                    ),
                  );
                  const index = controls.indexOf(
                    document.activeElement as HTMLElement,
                  );
                  if (event.shiftKey && index === 0) {
                    event.preventDefault();
                    controls.at(-1)?.focus();
                  } else if (!event.shiftKey && index === controls.length - 1) {
                    event.preventDefault();
                    controls[0]?.focus();
                  }
                }
              }}
            >
              <h3>Annotate passage</h3>
              <blockquote>{draft.text}</blockquote>
              <label>
                Your change
                <textarea
                  ref={input}
                  aria-label="Your change"
                  value={comment}
                  maxLength={4000}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="What should the agent change?"
                />
              </label>
              <div className="thread-annotation-quick">
                <button
                  type="button"
                  onClick={() => setComment('Keep this as proposed.')}
                >
                  Keep this
                </button>
                <button
                  type="button"
                  onClick={() => setComment('Remove this.')}
                >
                  Remove this
                </button>
              </div>
              {error && <p role="alert">{error}</p>}
              <div className="thread-annotation-actions">
                <button type="button" onClick={() => setDraft(null)}>
                  Cancel
                </button>
                <button type="submit" disabled={!comment.trim()}>
                  Add to composer
                </button>
              </div>
            </form>
          </div>,
          document.body,
        )}
    </>
  );
}
