/**
 * Tile rendering — the "Composed Tiles" design. A tile layers three independent
 * channels (see `composeTile`):
 *   - GLYPH  (function)  — a canvas-drawn vector icon from `glyphs.ts`
 *   - FILL   (state)     — a status colour from `STATUS_RGB`
 *   - BADGE  (secondary) — a count numeral / mini state char in a top-right disc
 *
 * The base `statusTile` produces a solid RGB bitmap with no native deps (so it's
 * testable and always available — the no-canvas fallback). Richer compositing
 * plugs in via `@napi-rs/canvas` when installed, degrading to the solid tile
 * plus presentation hints when it isn't. `labelTile` is a glyph-less
 * `composeTile` wrapper kept at its original signature for existing callers.
 *
 * Native resolution: a tile is authored on a 2× offscreen canvas then bilinearly
 * downscaled (via `drawImage`) so the returned buffer's width equals the native
 * key pixel size. That makes `elgato-device.ts` hit its `target === image.width`
 * branch and skip its nearest-neighbour resample — the crisp path.
 */

import { createRequire } from 'node:module';

import { GLYPHS, GLYPH_CHARS, type GlyphName } from './glyphs.js';
import type { KeyImage } from './page.js';
import type { DeckStatus } from '../lib/types.js';
import type { SKRSContext2D } from '@napi-rs/canvas';

const require = createRequire(import.meta.url);

/** XL keys render at 96×96 natively; the renderer defaults to this. */
export const TILE = 96;

/**
 * Status → RGB. The agent-tile colour language (per the operator's spec):
 *   busy=yellow (working), attention=red (needs you), idle=slate (no colour).
 * The rest are chrome/edge states: running=green (success flash / enabled
 * schedule / loading — NOT an agent's "working"), error=rust (stale/unknown),
 * done=teal (a finished agent, distinct from idle).
 */
export const STATUS_RGB: Record<DeckStatus, [number, number, number]> = {
  busy: [255, 193, 7], // yellow/amber — an agent actively working
  attention: [229, 57, 53], // red — an agent waiting on a human ("needs you")
  running: [76, 175, 80], // green — success / enabled / loading (non-agent chrome)
  error: [183, 65, 40], // rust — stale / unreachable
  idle: [70, 74, 82], // slate — present but quiet (reads as "no colour")
  done: [38, 150, 190] // teal — finished its run
};

/** Near-black vs. white glyph/text, chosen by fill luminance (mirrors fg()). */
const INK_DARK = '#14161a'; // [20,22,26]
const INK_LIGHT = '#f2f2f2'; // [242,242,242]

/** Alert-border colour for a "needs you" tile — a bright, unambiguous red. */
const ALERT_RGB: [number, number, number] = [244, 67, 54];

/** Solid status tile — no native dependency, always available. */
export function statusTile(status: DeckStatus, size = TILE): KeyImage {
  const [r, g, b] = STATUS_RGB[status];
  const data = Buffer.allocUnsafe(size * size * 3);
  for (let i = 0; i < data.length; i += 3) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
  return { width: size, height: size, data, channels: 3, status };
}

/**
 * Rec.601 luma of an RGB triple (0–255). Used to pick a contrasting ink for the
 * glyph/caption: near-black when the fill is light (amber/light-green), white
 * otherwise — the fix for the white-on-amber contrast bug.
 */
export function luminance([r, g, b]: [number, number, number]): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Contrasting ink for text/glyphs drawn on top of a status fill. */
function inkFor(status: DeckStatus): string {
  return luminance(STATUS_RGB[status]) > 140 ? INK_DARK : INK_LIGHT;
}

/**
 * Fit a caption to `maxW` at the already-set font, ellipsising WORD-first so a
 * multi-word title stays recognisable. "Add ZCC Stream Deck" → "Add ZCC…"
 * rather than a mid-word "Add ZCC S…". We drop whole trailing words while the
 * string overflows; only when a single (first) word still doesn't fit do we
 * fall back to a character cut. The caller must have set `ctx.font` first.
 */
export function fitCaption(
  ctx: Pick<SKRSContext2D, 'measureText'>,
  caption: string,
  maxW: number
): string {
  if (ctx.measureText(caption).width <= maxW) return caption;
  const words = caption.split(/\s+/).filter(Boolean);
  // Drop trailing words until the remainder (plus an ellipsis) fits.
  for (let n = words.length - 1; n >= 1; n -= 1) {
    const candidate = words.slice(0, n).join(' ');
    if (ctx.measureText(candidate + '…').width <= maxW) return candidate + '…';
  }
  // A single word (or the first word) still overflows — character-cut it.
  let text = words[0] ?? caption;
  while (text.length > 1 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
  return text + '…';
}

let canvasMod: typeof import('@napi-rs/canvas') | null | undefined;

/** Lazy, optional @napi-rs/canvas load. Returns null if the dep isn't installed. */
function loadCanvas(): typeof import('@napi-rs/canvas') | null {
  if (canvasMod !== undefined) return canvasMod;
  try {
    // Optional dependency — a headless build (tests/CI) needn't install it.
    canvasMod = require('@napi-rs/canvas') as typeof import('@napi-rs/canvas');
    // A bundled caption TTF would be registered here via GlobalFonts.register;
    // for now we ship on the 'sans-serif' fallback (no TTF file bundled yet).
  } catch {
    canvasMod = null;
  }
  return canvasMod;
}

export interface ComposeTileOpts {
  /** Fill colour channel. */
  status: DeckStatus;
  /** Bottom caption strip text (size-fit, then ellipsised). */
  caption?: string;
  /** Vector glyph drawn in the icon zone. Omit for a glyph-less (label) tile. */
  icon?: GlyphName;
  /**
   * Large text drawn in the icon zone IN PLACE OF a glyph — e.g. a schedule's
   * "next run in" readout ("5m", "2h"). When set, the `icon` glyph is skipped so
   * the two never overdraw. The `caption` strip is unaffected (identity stays on
   * the bottom line). Size-fit like the caption so it never overflows.
   */
  heroText?: string;
  /** Top-right badge text — a count numeral or a mini state char. */
  badge?: string;
  /**
   * Pressable tiles get a rounded, top-lit gradient fill + inner border. Static
   * tiles (headers, idle filler, readouts) are flat, square, ~20% desaturated,
   * and never carry a badge. Defaults to pressable.
   */
  pressable?: boolean;
  /** On/off variant for glyphs that accept it (e.g. `power`). */
  filled?: boolean;
  /**
   * Project-identity dot: an RGB triple drawn as a filled disc in the tile's
   * top-LEFT corner (mirroring the top-right badge), so every agent tile shows
   * which project it belongs to. Omit for no dot.
   */
  dot?: [number, number, number];
  /**
   * Draw a bright-red alert border around the whole tile — the "needs you"
   * signal for a blocked agent. Sits inside the tile edge so it reads on any
   * fill colour.
   */
  alert?: boolean;
  /** Native key pixel size (buffer width). Defaults to the XL's 96. */
  size?: number;
}

/** c + (target-c)*t, clamped to a byte. */
function mix(c: number, target: number, t: number): number {
  return Math.max(0, Math.min(255, Math.round(c + (target - c) * t)));
}

/**
 * Compose a tile from the glyph / fill / badge channels per the visual spec.
 * Authored at 2× offscreen then downscaled so the returned buffer width equals
 * `size` (the native key px). Falls back to a solid `statusTile` (plus hints)
 * when canvas is unavailable.
 */
export function composeTile(opts: ComposeTileOpts): KeyImage {
  const { status, caption, icon, badge, filled, dot: dotRgb, alert, heroText } = opts;
  const pressable = opts.pressable ?? true;
  const size = opts.size ?? TILE;

  const canvas = loadCanvas();
  const hints = {
    status,
    label: caption,
    icon: heroText ? undefined : icon,
    heroText,
    // Static tiles carry no badge (spec); drop the hint too for parity with sim.
    badge: pressable ? badge : undefined,
    alert: alert || undefined
  };
  if (!canvas) return { ...statusTile(status, size), ...hints };

  // Author at 2× the native size; `A` = author units per native-72 spec unit,
  // so the 72-referenced spec values below scale to any tile size.
  const author = size * 2;
  const A = size / 36;
  const cv = canvas.createCanvas(author, author);
  const ctx = cv.getContext('2d');

  const rgb = STATUS_RGB[status];
  const ink = inkFor(status);

  if (pressable) {
    // Rounded, top-lit vertical gradient (+12% lightness top) + inner border.
    const radius = 8 * A;
    const top: [number, number, number] = [mix(rgb[0], 255, 0.12), mix(rgb[1], 255, 0.12), mix(rgb[2], 255, 0.12)];
    const grad = ctx.createLinearGradient(0, 0, 0, author);
    grad.addColorStop(0, `rgb(${top[0]},${top[1]},${top[2]})`);
    grad.addColorStop(1, `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(0, 0, author, author, radius);
    ctx.fill();
    // Inner border, one shade darker.
    ctx.strokeStyle = `rgb(${mix(rgb[0], 0, 0.18)},${mix(rgb[1], 0, 0.18)},${mix(rgb[2], 0, 0.18)})`;
    ctx.lineWidth = 1.5 * A;
    ctx.beginPath();
    ctx.roundRect(0.75 * A, 0.75 * A, author - 1.5 * A, author - 1.5 * A, radius);
    ctx.stroke();
  } else {
    // Static: flat, square, ~20% desaturated toward its own luma.
    const lum = luminance(rgb);
    ctx.fillStyle = `rgb(${mix(rgb[0], lum, 0.2)},${mix(rgb[1], lum, 0.2)},${mix(rgb[2], lum, 0.2)})`;
    ctx.fillRect(0, 0, author, author);
  }

  // GLYPH channel — centred ~(36,27) in the top icon zone, ~34px tall @72.
  // `heroText` takes the zone instead (a big readout, e.g. a schedule ETA); the
  // two are mutually exclusive so they never overdraw.
  if (heroText) {
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const maxW = author - 12 * A;
    let px = 22;
    ctx.font = `bold ${px * A}px sans-serif`;
    while (px > 12 && ctx.measureText(heroText).width > maxW) {
      px -= 1;
      ctx.font = `bold ${px * A}px sans-serif`;
    }
    ctx.fillText(heroText, 36 * A, 27 * A);
  } else if (icon) {
    GLYPHS[icon](ctx as SKRSContext2D, 36 * A, 27 * A, 17 * A, ink, filled);
  }

  // CAPTION channel — bottom scrim + size-fit single line (13→10px, then …).
  if (caption) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 52 * A, author, 20 * A);
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const maxW = author - 12 * A; // 6px safe margin each side @72
    let px = 13;
    ctx.font = `bold ${px * A}px sans-serif`;
    while (px > 10 && ctx.measureText(caption).width > maxW) {
      px -= 1;
      ctx.font = `bold ${px * A}px sans-serif`;
    }
    ctx.fillText(fitCaption(ctx, caption, maxW), author / 2, 63 * A);
  }

  // BADGE channel — top-right 18px disc, inset 5px @72; pressable tiles only.
  if (pressable && badge) {
    const br = 9 * A;
    const bx = author - (5 + 9) * A;
    const by = (5 + 9) * A;
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ink === INK_DARK ? INK_LIGHT : INK_DARK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${11 * A}px sans-serif`;
    ctx.fillText(badge.slice(0, 2), bx, by + 0.5 * A);
  }

  // PROJECT-DOT channel — top-left disc mirroring the badge, ringed in ink so it
  // reads on any fill. Identifies which project the (agent) tile belongs to.
  if (dotRgb) {
    const dr = 7 * A;
    const dx = (5 + 7) * A;
    const dy = (5 + 7) * A;
    ctx.beginPath();
    ctx.arc(dx, dy, dr, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${dotRgb[0]},${dotRgb[1]},${dotRgb[2]})`;
    ctx.fill();
    ctx.lineWidth = 1.25 * A;
    ctx.strokeStyle = ink;
    ctx.stroke();
  }

  // ALERT-BORDER channel — a bright-red ring hugging the tile edge, the "needs
  // you" signal. Drawn last so it sits above fill/glyph/caption on any colour.
  if (alert) {
    const w = 3 * A;
    ctx.strokeStyle = `rgb(${ALERT_RGB[0]},${ALERT_RGB[1]},${ALERT_RGB[2]})`;
    ctx.lineWidth = w;
    if (pressable) {
      ctx.beginPath();
      ctx.roundRect(w / 2, w / 2, author - w, author - w, 8 * A);
      ctx.stroke();
    } else {
      ctx.strokeRect(w / 2, w / 2, author - w, author - w);
    }
  }

  // Downscale 2× → native so the returned buffer width == native key px.
  const out = canvas.createCanvas(size, size);
  const octx = out.getContext('2d');
  octx.drawImage(cv, 0, 0, size, size);
  const rgba = octx.getImageData(0, 0, size, size).data;
  return { width: size, height: size, data: Buffer.from(rgba), channels: 4, ...hints };
}

/**
 * Status tile with a label across the bottom — a glyph-less `composeTile`
 * wrapper. Kept at its original signature/behaviour so existing callers are
 * unchanged; the no-canvas path still returns a flat tile plus the label hint.
 */
export function labelTile(status: DeckStatus, label: string, size = TILE): KeyImage {
  return composeTile({ status, caption: label, size });
}

/**
 * Press-ack helper: a darkened copy of an already-rendered tile. Scales every
 * RGB byte toward black (alpha untouched) so the controller can blit an instant
 * "pressed" state over any tile without knowing how it was drawn — the button
 * feels live even while the real action is an async control-plane round-trip.
 */
export function dimImage(image: KeyImage, factor = 0.55): KeyImage {
  const { data, channels } = image;
  const out = Buffer.allocUnsafe(data.length);
  for (let i = 0; i < data.length; i += channels) {
    out[i] = Math.round(data[i] * factor);
    out[i + 1] = Math.round(data[i + 1] * factor);
    out[i + 2] = Math.round(data[i + 2] * factor);
    if (channels === 4) out[i + 3] = data[i + 3];
  }
  return { ...image, data: out };
}

/**
 * Result-flash tile: a big check on green (success) or cross on rust (failure),
 * briefly blitted over the pressed key when an action resolves so the outcome
 * of an async intent is visible on the deck itself.
 */
export function feedbackTile(ok: boolean, size = TILE): KeyImage {
  return composeTile({ status: ok ? 'running' : 'error', icon: ok ? 'approve' : 'deny', size });
}

/** Re-export so the terminal sim can map a KeyImage.icon hint to a char. */
export { GLYPH_CHARS };
