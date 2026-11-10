import { describe, expect, it } from 'vitest';
import { createDetailedInteractionProofVerifier, createInteractionProofVerifier, signInteractionProof, INTERACTION_PROOF_TTL_MS } from './interaction-proof.js';

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
    expect(() => signInteractionProof('short', binding, 'human', 'window:7')).toThrow();
  });
  it('refuses a human claim whose source is not a main-drawn surface', () => {
    const verify = createInteractionProofVerifier(secret, () => at);
    for (const source of ['control:operator', 'window', '', 'cli']) {
      expect(verify(signInteractionProof(secret, binding, 'human', source, at), binding)).toBeNull();
    }
    expect(verify(signInteractionProof(secret, binding, 'human', 'sheet:1', at), binding)).toBe('human');
    expect(verify(signInteractionProof(secret, binding, 'cli', 'control:operator', at), binding)).toBe('cli');
  });
  it('reports which main-drawn surface vouched for a human', () => {
    const verify = createDetailedInteractionProofVerifier(secret, () => at);
    expect(verify(signInteractionProof(secret, binding, 'human', 'window:7', at), binding)).toEqual({ actor: 'human', attestation: 'window' });
    expect(verify(signInteractionProof(secret, binding, 'human', 'sheet:7', at), binding)).toEqual({ actor: 'human', attestation: 'sheet' });
    expect(verify(signInteractionProof(secret, binding, 'cli', 'control:operator', at), binding)).toEqual({ actor: 'cli' });
  });
  it('rejects expired and future proofs', () => {
    const token = signInteractionProof(secret, binding, 'human', 'window:7', at);
    expect(createInteractionProofVerifier(secret, () => at - 1)(token, binding)).toBeNull();
    expect(createInteractionProofVerifier(secret, () => at + INTERACTION_PROOF_TTL_MS)(token, binding)).toBeNull();
  });
  it('fails closed at replay retention cap, then prunes only expired entries', () => {
    let now = at;
    const verify = createInteractionProofVerifier(secret, () => now);
    const first = signInteractionProof(secret, binding, 'human', 'window:7', now);
    expect(verify(first, binding)).toBe('human');
    for (let i = 1; i < 4096; i++) expect(verify(signInteractionProof(secret, binding, 'human', 'window:7', now), binding)).toBe('human');
    expect(verify(signInteractionProof(secret, binding, 'human', 'window:7', now), binding)).toBeNull();
    expect(verify(first, binding)).toBeNull();
    now += INTERACTION_PROOF_TTL_MS;
    expect(verify(signInteractionProof(secret, binding, 'human', 'window:7', now), binding)).toBe('human');
  });
  describe('PTY session binding', () => {
    const session = { sessionId: 'pty-1', interactionId: 'interaction', body: '{"value":true}' };
    it('verifies a session proof once and binds the session id', () => {
      const verify = createInteractionProofVerifier(secret, () => at);
      const token = signInteractionProof(secret, session, 'human', 'window:7', at);
      expect(verify(token, { ...session, sessionId: 'pty-2' })).toBeNull();
      expect(verify(token, session)).toBe('human');
      expect(verify(token, session)).toBeNull();
    });
    it('keeps thread and session proofs in separate domains, even for the same id', () => {
      const verify = createInteractionProofVerifier(secret, () => at);
      const threadBinding = { threadId: 'same', interactionId: 'interaction', body: session.body };
      const sessionBinding = { ...session, sessionId: 'same' };
      const sessionToken = signInteractionProof(secret, sessionBinding, 'human', 'window:7', at);
      expect(verify(sessionToken, threadBinding)).toBeNull();
      const threadToken = signInteractionProof(secret, threadBinding, 'human', 'window:7', at);
      expect(verify(threadToken, sessionBinding)).toBeNull();
      // Each token is valid only against its own owner domain (single-use, so use fresh verifiers).
      expect(createInteractionProofVerifier(secret, () => at)(sessionToken, sessionBinding)).toBe('human');
      expect(createInteractionProofVerifier(secret, () => at)(threadToken, threadBinding)).toBe('human');
    });
    it('refuses a binding that names both keys or neither', () => {
      const verify = createInteractionProofVerifier(secret, () => at);
      const token = signInteractionProof(secret, session, 'human', 'w', at);
      expect(verify(token, { ...session, threadId: 't' } as never)).toBeNull();
      expect(verify(token, { interactionId: 'interaction', body: session.body } as never)).toBeNull();
      expect(() => signInteractionProof(secret, { ...session, threadId: 't' } as never, 'human', 'w', at)).toThrow('exactly one');
    });
  });
});
