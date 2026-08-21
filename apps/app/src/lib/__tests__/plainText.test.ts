import { describe, expect, it } from 'vitest';
import { mdToPlainText } from '../plainText.js';

describe('mdToPlainText', () => {
  it('strips trailing emphasis, not just leading (the inbox `**` bug)', () => {
    expect(mdToPlainText('**Update available — v1.0.1**')).toBe(
      'Update available — v1.0.1'
    );
  });

  it('unwraps inline code fences', () => {
    expect(mdToPlainText('Dev build is up — `npm run dev` running')).toBe(
      'Dev build is up — npm run dev running'
    );
    expect(mdToPlainText('``weird`` fence')).toBe('weird fence');
  });

  it('handles italics, bold-italic, and strikethrough', () => {
    expect(mdToPlainText('_italic_')).toBe('italic');
    expect(mdToPlainText('*em*')).toBe('em');
    expect(mdToPlainText('__strong__')).toBe('strong');
    expect(mdToPlainText('~~gone~~')).toBe('gone');
  });

  it('unwraps links and images to their text', () => {
    expect(mdToPlainText('see [the report](docs/x.md)')).toBe('see the report');
    expect(mdToPlainText('![diagram](/img/a.png) attached')).toBe(
      'diagram attached'
    );
  });

  it('strips leading block markers (heading, quote, bullet)', () => {
    expect(mdToPlainText('# Heading')).toBe('Heading');
    expect(mdToPlainText('> quoted')).toBe('quoted');
    expect(mdToPlainText('- item')).toBe('item');
    expect(mdToPlainText('* item')).toBe('item');
  });

  it('removes orphan markers from unbalanced source', () => {
    expect(mdToPlainText('half **bold')).toBe('half bold');
    expect(mdToPlainText('lone ` backtick')).toBe('lone backtick');
  });

  it('collapses whitespace and trims', () => {
    expect(mdToPlainText('  a   b  ')).toBe('a b');
  });

  it('returns empty for empty/whitespace input', () => {
    expect(mdToPlainText('')).toBe('');
    expect(mdToPlainText('   ')).toBe('');
  });

  it('leaves plain text untouched', () => {
    expect(mdToPlainText('Wave 1 — Epic 0 nearly complete (4 commits)')).toBe(
      'Wave 1 — Epic 0 nearly complete (4 commits)'
    );
  });
});
