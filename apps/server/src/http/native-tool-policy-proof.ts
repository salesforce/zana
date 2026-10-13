import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Main's proof on a native tool policy (OBL-004) request it sends the product
 * server over HTTP, which it does only when no runtime supervisor carries the
 * request (`pnpm dev`). It binds the exact body to the product-server
 * credential, which only main and the server hold (PTY children never see
 * it), and each proof is good once, briefly.
 */
export const NATIVE_TOOL_POLICY_PROOF_HEADER = 'x-zcc-native-tool-policy-proof';
/** The product route main posts to; main imports only this module, never the route. */
export const NATIVE_TOOL_POLICY_PATH = '/api/v1/native-tool-policy';
/** Covers main's 4 s request timeout with margin; a proof is never reused. */
export const NATIVE_TOOL_POLICY_PROOF_TTL_MS = 10_000;
const MAX_USED = 1024;
const TOKEN = /^(\d{13})\.([a-f0-9]{32})\.([a-f0-9]{64})$/;

function signature(secret: string, body: string, stamp: string, nonce: string): string {
  const digest = createHash('sha256').update(body).digest('hex');
  return createHmac('sha256', secret).update(JSON.stringify(['native-tool-policy', digest, stamp, nonce])).digest('hex');
}

/** Desktop main signs the serialized request it is about to send. */
export function signNativeToolPolicyRequest(secret: string, body: string, now = Date.now()): string {
  const stamp = String(now);
  const nonce = randomBytes(16).toString('hex');
  return `${stamp}.${nonce}.${signature(secret, body, stamp, nonce)}`;
}

/** Checks a proof against the raw body received. A matching proof is consumed at once. */
export function createNativeToolPolicyVerifier(secret: string, now: () => number = Date.now) {
  if (secret.length < 32) throw new Error('Invalid product server credential');
  const used = new Map<string, number>();
  return (token: unknown, body: string): boolean => {
    if (typeof token !== 'string' || token.length > 128) return false;
    const parts = TOKEN.exec(token);
    if (!parts) return false;
    const [, stamp, nonce, mac] = parts;
    const at = now();
    const age = at - Number(stamp);
    if (age < 0 || age > NATIVE_TOOL_POLICY_PROOF_TTL_MS || used.has(nonce!)) return false;
    if (!timingSafeEqual(Buffer.from(mac!), Buffer.from(signature(secret, body, stamp!, nonce!)))) return false;
    for (const [key, expires] of used) if (expires <= at) used.delete(key);
    if (used.size >= MAX_USED) used.delete(used.keys().next().value!);
    used.set(nonce!, at + NATIVE_TOOL_POLICY_PROOF_TTL_MS);
    return true;
  };
}
