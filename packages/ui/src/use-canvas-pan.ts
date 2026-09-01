import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

const PAN_IGNORE_SELECTOR = 'button, a, input, textarea, select, [contenteditable="true"]';

export interface CanvasPanOrigin {
  id: number;
  x: number;
  y: number;
  left: number;
  top: number;
}

export function canvasPanIgnoresTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  return (target as Element).closest(PAN_IGNORE_SELECTOR) !== null;
}

export function canvasPanOffset(
  origin: Pick<CanvasPanOrigin, 'x' | 'y' | 'left' | 'top'>,
  clientX: number,
  clientY: number
): { left: number; top: number } {
  return {
    left: origin.left - (clientX - origin.x),
    top: origin.top - (clientY - origin.y)
  };
}

/**
 * Click-drag pan for an overflow scrollport. Buttons, links, and fields keep
 * their own pointer handling so cards stay clickable.
 */
export function useCanvasPan(): {
  isPanning: boolean;
  canvasPanProps: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  };
} {
  const originRef = useRef<CanvasPanOrigin | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  const endPan = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const origin = originRef.current;
    if (!origin || origin.id !== event.pointerId) return;
    originRef.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || canvasPanIgnoresTarget(event.target)) return;
    originRef.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: event.currentTarget.scrollLeft,
      top: event.currentTarget.scrollTop
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsPanning(true);
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const origin = originRef.current;
    if (!origin || origin.id !== event.pointerId) return;
    const next = canvasPanOffset(origin, event.clientX, event.clientY);
    event.currentTarget.scrollLeft = next.left;
    event.currentTarget.scrollTop = next.top;
  }, []);

  return {
    isPanning,
    canvasPanProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endPan,
      onPointerCancel: endPan
    }
  };
}
