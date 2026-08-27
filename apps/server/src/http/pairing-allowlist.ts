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
    { methods: ['POST'], path: '/internal/hosts/interactive-request/interrupt' }
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
  return PAIRING_ALLOWLIST.http.some((row) => row.path === path && (row.methods as readonly string[]).includes(verb));
}

export function isAllowedWs(pathname: string): boolean {
  return (PAIRING_ALLOWLIST.ws as readonly string[]).includes(normalizePairingPath(pathname));
}
