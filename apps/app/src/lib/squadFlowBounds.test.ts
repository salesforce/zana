import { describe, expect, it } from 'vitest';
import { squadFlowBounds } from './squadFlowBounds.js';

describe('squadFlowBounds', () => {
  it('includes a routed back-edge side lane and marker padding outside the node layout', () => {
    const bounds = squadFlowBounds(
      [{ x: 420, y: 16, width: 244, height: 88 }],
      [{ x: 542, y: 104 }, { x: 1_142, y: 126 }, { x: 1_142, y: -6 }],
      1_100,
      340,
      16
    );

    expect(bounds).toEqual({ offsetX: 16, offsetY: 22, width: 1_174, height: 378 });
    expect(1_142 + bounds.offsetX + 16).toBeLessThanOrEqual(bounds.width);
    expect(-6 + bounds.offsetY - 16).toBeGreaterThanOrEqual(0);
  });

  it('expands and shifts content when a dragged node crosses the top-left origin', () => {
    const bounds = squadFlowBounds(
      [{ x: -80, y: -40, width: 244, height: 88 }],
      [{ x: -20, y: -10 }],
      1_100,
      340,
      16
    );

    expect(bounds.offsetX).toBe(96);
    expect(bounds.offsetY).toBe(56);
    expect(-80 + bounds.offsetX).toBe(16);
    expect(-40 + bounds.offsetY).toBe(16);
  });
});
