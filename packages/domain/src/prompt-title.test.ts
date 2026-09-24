import { describe, expect, it } from 'vitest';
import { titleFromObjective, titleFromPrompt } from './prompt-title.js';

describe('titleFromPrompt', () => {
  it.each(['𠮷', '👨‍👩‍👧', 'e\u0301', '🇨🇭'])('preserves the %s grapheme at the title boundary', (grapheme) => {
    expect(titleFromPrompt('a'.repeat(39) + grapheme)).toBe('a'.repeat(39) + grapheme);
    expect(titleFromPrompt('a'.repeat(39) + grapheme + 'x')).toBe('a'.repeat(39) + grapheme + '…');
    expect(titleFromPrompt(grapheme.repeat(41))).toBe(grapheme.repeat(40) + '…');
  });
  it('collapses whitespace and caps long prompts', () => {
    expect(titleFromPrompt('  Fix   the login  ')).toBe('Fix the login');
    expect(titleFromPrompt('a'.repeat(41))).toBe(`${'a'.repeat(40)}…`);
    expect(titleFromPrompt('   ')).toBe('');
  });
});

describe('titleFromObjective', () => {
  it('removes absolute and relative paths before deriving a fallback', () => {
    expect(titleFromObjective('Review /Users/me/private/spec.md and ./src/auth.ts now'))
      .toBe('Review and now');
  });

  it('removes a path immediately after punctuation, not only after whitespace', () => {
    expect(titleFromObjective('Fix (/home/alice/private/file)')).toBe('Fix (');
    expect(titleFromObjective('Open "C:\\Users\\alice\\secret"')).toBe('Open "');
  });

  it('removes a ~/ or ../ path with no other text', () => {
    expect(titleFromObjective('~/Downloads/report.pdf')).toBe('');
    expect(titleFromObjective('../secrets/key.pem')).toBe('');
  });

  it('leaves a URL scheme untouched', () => {
    expect(titleFromObjective('See https://a.co/x for it'))
      .toBe('See https://a.co/x for it');
  });

  it('returns an empty title for empty input', () => {
    expect(titleFromObjective('')).toBe('');
    expect(titleFromObjective('   ')).toBe('');
  });
});
