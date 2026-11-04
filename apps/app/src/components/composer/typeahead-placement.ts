import type { PopoverMenuPlacement } from '../ui/PopoverPicklist.js';

const VIEWPORT_PADDING = 8;
const ANCHOR_GAP = 8;
// Matches the non-portalled fallback in global.css; floating menus use the
// inline cap calculated here against the visible (keyboard-aware) viewport.
const MENU_MAX_HEIGHT = 280;
const MENU_VIEWPORT_FRACTION = 0.42;
// Flip when the preferred side cannot show a useful group of menu rows.
const MIN_PREFERRED_HEIGHT = 160;

/** Keep the composer menu inside the viewport, including on short windows. */
export function placeTypeaheadMenu(
  anchor: Pick<DOMRect, 'left' | 'top' | 'bottom' | 'width'>,
  viewport: { width: number; height: number; offsetLeft?: number; offsetTop?: number; layoutHeight?: number },
  preferAbove: boolean
): PopoverMenuPlacement {
  const padding = VIEWPORT_PADDING;
  const gap = ANCHOR_GAP;
  const viewportTop = viewport.offsetTop ?? 0;
  const viewportLeft = viewport.offsetLeft ?? 0;
  const viewportBottom = viewportTop + viewport.height;
  const height = Math.max(0, viewport.height - padding * 2);
  const width = Math.min(anchor.width, Math.max(0, viewport.width - padding * 2));
  const left = Math.max(viewportLeft + padding, Math.min(anchor.left, viewportLeft + viewport.width - padding - width));
  const above = Math.max(0, Math.min(height, anchor.top - viewportTop - gap - padding));
  const below = Math.max(0, Math.min(height, viewportBottom - anchor.bottom - gap - padding));
  const cap = Math.min(MENU_MAX_HEIGHT, Math.floor(viewport.height * MENU_VIEWPORT_FRACTION));
  const preferred = preferAbove ? above : below;
  const alternate = preferAbove ? below : above;
  const openAbove = preferred < Math.min(MIN_PREFERRED_HEIGHT, cap) && alternate > preferred ? !preferAbove : preferAbove;
  const maxHeight = Math.min(cap, openAbove ? above : below);
  return openAbove
    ? { left, width, maxHeight, bottom: (viewport.layoutHeight ?? viewport.height) - Math.min(viewportBottom - padding, Math.max(viewportTop + padding, anchor.top - gap)) }
    : { left, width, maxHeight, top: Math.max(viewportTop + padding, Math.min(viewportBottom - padding, anchor.bottom + gap)) };
}
