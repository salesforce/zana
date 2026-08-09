/**
 * Vector glyph library — the GLYPH channel of the "Composed Tiles" design. Each
 * glyph is a tiny canvas-drawn icon authored on a normalized grid and scaled to
 * a caller-supplied centre `(cx, cy)` and radius `r`, so the same shape renders
 * crisply at any tile size. Glyphs are monochrome: the caller passes the stroke
 * colour (chosen by tile-fill luminance) and every path is stroked with round
 * caps/joins at `lineWidth ≈ r*0.18`, a couple of filled accents aside.
 *
 * There are NO bundled images, SVGs, or icon fonts (a hard constraint): a glyph
 * is ~5–10 Path2D-equivalent ops against `@napi-rs/canvas`. The renderer draws
 * these into a tile; `GLYPH_CHARS` gives the terminal simulator a matching
 * single-width BMP unicode character per glyph (never an emoji — emoji are
 * double-width and would break the sim's fixed CELL_W grid), so `--sim` shows
 * the shape channel, not just the fill colour.
 */

import type { SKRSContext2D } from '@napi-rs/canvas';

/** The catalogue of drawable glyphs. Function icons + per-state indicators. */
export type GlyphName =
  | 'hub'
  | 'agents'
  | 'projects'
  | 'schedules'
  | 'status'
  | 'approve'
  | 'deny'
  | 'continue'
  | 'ping'
  | 'open'
  | 'refresh'
  | 'swap'
  | 'back'
  | 'home'
  | 'spawn'
  | 'run'
  | 'power'
  | 'more'
  | 'working'
  | 'blocked'
  | 'done'
  | 'idle'
  | 'unknown';

/**
 * Draw one glyph centred at `(cx, cy)` with radius `r` in `color`. `filled` is
 * honoured only by glyphs with an on/off variant (currently `power`): when true
 * the shape is drawn filled/solid (enabled), else hollow (disabled).
 */
export type GlyphFn = (
  ctx: SKRSContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
  filled?: boolean
) => void;

/** Shared stroke setup: monochrome, round caps/joins, weight relative to `r`. */
function setup(ctx: SKRSContext2D, r: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1, r * 0.18);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

/** A filled dot — reused by several glyphs (eyes, ellipsis, badges). */
function dot(ctx: SKRSContext2D, x: number, y: number, radius: number): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

/** House silhouette (roof + body) — used by `home`. */
function house(ctx: SKRSContext2D, cx: number, cy: number, r: number, color: string): void {
  setup(ctx, r, color);
  // Roof.
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.95, cy - r * 0.05);
  ctx.lineTo(cx, cy - r * 0.95);
  ctx.lineTo(cx + r * 0.95, cy - r * 0.05);
  ctx.stroke();
  // Body walls + floor.
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.65, cy - r * 0.05);
  ctx.lineTo(cx - r * 0.65, cy + r * 0.8);
  ctx.lineTo(cx + r * 0.65, cy + r * 0.8);
  ctx.lineTo(cx + r * 0.65, cy - r * 0.05);
  ctx.stroke();
}

/** Robot head: antenna + head + two eyes — the ZCC brand mark and `agents` icon. */
function robot(ctx: SKRSContext2D, cx: number, cy: number, r: number, color: string): void {
  setup(ctx, r, color);
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.95);
  ctx.lineTo(cx, cy - r * 0.65);
  ctx.stroke();
  dot(ctx, cx, cy - r * 0.95, r * 0.14);
  ctx.beginPath();
  ctx.roundRect(cx - r * 0.8, cy - r * 0.65, r * 1.6, r * 1.45, r * 0.28);
  ctx.stroke();
  dot(ctx, cx - r * 0.35, cy - r * 0.02, r * 0.14);
  dot(ctx, cx + r * 0.35, cy - r * 0.02, r * 0.14);
}

export const GLYPHS: Record<GlyphName, GlyphFn> = {
  // ZCC hub / brand mark: the robot head (user-chosen over the house).
  hub: (ctx, cx, cy, r, color) => robot(ctx, cx, cy, r, color),

  home: (ctx, cx, cy, r, color) => house(ctx, cx, cy, r, color),

  // Robot head — same mark as the hub.
  agents: (ctx, cx, cy, r, color) => robot(ctx, cx, cy, r, color),

  // Folder with a tab.
  projects: (ctx, cx, cy, r, color) => {
    setup(ctx, r, color);
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.9, cy - r * 0.35);
    ctx.lineTo(cx - r * 0.25, cy - r * 0.35);
    ctx.lineTo(cx - r * 0.05, cy - r * 0.62);
    ctx.lineTo(cx + r * 0.9, cy - r * 0.62);
    ctx.lineTo(cx + r * 0.9, cy + r * 0.7);
    ctx.lineTo(cx - r * 0.9, cy + r * 0.7);
    ctx.closePath();
    ctx.stroke();
  },

  // Clock face + two hands.
  schedules: (ctx, cx, cy, r, color) => {
    setup(ctx, r, color);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy - r * 0.55);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + r * 0.42, cy + r * 0.1);
    ctx.stroke();
  },

  // Gauge: top-half arc with a needle.
  status: (ctx, cx, cy, r, color) => {
    setup(ctx, r, color);
    ctx.beginPath();
    ctx.arc(cx, cy + r * 0.25, r * 0.85, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy + r * 0.25);
    ctx.lineTo(cx + r * 0.5, cy - r * 0.35);
    ctx.stroke();
    dot(ctx, cx, cy + r * 0.25, r * 0.1);
  },

  // Check mark.
  approve: (ctx, cx, cy, r, color) => {
    setup(ctx, r, color);
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.7, cy);
    ctx.lineTo(cx - r * 0.2, cy + r * 0.5);
    ctx.lineTo(cx + r * 0.75, cy - r * 0.55);
    ctx.stroke();
  },

  // Cross.
  deny: (ctx, cx, cy, r, color) => {
    setup(ctx, r, color);
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.6, cy - r * 0.6);
    ctx.lineTo(cx + r * 0.6, cy + r * 0.6);
    ctx.moveTo(cx + r * 0.6, cy - r * 0.6);
    ctx.lineTo(cx - r * 0.6, cy + r * 0.6);
    ctx.stroke();
  },

  // Return / enter arrow (↵): down-then-left with an arrowhead.
  continue: (ctx, cx, cy, r, color) => {
    setup(ctx, r, color);
    ctx.beginPath();
    ctx.moveTo(cx + r * 0.7, cy - r * 0.55);
    ctx.lineTo(cx + r * 0.7, cy + r * 0.15);
    ctx.lineTo(cx - r * 0.55, cy + r * 0.15);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.1, cy - r * 0.25);
    ctx.lineTo(cx - r * 0.6, cy + r * 0.15);
    ctx.lineTo(cx - r * 0.1, cy + r * 0.55);
    ctx.stroke();
  },

  // Paper plane.
  ping: (ctx, cx, cy, r, color) => {
    setup(ctx, r, color);
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.8, cy + r * 0.05);
    ctx.lineTo(cx + r * 0.85, cy - r * 0.6);
    ctx.lineTo(cx + r * 0.15, cy + r * 0.8);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + r * 0.85, cy - r * 0.6);
    ctx.lineTo(cx - r * 0.1, cy + r * 0.1);
    ctx.lineTo(cx + r * 0.15, cy + r * 0.8);
    ctx.stroke();
  },

  // Open-in-app: a window frame with an arrow springing out of its top-right —
  // the universal "reveal / open externally" mark.
  open: (ctx, cx, cy, r, color) => {
    setup(ctx, r, color);
    // Window frame (open corner at top-right where the arrow exits).
    ctx.beginPath();
    ctx.moveTo(cx + r * 0.15, cy - r * 0.6);
    ctx.lineTo(cx - r * 0.7, cy - r * 0.6);
    ctx.lineTo(cx - r * 0.7, cy + r * 0.6);
    ctx.lineTo(cx + r * 0.7, cy + r * 0.6);
    ctx.lineTo(cx + r * 0.7, cy - r * 0.1);
    ctx.stroke();
    // Diagonal arrow leaving the frame toward the top-right.
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.05, cy + r * 0.05);
    ctx.lineTo(cx + r * 0.8, cy - r * 0.8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + r * 0.3, cy - r * 0.8);
    ctx.lineTo(cx + r * 0.8, cy - r * 0.8);
    ctx.lineTo(cx + r * 0.8, cy - r * 0.3);
    ctx.stroke();
  },

  // Circular refresh arrow (↻).
  refresh: (ctx, cx, cy, r, color) => {
    setup(ctx, r, color);
    const a0 = Math.PI * 0.55;
    const a1 = Math.PI * 2.15;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.78, a0, a1);
    ctx.stroke();
    // Arrowhead at the arc's end.
    const ex = cx + Math.cos(a1) * r * 0.78;
    const ey = cy + Math.sin(a1) * r * 0.78;
    ctx.beginPath();
    ctx.moveTo(ex - r * 0.32, ey - r * 0.18);
    ctx.lineTo(ex, ey);
    ctx.lineTo(ex - r * 0.02, ey - r * 0.42);
    ctx.stroke();
  },

  // Swap: two stacked horizontal arrows pointing opposite ways (⇄) — the
  // "switch what this shows" affordance.
  swap: (ctx, cx, cy, r, color) => {
    setup(ctx, r, color);
    // Top arrow → right.
    const ty = cy - r * 0.35;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.7, ty);
    ctx.lineTo(cx + r * 0.7, ty);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + r * 0.35, ty - r * 0.3);
    ctx.lineTo(cx + r * 0.7, ty);
    ctx.lineTo(cx + r * 0.35, ty + r * 0.3);
    ctx.stroke();
    // Bottom arrow ← left.
    const by = cy + r * 0.35;
    ctx.beginPath();
    ctx.moveTo(cx + r * 0.7, by);
    ctx.lineTo(cx - r * 0.7, by);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.35, by - r * 0.3);
    ctx.lineTo(cx - r * 0.7, by);
    ctx.lineTo(cx - r * 0.35, by + r * 0.3);
    ctx.stroke();
  },

  // Left chevron.
  back: (ctx, cx, cy, r, color) => {
    setup(ctx, r, color);
    ctx.beginPath();
    ctx.moveTo(cx + r * 0.4, cy - r * 0.7);
    ctx.lineTo(cx - r * 0.4, cy);
    ctx.lineTo(cx + r * 0.4, cy + r * 0.7);
    ctx.stroke();
  },

  // Plus in a circle.
  spawn: (ctx, cx, cy, r, color) => {
    setup(ctx, r, color);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.5);
    ctx.lineTo(cx, cy + r * 0.5);
    ctx.moveTo(cx - r * 0.5, cy);
    ctx.lineTo(cx + r * 0.5, cy);
    ctx.stroke();
  },

  // Play triangle (filled).
  run: (ctx, cx, cy, r, color) => {
    setup(ctx, r, color);
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.55, cy - r * 0.75);
    ctx.lineTo(cx + r * 0.8, cy);
    ctx.lineTo(cx - r * 0.55, cy + r * 0.75);
    ctx.closePath();
    ctx.fill();
  },

  // Power symbol: broken ring (gap at top) + vertical bar. `filled` → solid disc.
  power: (ctx, cx, cy, r, color, filled) => {
    setup(ctx, r, color);
    if (filled) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const gap = 0.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.82, -Math.PI / 2 + gap, -Math.PI / 2 - gap + Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = filled ? '#000' : color;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.9);
    ctx.lineTo(cx, cy - r * 0.15);
    ctx.stroke();
  },

  // Horizontal ellipsis.
  more: (ctx, cx, cy, r, color) => {
    setup(ctx, r, color);
    dot(ctx, cx - r * 0.6, cy, r * 0.16);
    dot(ctx, cx, cy, r * 0.16);
    dot(ctx, cx + r * 0.6, cy, r * 0.16);
  },

  // 270° arc — "in progress".
  working: (ctx, cx, cy, r, color) => {
    setup(ctx, r, color);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.8, -Math.PI / 2, Math.PI);
    ctx.stroke();
  },

  // Blocked: "no entry" — ring with a horizontal bar.
  blocked: (ctx, cx, cy, r, color) => {
    setup(ctx, r, color);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.85, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.5, cy);
    ctx.lineTo(cx + r * 0.5, cy);
    ctx.stroke();
  },

  // Check inside a circle.
  done: (ctx, cx, cy, r, color) => {
    setup(ctx, r, color);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.42, cy);
    ctx.lineTo(cx - r * 0.12, cy + r * 0.32);
    ctx.lineTo(cx + r * 0.48, cy - r * 0.35);
    ctx.stroke();
  },

  // Idle agent: the robot head at rest (the ZCC mark), so a present-but-quiet
  // agent reads as "a robot waiting" rather than an anonymous dot.
  idle: (ctx, cx, cy, r, color) => robot(ctx, cx, cy, r, color),

  // Question mark: hook curve + stem + dot.
  unknown: (ctx, cx, cy, r, color) => {
    setup(ctx, r, color);
    ctx.beginPath();
    ctx.arc(cx, cy - r * 0.32, r * 0.45, Math.PI * 1.05, Math.PI * 0.15);
    ctx.lineTo(cx, cy + r * 0.2);
    ctx.stroke();
    dot(ctx, cx, cy + r * 0.62, r * 0.13);
  }
};

/**
 * Terminal-simulator fallback: one single-width BMP unicode char per glyph. NOT
 * emoji (double-width chars would break the sim's fixed CELL_W grid). Two glyphs
 * may share a char (hub/home are both houses) — chars needn't be unique.
 */
export const GLYPH_CHARS: Record<GlyphName, string> = {
  hub: '☻',
  home: '⌂',
  agents: '☻',
  projects: '▤',
  schedules: '◷',
  status: '◔',
  approve: '✓',
  deny: '✗',
  continue: '↵',
  ping: '➤',
  open: '⇱',
  refresh: '↻',
  swap: '⇄',
  back: '‹',
  spawn: '⊕',
  run: '▶',
  power: '⏻',
  more: '⋯',
  working: '◕',
  blocked: '⊘',
  done: '✔',
  idle: '☻',
  unknown: '?'
};
