import { describe, it, expect } from 'vitest';
import { checkApiCompat, SDK_API_VERSION } from '../index.js';

// The host contract version is an integer. checkApiCompat must accept both the
// host-facing integer-comparator grammar (`>=1 <2`) and the semver-ish forms
// authors naturally write in `engines.zccApi` (`^1.0.0`, `~1.2`, `1.x`, `1`).
// All semver-ish forms collapse to "major version === current".
describe('checkApiCompat', () => {
  it('defaults `current` to SDK_API_VERSION (1)', () => {
    expect(SDK_API_VERSION).toBe(1);
    expect(checkApiCompat('^1.0.0')).toBe(true); // uses default current=1
    expect(checkApiCompat('>=2')).toBe(false);
  });

  describe('caret ranges', () => {
    it('^1.0.0 satisfied at major 1', () => {
      expect(checkApiCompat('^1.0.0', 1)).toBe(true);
    });
    it('^1.0.0 rejected at major 2', () => {
      expect(checkApiCompat('^1.0.0', 2)).toBe(false);
    });
    it('^2.0.0 rejected at major 1', () => {
      expect(checkApiCompat('^2.0.0', 1)).toBe(false);
    });
  });

  describe('tilde ranges', () => {
    it('~1.2 satisfied at major 1', () => {
      expect(checkApiCompat('~1.2', 1)).toBe(true);
    });
    it('~1.2.0 satisfied at major 1', () => {
      expect(checkApiCompat('~1.2.0', 1)).toBe(true);
    });
    it('~1.2 rejected at major 2', () => {
      expect(checkApiCompat('~1.2', 2)).toBe(false);
    });
  });

  describe('x-range wildcards', () => {
    it('1.x satisfied at major 1', () => {
      expect(checkApiCompat('1.x', 1)).toBe(true);
    });
    it('1.2.x satisfied at major 1', () => {
      expect(checkApiCompat('1.2.x', 1)).toBe(true);
    });
    it('1.x rejected at major 2', () => {
      expect(checkApiCompat('1.x', 2)).toBe(false);
    });
  });

  describe('bare and dotted versions', () => {
    it('bare 1 satisfied at major 1', () => {
      expect(checkApiCompat('1', 1)).toBe(true);
    });
    it('bare 1 rejected at major 2', () => {
      expect(checkApiCompat('1', 2)).toBe(false);
    });
    it('full 1.2.3 satisfied at major 1', () => {
      expect(checkApiCompat('1.2.3', 1)).toBe(true);
    });
    it('full 2.0.0 rejected at major 1', () => {
      expect(checkApiCompat('2.0.0', 1)).toBe(false);
    });
  });

  describe('integer-comparator grammar (host-facing, preserved)', () => {
    it('>=1 <2 satisfied at 1', () => {
      expect(checkApiCompat('>=1 <2', 1)).toBe(true);
    });
    it('>=1 <2 rejected at 2', () => {
      expect(checkApiCompat('>=1 <2', 2)).toBe(false);
    });
    it('>=1 satisfied at 3', () => {
      expect(checkApiCompat('>=1', 3)).toBe(true);
    });
    it('=1 satisfied at 1', () => {
      expect(checkApiCompat('=1', 1)).toBe(true);
    });
    it('>2 rejected at 1', () => {
      expect(checkApiCompat('>2', 1)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('empty / whitespace-only range accepts anything', () => {
      expect(checkApiCompat('', 1)).toBe(true);
      expect(checkApiCompat('   ', 99)).toBe(true);
    });
    it('genuinely incompatible range fails closed (^2.0.0 @ 1)', () => {
      expect(checkApiCompat('^2.0.0', 1)).toBe(false);
    });
    it('unparseable garbage fails closed', () => {
      expect(checkApiCompat('not-a-version', 1)).toBe(false);
      expect(checkApiCompat('1.2.beta', 1)).toBe(false);
      expect(checkApiCompat('>=banana', 1)).toBe(false);
    });
    it('a mix where one token fails rejects the whole range', () => {
      expect(checkApiCompat('>=1 <1', 1)).toBe(false);
    });
  });
});
