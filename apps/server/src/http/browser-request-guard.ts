import { isLoopbackHttpHost } from '../browser-bootstrap.js';
import { buildLocalAppOrigins, type LocalAppOriginArgs } from './local-app-origins.js';

export interface BrowserRequestGuardDeps {
  config: LocalAppOriginArgs;
}

export interface BrowserRequestProblem {
  status: 403 | 415 | 400;
  error: string;
}

interface BrowserRequestGuardOptions {
  requireJsonForMutation?: boolean;
}

interface BrowserRequestContext {
  req: {
    url: string;
    method: string;
    header(name: string): string | undefined;
  };
}

function allowedAppOrigins(deps: BrowserRequestGuardDeps): Set<string> {
  return buildLocalAppOrigins(deps.config);
}

function knownAppPorts(deps: BrowserRequestGuardDeps): Set<number> {
  const ports = new Set<number>([deps.config.serverPort]);
  if (deps.config.devAppPort !== undefined) ports.add(deps.config.devAppPort);
  return ports;
}

function effectivePort(url: URL): number | null {
  if (url.port.length > 0) {
    const port = Number(url.port);
    return Number.isInteger(port) ? port : null;
  }
  if (url.protocol === 'http:') return 80;
  if (url.protocol === 'https:') return 443;
  return null;
}

function parseRequestHost(host: string, protocol: string): URL | null {
  try {
    const url = new URL(`${protocol}//${host}`);
    return url.username.length === 0 &&
      url.password.length === 0 &&
      url.pathname === '/' &&
      url.search.length === 0 &&
      url.hash.length === 0
      ? url
      : null;
  } catch {
    return null;
  }
}

function requestTargets(context: BrowserRequestContext): URL[] {
  const requestUrl = new URL(context.req.url, 'http://127.0.0.1');
  const targets = [requestUrl];
  const forwardedProtocol =
    context.req.header('x-forwarded-proto')?.split(',', 1)[0]?.trim() ||
    requestUrl.protocol.replace(/:$/u, '');

  for (const rawHost of [
    context.req.header('host'),
    context.req.header('x-forwarded-host')?.split(',', 1)[0]?.trim()
  ]) {
    if (rawHost === undefined || rawHost.length === 0) continue;
    const target = parseRequestHost(rawHost, `${forwardedProtocol}:`);
    if (target !== null) targets.push(target);
  }
  return targets;
}

function isTrustedOrigin(
  context: BrowserRequestContext,
  deps: BrowserRequestGuardDeps,
  origin: string
): boolean {
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  if (
    originUrl.origin !== origin ||
    (originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:')
  ) {
    return false;
  }

  if (allowedAppOrigins(deps).has(originUrl.origin)) return true;

  const targets = requestTargets(context);
  if (targets.some((target) => target.origin === originUrl.origin)) return true;

  const originPort = effectivePort(originUrl);
  if (originPort === null || !knownAppPorts(deps).has(originPort)) return false;

  return targets.some((target) => target.hostname === originUrl.hostname);
}

function isJsonContentType(contentType: string | undefined): boolean {
  return contentType?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json';
}

/**
 * Guards privileged local-browser boundaries without imposing credentials on
 * non-browser clients. Browsers send Origin; CLI and server-to-server callers
 * commonly do not. A foreign Origin is always denied. Loopback Host is required
 * so the listener cannot be used as a DNS-rebinding oracle.
 */
export function browserRequestProblem(
  context: BrowserRequestContext,
  deps: BrowserRequestGuardDeps,
  options: BrowserRequestGuardOptions = {}
): BrowserRequestProblem | null {
  const host = context.req.header('host');
  if (!isLoopbackHttpHost(host)) {
    return { status: 403, error: 'host is not a loopback app origin' };
  }

  const origin = context.req.header('origin');
  if (origin !== undefined && origin.length > 0 && !isTrustedOrigin(context, deps, origin)) {
    return {
      status: 403,
      error: `origin "${origin}" is not a local app origin`
    };
  }

  const method = context.req.method.toUpperCase();
  if (
    options.requireJsonForMutation === true &&
    method !== 'GET' &&
    method !== 'HEAD' &&
    method !== 'OPTIONS' &&
    !isJsonContentType(context.req.header('content-type'))
  ) {
    return {
      status: 415,
      error: 'content-type must be application/json'
    };
  }

  return null;
}

export function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}
