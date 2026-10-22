import { useEffect, useRef, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { copyText } from '../lib/copy-text.js';

/** How long the copied / failed icon stays before the button resets. */
export const CODE_COPY_FEEDBACK_MS = 1500;

type CopyState = 'idle' | 'copied' | 'failed';

const LABELS: Record<CopyState, string> = {
  idle: 'Copy code',
  copied: 'Copied',
  failed: 'Copy failed'
};

/**
 * Icon button pinned to a fenced code block's top-right corner. It sits
 * outside the scrolling `<pre>`, so it stays put on wide blocks, and it is
 * absolutely positioned, so it never shifts the block's layout. `code` is the
 * raw fence body from the current render, so a still-streaming message copies
 * whatever has arrived so far.
 */
export function CodeBlockCopyButton({ code }: { code: string }) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  const settle = (next: CopyState) => {
    setState(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setState('idle');
    }, CODE_COPY_FEEDBACK_MS);
  };
  const label = LABELS[state];
  return (
    <button
      type="button"
      className="inbox-md-code-copy"
      data-testid="code-block-copy"
      data-state={state}
      aria-label={label}
      title={label}
      onClick={(event) => {
        // Copying shouldn't also select or open a surrounding card/row.
        event.stopPropagation();
        copyText(code).then(
          () => settle('copied'),
          (error: unknown) => {
            console.warn('[code-block-copy] clipboard write failed', error);
            settle('failed');
          }
        );
      }}
    >
      {state === 'copied' ? <Check size={14} aria-hidden /> : state === 'failed' ? <X size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
    </button>
  );
}
