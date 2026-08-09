/**
 * Device abstraction — a TypeScript port of the showcase's `deck/device.py`,
 * generalized behind an interface so the controller is testable without
 * hardware. The real driver wraps `@elgato-stream-deck/node` (cross-platform
 * HID via node-hid); a `FakeDeck` records blits for tests.
 *
 * The Elgato Stream Deck XL is 8 columns × 4 rows; `keyIndex = row*COLS + col`.
 */

import { Navigator } from './page.js';
import { dimImage, feedbackTile } from './renderer.js';
import type { KeyImage } from './page.js';

/** Default (Stream Deck XL) geometry — the layouts' reference grid. */
export const COLS = 8;
export const ROWS = 4;

/** A deck's physical grid. Derived from the device so layouts adapt per model. */
export interface Geometry {
  cols: number;
  rows: number;
  /**
   * Native pixel size of one key's image (square). Optional: the real Elgato
   * adapter reports the connected model's size so the renderer authors at true
   * native resolution; FakeDeck and the terminal sim leave it undefined and the
   * renderer defaults to the XL's 96.
   */
  keyPx?: number;
}

export const XL: Geometry = { cols: COLS, rows: ROWS };

export function coordToIndex(col: number, row: number, cols: number = COLS): number {
  return row * cols + col;
}

export function indexToCoord(index: number, cols: number = COLS): [number, number] {
  return [index % cols, Math.floor(index / cols)];
}

/**
 * The narrow device surface the controller needs. Implemented by the real HID
 * driver and by `FakeDeck`. Matches the subset of `@elgato-stream-deck/node`'s
 * API we depend on, so the adapter is thin.
 */
export interface DeckDevice {
  readonly keyCount: number;
  /**
   * The device's physical grid. Optional for back-compat (FakeDeck and the
   * terminal sim default to XL); the real Elgato adapter reports the connected
   * model's actual cols/rows so layouts fold to fit smaller decks.
   */
  readonly geometry?: Geometry;
  clearPanel(): Promise<void> | void;
  /** Reset a single key to black (for a page slot with no Key). */
  clearKey(index: number): Promise<void> | void;
  /** Blit a native-format image to one key. */
  fillKeyImage(index: number, image: KeyImage): Promise<void> | void;
  on(event: 'down', cb: (index: number) => void): void;
  close(): Promise<void> | void;
}

/** How long a result-flash overrides its target key before the grid restores it. */
export const FLASH_MS = 800;

export class DeckController {
  private renderLock = Promise.resolve();
  private readonly geom: Geometry;
  /** Native key px, so feedback tiles author at the connected model's size. */
  private readonly keyPx?: number;
  /** The last key pressed, so a resolved action flashes the tile that fired it. */
  private lastPressedIndex: number | null = null;
  /** Key index → transient image that overrides the page render until cleared. */
  private readonly overrides = new Map<number, KeyImage>();
  /** Per-key flash timers, so a new flash on the same key cancels the old one. */
  private readonly flashTimers = new Map<number, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly device: DeckDevice,
    private readonly navigator: Navigator
  ) {
    this.geom = device.geometry ?? XL;
    this.keyPx = this.geom.keyPx;
    this.device.on('down', (index) => this.onKeyDown(index));
  }

  /**
   * Render one key from the current page. Serialized through a promise chain so
   * concurrent renders (poll tick + press feedback) can't interleave blits —
   * the JS single-threaded model already prevents the Python port's dict-race,
   * but device I/O is async, so we still order the writes.
   */
  renderKey(col: number, row: number): Promise<void> {
    const index = coordToIndex(col, row, this.geom.cols);
    this.renderLock = this.renderLock.then(async () => {
      // A transient override (press-ack dim / result flash) wins over the page
      // render until its timer clears it, so an async action's outcome stays
      // visible even as a poll tick re-renders the grid underneath it.
      const override = this.overrides.get(index);
      if (override) {
        await this.device.fillKeyImage(index, override);
        return;
      }
      const key = this.navigator.current.get(col, row);
      if (!key) {
        await this.device.clearKey(index);
        return;
      }
      await this.device.fillKeyImage(index, key.render());
    });
    return this.renderLock;
  }

  async renderAll(): Promise<void> {
    for (let row = 0; row < this.geom.rows; row++) {
      for (let col = 0; col < this.geom.cols; col++) {
        await this.renderKey(col, row);
      }
    }
  }

  private onKeyDown(index: number): void {
    const [col, row] = indexToCoord(index, this.geom.cols);
    const key = this.navigator.current.get(col, row);
    if (!key) return;
    // Press-ack: blit a dimmed copy of the tile synchronously so the key feels
    // live, then let the next render (a nav push or a poll tick) restore it. Only
    // for pressable keys, and never over a still-showing result flash.
    if (key.onPress && !this.overrides.has(index)) {
      void this.device.fillKeyImage(index, dimImage(key.render()));
    }
    // Remember which key fired, so a resolved action flashes the right tile.
    this.lastPressedIndex = index;
    // Press handlers must not block (they enqueue intents) — see actions.ts.
    key.onPress?.();
  }

  /**
   * Flash the outcome of an async action on the tile that triggered it: a check
   * on green for success, a cross on rust for failure, for `FLASH_MS`, then
   * restore the tile from the live page. Called from the app's `onResult` hook.
   * No-op if no key has been pressed yet.
   */
  flashResult(ok: boolean, index: number | null = this.lastPressedIndex): void {
    if (index == null) return;
    const image = feedbackTile(ok, this.keyPx);
    this.overrides.set(index, image);
    const [col, row] = indexToCoord(index, this.geom.cols);
    void this.renderKey(col, row);

    const prev = this.flashTimers.get(index);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      this.overrides.delete(index);
      this.flashTimers.delete(index);
      // Restore from the CURRENT page (it may have changed while the flash was up).
      void this.renderKey(col, row);
    }, FLASH_MS);
    // Don't keep the process alive just for a cosmetic flash.
    if (typeof timer.unref === 'function') timer.unref();
    this.flashTimers.set(index, timer);
  }

  async close(): Promise<void> {
    for (const t of this.flashTimers.values()) clearTimeout(t);
    this.flashTimers.clear();
    this.overrides.clear();
    await this.device.clearPanel();
    await this.device.close();
  }
}
