/**
 * The only routes a remote machine may reach through the SSH-tunnel pairing
 * forwarder: the installer, enrollment and the enrolled daemon's callbacks.
 */
export const PAIRING_ALLOWLIST = {
  http: [
    { methods: ['GET', 'HEAD'], path: '/install.sh' },
    { methods: ['GET', 'HEAD'], path: '/install/version' },
    { methods: ['GET', 'HEAD'], path: '/install/zcc-host.tgz' },
    { methods: ['POST'], path: '/internal/hosts/enroll' },
    { methods: ['POST'], path: '/internal/hosts/tool-call' },
    { methods: ['POST'], path: '/internal/hosts/cli-callback' },
    { methods: ['POST'], path: '/internal/hosts/interactive-request' },
    { methods: ['POST'], path: '/internal/hosts/interactive-request/interrupt' },
    { methods: ['GET', 'HEAD'], pathPattern: '^/internal/plugins/[^/]+/host/[a-f0-9]{64}$' }
  ],
  ws: ['/internal/hosts/ws']
} as const;

export function normalizePairingPath(pathname: string): string {
  const path = (pathname ?? '/').split('?')[0] ?? '/';
  return path.replace(/\/+$/u, '') || '/';
}

/**
 * What an SSH peer link may reach on the peer forwarder: enrollment and the
 * enrolled host's websocket, nothing else. Deliberately separate from
 * PAIRING_ALLOWLIST (which mirrors website/relay/allowlist.json) so the relay
 * guard is unaffected and a peer never gets installer or callback routes.
 */
export const PEER_LINK_ALLOWLIST = {
  http: [{ methods: ['POST'], path: '/internal/hosts/enroll' }],
  ws: ['/internal/hosts/ws']
} as const;

interface AllowlistRow {
  readonly methods: readonly string[];
  readonly path?: string;
  readonly pathPattern?: string;
}

interface Allowlist {
  readonly http: readonly AllowlistRow[];
  readonly ws: readonly string[];
}

export function isAllowedHttp(method: string, pathname: string, list: Allowlist = PAIRING_ALLOWLIST): boolean {
  const path = normalizePairingPath(pathname);
  const verb = (method ?? 'GET').toUpperCase();
  return list.http.some((row) => {
    if (!row.methods.includes(verb)) return false;
    if (row.path !== undefined) return row.path === path;
    if (row.pathPattern !== undefined) return new RegExp(row.pathPattern, 'u').test(path);
    return false;
  });
}

export function isAllowedWs(pathname: string, list: Allowlist = PAIRING_ALLOWLIST): boolean {
  return list.ws.includes(normalizePairingPath(pathname));
}

/**
 * Resolve a forwarded request target against the fixed product origin.
 * Only origin-form targets (`/path?query`) are accepted: an authority-bearing
 * target such as `//evil:1/internal/hosts/enroll` (or its `/\` variant) would
 * pass a pathname check yet make `new URL(target, origin)` contact another
 * host. The returned URL always has `origin`'s scheme/host/port, and `path` is
 * the dot-resolved pathname actually requested — check the allowlist on it.
 */
export function resolvePairingTarget(target: unknown, origin: string): { url: URL; path: string } | null {
  if (typeof target !== 'string' || !target.startsWith('/')) return null;
  const pathAndQuery = target.split(/[?#]/u, 1)[0] ?? '';
  if (pathAndQuery.startsWith('//') || pathAndQuery.includes('\\')) return null;
  if (/[\u0000- \u007f]/u.test(target)) return null;
  let parsed: URL;
  try {
    parsed = new URL(target, 'http://pairing-target.invalid');
  } catch {
    return null;
  }
  if (parsed.host !== 'pairing-target.invalid') return null;
  const base = new URL(origin);
  const url = new URL(base.origin);
  url.pathname = parsed.pathname;
  url.search = parsed.search;
  if (url.origin !== base.origin) return null;
  return { url, path: normalizePairingPath(parsed.pathname) };
}
