import { describe, expect, it } from 'vitest';
import { effectiveWorktreeIsolation } from './workspace-choice.js';

describe('effectiveWorktreeIsolation', () => {
  it.each([
    [true, true, true],
    [true, false, true],
    [false, true, false],
    [false, false, false],
    [undefined, true, true],
    [undefined, false, false],
    [undefined, undefined, false]
  ])('resolves project override %s before global default %s', (projectOverride, globalDefault, expected) => {
    expect(effectiveWorktreeIsolation(projectOverride, globalDefault)).toBe(expected);
  });
});
