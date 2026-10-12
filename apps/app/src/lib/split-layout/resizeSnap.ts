/** Pointer distance that catches the divider on the even split. */
export const SPLIT_RESIZE_SNAP_CAPTURE_PX = 12;
/** Distance the pointer must travel to pull a caught divider loose. */
export const SPLIT_RESIZE_SNAP_RELEASE_PX = 30;

/**
 * Snap a divider drag to the even split of its two panes, with hysteresis:
 * caught within the capture distance, released past the release distance.
 */
export function createEvenSplitSnap(evenPointer: number): (pointer: number) => boolean {
  let snapped = false;
  return (pointer) => {
    const distance = Math.abs(pointer - evenPointer);
    snapped = distance <= (snapped ? SPLIT_RESIZE_SNAP_RELEASE_PX : SPLIT_RESIZE_SNAP_CAPTURE_PX);
    return snapped;
  };
}
