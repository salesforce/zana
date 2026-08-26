import { describe, expect, it } from 'vitest';
import {
  JOIN_CODE_PREFIX,
  JOIN_CODE_TTL_MS,
  createJoinCodeStore
} from './join-codes.js';

describe('join codes', () => {
  it('mints a hostId without requiring a later peek to keep the code', () => {
    const store = createJoinCodeStore();
    const issued = store.mint(1_000);
    expect(issued.joinCode.startsWith(JOIN_CODE_PREFIX)).toBe(true);
    expect(issued.hostId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(issued.expiresAt).toBe(1_000 + JOIN_CODE_TTL_MS);
    expect(store.peek(issued.joinCode, 1_000)?.hostId).toBe(issued.hostId);
  });

  it('redeems once and rejects expiry', () => {
    const store = createJoinCodeStore();
    const issued = store.mint(10);
    expect(store.redeem(issued.joinCode, 11)?.hostId).toBe(issued.hostId);
    expect(store.redeem(issued.joinCode, 12)).toBeNull();
    const expired = store.mint(10);
    expect(store.redeem(expired.joinCode, 10 + JOIN_CODE_TTL_MS)).toBeNull();
    expect(store.peek('missing', 10)).toBeNull();
  });
});
