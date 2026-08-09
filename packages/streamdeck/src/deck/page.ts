/**
 * Page / Navigator — a TypeScript port of the showcase's `deck/pages.py`. A Page
 * is a grid of Keys addressed by (col, row); Navigator is a push/pop stack of
 * pages. Zero device or OS coupling — this is pure state.
 */

export type Coord = `${number},${number}`;

export function coordKey(col: number, row: number): Coord {
  return `${col},${row}`;
}

/** What one deck key shows and does. `render` returns a bitmap the device layer blits. */
export interface Key {
  col: number;
  row: number;
  /** Produce the key image (RGB bitmap). Called on every render tick for this key. */
  render: () => KeyImage;
  /** Invoked on press. Omit for a decorative/blank key. Must not block — enqueue instead. */
  onPress?: () => void;
}

/** A rendered key: raw RGB(A) pixels the device layer converts to native format. */
export interface KeyImage {
  width: number;
  height: number;
  /** Row-major RGB or RGBA bytes. */
  data: Uint8Array | Buffer;
  channels: 3 | 4;
  /**
   * Optional presentation hints, ignored by the HID device (it blits `data`)
   * but used by the terminal simulator to draw a labelled, coloured tile
   * without decoding the bitmap. Purely additive — set by the renderer.
   */
  label?: string;
  status?: import('../lib/types.js').DeckStatus;
  /**
   * Composed-tile presentation hints (also additive, HID-ignored). `icon` names
   * a vector glyph the sim renders as a BMP char; `badge` is a count numeral or
   * mini state char shown top-right. Set by the renderer's `composeTile`.
   */
  icon?: import('./glyphs.js').GlyphName;
  badge?: string;
  /** "Needs you" alert flag — the sim marks the tile (red border on hardware). */
  alert?: boolean;
  /** Large in-zone readout drawn instead of a glyph (e.g. a schedule ETA). */
  heroText?: string;
}

export class Page {
  readonly keys = new Map<Coord, Key>();

  constructor(readonly name: string, keys: Key[] = []) {
    for (const k of keys) this.add(k);
  }

  add(key: Key): void {
    this.keys.set(coordKey(key.col, key.row), key);
  }

  get(col: number, row: number): Key | undefined {
    return this.keys.get(coordKey(col, row));
  }
}

export class Navigator {
  private stack: Page[];

  constructor(root: Page) {
    this.stack = [root];
  }

  get current(): Page {
    return this.stack[this.stack.length - 1];
  }

  push(page: Page): void {
    this.stack.push(page);
  }

  pop(): void {
    if (this.stack.length > 1) this.stack.pop();
  }

  /**
   * Replace the root (bottom) page without disturbing anything pushed on top.
   * Used by the poll loop to swap in a freshly-built grid each tick.
   */
  replaceRoot(page: Page): void {
    this.stack[0] = page;
  }

  /**
   * Replace the CURRENT (top) page in place. Used to swap a freshly-rebuilt
   * grid under the user while they're viewing it — e.g. the agents poll tick,
   * now that agents is a pushed page rather than the root. Rebuild-and-swap is
   * race-free vs. mutating a live page's keys.
   */
  replaceCurrent(page: Page): void {
    this.stack[this.stack.length - 1] = page;
  }
}
