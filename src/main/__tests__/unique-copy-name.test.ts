import { describe, expect, it } from 'vitest';
import { uniqueCopyName } from '../unique-copy-name.js';

describe('uniqueCopyName', () => {
  it('starts numbering at one', () => {
    expect(uniqueCopyName('Reviewer', [])).toBe('Reviewer 1');
  });

  it('increments through every collision and fills no gaps', () => {
    expect(uniqueCopyName('Reviewer', ['Reviewer 1', 'Reviewer 2', 'Reviewer 4'])).toBe('Reviewer 3');
  });

  it('compares trimmed names without case distinction', () => {
    expect(uniqueCopyName('  Reviewer  ', [' reviewer 1 ', 'REVIEWER 2'])).toBe('Reviewer 3');
  });

  it('keeps numeric source names as part of the base name', () => {
    expect(uniqueCopyName('Foo 1', [])).toBe('Foo 1 1');
  });
});
