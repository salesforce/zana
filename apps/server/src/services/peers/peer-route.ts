/**
 * A peer's advertised app-server route. Only the origin is ever used: no credentials, path, query or
 * fragment. Loopback is always acceptable (the server binds 127.0.0.1); any other origin must be https and
 * explicitly allowlisted by the owner. Callers fetch with `redirect: 'error'`, so the destination is fixed.
 */
const LOOPBACK = new Set(['127.0.0.1', '[::1]', 'localhost']);
export const PEER_ROUTE_MAX = 256;

export function validatePeerRoute(input: unknown, allowedOrigins: readonly string[] = []): string {
  if (typeof input !== 'string' || input.length === 0 || input.length > PEER_ROUTE_MAX) throw new Error('invalid peer route');
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('invalid peer route'); }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password ||
    url.pathname !== '/' || url.search || url.hash || !url.hostname) throw new Error('invalid peer route');
  if (!LOOPBACK.has(url.hostname) && !(url.protocol === 'https:' && allowedOrigins.includes(url.origin))) {
    throw new Error('peer route is not loopback or allowlisted');
  }
  return `${url.origin}/`;
}
