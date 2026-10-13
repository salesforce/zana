import { describe, expect, it } from 'vitest';
import {
  createNativeToolPolicyVerifier,
  NATIVE_TOOL_POLICY_PROOF_TTL_MS,
  signNativeToolPolicyRequest
} from './native-tool-policy-proof.js';

const secret = 's'.repeat(64);
const body = JSON.stringify({ invocationId: 'a'.repeat(64), toolName: 'Bash', input: { command: 'pwd' } });

describe('native tool policy proof', () => {
  it('accepts main\'s proof for the exact body once', () => {
    const verify = createNativeToolPolicyVerifier(secret, () => 1_800_000_000_000);
    const token = signNativeToolPolicyRequest(secret, body, 1_800_000_000_000);
    expect(verify(token, body)).toBe(true);
    expect(verify(token, body)).toBe(false);
  });

  it.each<[string, (token: string) => [unknown, string]]>([
    ['another body', (token) => [token, body.replace('pwd', 'rm -rf /')]],
    ['a missing proof', () => [undefined, body]],
    ['a non-string proof', () => [42, body]],
    ['an oversized proof', (token) => [`${token}${'0'.repeat(128)}`, body]],
    ['a malformed proof', () => ['not-a-proof', body]],
    ['a forged signature', (token) => [token.replace(/[a-f0-9]{64}$/, 'f'.repeat(64)), body]]
  ])('refuses %s', (_label, attempt) => {
    const verify = createNativeToolPolicyVerifier(secret, () => 1_800_000_000_000);
    const [token, received] = attempt(signNativeToolPolicyRequest(secret, body, 1_800_000_000_000));
    expect(verify(token, received)).toBe(false);
  });

  it('refuses a proof signed with another credential', () => {
    const verify = createNativeToolPolicyVerifier(secret, () => 1_800_000_000_000);
    expect(verify(signNativeToolPolicyRequest('o'.repeat(64), body, 1_800_000_000_000), body)).toBe(false);
  });

  it('refuses an expired or future proof', () => {
    let now = 1_800_000_000_000;
    const verify = createNativeToolPolicyVerifier(secret, () => now);
    const token = signNativeToolPolicyRequest(secret, body, now);
    now += NATIVE_TOOL_POLICY_PROOF_TTL_MS + 1;
    expect(verify(token, body)).toBe(false);
    expect(verify(signNativeToolPolicyRequest(secret, body, now + 1), body)).toBe(false);
  });

  it('forgets used proofs once they expire, and bounds what it remembers', () => {
    let now = 1_800_000_000_000;
    const verify = createNativeToolPolicyVerifier(secret, () => now);
    for (let i = 0; i < 1100; i++) expect(verify(signNativeToolPolicyRequest(secret, body, now), body)).toBe(true);
    now += NATIVE_TOOL_POLICY_PROOF_TTL_MS;
    expect(verify(signNativeToolPolicyRequest(secret, body, now), body)).toBe(true);
  });

  it('needs a real credential', () => {
    expect(() => createNativeToolPolicyVerifier('short')).toThrow('Invalid product server credential');
  });
});
