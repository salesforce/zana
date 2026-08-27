import { describe, expect, it } from 'vitest';
import { ABOUT_CREDITS, BB_IDE_URL } from './about-credits.js';

describe('ABOUT_CREDITS', () => {
  it('credits the bb IDE rebase and the products that inspired Zana', () => {
    expect(ABOUT_CREDITS).toContain('rebased on the awesome bb IDE');
    expect(ABOUT_CREDITS).toContain('Inspired by bb, Cursor, Codex, and Claude Code.');
    expect(BB_IDE_URL).toBe('https://github.com/get-bb/bb');
  });
});
