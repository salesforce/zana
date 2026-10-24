import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PAIRING_CODE_MISMATCH_LIMIT, mintApprovalCode, normalizeCode, pairingCodeMatches, pairingCodeOf } from './pairing-code.js';

const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

describe('pairing code', () => {
  it('derives a stable XXXX-XXXX Crockford code from the consent digest', () => {
    const digest = createHash('sha256').update('consent').digest();
    const value = pairingCodeOf(digest);
    expect(value).toMatch(CROCKFORD);
    expect(pairingCodeOf(Buffer.from(digest))).toBe(value);
    expect(pairingCodeOf(Buffer.alloc(32))).toBe(pairingCodeOf(Buffer.alloc(32)));
  });

  it('changes when the digest changes', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 64; i++) seen.add(pairingCodeOf(randomBytes(32)));
    expect(seen.size).toBe(64);
    for (const value of seen) expect(value).toMatch(CROCKFORD);
  });

  it('normalizes case, separators and Crockford look-alikes', () => {
    expect(normalizeCode('abcd-efgh')).toBe('ABCD-EFGH');
    expect(normalizeCode(' ab cd ef gh ')).toBe('ABCD-EFGH');
    expect(normalizeCode('ABCDEFGH')).toBe('ABCD-EFGH');
    expect(normalizeCode('oIlL-0000')).toBe('0111-0000');
  });

  it('rejects malformed input', () => {
    for (const bad of ['', 'ABCD-EFG', 'ABCD-EFGHJ', 'ABCD-EFGU', 'ABCD_EFGH', 'ABCD-EFG!', 'x'.repeat(33), '１２３４-５６７８']) {
      expect(normalizeCode(bad)).toBeNull();
    }
    expect(normalizeCode(42 as never)).toBeNull();
  });

  it('matches only the normalized code of the same digest', () => {
    const digest = randomBytes(32), value = pairingCodeOf(digest);
    expect(pairingCodeMatches(value, digest)).toBe(true);
    expect(pairingCodeMatches(value.toLowerCase().replace('-', ' '), digest)).toBe(true);
    const other = Buffer.alloc(32, 1);
    expect(pairingCodeOf(other)).not.toBe(pairingCodeOf(Buffer.alloc(32)));
    expect(pairingCodeMatches(pairingCodeOf(other), Buffer.alloc(32))).toBe(false);
    expect(pairingCodeMatches(undefined, digest)).toBe(false);
    expect(pairingCodeMatches('garbage', digest)).toBe(false);
    expect(pairingCodeMatches('\0\0\0\0\0\0\0\0\0', digest)).toBe(false);
  });

  it('limits mismatches to five', () => {
    expect(PAIRING_CODE_MISMATCH_LIMIT).toBe(5);
  });

  describe('mintApprovalCode', () => {
    it('mints a well-formed Crockford XXXX-XXXX code that survives normalization', () => {
      for (let i = 0; i < 200; i++) {
        const code = mintApprovalCode();
        expect(code).toMatch(CROCKFORD);
        // A freshly minted code is already normalized, so normalizeCode is a no-op on it.
        expect(normalizeCode(code)).toBe(code);
      }
    });

    it('is random, not derived from any public value', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 500; i++) seen.add(mintApprovalCode());
      // 40 bits of entropy: 500 draws collide with negligible probability.
      expect(seen.size).toBe(500);
    });
  });
});
