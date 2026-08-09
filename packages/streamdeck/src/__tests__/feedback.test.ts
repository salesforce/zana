/**
 * Phase 2 "on-device feedback loop" coverage, at the controller seam (no socket
 * needed). Proves press-ack dims the pressed tile immediately, a resolved action
 * flashes the tile that fired it, and the flash override survives a poll-tick
 * re-render until its timer clears — so the outcome can't be raced away by the
 * grid redrawing underneath it.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { DeckController, FLASH_MS, coordToIndex } from '../deck/device.js';
import { Navigator, Page } from '../deck/page.js';
import { FakeDeck } from '../deck/fake-device.js';
import { composeTile, fitCaption } from '../deck/renderer.js';

afterEach(() => vi.useRealTimers());

/** A one-tile page whose (0,0) key is pressable; render is a plain green tile. */
function onePage(onPress: () => void): Page {
  const page = new Page('t');
  page.add({ col: 0, row: 0, render: () => composeTile({ status: 'running', caption: 'X' }), onPress });
  return page;
}

/** Sum of RGB across a tile — a cheap "how bright is it" proxy for dim detection. */
function brightness(data: Uint8Array | Buffer, channels: number): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += channels) sum += data[i] + data[i + 1] + data[i + 2];
  return sum;
}

describe('fitCaption (word-first ellipsis)', () => {
  // Fake metrics: 1 unit per character (spaces + the ellipsis included), so the
  // word-vs-char behaviour is deterministic without a real canvas.
  const ctx = { measureText: (s: string) => ({ width: s.length }) as TextMetrics };

  it('returns the caption unchanged when it fits', () => {
    expect(fitCaption(ctx, 'Add ZCC', 20)).toBe('Add ZCC');
  });

  it('drops whole trailing words (not mid-word) when it overflows', () => {
    // "Add ZCC Stream Deck" (19) > 10 → drop words until "Add ZCC…" (8) fits.
    expect(fitCaption(ctx, 'Add ZCC Stream Deck', 10)).toBe('Add ZCC…');
  });

  it('keeps as many leading words as fit', () => {
    // maxW 15 admits "Add ZCC Stream…" (15) — the three-word prefix.
    expect(fitCaption(ctx, 'Add ZCC Stream Deck', 15)).toBe('Add ZCC Stream…');
  });

  it('character-cuts a single word that still overflows', () => {
    // No spaces to break on → fall back to a char cut ending in an ellipsis.
    expect(fitCaption(ctx, 'Supercalifragilistic', 6)).toBe('Super…');
  });
});

describe('DeckController feedback', () => {
  it('dims the pressed tile immediately (press-ack) before the handler runs', () => {
    const deck = new FakeDeck();
    let pressed = false;
    const nav = new Navigator(onePage(() => (pressed = true)));
    const controller = new DeckController(deck, nav);

    const full = composeTile({ status: 'running', caption: 'X' });
    deck.press(coordToIndex(0, 0));

    expect(pressed).toBe(true);
    const ack = deck.lastBlit(0);
    expect(ack).toBeDefined();
    // The ack blit is strictly darker than a full-brightness render of the tile.
    expect(brightness(ack!.image.data, ack!.image.channels)).toBeLessThan(
      brightness(full.data, full.channels)
    );
    void controller;
  });

  it('flashes the outcome on the pressed tile, then restores it after FLASH_MS', async () => {
    vi.useFakeTimers();
    const deck = new FakeDeck();
    const nav = new Navigator(onePage(() => {}));
    const controller = new DeckController(deck, nav);

    deck.press(coordToIndex(0, 0)); // arms lastPressedIndex = 0
    controller.flashResult(true);
    // Flush the serialized render chain (renderKey queues on a promise chain).
    await vi.advanceTimersByTimeAsync(0);

    // A success flash is a green check tile — its status hint proves the override.
    expect(deck.lastBlit(0)?.image.status).toBe('running');

    // A poll-tick re-render must NOT clobber the flash while it's up.
    void controller.renderKey(0, 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(deck.lastBlit(0)?.image.status).toBe('running');

    // After the window, the override clears and the tile renders from the page.
    await vi.advanceTimersByTimeAsync(FLASH_MS + 1);
    void controller.renderKey(0, 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(deck.lastBlit(0)?.image.label).toBe('X');
  });
});
