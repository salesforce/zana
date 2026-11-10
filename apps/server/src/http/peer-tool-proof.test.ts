import { describe, it, expect } from 'vitest';
import { signPeerToolRequest, createPeerToolVerifier } from './peer-tool-proof.js';

const secret = 'peer-test-secret'.repeat(4), now = 1_790_000_000_000;
describe('main-authenticated peer proofs', () => {
  it('binds the exact body, accepts once, and refuses forged identities', () => {
    const verify = createPeerToolVerifier(secret, () => now);
    const body = '{"caller":"cli-1"}', proof = signPeerToolRequest(secret, body, now);
    expect(verify(proof, '{"caller":"cli-2"}')).toBe(false);
    expect(verify(signPeerToolRequest('other'.repeat(10), body, now), body)).toBe(false);
    expect(verify(proof, body)).toBe(true); expect(verify(proof, body)).toBe(false);
    for (const invalid of [null, '', 'bad', '9'.repeat(1000)]) expect(verify(invalid, body)).toBe(false);
  });
  it('rejects expired/future proofs and removes old replay entries', () => {
    let at = now; const verify = createPeerToolVerifier(secret, () => at);
    expect(verify(signPeerToolRequest(secret, 'a', now - 10_001), 'a')).toBe(false);
    expect(verify(signPeerToolRequest(secret, 'a', now + 1), 'a')).toBe(false);
    expect(verify(signPeerToolRequest(secret, 'a', now), 'a')).toBe(true);
    at += 10_001;
    expect(verify(signPeerToolRequest(secret, 'b', at), 'b')).toBe(true);
    expect(() => createPeerToolVerifier('short')).toThrow('credential');
  });
  it('fails closed at the replay budget', () => {
    const verify = createPeerToolVerifier(secret, () => now);
    for (let i = 0; i < 1024; i++) expect(verify(signPeerToolRequest(secret, 'x', now), 'x')).toBe(true);
    expect(verify(signPeerToolRequest(secret, 'x', now), 'x')).toBe(false);
  });
});
