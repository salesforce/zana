import { describe, expect, it } from 'vitest';
import { titleFromObjective, titleFromPrompt } from './prompt-title.js';

describe('titleFromPrompt', () => {
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
});
