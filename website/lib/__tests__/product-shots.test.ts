import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PRODUCT_SHOTS, productShotShowsMedia } from '../product-shots';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('product shots', () => {
  it('points the homepage and agents board at the animated GIF on disk', () => {
    expect(PRODUCT_SHOTS['cockpit-overview'].src).toBe('/product-shots/agents-board.gif');
    expect(PRODUCT_SHOTS['agents-board'].src).toBe('/product-shots/agents-board.gif');
    const gif = resolve(websiteRoot, 'public/product-shots/agents-board.gif');
    expect(existsSync(gif)).toBe(true);
    expect(readFileSync(gif).subarray(0, 6).toString('ascii')).toMatch(/^GIF8[79]a$/);
  });

  it('points inbox at the still screenshot on disk', () => {
    expect(PRODUCT_SHOTS['inbox-decision'].src).toBe('/product-shots/inbox-decision.jpg');
    expect(existsSync(resolve(websiteRoot, 'public/product-shots/inbox-decision.jpg'))).toBe(true);
  });

  it('points teams at the animated GIF on disk', () => {
    expect(PRODUCT_SHOTS['team-launch'].src).toBe('/product-shots/team-launch.gif');
    const gif = resolve(websiteRoot, 'public/product-shots/team-launch.gif');
    expect(existsSync(gif)).toBe(true);
    expect(readFileSync(gif).subarray(0, 6).toString('ascii')).toMatch(/^GIF8[79]a$/);
  });

  it('keeps Features on placeholders even when a shot has media', () => {
    expect(productShotShowsMedia('/product-shots/agents-board.gif')).toBe(true);
    expect(productShotShowsMedia('/product-shots/agents-board.gif', true)).toBe(false);
    expect(productShotShowsMedia(undefined, true)).toBe(false);
  });
});
