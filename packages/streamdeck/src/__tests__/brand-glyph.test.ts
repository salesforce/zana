import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { GLYPHS, GLYPH_CHARS } from '../deck/glyphs.js';

describe('Zana hub branding', () => {
  it('draws a fairy with a separate head and four wings without leaving a transform', () => {
    const canvas = createCanvas(64, 64);
    const ctx = canvas.getContext('2d');
    GLYPHS.hub(ctx, 32, 32, 32, '#ffffff');
    expect(ctx.getTransform().a).toBe(1);
    const alpha = (x: number, y: number) => ctx.getImageData(x, y, 1, 1).data[3];
    for (const [x, y] of [[32, 20], [19, 25], [45, 25], [18, 44], [46, 44], [32, 47]]) {
      expect(alpha(x, y)).toBeGreaterThan(200);
    }
    expect(alpha(32, 25)).toBe(0);
    expect(alpha(0, 0)).toBe(0);
  });

  it('keeps the brand distinct from the agent robot and supports scaled colored tiles', () => {
    const hub = createCanvas(72, 72);
    const ctx = hub.getContext('2d');
    GLYPHS.hub(ctx, 36, 36, 28, '#ff0000');
    expect([...ctx.getImageData(36, 26, 1, 1).data]).toEqual([255, 0, 0, 255]);
    const agent = createCanvas(72, 72);
    GLYPHS.agents(agent.getContext('2d'), 36, 36, 28, '#ff0000');
    expect(hub.toBuffer('image/png')).not.toEqual(agent.toBuffer('image/png'));
    expect(GLYPH_CHARS.hub).not.toBe(GLYPH_CHARS.agents);
  });
});
