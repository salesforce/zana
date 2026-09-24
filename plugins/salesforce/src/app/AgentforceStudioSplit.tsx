import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type PointerEvent } from 'react';
import { DEFAULT_SPLIT_RATIO, MIN_SPLIT_RATIO, MAX_SPLIT_RATIO, splitRatioFromClientX, splitRatioFromKey } from '../../lib/agent-script-split.js';

/** Pointer capture keeps resizing continuous while crossing the Monaco iframe. */
export function AgentforceStudioSplit({ editor, children, open }: { editor: ReactNode; children: ReactNode; open: boolean }) {
  const [ratio, setRatio] = useState(DEFAULT_SPLIT_RATIO);
  const [dragging, setDragging] = useState(false);
  const workspace = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  useEffect(() => { if (!open) { pointer.current = null; setDragging(false); } }, [open]);
  const resize = (clientX: number) => {
    const rect = workspace.current?.getBoundingClientRect();
    if (rect) setRatio(splitRatioFromClientX(clientX, rect.left, rect.width));
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (pointer.current !== event.pointerId) return;
    pointer.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <div ref={workspace} className="af-workspace" data-lab-open={open} data-resizing={dragging} style={{ '--af-editor-ratio': ratio } as CSSProperties}>
    <div className="sf-as-stage">{editor}</div>
    {open && <div
      className="af-workspace-divider" role="separator" tabIndex={0}
      aria-label="Resize editor and conversation" aria-orientation="vertical"
      aria-valuemin={Math.round(MIN_SPLIT_RATIO * 100)} aria-valuemax={Math.round(MAX_SPLIT_RATIO * 100)} aria-valuenow={Math.round(ratio * 100)}
      aria-valuetext={`${Math.round(ratio * 100)}% editor, ${Math.round((1 - ratio) * 100)}% conversation`}
      title="Drag to resize · double-click to reset · arrow keys to adjust"
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        pointer.current = event.pointerId;
        setDragging(true);
      }}
      onPointerMove={event => { if (pointer.current === event.pointerId) resize(event.clientX); }}
      onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
      onDoubleClick={() => setRatio(DEFAULT_SPLIT_RATIO)}
      onKeyDown={event => {
        const next = splitRatioFromKey(ratio, event.key);
        if (next === null) return;
        event.preventDefault();
        setRatio(next);
      }}
    />}
    {children}
  </div>;
}
