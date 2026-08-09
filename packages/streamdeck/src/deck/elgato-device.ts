/**
 * Real hardware adapter over `@elgato-stream-deck/node` v7 (cross-platform HID
 * via node-hid — the same lib on macOS, Windows, and Linux, unlike the
 * showcase's Windows-only stack). Isolated behind the `DeckDevice` interface and
 * a lazy import so the rest of the package builds and tests headless: only
 * `openDeck` touches the optional dependency, and it throws a clear error if
 * it's absent.
 *
 * v7 is control-object based: `openStreamDeck` takes a device path (from
 * `listStreamDecks()`), keys are `button` entries in `CONTROLS`, and the `down`
 * event yields the pressed control (we forward its `.index`).
 */

import { createRequire } from 'node:module';

import type { DeckDevice, Geometry } from './device.js';
import type { KeyImage } from './page.js';

const require = createRequire(import.meta.url);

type NodeMod = typeof import('@elgato-stream-deck/node');
type StreamDeck = import('@elgato-stream-deck/node').StreamDeck;
type ButtonControl = import('@elgato-stream-deck/node').StreamDeckButtonControlDefinition;

export async function openDeck(): Promise<DeckDevice> {
  let mod: NodeMod;
  try {
    mod = require('@elgato-stream-deck/node') as NodeMod;
  } catch {
    throw new Error(
      "@elgato-stream-deck/node is not installed. Run `npm i @elgato-stream-deck/node` " +
        'in packages/streamdeck (it is an optionalDependency so headless builds skip it).'
    );
  }

  const found = await mod.listStreamDecks();
  if (found.length === 0) {
    throw new Error(
      'No Stream Deck found. Is the official Elgato Stream Deck app still running? ' +
        'It must be fully quit first — only one process can hold the HID connection.'
    );
  }

  const deck = await mod.openStreamDeck(found[0].path, { resetToLogoOnClose: true });
  return new ElgatoDevice(deck);
}

class ElgatoDevice implements DeckDevice {
  /** button controls keyed by their `.index`, for pixel-size lookup on blit. */
  private readonly buttons = new Map<number, ButtonControl>();
  readonly geometry: Geometry;

  constructor(private readonly deck: StreamDeck) {
    let maxCol = 0;
    let maxRow = 0;
    for (const c of deck.CONTROLS) {
      if (c.type !== 'button') continue;
      this.buttons.set(c.index, c);
      if (c.column > maxCol) maxCol = c.column;
      if (c.row > maxRow) maxRow = c.row;
    }
    // v7 has no KEY_COLUMNS/KEY_ROWS — the grid is implied by the buttons'
    // row/column coordinates in CONTROLS. Deriving it here is what makes the
    // layouts fold per-device (8×4 XL, 5×3 original, …); fall back to XL if a
    // model somehow exposes no buttons.
    // Native key pixel size from the first button's declared pixelSize (all
    // buttons on a model share it); default 96 (XL) if a model omits it. This
    // lets the renderer author at true native resolution.
    const first = this.buttons.values().next().value;
    const keyPx = first && 'pixelSize' in first ? first.pixelSize.width : 96;
    this.geometry = this.buttons.size
      ? { cols: maxCol + 1, rows: maxRow + 1, keyPx }
      : { cols: 8, rows: 4, keyPx: 96 };
  }

  get keyCount(): number {
    return this.buttons.size;
  }

  /** Native pixel width of a key's image, if the model declares one. */
  private keyPixelWidth(index: number): number | undefined {
    const c = this.buttons.get(index);
    return c && 'pixelSize' in c ? c.pixelSize.width : undefined;
  }

  clearPanel(): Promise<void> {
    return this.deck.clearPanel();
  }

  clearKey(index: number): Promise<void> {
    return this.deck.clearKey(index);
  }

  fillKeyImage(index: number, image: KeyImage): Promise<void> {
    // The renderer produces TILE×TILE (96², the XL's key size). Smaller models
    // (e.g. the original's 72²) need the buffer at their native size, so scale
    // to the key's declared pixel size when it differs before blitting.
    const target = this.keyPixelWidth(index) ?? image.width;
    const scaled = target === image.width ? image : downscale(image, target);
    return this.deck.fillKeyBuffer(index, Buffer.from(scaled.data), {
      format: scaled.channels === 4 ? 'rgba' : 'rgb'
    });
  }

  on(_event: 'down', cb: (index: number) => void): void {
    this.deck.on('down', (control) => {
      if (control.type === 'button') cb(control.index);
    });
  }

  close(): Promise<void> {
    return this.deck.close();
  }
}

/**
 * Resample a square RGB(A) tile to `size`×`size` with nearest-neighbour — no
 * native dep, and adequate for solid/labelled status tiles (no fine detail to
 * lose). Used to fit the renderer's 96² output onto smaller decks' native keys.
 */
function downscale(image: KeyImage, size: number): KeyImage {
  const { data, width, channels } = image;
  const out = Buffer.allocUnsafe(size * size * channels);
  for (let y = 0; y < size; y++) {
    const srcY = Math.floor((y * width) / size);
    for (let x = 0; x < size; x++) {
      const srcX = Math.floor((x * width) / size);
      const si = (srcY * width + srcX) * channels;
      const di = (y * size + x) * channels;
      for (let c = 0; c < channels; c++) out[di + c] = data[si + c];
    }
  }
  return { width: size, height: size, data: out, channels, label: image.label, status: image.status };
}
