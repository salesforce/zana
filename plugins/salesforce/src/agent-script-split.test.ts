import { describe, expect, it } from 'vitest';
import {
  clampSplitRatio,
  DEFAULT_SPLIT_RATIO,
  MAX_SPLIT_RATIO,
  MIN_SPLIT_RATIO,
  splitRatioFromClientX,
  splitRatioFromKey
} from '../lib/agent-script-split.js';

describe('agent script split resize', () => {
  it('clamps and maps pointer position to a pane ratio', () => {
    expect(clampSplitRatio(0.58)).toBe(0.58);
    expect(clampSplitRatio(0)).toBe(MIN_SPLIT_RATIO);
    expect(clampSplitRatio(1)).toBe(MAX_SPLIT_RATIO);
    expect(clampSplitRatio(Number.NaN)).toBe(DEFAULT_SPLIT_RATIO);
    expect(splitRatioFromClientX(100, 0, 0)).toBe(DEFAULT_SPLIT_RATIO);
    expect(splitRatioFromClientX(280, 0, 1000)).toBe(MIN_SPLIT_RATIO);
    expect(splitRatioFromClientX(500, 0, 1000)).toBe(0.5);
  });

  it('moves the split from the keyboard and resets on Enter', () => {
    expect(splitRatioFromKey(0.5, 'ArrowLeft')).toBe(0.46);
    expect(splitRatioFromKey(0.5, 'ArrowRight')).toBe(0.54);
    expect(splitRatioFromKey(0.5, 'Home')).toBe(MIN_SPLIT_RATIO);
    expect(splitRatioFromKey(0.5, 'End')).toBe(MAX_SPLIT_RATIO);
    expect(splitRatioFromKey(0.4, 'Enter')).toBe(DEFAULT_SPLIT_RATIO);
    expect(splitRatioFromKey(0.5, 'Tab')).toBeNull();
  });
});
