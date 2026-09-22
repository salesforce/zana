import { isSameServer, safePath } from './urls';

/**
 * Which in-app path a WebView mount should load. Mirrors BB's shell load
 * resolution (#3743): a remembered in-memory path where the user actually is
 * wins over the path the shell was first opened with, so a cookie refresh,
 * manual Reload or process recovery restores their place instead of bouncing
 * back to the deep link or the new-thread page. Cold starts (no visited path,
 * no explicit request) open the new-thread page at `/`.
 *
 * The visited path is never persisted to disk — a cold start after an app
 * restart always resolves to the requested path or `/`.
 */
export function resolveShellLoadPath(input: {
  visitedPath: string | null;
  requestedPath: string | undefined;
}): string {
  if (input.visitedPath !== null) return input.visitedPath;
  if (input.requestedPath !== undefined && input.requestedPath.length > 0) {
    return input.requestedPath;
  }
  return '/';
}

/**
 * The confined in-app path for a same-server navigation, or null when the URL
 * left the server (an external link the shell should not remember). The result
 * is passed through `safePath`, so a navigation into a blocked route collapses
 * to `/` rather than being remembered verbatim.
 */
export function shellPathFromUrl(url: string, serverUrl: string): string | null {
  if (!isSameServer(url, serverUrl)) return null;
  const rest = url.slice(serverUrl.length);
  return safePath(rest.startsWith('/') ? rest : `/${rest}`);
}
