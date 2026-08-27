import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWLIST_PATH = join(dirname(fileURLToPath(import.meta.url)), 'allowlist.json');

/** @type {{ http: Array<{ methods: string[]; path: string }>; ws: string[] }} */
export const PAIRING_ALLOWLIST = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'));

export function normalizePairingPath(pathname) {
  const path = (pathname ?? '/').split('?')[0] ?? '/';
  return path.replace(/\/+$/u, '') || '/';
}

export function isAllowedHttp(method, pathname) {
  const path = normalizePairingPath(pathname);
  const verb = (method ?? 'GET').toUpperCase();
  return PAIRING_ALLOWLIST.http.some((row) => row.path === path && row.methods.includes(verb));
}

export function isAllowedWs(pathname) {
  return PAIRING_ALLOWLIST.ws.includes(normalizePairingPath(pathname));
}
