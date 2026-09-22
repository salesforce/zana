import { product } from '../lib/product-client.js';

export const INSPECTOR_MIN_WIDTH = 640;
export const INSPECTOR_MIN_HEIGHT = 400;
export const INSPECTOR_VIEWPORT_GUTTER = 16;
export const INSPECTOR_KEYBOARD_STEP = 24;

export type InspectorResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface InspectorFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface InspectorViewport {
  width: number;
  height: number;
}

export function inspectorViewport(
  view: Pick<Window, 'innerWidth' | 'innerHeight'> | null | undefined = globalThis.window
): InspectorViewport {
  return {
    width: Math.max(1, view?.innerWidth ?? 1280),
    height: Math.max(1, view?.innerHeight ?? 800)
  };
}

export function clampInspectorFrame(
  frame: InspectorFrame,
  viewport: InspectorViewport
): InspectorFrame {
  const maxWidth = Math.max(1, viewport.width - INSPECTOR_VIEWPORT_GUTTER * 2);
  const maxHeight = Math.max(1, viewport.height - INSPECTOR_VIEWPORT_GUTTER * 2);
  const minWidth = Math.min(INSPECTOR_MIN_WIDTH, maxWidth);
  const minHeight = Math.min(INSPECTOR_MIN_HEIGHT, maxHeight);
  const width = Math.min(maxWidth, Math.max(minWidth, Math.round(frame.width)));
  const height = Math.min(maxHeight, Math.max(minHeight, Math.round(frame.height)));
  const left = Math.min(
    viewport.width - INSPECTOR_VIEWPORT_GUTTER - width,
    Math.max(INSPECTOR_VIEWPORT_GUTTER, Math.round(frame.left))
  );
  const top = Math.min(
    viewport.height - INSPECTOR_VIEWPORT_GUTTER - height,
    Math.max(INSPECTOR_VIEWPORT_GUTTER, Math.round(frame.top))
  );
  return { left, top, width, height };
}

export function inspectorFrameFromRect(rect: {
  left: number;
  top: number;
  width: number;
  height: number;
}): InspectorFrame {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

export function inspectorFrameFromPointer(args: {
  start: InspectorFrame;
  originX: number;
  originY: number;
  clientX: number;
  clientY: number;
  edge: InspectorResizeEdge;
  viewport: InspectorViewport;
}): InspectorFrame {
  const dx = args.clientX - args.originX;
  const dy = args.clientY - args.originY;
  let left = args.start.left;
  let top = args.start.top;
  let right = args.start.left + args.start.width;
  let bottom = args.start.top + args.start.height;
  if (args.edge.includes('e')) right += dx;
  if (args.edge.includes('w')) left += dx;
  if (args.edge.includes('s')) bottom += dy;
  if (args.edge.includes('n')) top += dy;

  const maxWidth = Math.max(1, args.viewport.width - INSPECTOR_VIEWPORT_GUTTER * 2);
  const maxHeight = Math.max(1, args.viewport.height - INSPECTOR_VIEWPORT_GUTTER * 2);
  const minWidth = Math.min(INSPECTOR_MIN_WIDTH, maxWidth);
  const minHeight = Math.min(INSPECTOR_MIN_HEIGHT, maxHeight);
  const minLeft = INSPECTOR_VIEWPORT_GUTTER;
  const minTop = INSPECTOR_VIEWPORT_GUTTER;
  const maxRight = args.viewport.width - INSPECTOR_VIEWPORT_GUTTER;
  const maxBottom = args.viewport.height - INSPECTOR_VIEWPORT_GUTTER;

  if (args.edge.includes('w')) left = Math.min(right - minWidth, Math.max(minLeft, left));
  if (args.edge.includes('e')) right = Math.max(left + minWidth, Math.min(maxRight, right));
  if (args.edge.includes('n')) top = Math.min(bottom - minHeight, Math.max(minTop, top));
  if (args.edge.includes('s')) bottom = Math.max(top + minHeight, Math.min(maxBottom, bottom));

  return clampInspectorFrame(
    { left, top, width: right - left, height: bottom - top },
    args.viewport
  );
}

export function inspectorFrameFromKey(
  frame: InspectorFrame,
  key: string,
  viewport: InspectorViewport
): InspectorFrame | null {
  if (key === 'ArrowRight') {
    return clampInspectorFrame({ ...frame, width: frame.width + INSPECTOR_KEYBOARD_STEP }, viewport);
  }
  if (key === 'ArrowLeft') {
    return clampInspectorFrame({ ...frame, width: frame.width - INSPECTOR_KEYBOARD_STEP }, viewport);
  }
  if (key === 'ArrowDown') {
    return clampInspectorFrame({ ...frame, height: frame.height + INSPECTOR_KEYBOARD_STEP }, viewport);
  }
  if (key === 'ArrowUp') {
    return clampInspectorFrame({ ...frame, height: frame.height - INSPECTOR_KEYBOARD_STEP }, viewport);
  }
  if (key === 'Home') {
    return clampInspectorFrame(
      { ...frame, width: INSPECTOR_MIN_WIDTH, height: INSPECTOR_MIN_HEIGHT },
      viewport
    );
  }
  if (key === 'End') {
    return clampInspectorFrame(
      {
        left: INSPECTOR_VIEWPORT_GUTTER,
        top: INSPECTOR_VIEWPORT_GUTTER,
        width: viewport.width,
        height: viewport.height
      },
      viewport
    );
  }
  return null;
}

export function cursorForInspectorEdge(edge: InspectorResizeEdge): string {
  if (edge === 'e' || edge === 'w') return 'ew-resize';
  if (edge === 'n' || edge === 's') return 'ns-resize';
  if (edge === 'ne' || edge === 'sw') return 'nesw-resize';
  return 'nwse-resize';
}

export function inspectorModalClassName(fullScreen: boolean, resizing = false): string {
  return `modal agent-terminal-modal${fullScreen ? ' is-fullscreen' : ''}${resizing ? ' is-resizing' : ''}`;
}

export function inspectorFrameStyle(
  frame: InspectorFrame | null,
  fullScreen: boolean
): { position: 'absolute'; left: number; top: number; width: number; height: number; maxHeight: number; margin: number } | undefined {
  if (fullScreen || !frame) return undefined;
  return {
    position: 'absolute',
    left: frame.left,
    top: frame.top,
    width: frame.width,
    height: frame.height,
    maxHeight: frame.height,
    margin: 0
  };
}

export function applyInspectorFullScreen(next: boolean): void {
  void product.app.setFullScreen(next);
}

export function releaseInspectorFullScreen(wasFullScreen: boolean): void {
  if (wasFullScreen) applyInspectorFullScreen(false);
}

export function focusInspectorDialog(node: { focus(): void } | null): void {
  node?.focus();
}

export function stopInspectorDialogClick(event: { stopPropagation(): void }): void {
  event.stopPropagation();
}

export function toggleInspectorFullScreen(
  current: boolean,
  setFullScreen: (next: boolean) => void
): boolean {
  const next = !current;
  setFullScreen(next);
  applyInspectorFullScreen(next);
  return next;
}
