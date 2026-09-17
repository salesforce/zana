import { useEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { clampSplitPairFraction } from '../../lib/split-layout/ops.js';

/** Live DOM preview, with one persisted resize on release. */
export function SplitDivider({ dir, hidden, fraction, onResize }: {
  dir: 'row' | 'col';
  hidden: boolean;
  fraction: number;
  onResize: (fraction: number) => void;
}) {
  const horizontal = dir === 'row';
  const cancelDrag = useRef<(() => void) | null>(null);
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;
  // Parents can rerender while the pointer is captured. Callback identity is
  // not a reason to cancel; changes to the divider's tree position remount it.
  useEffect(() => () => cancelDrag.current?.(), [dir, hidden]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || hidden) return;
    const divider = event.currentTarget;
    const previous = divider.previousElementSibling;
    const next = divider.nextElementSibling;
    if (!(previous instanceof HTMLElement) || !(next instanceof HTMLElement)) return;
    cancelDrag.current?.();
    const previousRect = previous.getBoundingClientRect();
    const nextRect = next.getBoundingClientRect();
    const previousSize = horizontal ? previousRect.width : previousRect.height;
    const nextSize = horizontal ? nextRect.width : nextRect.height;
    const span = previousSize + nextSize;
    if (span <= 0) return;
    event.preventDefault();
    divider.focus();
    const pointerId = event.pointerId;
    const start = horizontal ? event.clientX : event.clientY;
    const previousGrow = Number.parseFloat(window.getComputedStyle(previous).flexGrow);
    const nextGrow = Number.parseFloat(window.getComputedStyle(next).flexGrow);
    const pairTotal = Number.isFinite(previousGrow + nextGrow) && previousGrow + nextGrow > 0
      ? previousGrow + nextGrow : 1;
    const previousFlex = previous.style.flex;
    const nextFlex = next.style.flex;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    let pendingFraction: number | null = null;
    let finished = false;

    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const pointer = horizontal ? moveEvent.clientX : moveEvent.clientY;
      pendingFraction = clampSplitPairFraction((previousSize + pointer - start) / span);
      previous.style.flex = `${pairTotal * pendingFraction} 1 0px`;
      next.style.flex = `${pairTotal * (1 - pendingFraction)} 1 0px`;
      divider.setAttribute('aria-valuenow', String(Math.round(pendingFraction * 100)));
    };
    const finish = (commit: boolean) => {
      if (finished) return;
      finished = true;
      cancelDrag.current = null;
      delete divider.dataset.dragging;
      divider.removeEventListener('pointermove', move);
      divider.removeEventListener('pointerup', up);
      divider.removeEventListener('pointercancel', cancelPointer);
      divider.removeEventListener('lostpointercapture', cancel);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
      if (divider.hasPointerCapture(pointerId)) divider.releasePointerCapture(pointerId);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      previous.style.flex = previousFlex;
      next.style.flex = nextFlex;
      divider.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
      if (commit && pendingFraction !== null) onResizeRef.current(pendingFraction);
    };
    const cancel = () => finish(false);
    const cancelPointer = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId === pointerId) cancel();
    };
    const up = (upEvent: PointerEvent) => {
      if (upEvent.pointerId === pointerId) finish(true);
    };
    const key = (keyEvent: globalThis.KeyboardEvent) => {
      if (keyEvent.key !== 'Escape') return;
      keyEvent.preventDefault();
      keyEvent.stopImmediatePropagation();
      cancel();
    };
    divider.setPointerCapture(pointerId);
    cancelDrag.current = cancel;
    divider.dataset.dragging = 'true';
    document.body.style.cursor = horizontal ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    divider.addEventListener('pointermove', move);
    divider.addEventListener('pointerup', up);
    divider.addEventListener('pointercancel', cancelPointer);
    divider.addEventListener('lostpointercapture', cancel);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || hidden) return;
    const step = event.shiftKey ? 0.1 : 0.02;
    let next: number;
    switch (event.key) {
      case horizontal ? 'ArrowLeft' : 'ArrowUp': next = fraction - step; break;
      case horizontal ? 'ArrowRight' : 'ArrowDown': next = fraction + step; break;
      case 'Home': next = 0.15; break;
      case 'End': next = 0.85; break;
      case 'Enter': next = 0.5; break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    onResize(clampSplitPairFraction(next));
  };

  return (
    <div
      role="separator"
      tabIndex={hidden ? -1 : 0}
      aria-hidden={hidden || undefined}
      aria-label={horizontal ? 'Resize panes left and right' : 'Resize panes above and below'}
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      aria-valuemin={15}
      aria-valuemax={85}
      aria-valuenow={Math.round(fraction * 100)}
      title="Drag or use arrow keys to resize. Double-click or press Enter to balance."
      className={`split-divider split-divider--${dir}${hidden ? ' is-hidden' : ''}`}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      onDoubleClick={() => { if (!hidden) onResize(0.5); }}
    >
      <div aria-hidden className="split-divider-hit" />
    </div>
  );
}
