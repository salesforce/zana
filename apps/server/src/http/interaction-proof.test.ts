import { describe, expect, it } from 'vitest';
import { createInteractionProofVerifier, signInteractionProof, INTERACTION_PROOF_TTL_MS } from './interaction-proof.js';

const secret = 's'.repeat(32);
const binding = { threadId: 'thread', interactionId: 'interaction', body: '{"value":true}' };
const at = 1_792_672_405_253;

describe('interaction actor proof', () => {
  it.each(['human', 'cli', 'agent', 'unknown'] as const)('verifies %s once', actor => {
    const verify = createInteractionProofVerifier(secret, () => at);
    const token = signInteractionProof(secret, binding, actor, 'window:7', at);
    expect(verify(token, binding)).toBe(actor);
    expect(verify(token, binding)).toBeNull();
  });
  it('binds body, interaction, thread, secret, and source; rejects malformed claims', () => {
    const verify = createInteractionProofVerifier(secret, () => at);
    const token = signInteractionProof(secret, binding, 'human', 'window:7', at);
    for (const altered of [{ ...binding, threadId: 'other' }, { ...binding, interactionId: 'other' }, { ...binding, body: '{}' }]) expect(verify(token, altered)).toBeNull();
    expect(createInteractionProofVerifier('x'.repeat(32), () => at)(token, binding)).toBeNull();
    const [payload, signature] = token.split('.');
    const claim = JSON.parse(Buffer.from(payload!, 'base64url').toString());
    for (const change of [{ source: 'control:operator' }, { actor: 'other' }, { nonce: false }, { expiresAt: null }]) {
      expect(verify(`${Buffer.from(JSON.stringify({ ...claim, ...change })).toString('base64url')}.${signature}`, binding)).toBeNull();
    }
    for (const invalid of [null, '', 'bad', 'eA.' + '0'.repeat(64), 'x'.repeat(1025)]) expect(verify(invalid, binding)).toBeNull();
    expect(verify(token, binding)).toBe('human');
    expect(() => createInteractionProofVerifier('short')).toThrow();
    expect(() => signInteractionProof('short', binding, 'human', 'window')).toThrow();
  });
  it('rejects expired and future proofs', () => {
    const token = signInteractionProof(secret, binding, 'human', 'window', at);
    expect(createInteractionProofVerifier(secret, () => at - 1)(token, binding)).toBeNull();
    expect(createInteractionProofVerifier(secret, () => at + INTERACTION_PROOF_TTL_MS)(token, binding)).toBeNull();
  });
  it('fails closed at replay retention cap, then prunes only expired entries', () => {
    let now = at;
    const verify = createInteractionProofVerifier(secret, () => now);
    const first = signInteractionProof(secret, binding, 'human', 'window', now);
    expect(verify(first, binding)).toBe('human');
    for (let i = 1; i < 4096; i++) expect(verify(signInteractionProof(secret, binding, 'human', 'window', now), binding)).toBe('human');
    expect(verify(signInteractionProof(secret, binding, 'human', 'window', now), binding)).toBeNull();
    expect(verify(first, binding)).toBeNull();
    now += INTERACTION_PROOF_TTL_MS;
    expect(verify(signInteractionProof(secret, binding, 'human', 'window', now), binding)).toBe('human');
  });
});
