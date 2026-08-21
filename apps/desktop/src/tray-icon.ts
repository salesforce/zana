import { deflateSync } from 'node:zlib';
import { nativeImage, type NativeImage } from 'electron';

/**
 * Builds the app's own glyph — the same `WandSparkles` mark (lucide-react)
 * used in the menu-bar popover's brand badge (`MenubarPopover.tsx`) — as a
 * macOS *template image* (black pixels with an alpha mask, which the OS
 * recolors for light/dark menu bars). We redraw the marks monochrome rather
 * than shrink a colored icon: at the 18pt menu-bar slot a colored icon
 * collapses into an illegible dark blob and can't tint. This keeps the
 * menu-bar presence identical to the popover's own brand glyph while staying
 * crisp and menu-bar-correct.
 *
 * Self-contained: rasterizes the glyph by 3× supersampling for cheap
 * anti-aliasing, then encodes a real (zlib-compressed) PNG. Returns a template
 * NativeImage at 2× density. Callers should fall back to the app icon (or an
 * empty image) if this throws.
 */
export function buildAppGlyphTemplateImage(): NativeImage {
  const size = 36; // @2x of an 18pt menu-bar slot
  const rgba = rasterizeGlyph(size);
  const png = encodePng(size, size, rgba);
  const img = nativeImage.createFromBuffer(png, { scaleFactor: 2 });
  img.setTemplateImage(true);
  return img;
}

/** System red (`systemRed`, sRGB) used for the attention dot. */
const ATTENTION_RGB = { r: 0xff, g: 0x3b, b: 0x30 };

/**
 * The attention variant of the app glyph: the same marks, plus a small red disc
 * baked into the upper-right corner (over the wand's upper sparkle) to signal
 * that one or more agents need the user. Because `setTitle` on macOS cannot color text
 * (Electron exposes only `fontType`), the RED in "agents requesting attention"
 * has to live in the icon — and a red pixel can't survive a *template* image
 * (the OS recolors every opaque pixel to the menu-bar text color), so this is a
 * NON-template `NativeImage`: it keeps its literal RGBA and forgoes the OS's
 * automatic light/dark tinting.
 *
 * Since we lose auto-tinting, the glyph itself must be drawn in a color that
 * reads on the current bar — white on a dark bar, black on a light one — so the
 * caller passes `dark` (from `nativeTheme.shouldUseDarkColors`). Callers should
 * fall back to {@link buildAppGlyphTemplateImage} (or the app icon) if this
 * throws.
 */
export function buildAppGlyphAttentionImage(opts: { dark: boolean }): NativeImage {
  const size = 36; // @2x of an 18pt menu-bar slot
  const glyph = opts.dark ? { r: 0xff, g: 0xff, b: 0xff } : { r: 0, g: 0, b: 0 };
  const rgba = rasterizeGlyph(size, glyph);
  paintAttentionDot(size, rgba);
  const png = encodePng(size, size, rgba);
  // NON-template: keep the literal red. No setTemplateImage(true).
  return nativeImage.createFromBuffer(png, { scaleFactor: 2 });
}

/**
 * Paints a filled red disc in the upper-right corner of the RGBA buffer, over
 * the wand's tip, so the attention signal reads even at 18pt. Uses the same 3×
 * supersampled coverage the glyph rasterizer uses for a clean edge, and fully
 * overwrites (not blends) the underlying glyph pixels inside the disc so the dot
 * reads as one solid mark rather than a glyph-tinted smudge.
 */
function paintAttentionDot(size: number, rgba: Buffer) {
  const radius = size * 0.24;
  const cx = size - radius - 1;
  const cy = radius + 1;
  const ss = 3;
  const samples = ss * ss;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = x + (sx + 0.5) / ss;
          const py = y + (sy + 0.5) / ss;
          if (Math.hypot(px - cx, py - cy) <= radius) hits++;
        }
      }
      if (hits === 0) continue;
      const cov = hits / samples;
      const i = (y * size + x) * 4;
      // Over-composite the red onto whatever's there (glyph or transparent),
      // so the disc's anti-aliased rim still blends with the bar behind it.
      const a = rgba[i + 3] / 255;
      const outA = cov + a * (1 - cov);
      if (outA <= 0) continue;
      rgba[i] = Math.round((ATTENTION_RGB.r * cov + rgba[i] * a * (1 - cov)) / outA);
      rgba[i + 1] = Math.round((ATTENTION_RGB.g * cov + rgba[i + 1] * a * (1 - cov)) / outA);
      rgba[i + 2] = Math.round((ATTENTION_RGB.b * cov + rgba[i + 2] * a * (1 - cov)) / outA);
      rgba[i + 3] = Math.round(outA * 255);
    }
  }
}

/**
 * Renders the app marks (black, alpha-masked) into an RGBA buffer: the
 * `WandSparkles` glyph (lucide-react) — a diagonal wand with a tip tick, and
 * three cross-shaped sparkles of varying size — reproduced from lucide's own
 * 24×24 path data (`node_modules/lucide-react/dist/esm/icons/wand-sparkles.js`),
 * every mark a stroked line segment with the icon's own `strokeWidth={2}`.
 * The segments are fitted into the canvas so their combined bounding box
 * fills the slot with a small margin.
 */
function rasterizeGlyph(size: number, color: { r: number; g: number; b: number } = { r: 0, g: 0, b: 0 }): Buffer {
  // --- source geometry, in lucide's 24×24 viewBox, strokeWidth 2 -------------
  const halfStroke = 1;
  const segments = [
    // Wand rod (the icon's rounded-parallelogram path, approximated as a line).
    { x1: 2.36, y1: 20.36, x2: 19.64, y2: 3.64 },
    // Tip tick, just below the rod's upper end.
    { x1: 14, y1: 7, x2: 17, y2: 10 },
    // Large sparkle (bottom-left): vertical + horizontal arm.
    { x1: 5, y1: 6, x2: 5, y2: 10 },
    { x1: 7, y1: 8, x2: 3, y2: 8 },
    // Medium sparkle (right, below the rod).
    { x1: 19, y1: 14, x2: 19, y2: 18 },
    { x1: 21, y1: 16, x2: 17, y2: 16 },
    // Small sparkle (top).
    { x1: 10, y1: 2, x2: 10, y2: 4 },
    { x1: 11, y1: 3, x2: 9, y2: 3 }
  ];

  // --- fit the combined bbox into the canvas with a small padding ------------
  const minX = Math.min(...segments.flatMap((s) => [s.x1, s.x2])) - halfStroke;
  const maxX = Math.max(...segments.flatMap((s) => [s.x1, s.x2])) + halfStroke;
  const minY = Math.min(...segments.flatMap((s) => [s.y1, s.y2])) - halfStroke;
  const maxY = Math.max(...segments.flatMap((s) => [s.y1, s.y2])) + halfStroke;
  const bboxW = maxX - minX;
  const bboxH = maxY - minY;
  const pad = 2; // px of empty margin inside the canvas
  const avail = size - pad * 2;
  const scale = avail / Math.max(bboxW, bboxH);
  const offX = pad + (avail - bboxW * scale) / 2;
  const offY = pad + (avail - bboxH * scale) / 2;
  const tx = (x: number) => (x - minX) * scale + offX;
  const ty = (y: number) => (y - minY) * scale + offY;

  // Transform the marks into canvas space up front.
  const segs = segments.map((s) => ({ x1: tx(s.x1), y1: ty(s.y1), x2: tx(s.x2), y2: ty(s.y2) }));
  const strokeR = halfStroke * scale;

  const ss = 3; // supersample factor
  const samples = ss * ss;
  const buf = Buffer.alloc(size * size * 4, 0);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = x + (sx + 0.5) / ss;
          const py = y + (sy + 0.5) / ss;
          const onMark = segs.some((s) => pointNearSegment(px, py, s.x1, s.y1, s.x2, s.y2) <= strokeR);
          if (onMark) hits++;
        }
      }
      if (hits > 0) {
        const alpha = Math.round((hits / samples) * 255);
        const i = (y * size + x) * 4;
        buf[i] = color.r;
        buf[i + 1] = color.g;
        buf[i + 2] = color.b;
        buf[i + 3] = alpha;
      }
    }
  }
  return buf;
}

/** Distance from point (px,py) to segment (ax,ay)-(bx,by). */
function pointNearSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// ----- minimal PNG encoder (truecolor + alpha, no filtering) ----------------

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Each scanline is prefixed with a filter-type byte (0 = none).
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw);

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

let crcTable: number[] | null = null;
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}
