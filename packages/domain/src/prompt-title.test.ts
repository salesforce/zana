import { describe, expect, it } from 'vitest';
import { titleFromPrompt } from './prompt-title.js';

describe('titleFromPrompt', () => {
  it('collapses whitespace and caps long prompts', () => {
    expect(titleFromPrompt('  Fix   the login  ')).toBe('Fix the login');
    expect(titleFromPrompt('a'.repeat(41))).toBe(`${'a'.repeat(40)}…`);
    expect(titleFromPrompt('   ')).toBe('');
  });
});
