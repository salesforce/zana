import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { errorMessage, pushErrorToast } from '../store';

export const SWIPE_ACTION_WIDTH = 88;
const REVEAL_DISTANCE = 44;
export const SWIPE_CLOSE_DISTANCE = 144;
const MAX_DISTANCE = 220;

/**
 * Phone swipe-left-to-close. A short swipe reveals a Close action, a long swipe
 * closes on release. Spread `handlers` on the element the finger drags and call
 * `consumeClick` from its click so a drag never also opens the item.
 */
export function useSwipeToClose<Root extends HTMLElement>(onClose: () => Promise<void>, failure = 'Could not close the agent') {
  const rootRef = useRef<Root>(null);
  const gesture = useRef<{ id: number; x: number; y: number; offset: number; horizontal: boolean } | null>(null);
  const suppressClick = useRef(false);
  const closing = useRef(false);
  const [distance, setDistance] = useState(0);
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [dragging, setDragging] = useState(false);

  function reset() {
    setDistance(0);
    setRevealed(false);
  }

  useEffect(() => {
    if (!revealed) return;
    const dismiss = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) reset();
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [revealed]);

  async function close() {
    if (closing.current) return;
    reset();
    closing.current = true;
    setBusy(true);
    try {
      await onClose();
    } catch (error) {
      pushErrorToast(errorMessage(error, failure));
    } finally {
      closing.current = false;
      setBusy(false);
    }
  }

  function move(event: PointerEvent<HTMLElement>) {
    const start = gesture.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.horizontal) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
      // Lock only a deliberate horizontal drag. A revealed row can swipe back.
      if (Math.abs(dx) <= Math.abs(dy) * 1.5 || (start.offset === 0 && dx > 0)) {
        gesture.current = null;
        return;
      }
      start.horizontal = true;
      setDragging(true);
      suppressClick.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    setDistance(Math.min(MAX_DISTANCE, Math.max(0, start.offset - dx)));
  }

  function finish(event: PointerEvent<HTMLElement>, cancelled: boolean) {
    const start = gesture.current;
    if (!start || start.id !== event.pointerId) return;
    gesture.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!start.horizontal) return;
    const next = cancelled ? start.offset : Math.max(0, start.offset + start.x - event.clientX);
    if (!cancelled && next >= SWIPE_CLOSE_DISTANCE) {
      void close();
    } else {
      const open = next >= REVEAL_DISTANCE;
      setDistance(open ? SWIPE_ACTION_WIDTH : 0);
      setRevealed(open);
    }
  }

  const handlers = {
    'data-swipe-handle': '',
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (closing.current || !event.isPrimary || event.button !== 0) return;
      suppressClick.current = false;
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, offset: distance, horizontal: false };
    },
    onPointerMove: move,
    onPointerUp: (event: PointerEvent<HTMLElement>) => finish(event, false),
    onPointerCancel: (event: PointerEvent<HTMLElement>) => finish(event, true),
    onLostPointerCapture(event: PointerEvent<HTMLElement>) {
      // Touch starts with implicit capture on the tapped icon/text. Its
      // bubbled loss when we capture the handle is a transfer, not a cancel.
      if (event.target === event.currentTarget) finish(event, true);
    }
  };

  /** True when the click finished a drag or dismissed the action (and was cancelled). */
  function consumeClick(event: MouseEvent) {
    if (suppressClick.current || closing.current) {
      event.preventDefault();
      suppressClick.current = false;
      return true;
    }
    if (revealed) {
      event.preventDefault();
      reset();
      return true;
    }
    return false;
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !revealed) return;
    event.preventDefault();
    event.stopPropagation();
    reset();
    rootRef.current?.querySelector<HTMLElement>('[data-swipe-handle]')?.focus({ preventScroll: true });
  }

  return {
    rootRef, distance, busy, revealed, dragging, ready: distance >= SWIPE_CLOSE_DISTANCE,
    close, handlers, consumeClick, onKeyDown
  };
}
