import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('product shots', () => {
  it('keeps the homepage Agents board GIF on disk', () => {
    const gif = resolve(websiteRoot, 'public/product-shots/agents-board.gif');
    expect(existsSync(gif)).toBe(true);
    expect(readFileSync(gif).subarray(0, 6).toString('ascii')).toMatch(/^GIF8[79]a$/);
  });
});
