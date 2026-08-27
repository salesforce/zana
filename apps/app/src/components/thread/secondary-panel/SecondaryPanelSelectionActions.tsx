import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';

export const COMPOSER_INSERT_EVENT = 'zcc:composer-insert';

export function dispatchComposerInsert(threadId: string, text: string): void {
  if (typeof window === 'undefined') return;
  const next = text.trim();
  if (!threadId || next.length === 0) return;
  window.dispatchEvent(new CustomEvent(COMPOSER_INSERT_EVENT, {
    detail: { threadId, text: next }
  }));
}

export function readTrimmedSelection(): string | null {
  if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return null;
  const text = window.getSelection()?.toString().trim() ?? '';
  return text.length > 0 ? text : null;
}

export function SecondaryPanelSelectionActions({
  threadId,
  children
}: {
  threadId?: string | null;
  children: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);

  const clear = useCallback(() => {
    setSelected(null);
    setAnchor(null);
  }, []);

  const onMouseUp = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const text = readTrimmedSelection();
    if (!text) {
      clear();
      return;
    }
    setSelected(text);
    setAnchor({ x: event.clientX, y: event.clientY });
  }, [clear]);

  if (!threadId) return children;

  return (
    <div
      ref={hostRef}
      className="thread-selection-host"
      data-testid="thread-selection-host"
      onMouseUp={onMouseUp}
    >
      {children}
      {selected && anchor ? (
        <button
          type="button"
          className="thread-selection-add"
          data-testid="thread-selection-add"
          style={{ left: anchor.x, top: anchor.y }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            dispatchComposerInsert(threadId, selected);
            clear();
          }}
        >
          Add to chat
        </button>
      ) : null}
    </div>
  );
}
