export const DEFAULT_SPLIT_RATIO = 0.58;
export const MIN_SPLIT_RATIO = 0.28;
export const MAX_SPLIT_RATIO = 0.72;
export const SPLIT_KEYBOARD_STEP = 0.04;

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_SPLIT_RATIO;
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));
}

export function splitRatioFromClientX(clientX: number, left: number, width: number): number {
  if (!(width > 0)) return DEFAULT_SPLIT_RATIO;
  return clampSplitRatio((clientX - left) / width);
}

export function splitRatioFromKey(ratio: number, key: string): number | null {
  if (key === 'ArrowLeft' || key === 'ArrowUp') return clampSplitRatio(ratio - SPLIT_KEYBOARD_STEP);
  if (key === 'ArrowRight' || key === 'ArrowDown') return clampSplitRatio(ratio + SPLIT_KEYBOARD_STEP);
  if (key === 'Home') return MIN_SPLIT_RATIO;
  if (key === 'End') return MAX_SPLIT_RATIO;
  if (key === 'Enter' || key === ' ') return DEFAULT_SPLIT_RATIO;
  return null;
}
