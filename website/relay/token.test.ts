import { describe, expect, it } from 'vitest';
import { bearerToken, tokenMatches } from './token.mjs';

describe('relay token', () => {
  it('parses a Bearer value and compares with timing-safe equality', () => {
    expect(bearerToken('Bearer secret-token-secret')).toBe('secret-token-secret');
    expect(bearerToken('secret-token-secret')).toBeNull();
    expect(tokenMatches('secret-token-secret', 'secret-token-secret')).toBe(true);
    expect(tokenMatches('secret-token-secret', 'other-token-other')).toBe(false);
    expect(tokenMatches('short', 'longer-token')).toBe(false);
  });
});
