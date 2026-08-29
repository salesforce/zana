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
