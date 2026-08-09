/**
 * Headless DeckDevice for tests: records every blit and lets a test simulate a
 * key press. No hardware, no optional deps — the whole app can run against it.
 */

import type { DeckDevice } from './device.js';
import type { KeyImage } from './page.js';

export interface Blit {
  index: number;
  image: KeyImage;
}

export class FakeDeck implements DeckDevice {
  readonly keyCount = 32;
  readonly blits: Blit[] = [];
  cleared = 0;
  closed = false;
  private downCb: ((index: number) => void) | null = null;

  clearPanel(): void {
    this.cleared++;
  }

  clearKey(_index: number): void {
    /* recorded implicitly via absence of a blit */
  }

  fillKeyImage(index: number, image: KeyImage): void {
    this.blits.push({ index, image });
  }

  on(_event: 'down', cb: (index: number) => void): void {
    this.downCb = cb;
  }

  close(): void {
    this.closed = true;
  }

  /** Simulate a physical press at the given key index. */
  press(index: number): void {
    this.downCb?.(index);
  }

  /** Most recent blit recorded for a key index, or undefined. */
  lastBlit(index: number): Blit | undefined {
    for (let i = this.blits.length - 1; i >= 0; i--) {
      if (this.blits[i].index === index) return this.blits[i];
    }
    return undefined;
  }
}
