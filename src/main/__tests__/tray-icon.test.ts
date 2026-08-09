import { describe, it, expect, vi } from 'vitest';
import { inflateSync } from 'node:zlib';

// tray-icon builds a real PNG and hands it to electron's nativeImage. Mock
// nativeImage to CAPTURE that PNG buffer so we can decode it and assert on the
// actual pixels — that's the only way to prove the red attention dot survives
// (it's a NON-template image) and that the glyph tints with the bar theme.
const captured: { last?: Buffer; template?: boolean } = {};
vi.mock('electron', () => ({
  nativeImage: {
    createFromBuffer: (buf: Buffer) => {
      captured.last = buf;
      captured.template = false;
      return {
        setTemplateImage: (v: boolean) => {
          captured.template = v;
        }
      };
    }
  }
}));

import { buildAppGlyphTemplateImage, buildAppGlyphAttentionImage } from '../tray-icon.js';

/**
 * Decode our minimal PNG (RGBA truecolor, filter 0 on every scanline) back into
 * an { size, at(x,y) } reader. Mirrors the encoder in tray-icon.ts.
 */
function decodePng(png: Buffer): { size: number; at: (x: number, y: number) => [number, number, number, number] } {
  // IHDR data starts 8 (sig) + 4 (len) + 4 (type) = 16 bytes in.
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  expect(width).toBe(height);

  // Walk chunks to find IDAT.
  let off = 8;
  let idat: Buffer | null = null;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') idat = png.subarray(off + 8, off + 8 + len);
    off += 12 + len;
  }
  if (!idat) throw new Error('no IDAT');

  const raw = inflateSync(idat);
  const stride = width * 4;
  return {
    size: width,
    at: (x, y) => {
      const row = y * (stride + 1) + 1; // +1 skips the per-scanline filter byte
      const i = row + x * 4;
      return [raw[i], raw[i + 1], raw[i + 2], raw[i + 3]];
    }
  };
}

describe('buildAppGlyphTemplateImage', () => {
  it('marks the plain glyph as a template image (OS recolors it)', () => {
    captured.last = undefined;
    buildAppGlyphTemplateImage();
    expect(captured.last).toBeInstanceOf(Buffer);
    expect(captured.template).toBe(true);
  });
});

describe('buildAppGlyphAttentionImage', () => {
  it('bakes an opaque red dot into the upper-right corner (survives as non-template)', () => {
    buildAppGlyphAttentionImage({ dark: true });
    expect(captured.template).toBe(false); // literal red must NOT be recolored
    const img = decodePng(captured.last!);

    // The dot is centered at (size - r - 1, r + 1) with r = size*0.24 — sample
    // its center and assert it's system-red and fully opaque.
    const r = img.size * 0.24;
    const cx = Math.round(img.size - r - 1);
    const cy = Math.round(r + 1);
    const [red, green, blue, alpha] = img.at(cx, cy);
    expect(alpha).toBe(255);
    expect(red).toBeGreaterThan(0xd0);
    expect(green).toBeLessThan(0x80);
    expect(blue).toBeLessThan(0x80);
  });

  it('draws the glyph white on a dark bar and black on a light bar', () => {
    // A pixel on the chevron stroke is glyph-colored (not the dot). Grab a
    // clearly-glyph pixel by scanning the left half for the first opaque,
    // non-red pixel under each theme.
    const glyphColor = (dark: boolean): [number, number, number] => {
      buildAppGlyphAttentionImage({ dark });
      const img = decodePng(captured.last!);
      for (let y = 0; y < img.size; y++) {
        for (let x = 0; x < Math.floor(img.size / 2); x++) {
          const [r, g, b, a] = img.at(x, y);
          if (a > 200 && !(r > 0xd0 && g < 0x80)) return [r, g, b];
        }
      }
      throw new Error('no glyph pixel found');
    };

    const [dr, dg, db] = glyphColor(true);
    expect(dr).toBeGreaterThan(0xd0);
    expect(dg).toBeGreaterThan(0xd0);
    expect(db).toBeGreaterThan(0xd0);

    const [lr, lg, lb] = glyphColor(false);
    expect(lr).toBeLessThan(0x40);
    expect(lg).toBeLessThan(0x40);
    expect(lb).toBeLessThan(0x40);
  });
});
