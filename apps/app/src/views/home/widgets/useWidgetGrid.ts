import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { bound, gridColumns, layoutBottom, MAX_GRID_ROW, type Columns, type Placement, type WidgetLayout } from './model.js';

export const GRID_GAP = 10;
export const GRID_ROW_HEIGHT = 54;

type Change = Placement & { id: string; kind: 'move' | 'resize' };
type Gesture = {
  pointer: number;
  control: HTMLButtonElement;
  card: Placement;
  id: string;
  kind: Change['kind'];
  startX: number;
  startY: number;
  grabX: number;
  grabY: number;
  clientX: number;
  clientY: number;
  scroller: HTMLElement | null;
  frame: number;
  active: boolean;
  target: Change | null;
};

export function useGridColumns(element: React.RefObject<HTMLElement | null>, visible: boolean): Columns {
  const [columns, setColumns] = useState<Columns>(6);
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    function measure() {
      if (node?.clientWidth) setColumns(gridColumns(node.clientWidth));
    }
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [element, visible]);
  return columns;
}

export function useWidgetGrid(
  grid: React.RefObject<HTMLDivElement | null>,
  columns: Columns,
  layout: WidgetLayout,
  visible: boolean,
  commit: (change: Change) => void
) {
  const [preview, setPreview] = useState<Change | null>(null);
  const drag = useRef<Gesture | null>(null);
  const maxRow = Math.min(MAX_GRID_ROW, layoutBottom(layout) + 1);
  useEffect(() => () => {
    if (drag.current) cancelAnimationFrame(drag.current.frame);
  }, []);

  useEffect(() => {
    if (visible || !drag.current) return;
    cancelAnimationFrame(drag.current.frame);
    drag.current = null;
    setPreview(null);
  }, [visible]);

  function begin(event: PointerEvent<HTMLButtonElement>, id: string, kind: Change['kind']) {
    const card = layout.get(id);
    const node = grid.current;
    if (event.button !== 0 || !node || !card || drag.current) return;
    const control = event.currentTarget;
    const box = node.getBoundingClientRect();
    const columnStep = (box.width + GRID_GAP) / columns;
    const rowStep = GRID_ROW_HEIGHT + GRID_GAP;
    control.setPointerCapture(event.pointerId);
    drag.current = {
      pointer: event.pointerId, control, card, id, kind,
      startX: event.clientX, startY: event.clientY,
      grabX: event.clientX - box.left - card.column * columnStep,
      grabY: event.clientY - box.top - card.row * rowStep,
      clientX: event.clientX, clientY: event.clientY,
      scroller: node.closest('.home-panel'), frame: 0, active: false, target: null
    };
  }

  function paint(gesture: Gesture) {
    const box = grid.current?.getBoundingClientRect();
    if (!box) return;
    const { clientX, clientY, card, kind, id } = gesture;
    const columnStep = (box.width + GRID_GAP) / columns;
    const rowStep = GRID_ROW_HEIGHT + GRID_GAP;
    if (kind === 'move' && (clientX < box.left || clientX > box.right || clientY < box.top || clientY > box.bottom)) {
      gesture.target = null;
    } else if (kind === 'move') {
      gesture.target = {
        ...card, id, kind,
        column: bound(Math.round((clientX - box.left - gesture.grabX) / columnStep), 0, columns - card.width),
        row: bound(Math.round((clientY - box.top - gesture.grabY) / rowStep), 0, maxRow)
      };
    } else {
      gesture.target = {
        ...card, id, kind,
        width: bound(card.width + Math.round((clientX - gesture.startX) / columnStep), 2, columns),
        height: bound(card.height + Math.round((clientY - gesture.startY) / rowStep), 2, 7)
      };
      gesture.target.column = Math.min(gesture.target.column, columns - gesture.target.width);
    }
    setPreview(gesture.target);
  }

  function scroll(gesture: Gesture) {
    const surface = gesture.scroller;
    const bounds = surface?.getBoundingClientRect();
    if (drag.current !== gesture || !surface || !bounds || gesture.clientX < bounds.left || gesture.clientX > bounds.right) return;
    const localY = gesture.clientY - bounds.top;
    if (localY < 0 || localY > bounds.height) return;
    const step = Math.round((Math.max(0, localY - bounds.height + 42) - Math.max(0, 42 - localY)) / 4);
    const previous = surface.scrollTop;
    surface.scrollTop += step;
    if (surface.scrollTop !== previous) {
      paint(gesture);
      gesture.frame = requestAnimationFrame(() => scroll(gesture));
    }
  }

  function update(event: PointerEvent<HTMLButtonElement>) {
    const gesture = drag.current;
    if (!gesture || gesture.pointer !== event.pointerId) return;
    const { clientX, clientY } = event;
    if (!gesture.active && Math.hypot(clientX - gesture.startX, clientY - gesture.startY) < 4) return;
    gesture.active = true;
    gesture.clientX = clientX;
    gesture.clientY = clientY;
    paint(gesture);
    cancelAnimationFrame(gesture.frame);
    if (gesture.kind === 'move') gesture.frame = requestAnimationFrame(() => scroll(gesture));
  }

  function finish(save: boolean, pointer?: number) {
    const gesture = drag.current;
    if (!gesture || (pointer !== undefined && gesture.pointer !== pointer)) return;
    drag.current = null;
    cancelAnimationFrame(gesture.frame);
    if (gesture.control.hasPointerCapture(gesture.pointer)) gesture.control.releasePointerCapture(gesture.pointer);
    setPreview(null);
    if (save && gesture.target) commit(gesture.target);
  }

  function key(event: KeyboardEvent<HTMLButtonElement>, id: string, kind: Change['kind']) {
    if (event.key === 'Escape' && drag.current) {
      event.preventDefault();
      finish(false);
      return;
    }
    const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    const card = layout.get(id);
    if (!card || (!dx && !dy)) return;
    event.preventDefault();
    if (kind === 'move') {
      commit({ ...card, id, kind, column: bound(card.column + dx, 0, columns - card.width), row: bound(card.row + dy, 0, maxRow) });
    } else {
      const width = bound(card.width + dx, 2, columns);
      commit({ ...card, id, kind, width, height: bound(card.height + dy, 2, 7), column: Math.min(card.column, columns - width) });
    }
  }

  function controls(id: string, kind: Change['kind']) {
    return {
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => begin(event, id, kind),
      onPointerMove: update,
      onPointerUp: (event: PointerEvent<HTMLButtonElement>) => finish(true, event.pointerId),
      onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => finish(false, event.pointerId),
      onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => finish(false, event.pointerId),
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => key(event, id, kind)
    };
  }

  return { controls, preview };
}
