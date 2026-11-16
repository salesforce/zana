import { useEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import {
  addThreadContext,
  focusThreadComposer,
} from '../../plugins/thread-context-target.js';
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
  const [error, setError] = useState('');
  useEffect(() => {
    let frame = 0;
    const hide = () => {
      cancelAnimationFrame(frame);
      setSelection(null);
      setError('');
    };
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
    setError('');
  }, [threadId]);

  if (!selection) return null;
  return createPortal(
    <div
      role="toolbar"
      aria-label="Selected passage"
      className="thread-annotation-menu"
      style={{
        left: Math.max(
          8,
          Math.min(selection.rect.left, window.innerWidth - (error ? 296 : 128)),
        ),
        top: Math.max(
          8,
          Math.min(selection.rect.top - 48, window.innerHeight - 48),
        ),
      }}
      onPointerDown={(event) => event.preventDefault()}
    >
      <button
        type="button"
        onClick={() => {
          if (!addThreadContext(threadId, selection.reference)) {
            setError(
              'The composer is unavailable or full. Try again after making room.',
            );
            return;
          }
          setSelection(null);
          setError('');
          window.getSelection()?.removeAllRanges();
          focusThreadComposer(threadId);
        }}
      >
        Ask Zana
      </button>
      {error && <span role="alert">{error}</span>}
    </div>,
    document.body,
  );
}
