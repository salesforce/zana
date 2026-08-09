import { describe, it, expect } from 'vitest';
import { compareVersions } from '../index.js';

// compareVersions orders extension releases for the boot-time auto-reseed
// (never downgrade). No semver dependency — a hand-rolled major.minor.patch
// compare. Pre-release/build suffixes are ignored; junk parses as 0.0.0.
describe('compareVersions', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('0.2.0', '0.1.9')).toBeGreaterThan(0);
    expect(compareVersions('0.1.2', '0.1.1')).toBeGreaterThan(0);
    expect(compareVersions('0.1.1', '0.1.2')).toBeLessThan(0);
  });

  it('treats equal versions as 0', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('pads missing segments with 0 (1.0 === 1.0.0)', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('2', '2.0.0')).toBe(0);
  });

  it('ignores pre-release / build suffixes', () => {
    expect(compareVersions('1.2.3-beta.1', '1.2.3')).toBe(0);
    expect(compareVersions('1.2.3+build', '1.2.3')).toBe(0);
  });

  it('parses missing/junk versions as 0.0.0 (sorts below any real release)', () => {
    expect(compareVersions('', '0.0.1')).toBeLessThan(0);
    expect(compareVersions('not-a-version', '0.1.0')).toBeLessThan(0);
    // @ts-expect-error — exercise the runtime guard for undefined input
    expect(compareVersions(undefined, '0.0.0')).toBe(0);
  });
});
