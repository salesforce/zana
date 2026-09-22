import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { product } from '../lib/product-client.js';
import { suppressPostDragClick } from '../lib/suppress-post-drag-click.js';
import {
  clampInspectorFrame,
  cursorForInspectorEdge,
  focusInspectorDialog,
  inspectorFrameFromKey,
  inspectorFrameFromPointer,
  inspectorFrameFromRect,
  inspectorFrameStyle,
  inspectorModalClassName,
  inspectorViewport,
  releaseInspectorFullScreen,
  toggleInspectorFullScreen,
  type InspectorFrame,
  type InspectorResizeEdge
} from './inspector-window.js';

export function useInspectorWindow() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [fullScreen, setFullScreen] = useState(false);
  const [frame, setFrame] = useState<InspectorFrame | null>(null);
  const [resizing, setResizing] = useState(false);
  const fullScreenRef = useRef(false);
  fullScreenRef.current = fullScreen;
  const drag = useRef<{
    pointerId: number;
    edge: InspectorResizeEdge;
    originX: number;
    originY: number;
    start: InspectorFrame;
    previousCursor: string;
    previousUserSelect: string;
  } | null>(null);

  useEffect(() => product.app.onFullScreenChanged(setFullScreen), []);
  useEffect(() => () => releaseInspectorFullScreen(fullScreenRef.current), []);
  // Mount-only focus. Do not depend on per-render values — a 1s tick or status
  // poll would yank focus off the live xterm the user is typing into.
  useEffect(() => {
    focusInspectorDialog(ref.current);
  }, []);
  useEffect(() => {
    const onWindowResize = () => {
      setFrame((current) => (current ? clampInspectorFrame(current, inspectorViewport()) : current));
    };
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  }, []);

  const measure = (): InspectorFrame | null => {
    const node = ref.current;
    if (!node) return null;
    return inspectorFrameFromRect(node.getBoundingClientRect());
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    const session = drag.current;
    if (!session || session.pointerId !== event.pointerId) return;
    drag.current = null;
    setResizing(false);
    document.body.style.cursor = session.previousCursor;
    document.body.style.userSelect = session.previousUserSelect;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    suppressPostDragClick();
  };

  return {
    ref,
    fullScreen,
    resizing,
    className: inspectorModalClassName(fullScreen, resizing),
    style: inspectorFrameStyle(frame, fullScreen),
    toggleFullScreen: () => toggleInspectorFullScreen(fullScreen, setFullScreen),
    beginResize: (edge: InspectorResizeEdge, event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || fullScreen || drag.current) return;
      const start = measure();
      if (!start) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {
        pointerId: event.pointerId,
        edge,
        originX: event.clientX,
        originY: event.clientY,
        start,
        previousCursor: document.body.style.cursor,
        previousUserSelect: document.body.style.userSelect
      };
      document.body.style.cursor = cursorForInspectorEdge(edge);
      document.body.style.userSelect = 'none';
      setResizing(true);
      setFrame(clampInspectorFrame(start, inspectorViewport()));
    },
    moveResize: (event: PointerEvent<HTMLDivElement>) => {
      const session = drag.current;
      if (!session || session.pointerId !== event.pointerId) return;
      setFrame(
        inspectorFrameFromPointer({
          start: session.start,
          originX: session.originX,
          originY: session.originY,
          clientX: event.clientX,
          clientY: event.clientY,
          edge: session.edge,
          viewport: inspectorViewport()
        })
      );
    },
    endResize: finishDrag,
    resetFrame: () => {
      drag.current = null;
      setResizing(false);
      setFrame(null);
    },
    keyResize: (key: string) => {
      const start = frame ?? measure();
      if (!start) return;
      const next = inspectorFrameFromKey(start, key, inspectorViewport());
      if (next) setFrame(next);
    }
  };
}
