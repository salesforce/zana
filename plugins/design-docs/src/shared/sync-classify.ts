/**
 * One classification of a queued delivery, shared by the server (status, CLI counts) and the app, so the CLI
 * and the UI can never disagree about `failed` versus `waiting`.
 */

/** Longest stored or shown delivery error. */
export const MAX_SYNC_ERROR_LENGTH = 300;

/** A failed delivery that only means the other computer was not reachable; it is retried on its own. */
export function isOfflineSyncError(message: string): boolean {
  return /unavailable|timed? ?out|not connected|disconnect|ECONN|ENOTFOUND|EHOSTUNREACH|authorization changed/i.test(message);
}

/** Receipt stages stored as the "reason" when the other computer answered but did not finish: not errors. */
const STAGE_TOKENS = new Set(['received', 'merged', 'synced', 'conflict', 'blocked']);

export function isStageToken(message: string | null | undefined): boolean {
  return !!message && STAGE_TOKENS.has(message);
}

/** `failed` only for a real, non-offline error; no error, a stage token or an offline error is `waiting`. */
export function classifyDelivery(message: string | null | undefined): 'waiting' | 'failed' {
  if (!message || isStageToken(message)) return 'waiting';
  return isOfflineSyncError(message) ? 'waiting' : 'failed';
}

/** Redacts credentials and query strings, collapses whitespace and truncates; safe to store, log and show. */
export function boundSyncError(message: string): string {
  const clean = message
    .replace(/\b(authorization|proxy-authorization)\b\s*[:=]\s*(?:bearer|basic)?\s*[^\s,;"']+/gi, '$1: [redacted]')
    .replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, '$1 [redacted]')
    .replace(/\b(token|access_token|refresh_token|api[_-]?key|secret|password|passwd|signature|sig)\b(["']?\s*[:=]\s*["']?)[^\s&,;"']+/gi, '$1$2[redacted]')
    .replace(/\?[^\s"')]*/g, '?[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > MAX_SYNC_ERROR_LENGTH ? `${clean.slice(0, MAX_SYNC_ERROR_LENGTH - 1)}…` : clean;
}

/** A short, fixed code for logs and diagnostics: never the message itself, so nothing secret can ride along. */
export function deliveryReasonCode(message: string | null | undefined): string {
  if (!message) return 'none';
  if (isStageToken(message)) return `stage-${message}`;
  return isOfflineSyncError(message) ? 'offline' : 'error';
}
