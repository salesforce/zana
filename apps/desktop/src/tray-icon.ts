import { deflateSync } from 'node:zlib';
import { nativeImage, type NativeImage } from 'electron';
import { FAIRY_GLYPH_ALPHA, FAIRY_GLYPH_SIZE } from './generated/zana-glyph.js';

const glyphAlpha = Buffer.from(FAIRY_GLYPH_ALPHA, 'base64');

/**
 * Zana's fairy silhouette as a macOS template image, tinted by the OS.
 * The checked-in alpha mask comes from resources/zana-glyph.svg, shared with
 * the popover and Stream Deck. No file reads or SVG rendering at app startup.
 */
export function buildAppGlyphTemplateImage(): NativeImage {
  const size = FAIRY_GLYPH_SIZE; // @2x of an 18pt menu-bar slot
  const rgba = colorizeGlyph();
  const png = encodePng(size, size, rgba);
  const img = nativeImage.createFromBuffer(png, { scaleFactor: 2 });
  img.setTemplateImage(true);
  return img;
}

/** System red (`systemRed`, sRGB) used for the attention dot. */
const ATTENTION_RGB = { r: 0xff, g: 0x3b, b: 0x30 };

/**
 * The attention variant of the app glyph: the same marks, plus a small red disc
 * baked into the upper-right corner (over the fairy's upper sparkle) to signal
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
  const size = FAIRY_GLYPH_SIZE; // @2x of an 18pt menu-bar slot
  const glyph = opts.dark ? { r: 0xff, g: 0xff, b: 0xff } : { r: 0, g: 0, b: 0 };
  const rgba = colorizeGlyph(glyph);
  paintAttentionDot(size, rgba);
  const png = encodePng(size, size, rgba);
  // NON-template: keep the literal red. No setTemplateImage(true).
  return nativeImage.createFromBuffer(png, { scaleFactor: 2 });
}

/**
 * Paints a filled red disc in the upper-right corner of the RGBA buffer, over
 * the fairy's sparkle, so the attention signal reads even at 18pt. Uses 3×
 * supersampling for a clean edge, and fully
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

/** Color the shared antialiased mask; retain its transparent negative space. */
function colorizeGlyph(color = { r: 0, g: 0, b: 0 }): Buffer {
  const rgba = Buffer.alloc(glyphAlpha.length * 4);
  for (let pixel = 0; pixel < glyphAlpha.length; pixel++) {
    const offset = pixel * 4;
    rgba[offset] = color.r;
    rgba[offset + 1] = color.g;
    rgba[offset + 2] = color.b;
    rgba[offset + 3] = glyphAlpha[pixel];
  }
  return rgba;
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
