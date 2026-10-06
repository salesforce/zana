import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const MAX_AGE_MS = 30_000;
const MAX_USED = 1024;

function signature(secret: string, threadId: string, itemId: string, stamp: string, nonce: string): string {
  return createHmac('sha256', secret).update(JSON.stringify([threadId, itemId, stamp, nonce])).digest('hex');
}

/** Main alone holds the boot secret; renderer and agent sessions never receive it. */
export function signUiSend(secret: string, threadId: string, itemId: string, now = Date.now()): string {
  const stamp = String(now);
  const nonce = randomBytes(16).toString('hex');
  return `${stamp}.${nonce}.${signature(secret, threadId, itemId, stamp, nonce)}`;
}

export function createUiSendVerifier(secret: string) {
  if (secret.length < 32) throw new Error('Invalid desktop UI signing secret');
  const used = new Map<string, number>();
  return (proof: unknown, threadId: string, itemId: string): boolean => {
    if (typeof proof !== 'string' || proof.length > 128) return false;
    const parts = /^(\d{13})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(proof);
    if (!parts) return false;
    const [, stamp, nonce, mac] = parts;
    const now = Date.now();
    const age = now - Number(stamp);
    if (age < 0 || age > MAX_AGE_MS || used.has(proof)) return false;
    const expected = signature(secret, threadId, itemId, stamp, nonce);
    if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return false;
    // A proof is consumed before dispatch, including failures, to prevent retries of an override.
    for (const [key, expires] of used) if (expires <= now) used.delete(key);
    if (used.size >= MAX_USED) used.delete(used.keys().next().value!);
    used.set(proof, now + MAX_AGE_MS);
    return true;
  };
}
