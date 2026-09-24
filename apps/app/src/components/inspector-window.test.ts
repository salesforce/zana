import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/product-client.js', () => ({
  product: {
    app: {
      setFullScreen: vi.fn(),
      onFullScreenChanged: vi.fn(() => () => undefined)
    }
  }
}));

import {
  INSPECTOR_MIN_HEIGHT,
  INSPECTOR_MIN_WIDTH,
  INSPECTOR_VIEWPORT_GUTTER,
  clampInspectorFrame,
  cursorForInspectorEdge,
  inspectorFrameFromKey,
  inspectorFrameFromPointer,
  inspectorFrameFromRect,
  inspectorFrameStyle,
  inspectorModalClassName,
  inspectorViewport
} from './inspector-window.js';

const viewport = { width: 1600, height: 1000 };
const start = { left: 200, top: 80, width: 800, height: 600 };

describe('inspector window geometry', () => {
  it('clamps a frame inside the viewport gutter and minimum size', () => {
    expect(clampInspectorFrame({ left: -40, top: -20, width: 80, height: 50 }, viewport)).toEqual({
      left: INSPECTOR_VIEWPORT_GUTTER,
      top: INSPECTOR_VIEWPORT_GUTTER,
      width: INSPECTOR_MIN_WIDTH,
      height: INSPECTOR_MIN_HEIGHT
    });
    expect(
      clampInspectorFrame({ left: 20, top: 20, width: 4000, height: 4000 }, viewport)
    ).toEqual({
      left: INSPECTOR_VIEWPORT_GUTTER,
      top: INSPECTOR_VIEWPORT_GUTTER,
      width: viewport.width - INSPECTOR_VIEWPORT_GUTTER * 2,
      height: viewport.height - INSPECTOR_VIEWPORT_GUTTER * 2
    });
  });

  it('shrinks the minimum size when the viewport is smaller than the default floor', () => {
    expect(clampInspectorFrame({ left: 0, top: 0, width: 900, height: 700 }, { width: 500, height: 360 })).toEqual({
      left: INSPECTOR_VIEWPORT_GUTTER,
      top: INSPECTOR_VIEWPORT_GUTTER,
      width: 500 - INSPECTOR_VIEWPORT_GUTTER * 2,
      height: 360 - INSPECTOR_VIEWPORT_GUTTER * 2
    });
  });

  it('resizes from each edge while keeping the opposite edge planted', () => {
    expect(
      inspectorFrameFromPointer({
        start,
        originX: 1000,
        originY: 400,
        clientX: 1100,
        clientY: 430,
        edge: 'e',
        viewport
      })
    ).toMatchObject({ left: 200, width: 900, height: 600 });
    expect(
      inspectorFrameFromPointer({
        start,
        originX: 200,
        originY: 400,
        clientX: 140,
        clientY: 400,
        edge: 'w',
        viewport
      })
    ).toMatchObject({ left: 140, width: 860 });
    expect(
      inspectorFrameFromPointer({
        start,
        originX: 600,
        originY: 680,
        clientX: 600,
        clientY: 740,
        edge: 's',
        viewport
      })
    ).toMatchObject({ top: 80, height: 660 });
    expect(
      inspectorFrameFromPointer({
        start,
        originX: 600,
        originY: 80,
        clientX: 600,
        clientY: 40,
        edge: 'n',
        viewport
      })
    ).toMatchObject({ top: 40, height: 640 });
    const corner = inspectorFrameFromPointer({
      start,
      originX: 1000,
      originY: 680,
      clientX: 1080,
      clientY: 760,
      edge: 'se',
      viewport
    });
    expect(corner).toMatchObject({ left: 200, top: 80, width: 880, height: 680 });
  });

  it('stops shrinking at the minimum size without drifting the planted edge', () => {
    const west = inspectorFrameFromPointer({
      start,
      originX: 200,
      originY: 400,
      clientX: 900,
      clientY: 400,
      edge: 'w',
      viewport
    });
    expect(west.width).toBe(INSPECTOR_MIN_WIDTH);
    expect(west.left + west.width).toBe(start.left + start.width);
    const south = inspectorFrameFromPointer({
      start,
      originX: 600,
      originY: 680,
      clientX: 600,
      clientY: 100,
      edge: 's',
      viewport
    });
    expect(south.height).toBe(INSPECTOR_MIN_HEIGHT);
    expect(south.top).toBe(start.top);
  });

  it('moves the frame from the keyboard and ignores unrelated keys', () => {
    expect(inspectorFrameFromKey(start, 'ArrowRight', viewport)?.width).toBe(824);
    expect(inspectorFrameFromKey(start, 'ArrowLeft', viewport)?.width).toBe(776);
    expect(inspectorFrameFromKey(start, 'ArrowDown', viewport)?.height).toBe(624);
    expect(inspectorFrameFromKey(start, 'ArrowUp', viewport)?.height).toBe(576);
    expect(inspectorFrameFromKey(start, 'Home', viewport)).toMatchObject({
      width: INSPECTOR_MIN_WIDTH,
      height: INSPECTOR_MIN_HEIGHT
    });
    expect(inspectorFrameFromKey(start, 'End', viewport)).toEqual({
      left: INSPECTOR_VIEWPORT_GUTTER,
      top: INSPECTOR_VIEWPORT_GUTTER,
      width: viewport.width - INSPECTOR_VIEWPORT_GUTTER * 2,
      height: viewport.height - INSPECTOR_VIEWPORT_GUTTER * 2
    });
    expect(inspectorFrameFromKey(start, 'Tab', viewport)).toBeNull();
  });

  it('maps CSS for a custom frame and drops it while fullscreen', () => {
    expect(inspectorFrameStyle(start, false)).toEqual({
      position: 'absolute',
      left: 200,
      top: 80,
      width: 800,
      height: 600,
      maxHeight: 600,
      margin: 0
    });
    expect(inspectorFrameStyle(start, true)).toBeUndefined();
    expect(inspectorFrameStyle(null, false)).toBeUndefined();
    expect(inspectorModalClassName(false)).toBe('modal agent-terminal-modal');
    expect(inspectorModalClassName(true)).toBe('modal agent-terminal-modal is-fullscreen');
    expect(inspectorModalClassName(false, true)).toBe('modal agent-terminal-modal is-resizing');
    expect(inspectorModalClassName(true, true)).toBe('modal agent-terminal-modal is-fullscreen is-resizing');
    expect(cursorForInspectorEdge('e')).toBe('ew-resize');
    expect(cursorForInspectorEdge('s')).toBe('ns-resize');
    expect(cursorForInspectorEdge('ne')).toBe('nesw-resize');
    expect(cursorForInspectorEdge('se')).toBe('nwse-resize');
    expect(inspectorFrameFromRect({ left: 1, top: 2, width: 3, height: 4 })).toEqual({
      left: 1,
      top: 2,
      width: 3,
      height: 4
    });
    expect(inspectorViewport({ innerWidth: 0, innerHeight: -4 })).toEqual({ width: 1, height: 1 });
  });
});
