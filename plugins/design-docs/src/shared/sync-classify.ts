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

export interface PeerFault { code: 'enrollment' | 'grant'; hint: string }

/**
 * The likely cause behind a computer's newest error, with advice. Derived from error text only: the plugin cannot see
 * pair state, and the link can read "connected" while the pairing is revoked, so the error is the only evidence.
 */
export function diagnoseFault(message: string | null | undefined): PeerFault | null {
  if (!message) return null;
  if (/enrollment changed|revoked/i.test(message)) {
    return { code: 'enrollment', hint: 'Pairing with this computer was changed or revoked. The link can still show connected, and Sync Now will fail the same way until the two computers are paired again.' };
  }
  if (/peer grant unavailable/i.test(message)) {
    return { code: 'grant', hint: 'This computer was not listed as connected with a grant when the send was tried. Sync Now retries it.' };
  }
  return null;
}

/** A short, fixed code for logs and diagnostics: never the message itself, so nothing secret can ride along. */
export function deliveryReasonCode(message: string | null | undefined): string {
  if (!message) return 'none';
  if (isStageToken(message)) return `stage-${message}`;
  return isOfflineSyncError(message) ? 'offline' : 'error';
}
