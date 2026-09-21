// Use Expo's parser explicitly: React Native's fallback URL only parses HTTP
// hosts and does not normalize paths consistently with the desktop runtime.
import { URL } from 'whatwg-url-minimum';

export function normalizeServerUrl(input: string): string {
  const url = new URL(input.trim());
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error('Enter a server URL without a path, password or query.');
  }
  const host = url.hostname.toLowerCase();
  const parts = host.split('.');
  const ipv4 = parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
  const [a = -1, b = -1] = parts.map(Number);
  const privateIp =
    ipv4 &&
    (a === 127 ||
      a === 10 ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 100 && b >= 64 && b <= 127));
  const privateHost =
    host === 'localhost' || host === '[::1]' || privateIp || host.endsWith('.local');
  if (url.protocol === 'http:' && !privateHost)
    throw new Error('Use HTTPS for a remote server. HTTP is available only on a private network.');
  return url.origin;
}
export function safePath(path: string): string {
  if (
    path.length > 2048 ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    /[\\\u0000-\u0020]/.test(path) ||
    /%2f|%5c|%00/i.test(path)
  )
    return '/';
  const url = new URL(path, 'https://shell.invalid');
  if (
    url.origin !== 'https://shell.invalid' ||
    /^\/(api|internal|_mobile|mcp)(\/|$)/.test(url.pathname)
  )
    return '/';
  return url.pathname + url.search + url.hash;
}
export function isSameServer(url: string, serverUrl: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === serverUrl && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}
export function externalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      ['https:', 'http:', 'mailto:', 'tel:'].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}
export interface PairingPayload {
  version: 1;
  serverUrl: string;
  code: string;
  expiresAt: number;
}
export function parsePairingPayload(raw: string, now = Date.now()): PairingPayload {
  let input = raw.trim();
  if (input.length > 4096) throw new Error('Pairing code is too long.');
  let value: Partial<PairingPayload> | null;
  try {
    if (input.startsWith('zana:')) {
      const link = new URL(input);
      if (
        link.host !== 'connect' ||
        link.username ||
        link.password ||
        (link.pathname !== '' && link.pathname !== '/')
      )
        throw new Error('Not a pairing link');
      input = link.searchParams.get('payload') ?? '';
    }
    value = JSON.parse(input);
  } catch {
    throw new Error('Scan a Zana pairing QR code generated on your computer.');
  }
  if (
    !value ||
    value.version !== 1 ||
    typeof value.serverUrl !== 'string' ||
    typeof value.code !== 'string' ||
    !/^[\w-]{22}$/.test(value.code) ||
    typeof value.expiresAt !== 'number' ||
    !Number.isFinite(value.expiresAt) ||
    value.expiresAt <= now
  )
    throw new Error('Pairing code is invalid or expired. Generate a new code on your computer.');
  return {
    version: 1,
    serverUrl: normalizeServerUrl(value.serverUrl),
    code: value.code,
    expiresAt: value.expiresAt
  };
}
/** Deep links choose a screen, never grant trust or start network requests. */
export function nativeIntent(path: string): string {
  try {
    const url = new URL(path);
    if (url.protocol === 'zana:' && url.hostname === 'connect')
      return `/connect?payload=${encodeURIComponent(url.searchParams.get('payload') ?? '')}`;
    if (url.protocol === 'zana:' && url.hostname === 'open')
      return `/?server=${encodeURIComponent(normalizeServerUrl(url.searchParams.get('server') ?? ''))}&path=${encodeURIComponent(safePath(url.searchParams.get('path') ?? '/'))}`;
    if (url.protocol === 'https:' || url.protocol === 'http:')
      return `/?server=${encodeURIComponent(normalizeServerUrl(url.origin))}&path=${encodeURIComponent(safePath(url.pathname + url.search + url.hash))}`;
  } catch {
    /* unknown links land at home */
  }
  return '/';
}
