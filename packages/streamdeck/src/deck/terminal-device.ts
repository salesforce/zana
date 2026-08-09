/**
 * A `DeckDevice` that renders the 8×4 grid to the terminal instead of HID
 * hardware, so the whole app can be *driven by a human* with no physical Stream
 * Deck and no canvas dependency. It reuses the exact controller/navigator/page
 * machinery the real deck uses — only the blit target and the input source
 * change:
 *
 *  - `fillKeyImage` records each key's colour + label (from the additive
 *    `status`/`label` hints on `KeyImage`) and repaints the grid.
 *  - key "presses" come from stdin: type a cell like `01` (col row) or `0,1`
 *    and hit enter, or `q` to quit.
 *
 * This is a dev/test surface, not shipped hardware; it exists so `--sim` mode
 * can exercise every view and action interactively.
 */

import { XL, coordToIndex } from './device.js';
import { STATUS_RGB, GLYPH_CHARS, luminance } from './renderer.js';
import type { DeckDevice, Geometry } from './device.js';
import type { KeyImage } from './page.js';
import type { GlyphName } from './glyphs.js';
import type { DeckStatus } from '../lib/types.js';

interface Cell {
  status?: DeckStatus;
  label?: string;
  icon?: GlyphName;
  badge?: string;
  alert?: boolean;
  filled: boolean;
}

const RESET = '\x1b[0m';
const CELL_W = 9; // inner width of a tile in chars
/** Bright-red foreground — the sim's stand-in for the "needs you" alert border. */
const ALERT_FG = '\x1b[38;2;244;67;54m';

function bg(status: DeckStatus | undefined): string {
  if (!status) return '\x1b[48;2;20;20;24m';
  const [r, g, b] = STATUS_RGB[status];
  return `\x1b[48;2;${r};${g};${b}m`;
}

/**
 * Black text on light fills (amber/teal/light-green), white otherwise — chosen
 * by the fill's luminance so it mirrors the renderer's contrast rule and stays
 * correct as new status colours (e.g. `done` teal) are added.
 */
function fg(status: DeckStatus | undefined): string {
  if (!status) return '\x1b[38;2;255;255;255m';
  return luminance(STATUS_RGB[status]) > 140 ? '\x1b[38;2;0;0;0m' : '\x1b[38;2;255;255;255m';
}

function pad(s: string, w: number): string {
  const t = s.length > w ? s.slice(0, w) : s;
  const total = w - t.length;
  const left = Math.floor(total / 2);
  return ' '.repeat(left) + t + ' '.repeat(total - left);
}

export class TerminalDeck implements DeckDevice {
  readonly geometry: Geometry;
  readonly keyCount: number;
  private readonly cells: Cell[];
  private downCb: ((index: number) => void) | null = null;
  private closedFlag = false;
  private repaintQueued = false;

  /** Defaults to XL (8×4); pass a geometry to preview a smaller deck's fold. */
  constructor(geometry: Geometry = XL) {
    this.geometry = geometry;
    this.keyCount = geometry.cols * geometry.rows;
    this.cells = Array.from({ length: this.keyCount }, () => ({ filled: false }));
  }

  clearPanel(): void {
    for (const c of this.cells) {
      c.filled = false;
      c.label = undefined;
      c.status = undefined;
      c.icon = undefined;
      c.badge = undefined;
      c.alert = undefined;
    }
    this.paint();
  }

  clearKey(index: number): void {
    const c = this.cells[index];
    if (c) {
      c.filled = false;
      c.label = undefined;
      c.status = undefined;
      c.icon = undefined;
      c.badge = undefined;
      c.alert = undefined;
    }
    this.scheduleRepaint();
  }

  fillKeyImage(index: number, image: KeyImage): void {
    const c = this.cells[index];
    if (!c) return;
    c.filled = true;
    c.status = image.status;
    c.label = image.label;
    c.icon = image.icon;
    c.badge = image.badge;
    c.alert = image.alert;
    this.scheduleRepaint();
  }

  /**
   * Coalesce the per-key writes of one `renderAll` pass into a single repaint
   * on the next microtask, so navigating a page redraws the grid exactly once
   * instead of once per tile.
   */
  private scheduleRepaint(): void {
    if (this.repaintQueued) return;
    this.repaintQueued = true;
    queueMicrotask(() => {
      this.repaintQueued = false;
      this.paint();
    });
  }

  on(_event: 'down', cb: (index: number) => void): void {
    this.downCb = cb;
  }

  close(): void {
    this.closedFlag = true;
  }

  get closed(): boolean {
    return this.closedFlag;
  }

  /** Simulate a press at (col,row). Ignores out-of-range coords. */
  pressCoord(col: number, row: number): void {
    const { cols, rows } = this.geometry;
    if (col < 0 || col >= cols || row < 0 || row >= rows) return;
    this.downCb?.(coordToIndex(col, row, cols));
  }

  /** Repaint the whole grid in place. Called after every render pass. */
  paint(): void {
    const { cols, rows } = this.geometry;
    const lines: string[] = [];
    lines.push('');
    lines.push(`  ZCC Stream Deck — terminal simulator (${cols}×${rows})   (type "col row", e.g. 0 0, then Enter · q to quit)`);
    lines.push('');

    // Column header
    let header = '     ';
    for (let col = 0; col < cols; col++) header += pad(`c${col}`, CELL_W) + ' ';
    lines.push(header);

    for (let row = 0; row < rows; row++) {
      // Two text rows per tile line for a chunkier, more tile-like look.
      let top = ` r${row}  `;
      let mid = `     `;
      for (let col = 0; col < cols; col++) {
        const c = this.cells[coordToIndex(col, row, cols)];
        const paint = c.filled;
        const label = c.label ?? '';
        // Top text row shows the GLYPH channel (icon char) with the BADGE at the
        // right, so --sim previews the shape/badge, not just the fill colour.
        const glyph = c.icon ? GLYPH_CHARS[c.icon] : '';
        const badge = c.badge ? c.badge.slice(0, 2) : '';
        const iconRow = glyph || badge ? `${glyph}${badge ? ' ' + badge : ''}` : '';
        // "Needs you" alert: the sim can't draw a border, so it flags the tile by
        // rendering its glyph/label row in bright red (the hardware gets a red border).
        const ink = c.alert ? ALERT_FG : fg(c.status);
        top += bg(paint ? c.status : undefined) + ink + pad(iconRow, CELL_W) + RESET + ' ';
        mid += bg(paint ? c.status : undefined) + ink + pad(label, CELL_W) + RESET + ' ';
      }
      lines.push(top);
      lines.push(mid);
      lines.push('');
    }

    // Clear screen + home, then draw. Keeps the grid pinned to the top.
    process.stdout.write('\x1b[2J\x1b[H' + lines.join('\n') + '\n');
  }
}
