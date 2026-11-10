import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const PEER_TOOL_PATH = '/api/v1/thread-peers/tool';
export const PEER_TOOL_PROOF_HEADER = 'x-zcc-peer-tool-proof';
export const PEER_TOOL_BODY_LIMIT = 64_000;
const TTL_MS = 10_000;
function mac(secret: string, stamp: string, nonce: string, body: string): string {
  return createHmac('sha256', secret).update(JSON.stringify(['thread-peer-tool', stamp, nonce, body])).digest('hex');
}
export function signPeerToolRequest(secret: string, body: string, now = Date.now()): string {
  const stamp = String(now), nonce = randomBytes(16).toString('hex');
  return `${stamp}.${nonce}.${mac(secret, stamp, nonce, body)}`;
}
/** Main asserts live PTY identity. Neither renderer nor agent receives this secret. */
export function createPeerToolVerifier(secret: string, now = Date.now) {
  if (secret.length < 32) throw new Error('Invalid product server credential');
  const used = new Map<string, number>();
  return (proof: unknown, body: string): boolean => {
    if (typeof proof !== 'string') return false;
    const match = /^(\d{13})\.([a-f0-9]{32})\.([a-f0-9]{64})$/u.exec(proof);
    if (!match) return false;
    const [, stamp, nonce, signature] = match;
    const at = now(), age = at - Number(stamp);
    if (age < 0 || age > TTL_MS || used.has(nonce!)) return false;
    if (!timingSafeEqual(Buffer.from(signature!), Buffer.from(mac(secret, stamp!, nonce!, body)))) return false;
    for (const [key, expiry] of used) if (expiry <= at) used.delete(key);
    if (used.size >= 1024) return false;
    used.set(nonce!, at + TTL_MS);
    return true;
  };
}
