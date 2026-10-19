/**
 * Core `peers/join` deep link, renderer side. Main validates the link and pushes
 * `{ route: 'peers/join', payload }`; this module parks the payload for the
 * Settings → Peers view, which PREFILLS the Join computer panel. A link never
 * joins on its own: the user reads the form and presses Join.
 */
import type { CoreDeepLinkDelivery } from '@zana-ai/zcc-desktop-contract';
import { appNavigate } from './app-navigate.js';
import { getSettingsTabRoutePath } from './route-paths.js';

/** How long an unclaimed join payload waits for the Peers view to mount. */
export const PEER_JOIN_PENDING_TTL_MS = 60_000;
const MAX_PAYLOAD = 4096;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0020\u007f-\u009f\u2028\u2029]/;

type Listener = (payload: string) => void;

let pending: { payload: string; expiresAt: number } | null = null;
const listeners = new Set<Listener>();

/** Shape check on a delivery; main already validated, this keeps a hostile renderer message out. */
export function isPeerJoinDelivery(value: unknown): value is CoreDeepLinkDelivery {
  if (!value || typeof value !== 'object') return false;
  const { route, payload } = value as Record<string, unknown>;
  return route === 'peers/join' && typeof payload === 'string' && payload.length > 0 && payload.length <= MAX_PAYLOAD && !CONTROL.test(payload);
}

/** Take the parked payload once (null when none or expired). */
export function takePendingPeerJoin(now: number = Date.now()): string | null {
  const entry = pending;
  pending = null;
  return entry && entry.expiresAt > now ? entry.payload : null;
}

/** Be told of a join payload arriving while the Peers view is mounted. */
export function subscribePeerJoin(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Route one core delivery: park the payload, open Settings → Peers. */
export async function routeCoreDeepLink(delivery: unknown, now: number = Date.now()): Promise<'routed' | 'invalid'> {
  if (!isPeerJoinDelivery(delivery)) return 'invalid';
  if (listeners.size > 0) {
    for (const listener of [...listeners]) listener(delivery.payload);
  } else {
    pending = { payload: delivery.payload, expiresAt: now + PEER_JOIN_PENDING_TTL_MS };
  }
  appNavigate(getSettingsTabRoutePath('peers'));
  return 'routed';
}

/** `<base>peers/join?d=<token>` for the invitation, or null when this build owns no scheme. */
export async function buildPeerJoinLink(token: string): Promise<string | null> {
  const api = typeof window === 'undefined' ? undefined : window.cc?.deepLinks;
  if (!api || !token) return null;
  try {
    const config = await api.config();
    return config?.base ? `${config.base}peers/join?d=${encodeURIComponent(token)}` : null;
  } catch {
    return null;
  }
}

/** Test seam. */
export function resetPeerJoinForTests(): void {
  pending = null;
  listeners.clear();
}
