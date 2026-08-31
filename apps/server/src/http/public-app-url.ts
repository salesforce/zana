import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isLoopbackHttpHost } from '../browser-bootstrap.js';
import { headerValue } from './browser-request-guard.js';
import type { IncomingMessage } from 'node:http';

/** Repo-root one-line hostname file. Kept for operators; pairing no longer reads it. */
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

function compileTimeAppUrl(): string | undefined {
  return typeof __ZCC_BUNDLED_APP_URL__ === 'string' ? __ZCC_BUNDLED_APP_URL__ : undefined;
}

/**
 * Public origin used for remote host-daemon join commands and Host-header
 * allowlisting on enroll/WS. Trailing slashes are stripped.
 *
 * Precedence: runtime `ZCC_APP_URL` > compile-time bake (`electron-vite` main
 * define from the same env). Settings `publicAppUrl` and the repo
 * `public-app-url` file are not used.
 */
export function resolvePublicAppUrl(input?: {
  env?: NodeJS.ProcessEnv;
  bundledUrl?: string | null;
  /** @deprecated Ignored — pairing does not read Settings. */
  configUrl?: string | null;
  /** @deprecated Ignored — pairing does not read the repo file. */
  cwd?: string;
}): string | undefined {
  const env = input?.env ?? process.env;
  const bundled = input && 'bundledUrl' in input
    ? input.bundledUrl ?? undefined
    : compileTimeAppUrl();
  return parsePublicOrigin(env.ZCC_APP_URL) ?? parsePublicOrigin(bundled);
}

/** Renderer-facing config: public origin from env/bake only; never the relay token. */
export function presentAppConfig<T extends { publicAppUrl?: string; relayToken?: string }>(
  config: T,
  input?: { env?: NodeJS.ProcessEnv; bundledUrl?: string | null }
): T {
  const publicAppUrl = resolvePublicAppUrl({
    env: input?.env,
    bundledUrl: input?.bundledUrl
  });
  if (publicAppUrl === config.publicAppUrl && config.relayToken === undefined) return config;
  return { ...config, publicAppUrl, relayToken: undefined };
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
