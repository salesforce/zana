/**
 * A transient "Loading…" page shown the instant a fetch-on-open view is opened
 * (Projects / Schedules / Status), before the control-plane round-trip resolves.
 * It's replaced in place by the real grid when the data arrives. Without it a
 * press into a slow view would leave the previous page on the keys — the button
 * would feel dead and an impatient double-press could push twice.
 *
 * A single non-pressable spinner tile at (0,0): a "working" arc glyph on the
 * neutral running fill. Pressing anything is a no-op until the real page swaps in.
 */

import { Page } from '../deck/page.js';
import { XL, type Geometry } from '../deck/device.js';
import { composeTile } from '../deck/renderer.js';

/** Build the loading placeholder for a named view (caption e.g. "Projects"). */
export function buildLoadingPage(caption: string, geom: Geometry = XL): Page {
  const size = geom.keyPx; // native key px (undefined → renderer defaults to 96)
  const page = new Page('loading');
  page.add({
    col: 0,
    row: 0,
    render: () => composeTile({ status: 'running', caption, icon: 'working', pressable: false, size })
  });
  return page;
}
