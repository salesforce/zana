import { useRealtime } from '@zana-ai/zcc-plugin-sdk/app';
import { CONTEXT_CHANGED_CHANNEL } from '../../lib/studio-contract.js';

/** The in-window event every org-context listener already handles. */
export const CONTEXT_CHANGED_EVENT = 'sf:context-changed';

/** Names this window on context RPCs (`origin`) so it can skip the signal for its own change. */
export const CONTEXT_ORIGIN = `w${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;

const RELAYED_CAP = 32;
const relayed: string[] = [];

export function announceContextChanged(projectId: string | null): void {
  window.dispatchEvent(new CustomEvent(CONTEXT_CHANGED_EVENT, { detail: { projectId } }));
}

/**
 * Turns another window's org-context change into this window's event, so a
 * Studio window and the main window stay on the same org. Several surfaces in
 * one window may mount it; each change is relayed once.
 */
export function relayContextChange(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const change = payload as { projectId?: unknown; changeId?: unknown; origin?: unknown };
  if (change.origin === CONTEXT_ORIGIN) return false;
  if (typeof change.changeId === 'string') {
    if (relayed.includes(change.changeId)) return false;
    relayed.push(change.changeId);
    if (relayed.length > RELAYED_CAP) relayed.shift();
  }
  announceContextChanged(typeof change.projectId === 'string' ? change.projectId : null);
  return true;
}

export function useContextChangeRelay(): void {
  useRealtime(CONTEXT_CHANGED_CHANNEL, relayContextChange);
}
