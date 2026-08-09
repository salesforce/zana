/**
 * Responsive layout helper. The pages describe *what* tiles they want (a body
 * list + a nav bar) and this places them for the connected deck's geometry, so
 * the same page code lights up an 8×4 XL and a 5×3 original alike.
 *
 * One universal rule keeps muscle memory stable across models:
 *   - BODY tiles flow row-major across every row EXCEPT the last.
 *   - The NAV bar lives on the last row: caller-supplied nav tiles from the
 *     left, and (optionally) Back pinned to the bottom-right corner.
 *
 * On XL (8×4) this reproduces the hand-tuned layout exactly (body = rows 0–2 =
 * 24 slots, nav = row 3, Back at col 7); on a 5×3 deck it folds to body = rows
 * 0–1 = 10 slots, nav = row 2, Back at col 4 — no coordinate is ever off-device.
 */

import { Page, type KeyImage } from './page.js';
import { statusTile, composeTile } from './renderer.js';
import type { Geometry } from './device.js';

export interface TileSpec {
  render: () => KeyImage;
  onPress?: () => void;
}

/**
 * Overflow paging for a body that exceeds the grid's capacity. When present and
 * the body is too long, the last body slot becomes a "More +N" tile that calls
 * `onMore` (the caller advances `pageIndex`, wrapping, and rebuilds), so items
 * are paged through instead of silently dropped off the end.
 */
export interface PagingSpec {
  /** Which page of the body to show (0-based). Wrapped by the caller. */
  pageIndex: number;
  /** Advance to the next page (caller bumps its index and rebuilds). */
  onMore: () => void;
}

export interface GridSpec {
  name: string;
  geom: Geometry;
  /** Body tiles, flowed row-major across all rows but the last. */
  body: TileSpec[];
  /** Nav tiles placed on the last row from col 0 (Refresh, Swap, …). */
  nav?: TileSpec[];
  /** Back tile, pinned bottom-right (last col of the last row). */
  back?: TileSpec;
  /** When true, remaining body cells render as idle filler (a "full" grid). */
  fillBody?: boolean;
  /** Optional overflow paging; only engages when body.length exceeds capacity. */
  paging?: PagingSpec;
}

/** Body capacity for a geometry: every cell except the reserved last (nav) row. */
export function bodyCapacity(geom: Geometry): number {
  return geom.cols * Math.max(1, geom.rows - 1);
}

export function buildGrid(spec: GridSpec): Page {
  const { name, geom, body, nav = [], back, fillBody, paging } = spec;
  const page = new Page(name);
  const cap = bodyCapacity(spec.geom);
  const lastRow = geom.rows - 1;
  const size = geom.keyPx; // native key px (undefined → renderer defaults to 96)

  // When the body overflows, reserve the final body slot for a "More" tile and
  // window the body to the current page; otherwise show it as-is (no paging).
  const overflow = !!paging && body.length > cap;
  const slotsForItems = overflow ? cap - 1 : cap;
  const pageCount = overflow ? Math.ceil(body.length / slotsForItems) : 1;
  const pageIndex = overflow ? ((paging!.pageIndex % pageCount) + pageCount) % pageCount : 0;
  const start = pageIndex * slotsForItems;
  const shown = body.slice(start, start + slotsForItems);

  const cells = fillBody ? cap : overflow ? slotsForItems : shown.length;
  for (let i = 0; i < cells; i++) {
    const col = i % geom.cols;
    const row = Math.floor(i / geom.cols);
    const t = shown[i];
    if (t) page.add({ col, row, render: t.render, onPress: t.onPress });
    else if (fillBody) page.add({ col, row, render: () => statusTile('idle') });
  }

  // "More +N" tile in the reserved final body slot when the body overflows.
  if (overflow) {
    const remaining = body.length - shown.length;
    const col = slotsForItems % geom.cols;
    const row = Math.floor(slotsForItems / geom.cols);
    page.add({
      col,
      row,
      render: () => composeTile({ status: 'idle', caption: 'More', icon: 'more', badge: `+${remaining}`, size }),
      onPress: paging!.onMore
    });
  }

  // Nav bar on the last row, left→right; Back pinned to the bottom-right corner.
  nav.forEach((t, j) => {
    if (j < geom.cols - 1) page.add({ col: j, row: lastRow, render: t.render, onPress: t.onPress });
  });
  if (back) page.add({ col: geom.cols - 1, row: lastRow, render: back.render, onPress: back.onPress });

  return page;
}

export interface OverlaySpec {
  name: string;
  geom: Geometry;
  /** The target this overlay acts on — pinned to (0,0), non-pressable. */
  header: TileSpec;
  /** Action tiles, flowed row-major from row 1 (rows above the Back row). */
  actions: TileSpec[];
  /** Back tile, pinned to (0, lastRow). */
  back: TileSpec;
}

/**
 * A per-item action overlay (agent / project / schedule). Header at (0,0),
 * actions flow across the middle rows, Back pinned to the bottom-RIGHT corner —
 * the same corner `buildGrid` uses, so Back is muscle-memory consistent across
 * every grid and overlay. Reproduces the XL overlays' action positions (Approve
 * at (0,1), etc.) while folding onto a 5×3 deck without any coordinate landing
 * off-device.
 */
export function buildOverlay(spec: OverlaySpec): Page {
  const { name, geom, header, actions, back } = spec;
  const page = new Page(name);
  const lastRow = geom.rows - 1;

  page.add({ col: 0, row: 0, render: header.render, onPress: header.onPress });

  // Actions occupy rows 1..lastRow-1 (the Back row is reserved). Every current
  // overlay has ≤4 actions, which fits row 1 on both the XL and the 5×3.
  const actionRows = Math.max(1, lastRow - 1);
  const capacity = actionRows * geom.cols;
  actions.slice(0, capacity).forEach((t, i) => {
    const col = i % geom.cols;
    const row = 1 + Math.floor(i / geom.cols);
    page.add({ col, row, render: t.render, onPress: t.onPress });
  });

  page.add({ col: geom.cols - 1, row: lastRow, render: back.render, onPress: back.onPress });
  return page;
}
