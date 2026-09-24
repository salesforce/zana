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
const start = { left: 400, top: 200, width: 800, height: 600 };

describe('inspector window geometry', () => {
  it('centers the frame after clamping to the minimum size or viewport gutter', () => {
    expect(clampInspectorFrame({ left: -40, top: -20, width: 80, height: 50 }, viewport)).toEqual({
      left: (viewport.width - INSPECTOR_MIN_WIDTH) / 2,
      top: (viewport.height - INSPECTOR_MIN_HEIGHT) / 2,
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

  it.each(['e', 'w', 'n', 's', 'ne', 'nw', 'se', 'sw'] as const)(
    'mirrors outward and inward drags from the %s handle around the center', (edge) => {
      for (const distance of [60, -60]) {
        const horizontal = edge.includes('e') || edge.includes('w');
        const vertical = edge.includes('n') || edge.includes('s');
        const frame = inspectorFrameFromPointer({
          start, originX: 800, originY: 500,
          clientX: 800 + (edge.includes('w') ? -distance : distance),
          clientY: 500 + (edge.includes('n') ? -distance : distance),
          edge, viewport
        });
        expect(frame).toEqual({
          left: start.left - (horizontal ? distance : 0),
          top: start.top - (vertical ? distance : 0),
          width: start.width + (horizontal ? distance * 2 : 0),
          height: start.height + (vertical ? distance * 2 : 0)
        });
      }
    }
  );

  it.each(['se', 'sw', 'ne', 'nw'] as const)('stays centered at viewport limits from %s', (edge) => {
    expect(inspectorFrameFromPointer({
      start, originX: 0, originY: 0,
      clientX: edge.includes('w') ? -4000 : 4000,
      clientY: edge.includes('n') ? -4000 : 4000,
      edge, viewport
    })).toEqual({ left: 16, top: 16, width: 1568, height: 968 });
  });

  it('stops shrinking at the minimum size without moving the center', () => {
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
    expect(west.left + west.width / 2).toBe(viewport.width / 2);
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
    expect(south.top + south.height / 2).toBe(viewport.height / 2);
  });

  it('moves the frame from the keyboard and ignores unrelated keys', () => {
    expect(inspectorFrameFromKey(start, 'ArrowRight', viewport)).toMatchObject({ width: 824, left: 388 });
    expect(inspectorFrameFromKey(start, 'ArrowLeft', viewport)).toMatchObject({ width: 776, left: 412 });
    expect(inspectorFrameFromKey(start, 'ArrowDown', viewport)).toMatchObject({ height: 624, top: 188 });
    expect(inspectorFrameFromKey(start, 'ArrowUp', viewport)).toMatchObject({ height: 576, top: 212 });
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
      left: 400,
      top: 200,
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
