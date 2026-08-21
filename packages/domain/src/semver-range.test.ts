import { describe, expect, it } from 'vitest';
import { compareVersions, satisfiesRange } from './semver-range.js';

describe('satisfiesRange', () => {
  it('accepts caret majors', () => {
    expect(satisfiesRange('1.2.0', '^1.0.0')).toBe(true);
    expect(satisfiesRange('2.0.0', '^1.0.0')).toBe(false);
  });

  it('accepts comparator lists', () => {
    expect(satisfiesRange('0.1.0', '>=0.1.0 <2')).toBe(true);
    expect(satisfiesRange('2.0.0', '>=0.1.0 <2')).toBe(false);
  });

  it('orders versions numerically', () => {
    expect(compareVersions('1.0.10', '1.0.9')).toBeGreaterThan(0);
  });
});
