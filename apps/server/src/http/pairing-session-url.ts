export const RELAY_SESSION_ID_RE = /^zcrs_[A-Za-z0-9_-]{16,64}$/;

export function isRelaySessionId(value: string | null | undefined): value is string {
  return typeof value === 'string' && RELAY_SESSION_ID_RE.test(value);
}

export function pairingSessionServerUrl(origin: string, sessionId: string): string {
  return `${origin.replace(/\/$/u, '')}/t/${sessionId}`;
}

export type PairingRelaySnapshot = {
  state: 'connected' | 'offline' | 'unconfigured';
  sessionId?: string;
  joinUntil?: number;
};

export function relayJoinWindowOpen(snapshot: PairingRelaySnapshot | null | undefined, now = Date.now()): boolean {
  if (!snapshot || snapshot.state !== 'connected' || !isRelaySessionId(snapshot.sessionId)) return false;
  if (typeof snapshot.joinUntil !== 'number' || !Number.isFinite(snapshot.joinUntil)) return false;
  return snapshot.joinUntil > now;
}

/** Renew this far before `joinUntil` so the door never reaches a hard close. */
export const JOIN_KEEPALIVE_LEAD_MS = 60_000;
export const JOIN_KEEPALIVE_FLOOR_MS = 5_000;
export const JOIN_KEEPALIVE_MIN_MS = 250;

export function joinKeepaliveDelayMs(joinUntil: number | undefined, now = Date.now()): number {
  if (typeof joinUntil !== 'number' || !Number.isFinite(joinUntil)) return JOIN_KEEPALIVE_FLOOR_MS;
  const remaining = joinUntil - now;
  if (remaining <= JOIN_KEEPALIVE_MIN_MS) return JOIN_KEEPALIVE_FLOOR_MS;
  const withLead = remaining - JOIN_KEEPALIVE_LEAD_MS;
  if (withLead >= JOIN_KEEPALIVE_FLOOR_MS) return withLead;
  return Math.max(JOIN_KEEPALIVE_MIN_MS, Math.min(JOIN_KEEPALIVE_FLOOR_MS, Math.floor(remaining / 2)));
}
