import { describe, expect, it } from 'vitest';
import { EXPLORER_MINIMAP_DEFAULTS, EXPLORER_MINIMAP_MIN_EDITOR_WIDTH } from '@zana-ai/zcc-domain/product';
import { minimapAutoHidden, minimapOptionsFor } from './minimapOptions.js';

const prefs = EXPLORER_MINIMAP_DEFAULTS;

describe('minimapOptionsFor', () => {
  it.each([
    ['narrow', 60],
    ['default', 120],
    ['wide', 200]
  ] as const)('%s width maps to maxColumn %i', (width, maxColumn) => {
    expect(minimapOptionsFor({ ...prefs, width }, 1000)).toMatchObject({ enabled: true, maxColumn });
  });

  it('maps the remaining preferences straight through', () => {
    expect(
      minimapOptionsFor(
        { ...prefs, renderCharacters: false, verticalSize: 'fit', slider: 'always', side: 'left' },
        1000
      )
    ).toEqual({ enabled: true, side: 'left', renderCharacters: false, size: 'fit', scale: 1, showSlider: 'always', maxColumn: 120 });
  });

  it('is disabled when switched off, regardless of width', () => {
    expect(minimapOptionsFor({ ...prefs, enabled: false }, 1000)).toEqual({ enabled: false });
  });

  it('hides below the width threshold, shows at it, and preserves options when unmeasured', () => {
    expect(minimapOptionsFor(prefs, EXPLORER_MINIMAP_MIN_EDITOR_WIDTH - 1)).toEqual({ enabled: false });
    expect(minimapOptionsFor(prefs, EXPLORER_MINIMAP_MIN_EDITOR_WIDTH).enabled).toBe(true);
    expect(minimapOptionsFor(prefs, 0).enabled).toBe(true);
  });
});

describe('minimapAutoHidden', () => {
  it('is only true when enabled and measured but too narrow', () => {
    expect(minimapAutoHidden(prefs, 300)).toBe(true);
    expect(minimapAutoHidden(prefs, 900)).toBe(false);
    expect(minimapAutoHidden(prefs, 0)).toBe(false);
    expect(minimapAutoHidden({ ...prefs, enabled: false }, 300)).toBe(false);
  });
});
