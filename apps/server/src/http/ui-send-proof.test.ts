import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUiSendVerifier, signUiSend } from './ui-send-proof.js';

const secret = 'desktop-only-boot-secret-of-at-least-32-bytes';
const threadId = 'thread-1';
const itemId = 'queued-1';
const now = 1_800_000_000_000;

afterEach(() => vi.useRealTimers());

describe('desktop UI send proofs', () => {
  it('binds authenticated phone approvals to their surface and consumes them once', () => {
    const verify = createUiSendVerifier(secret);
    const proof = signUiSend(secret, threadId, itemId, Date.now(), 'mobile-ui');
    expect(verify(proof, threadId, itemId)).toBe(false);
    expect(verify(proof, threadId, itemId, 'mobile-ui')).toBe(true);
    expect(verify(proof, threadId, itemId, 'mobile-ui')).toBe(false);
    expect(verify(signUiSend(secret, threadId, itemId), threadId, itemId, 'mobile-ui')).toBe(false);
  });
  it('rejects short verifier secrets', () => {
    expect(() => createUiSendVerifier('x'.repeat(31))).toThrow('Invalid desktop UI signing secret');
    expect(() => createUiSendVerifier('x'.repeat(32))).not.toThrow();
  });

  it('rejects malformed, oversized, future, and expired proofs without consuming a valid proof', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    const verify = createUiSendVerifier(secret);
    const valid = signUiSend(secret, threadId, itemId);
    const [stamp, nonce, mac] = valid.split('.');
    for (const proof of [undefined, {}, '', 'x'.repeat(129),
      `${stamp}.${nonce.slice(1)}.${mac}`, `${stamp}.${nonce}.${mac.toUpperCase()}`,
      signUiSend(secret, threadId, itemId, now + 1),
      signUiSend(secret, threadId, itemId, now - 30_001)]) {
      expect(verify(proof, threadId, itemId)).toBe(false);
    }
    expect(verify(valid, threadId, itemId)).toBe(true);
    expect(verify(valid, threadId, itemId)).toBe(false);
  });

  it('binds signatures to secret, thread, and item without consuming mismatched proofs', () => {
    const verify = createUiSendVerifier(secret);
    const proof = signUiSend(secret, threadId, itemId);
    expect(verify(proof, 'other-thread', itemId)).toBe(false);
    expect(verify(proof, threadId, 'other-item')).toBe(false);
    expect(verify(signUiSend('x'.repeat(32), threadId, itemId), threadId, itemId)).toBe(false);
    expect(verify(proof, threadId, itemId)).toBe(true);
  });

  it('accepts boundary-age proofs and purges expired replay entries before storing a new one', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    const verify = createUiSendVerifier(secret);
    const oldest = signUiSend(secret, threadId, itemId, now - 30_000);
    expect(verify(oldest, threadId, itemId)).toBe(true);
    vi.setSystemTime(now + 30_000);
    expect(verify(oldest, threadId, itemId)).toBe(false);
    expect(verify(signUiSend(secret, threadId, itemId), threadId, itemId)).toBe(true);
  });

  it('handles full replay history and still rejects expired proofs', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    const verify = createUiSendVerifier(secret);
    const first = signUiSend(secret, threadId, itemId);
    expect(verify(first, threadId, itemId)).toBe(true);
    for (let i = 1; i <= 1024; i++) {
      expect(verify(signUiSend(secret, threadId, `queued-${i}`), threadId, `queued-${i}`)).toBe(true);
    }
    vi.setSystemTime(now + 30_001);
    expect(verify(first, threadId, itemId)).toBe(false);
  });
});
