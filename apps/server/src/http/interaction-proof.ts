import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { InteractionActor } from '@zana-ai/zcc-domain';

export const INTERACTION_PROOF_HEADER = 'x-zcc-interaction-proof';
export const INTERACTION_PROOF_TTL_MS = 10_000;
const MAX_USED = 4096;

/**
 * What a proof is bound to: a thread, or a PTY session that has no thread
 * record. Exactly one of the two keys is set, and the two never share a MAC
 * domain, so a thread proof cannot answer a session interaction or the reverse.
 */
export type InteractionProofBinding = {
  interactionId: string;
  body: string;
} & ({ threadId: string; sessionId?: undefined } | { sessionId: string; threadId?: undefined });

type ActorProof = {
  actor: InteractionActor;
  source: string;
  expiresAt: number;
  nonce: string;
};

function mac(secret: string, binding: InteractionProofBinding, proof: ActorProof): Buffer {
  const keyed = typeof binding.sessionId === 'string' && typeof binding.threadId !== 'string'
    ? ['pty-interaction-response', binding.sessionId]
    : typeof binding.threadId === 'string' && typeof binding.sessionId !== 'string'
      ? ['interaction-response', binding.threadId]
      : null;
  if (!keyed) throw new Error('Interaction proof binds exactly one of threadId or sessionId');
  return createHmac('sha256', secret).update(JSON.stringify([
    ...keyed, binding.interactionId,
    createHash('sha256').update(binding.body).digest('hex'),
    proof.actor, proof.source, proof.expiresAt, proof.nonce
  ])).digest();
}

/** Main sends this directly to the server. Never return it to renderer/plugin callers. */
export function signInteractionProof(
  secret: string, binding: InteractionProofBinding, actor: InteractionActor,
  source: string, now = Date.now()
): string {
  if (secret.length < 32) throw new Error('Interaction proof unavailable');
  const proof: ActorProof = { actor, source, expiresAt: now + INTERACTION_PROOF_TTL_MS, nonce: randomBytes(16).toString('hex') };
  return `${Buffer.from(JSON.stringify(proof)).toString('base64url')}.${mac(secret, binding, proof).toString('hex')}`;
}

export function createInteractionProofVerifier(secret: string, now: () => number = Date.now) {
  if (secret.length < 32) throw new Error('Invalid interaction signing secret');
  const used = new Map<string, number>();
  return (token: unknown, binding: InteractionProofBinding): InteractionActor | null => {
    if (typeof token !== 'string' || token.length > 1024) return null;
    if ((typeof binding.threadId === 'string') === (typeof binding.sessionId === 'string')) return null;
    const parts = /^([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/.exec(token);
    if (!parts) return null;
    let proof: ActorProof;
    try { proof = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')); }
    catch { return null; }
    if (!proof || !['human', 'cli', 'agent', 'unknown'].includes(proof.actor)
      || typeof proof.source !== 'string' || proof.source.length > 256
      || !/^[a-f0-9]{32}$/.test(proof.nonce) || !Number.isSafeInteger(proof.expiresAt)) return null;
    const at = now();
    if (proof.expiresAt <= at || proof.expiresAt > at + INTERACTION_PROOF_TTL_MS || used.has(proof.nonce)) return null;
    if (!timingSafeEqual(Buffer.from(parts[2]!, 'hex'), mac(secret, binding, proof))) return null;
    for (const [nonce, expiry] of used) if (expiry <= at) used.delete(nonce);
    // Never evict live nonces: doing so would let a previously used proof replay.
    if (used.size >= MAX_USED) return null;
    used.set(proof.nonce, proof.expiresAt);
    return proof.actor;
  };
}
