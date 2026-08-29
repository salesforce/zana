import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isLoopbackHttpHost } from '../browser-bootstrap.js';
import { headerValue } from './browser-request-guard.js';
import type { IncomingMessage } from 'node:http';

/** Repo-root one-line hostname file. Edit this when the public domain changes. */
export const PUBLIC_APP_URL_FILENAME = 'public-app-url';

export function readPublicAppUrlFile(cwd?: string): string | undefined {
  // Vitest runs with cwd = repo root; don't leak the local hostname into API tests.
  if (cwd === undefined && process.env.VITEST) return undefined;
  const root = cwd ?? process.cwd();
  const path = join(root, PUBLIC_APP_URL_FILENAME);
  if (!existsSync(path)) return undefined;
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    return trimmed;
  }
  return undefined;
}

function parsePublicOrigin(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

/**
 * Public origin used for remote host-daemon join commands and Host-header
 * allowlisting on enroll/WS. Trailing slashes are stripped.
 *
 * Precedence: `ZCC_APP_URL` > Settings `publicAppUrl` > repo `public-app-url`.
 */
export function resolvePublicAppUrl(input?: {
  env?: NodeJS.ProcessEnv;
  configUrl?: string | null;
  cwd?: string;
}): string | undefined {
  const env = input?.env ?? process.env;
  return parsePublicOrigin(env.ZCC_APP_URL)
    ?? parsePublicOrigin(input?.configUrl ?? undefined)
    ?? parsePublicOrigin(readPublicAppUrlFile(input?.cwd));
}

/** Renderer-facing config: fill `publicAppUrl` from env / Settings / the repo file. */
export function presentAppConfig<T extends { publicAppUrl?: string }>(
  config: T,
  input?: { env?: NodeJS.ProcessEnv; cwd?: string }
): T {
  const publicAppUrl = resolvePublicAppUrl({
    env: input?.env,
    configUrl: config.publicAppUrl,
    cwd: input?.cwd
  });
  if (!publicAppUrl || publicAppUrl === config.publicAppUrl) return config;
  return { ...config, publicAppUrl };
}

export function publicOriginHost(publicAppUrl: string | undefined): string | undefined {
  if (!publicAppUrl) return undefined;
  try {
    return new URL(publicAppUrl).host.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Host-internal enroll/WS accept loopback Host headers (local daemon) or the
 * configured public origin (Tailscale Serve / Heroku). DNS-rebinding Host
 * headers that match neither are refused.
 */
export function isAllowedHostInternalHost(
  hostHeader: string | undefined,
  publicAppUrl?: string
): boolean {
  if (isLoopbackHttpHost(hostHeader)) return true;
  const expected = publicOriginHost(publicAppUrl);
  const received = hostHeader?.trim().toLowerCase();
  return Boolean(expected && received && received === expected);
}

export function requestHostHeader(request: IncomingMessage): string | undefined {
  return headerValue(request.headers, 'x-forwarded-host')?.split(',', 1)[0]?.trim()
    ?? headerValue(request.headers, 'host');
}
