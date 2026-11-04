import { describe, expect, it } from 'vitest';
import {
  CLOSE_WRAP_UP_INSTRUCTIONS_MAX,
  DEFAULT_CLOSE_WRAP_UP_INSTRUCTIONS,
  resolveCloseWrapUpInstructions
} from './product.js';

describe('close wrap-up instructions', () => {
  it('ships the default text, one step per line', () => {
    expect(DEFAULT_CLOSE_WRAP_UP_INSTRUCTIONS.split('\n')).toEqual([
      'Wrap up this session; it will be closed when you finish.',
      '1. Summarise: what you set out to do, what you did (files, decisions, messages sent), and what is left or waiting on someone.',
      '2. Self-learn: save anything a future session should know to memory (update an existing entry rather than adding a duplicate), and write a short retro to the project library if there were lessons worth keeping.',
      '3. Tidy up: resolve or update the follow-ups this session owns, and stop background tasks, monitors and pollers you started. Do not commit, push or send anything I have not asked for.',
      "4. Don't push a summary to the inbox; Zana adds one when it closes this session.",
      '5. If something needs my decision before closing, ask it as your final message and stop. Otherwise end with the summary.'
    ]);
    expect(DEFAULT_CLOSE_WRAP_UP_INSTRUCTIONS.length).toBeLessThan(CLOSE_WRAP_UP_INSTRUCTIONS_MAX);
  });

  it('uses the configured text when it has any', () => {
    expect(resolveCloseWrapUpInstructions({ closeWrapUpInstructions: 'Just summarise.' })).toBe('Just summarise.');
  });

  it('falls back to the default for absent, empty and whitespace-only text', () => {
    expect(resolveCloseWrapUpInstructions({})).toBe(DEFAULT_CLOSE_WRAP_UP_INSTRUCTIONS);
    expect(resolveCloseWrapUpInstructions({ closeWrapUpInstructions: '' })).toBe(DEFAULT_CLOSE_WRAP_UP_INSTRUCTIONS);
    expect(resolveCloseWrapUpInstructions({ closeWrapUpInstructions: '  \n ' })).toBe(DEFAULT_CLOSE_WRAP_UP_INSTRUCTIONS);
  });

  it('falls back to the default for a null or undefined config', () => {
    expect(resolveCloseWrapUpInstructions(null)).toBe(DEFAULT_CLOSE_WRAP_UP_INSTRUCTIONS);
    expect(resolveCloseWrapUpInstructions(undefined)).toBe(DEFAULT_CLOSE_WRAP_UP_INSTRUCTIONS);
  });
});
