import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Short authentication string for the invitation key exchange. Both sides derive it from the consent digest, which
 * covers the pairing id, both identities and the redeemer's per-link SSH key: the redeemer shows it, the inviter's owner
 * types it before approving. A token thief who reserved the invitation holds a different digest, so the owner cannot
 * type the code the real redeemer shows.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
export const PAIRING_CODE_MISMATCH_LIMIT = 5;

/** 8 Crockford base32 chars (40 bits) of a domain-separated hash of the digest, shown `XXXX-XXXX`. */
export function pairingCodeOf(consentDigest: Buffer): string {
  const hash = createHash('sha256').update('zcc-pairing-code-v1\0').update(consentDigest).digest();
  let bits = 0n;
  for (const byte of hash.subarray(0, 5)) bits = (bits << 8n) | BigInt(byte);
  let out = '';
  for (let shift = 35n; shift >= 0n; shift -= 5n) out += ALPHABET[Number((bits >> shift) & 31n)];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

/**
 * Canonical `XXXX-XXXX` form of typed input, or null. Case-insensitive; spaces and hyphens are ignored; Crockford's
 * look-alikes decode as usual (I/L -> 1, O -> 0).
 */
export function normalizeCode(input: string): string | null {
  if (typeof input !== 'string' || input.length > 32) return null;
  const text = input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  return CODE.test(text) ? `${text.slice(0, 4)}-${text.slice(4)}` : null;
}

/** Constant-time check of typed input against the code of `consentDigest`. */
export function pairingCodeMatches(input: unknown, consentDigest: Buffer): boolean {
  const typed = typeof input === 'string' ? normalizeCode(input) : null;
  const expected = Buffer.from(pairingCodeOf(consentDigest));
  const actual = Buffer.from(typed ?? '\0'.repeat(expected.length));
  return actual.length === expected.length && timingSafeEqual(actual, expected) && typed !== null;
}
