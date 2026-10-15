/**
 * Header filter shared by every pairing path into the loopback product server
 * (the relay client and the SSH-tunnel forwarder). The last hop is always
 * loopback, so hop-by-hop headers, the caller's Host/Origin, and any
 * client-supplied forwarding metadata are dropped and Host is pinned to the
 * product server.
 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'origin',
  // A forwarded public Host would 403 when Settings and the public origin
  // disagree, and a remote caller must never choose what the product server
  // believes about the client.
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-proto',
  'x-real-ip',
  'forwarded'
]);

export function isStrippedPairingHeader(name: string): boolean {
  return HOP_BY_HOP.has(name.toLowerCase());
}

/** `127.0.0.1:<port>` (or a bracketed IPv6 literal) for the pinned Host header. */
export function loopbackHostHeader(port: number, host = '127.0.0.1'): string {
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
}

/** Flatten request header pairs into one record with Host pinned to loopback. */
export function headerPairsToRecord(pairs: Array<[string, string]>, loopbackHost: string): Record<string, string> {
  // Headers named in `Connection` are hop-by-hop for this hop only (RFC 9110 7.6.1).
  const nominated = new Set<string>();
  for (const [name, value] of pairs) {
    if (name.toLowerCase() !== 'connection') continue;
    for (const token of value.split(',')) {
      const trimmed = token.trim().toLowerCase();
      if (trimmed) nominated.add(trimmed);
    }
  }
  // Null prototype so a header named `__proto__` cannot reach Object.prototype.
  const headers: Record<string, string> = Object.create(null) as Record<string, string>;
  headers.host = loopbackHost;
  for (const [name, value] of pairs) {
    if (!name || isStrippedPairingHeader(name) || nominated.has(name.toLowerCase())) continue;
    const existing = headers[name];
    headers[name] = existing ? `${existing}, ${value}` : value;
  }
  return headers;
}

/** Response headers safe to hand back to the remote caller. */
export function fetchHeadersToPairs(headers: Headers): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  headers.forEach((value, name) => {
    if (isStrippedPairingHeader(name)) return;
    pairs.push([name, value]);
  });
  return pairs;
}
