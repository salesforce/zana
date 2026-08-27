import { describe, expect, it } from 'vitest';
import { resolveIcon } from './resolveIcon.js';

describe('resolveIcon', () => {
  it('does not throw when the icon name is missing', () => {
    expect(resolveIcon(undefined)).toBeTypeOf('object');
    expect(resolveIcon(null)).toBe(resolveIcon(undefined));
    expect(resolveIcon('')).toBe(resolveIcon(undefined));
  });
});
