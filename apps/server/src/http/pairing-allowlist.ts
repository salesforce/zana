/**
 * Laptop-side copy of website/relay/allowlist.json.
 * The dyno reads the JSON; this module is what ships in the desktop app
 * (website/ is not in the Electron package). Keep them identical — see
 * pairing-relay-allowlist.guard.test.ts.
 */
export const PAIRING_ALLOWLIST = {
  http: [
    { methods: ['GET', 'HEAD'], path: '/install.sh' },
    { methods: ['GET', 'HEAD'], path: '/install/version' },
    { methods: ['GET', 'HEAD'], path: '/install/zcc-host.tgz' },
    { methods: ['POST'], path: '/internal/hosts/enroll' },
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

export function isAllowedHttp(method: string, pathname: string): boolean {
  const path = normalizePairingPath(pathname);
  const verb = (method ?? 'GET').toUpperCase();
  return PAIRING_ALLOWLIST.http.some((row) => {
    if (!(row.methods as readonly string[]).includes(verb)) return false;
    if ('path' in row) return row.path === path;
    if ('pathPattern' in row) return new RegExp(row.pathPattern, 'u').test(path);
    return false;
  });
}

export function isAllowedWs(pathname: string): boolean {
  return (PAIRING_ALLOWLIST.ws as readonly string[]).includes(normalizePairingPath(pathname));
}
