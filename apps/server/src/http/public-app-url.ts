import { isLoopbackHttpHost } from '../browser-bootstrap.js';
import { headerValue } from './browser-request-guard.js';
import type { IncomingMessage } from 'node:http';

/**
 * Public origin used for remote host-daemon join commands and Host-header
 * allowlisting on enroll/WS. Env wins so a Tailscale Serve URL can be injected
 * without rewriting config.json. Trailing slashes are stripped.
 */
export function resolvePublicAppUrl(input?: {
  env?: NodeJS.ProcessEnv;
  configUrl?: string | null;
}): string | undefined {
  const env = input?.env ?? process.env;
  const fromEnv = env.ZCC_APP_URL?.trim();
  const fromConfig = input?.configUrl?.trim();
  const raw = (fromEnv && fromEnv.length > 0 ? fromEnv : fromConfig) || undefined;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
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
 * configured public origin (Tailscale Serve). DNS-rebinding Host headers that
 * match neither are refused.
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
