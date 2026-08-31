import { describe, expect, it } from 'vitest';
import { ABOUT_CREDITS, BB_IDE_URL, GITHUB_REPO_URL, REPORT_BUG_URL } from './about-credits.js';

describe('ABOUT_CREDITS', () => {
  it('credits the bb IDE rebase and the products that inspired Zana', () => {
    expect(ABOUT_CREDITS).toContain('rebased on the awesome bb IDE');
    expect(ABOUT_CREDITS).toContain('Inspired by bb, Cursor, Codex, and Claude Code.');
    expect(BB_IDE_URL).toBe('https://github.com/get-bb/bb');
  });

  it('points the public repo at salesforce/zana', () => {
    expect(GITHUB_REPO_URL).toBe('https://github.com/salesforce/zana');
  });

  it('points bug reports at the public GitHub bug form', () => {
    expect(REPORT_BUG_URL).toBe(
      'https://github.com/salesforce/zana/issues/new?template=bug.yml'
    );
  });
});
