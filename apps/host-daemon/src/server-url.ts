/**
 * Join a path onto ZCC_SERVER_URL without dropping a pairing prefix (`/t/<session>`).
 * `new URL('/internal/…', 'https://origin/t/zcrs_…')` replaces that prefix and
 * hits the unprefixed Heroku door (`relay_ambiguous` when more than one laptop
 * tunnel is live).
 */
export function joinServerUrl(serverUrl: string, path: string): URL {
  const base = serverUrl.endsWith('/') ? serverUrl : `${serverUrl}/`;
  return new URL(path.replace(/^\/+/u, ''), base);
}

export function joinServerWsUrl(serverUrl: string, path: string): URL {
  return joinServerUrl(serverUrl.replace(/^http/i, 'ws'), path);
}
