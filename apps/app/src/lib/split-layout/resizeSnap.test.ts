import { describe, expect, it } from 'vitest';
import {
  createEvenSplitSnap,
  SPLIT_RESIZE_SNAP_CAPTURE_PX,
  SPLIT_RESIZE_SNAP_RELEASE_PX
} from './resizeSnap.js';

describe('createEvenSplitSnap', () => {
  it('captures near the even point and releases only past the release distance', () => {
    const snap = createEvenSplitSnap(100);
    expect(snap(100 + SPLIT_RESIZE_SNAP_CAPTURE_PX + 1)).toBe(false);
    expect(snap(100 - SPLIT_RESIZE_SNAP_CAPTURE_PX)).toBe(true);
    expect(snap(100 + SPLIT_RESIZE_SNAP_RELEASE_PX)).toBe(true);
    expect(snap(100 + SPLIT_RESIZE_SNAP_RELEASE_PX + 1)).toBe(false);
    expect(snap(100 + SPLIT_RESIZE_SNAP_CAPTURE_PX + 1)).toBe(false);
  });
});
