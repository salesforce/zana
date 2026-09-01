/** Layout box of `.plugin-guide-chip` before `--guide-chip-scale` transform. */
export const ANNOTATION_CHIP_LAYOUT_SIZE = 20;
export const ANNOTATION_CHIP_GAP = 8;

/**
 * Absolute `left`/`top` for a measured chip. Chips keep a 20px layout box and
 * grow with `transform: scale()`, so offsets are from the layout center, not
 * the visual box origin.
 */
export function measuredChipLayoutPosition({
  at,
  local,
  frame,
  layoutSize = ANNOTATION_CHIP_LAYOUT_SIZE,
  visualSize,
  gap = ANNOTATION_CHIP_GAP
}: {
  at: 'start' | 'end' | 'above';
  local: { left: number; top: number; width: number; height: number };
  frame: { left: number; right: number };
  layoutSize?: number;
  visualSize: number;
  gap?: number;
}): { left: number; top: number } {
  const halfLayout = layoutSize / 2;
  const halfVisual = visualSize / 2;
  const top = local.top + local.height / 2 - halfLayout;
  if (at === 'start') {
    return { left: frame.left - gap - halfLayout - halfVisual, top };
  }
  if (at === 'end') {
    return { left: frame.right + gap - halfLayout + halfVisual, top };
  }
  return {
    left: local.left + local.width / 2 - halfLayout,
    top: local.top - 4 - halfLayout - halfVisual
  };
}
