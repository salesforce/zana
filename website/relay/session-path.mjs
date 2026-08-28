import { randomBytes } from 'node:crypto';
import { normalizePairingPath } from './allowlist.mjs';

export const RELAY_SESSION_PREFIX = 'zcrs_';
export const RELAY_SESSION_ID_RE = /^zcrs_[A-Za-z0-9_-]{16,64}$/;
export const DEFAULT_JOIN_TTL_MS = 5 * 60 * 1000;
export const MAX_RELAY_SESSIONS = 32;

const SESSION_PATH_RE = /^\/t\/(zcrs_[A-Za-z0-9_-]{16,64})(\/.*)?$/;

export function mintRelaySessionId() {
  return `${RELAY_SESSION_PREFIX}${randomBytes(18).toString('base64url')}`;
}

export function isRelaySessionId(value) {
  return typeof value === 'string' && RELAY_SESSION_ID_RE.test(value);
}

/**
 * @param {string} pathname
 * @returns {{ sessionId: string, rest: string } | null}
 */
export function parseRelaySessionPath(pathname) {
  const path = normalizePairingPath(pathname);
  const match = SESSION_PATH_RE.exec(path);
  if (!match) return null;
  const rest = match[2] && match[2].length > 0 ? match[2] : '/';
  return { sessionId: match[1], rest: normalizePairingPath(rest) };
}

export function isJoinHttp(method, pathname) {
  const path = normalizePairingPath(pathname);
  const verb = (method ?? 'GET').toUpperCase();
  if (verb === 'GET' || verb === 'HEAD') {
    return path === '/install.sh' || path === '/install/version' || path === '/install/zcc-host.tgz';
  }
  return verb === 'POST' && path === '/internal/hosts/enroll';
}

export function pairingSessionServerUrl(origin, sessionId) {
  const base = String(origin ?? '').replace(/\/$/u, '');
  return `${base}/t/${sessionId}`;
}

export function resolveJoinTtlMs(input = {}) {
  if (typeof input.override === 'number' && Number.isFinite(input.override) && input.override > 0) {
    return Math.max(1_000, Math.min(input.override, 15 * 60 * 1000));
  }
  const raw = Number(input.env?.ZCC_RELAY_JOIN_TTL_MS);
  if (Number.isFinite(raw) && raw > 0) return Math.max(1_000, Math.min(raw, 15 * 60 * 1000));
  return DEFAULT_JOIN_TTL_MS;
}

export function resolveMaxSessions(input = {}) {
  if (typeof input.override === 'number' && Number.isFinite(input.override) && input.override > 0) {
    return Math.max(1, Math.min(Math.round(input.override), 256));
  }
  const raw = Number(input.env?.ZCC_RELAY_MAX_SESSIONS);
  if (Number.isFinite(raw) && raw > 0) return Math.max(1, Math.min(Math.round(raw), 256));
  return MAX_RELAY_SESSIONS;
}
