import { describe, expect, it } from 'vitest';
import { placeTypeaheadMenu } from './typeahead-placement.js';

describe('placeTypeaheadMenu', () => {
  const viewport = { width: 800, height: 600 };
  const anchor = { left: 100, top: 350, bottom: 450, width: 500 };
  it('prefers above for a thread and below for home when there is room', () => {
    expect(placeTypeaheadMenu(anchor, viewport, true)).toEqual({ left: 100, width: 500, bottom: 258, maxHeight: 252 });
    expect(placeTypeaheadMenu({ ...anchor, top: 100, bottom: 200 }, viewport, false)).toEqual({ left: 100, width: 500, top: 208, maxHeight: 252 });
  });
  it('flips away from the top or bottom edge and caps the available height', () => {
    expect(placeTypeaheadMenu({ ...anchor, top: 30, bottom: 120 }, viewport, true).top).toBe(128);
    expect(placeTypeaheadMenu({ ...anchor, top: 500, bottom: 590 }, viewport, false).bottom).toBe(108);
    expect(placeTypeaheadMenu({ ...anchor, top: 180, bottom: 280 }, { width: 800, height: 300 }, false).maxHeight).toBe(126);
  });
  it('fits a wide anchor into a narrow viewport and clamps horizontal edges', () => {
    expect(placeTypeaheadMenu(anchor, { width: 320, height: 600 }, true)).toMatchObject({ left: 8, width: 304 });
    expect(placeTypeaheadMenu({ ...anchor, left: -40 }, viewport, false).left).toBe(8);
    expect(placeTypeaheadMenu({ ...anchor, left: 700 }, viewport, false).left).toBe(292);
  });
  it('never returns negative dimensions with an offscreen anchor or tiny viewport', () => {
    expect(placeTypeaheadMenu({ left: -100, top: -100, bottom: 700, width: 900 }, { width: 10, height: 10 }, false)).toEqual({ left: 8, width: 0, top: 8, maxHeight: 0 });
  });
  it('confines both placements to a panned visual viewport within the layout viewport', () => {
    const visible = { width: 390, height: 300, offsetLeft: 20, offsetTop: 180, layoutHeight: 800 };
    expect(placeTypeaheadMenu({ left: 0, top: 400, bottom: 440, width: 500 }, visible, true))
      .toEqual({ left: 28, width: 374, bottom: 408, maxHeight: 126 });
    expect(placeTypeaheadMenu({ left: 0, top: 220, bottom: 260, width: 350 }, visible, true))
      .toEqual({ left: 28, width: 350, top: 268, maxHeight: 126 });
  });
});
