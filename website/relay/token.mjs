import { timingSafeEqual } from 'node:crypto';

export function bearerToken(authorization) {
  if (typeof authorization !== 'string' || authorization.length === 0) return null;
  const prefix = 'Bearer ';
  if (!authorization.toLowerCase().startsWith(prefix.toLowerCase())) return null;
  const token = authorization.slice(prefix.length).trim();
  return token.length > 0 ? token : null;
}

export function tokenMatches(received, expected) {
  if (typeof received !== 'string' || typeof expected !== 'string') return false;
  if (received.length === 0 || expected.length === 0) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function relayTokenFromEnv(env = process.env) {
  const value = env.ZCC_RELAY_TOKEN?.trim();
  return value && value.length > 0 ? value : undefined;
}
