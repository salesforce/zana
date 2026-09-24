import { createStore } from 'zustand/vanilla';
import type { LaneKey } from '../components/AgentBoard.js';
import type { FleetItem } from '../components/fleet-item.js';

export const BOARD_DONE_DELAY_MS = 60_000;
export const boardItemKey = (item: Pick<FleetItem, 'kind' | 'id'>) => `${item.kind}:${item.id}`;

/** Only these moves are commands; every other lane remains live-status driven. */
export function boardDropAction(item: FleetItem, from: LaneKey, to: LaneKey): 'stop' | 'done' | null {
  if (item.kind === 'schedule' || (item.kind === 'agent' && (
    item.card.session.status === 'exited' || item.card.isSyntheticExecutionHost
    || item.card.session.cohort?.executionId
  ))) return null;
  if (from !== 'blocked' && from !== 'working' && from !== 'idle') return null;
  if (to === 'done') return 'done';
  return to === 'idle' && from !== 'idle' ? 'stop' : null;
}

interface BoardMoveDeps {
  stop(item: FleetItem): Promise<void>;
  close(item: FleetItem): Promise<void>;
  /** Reject a removed/replaced session before a delayed close can act on it. */
  exists(item: FleetItem): boolean;
  onError(error: unknown): void;
}

/** App-owned, so leaving/unmounting the board does not cancel a pending close. */
export function createAgentBoardMoves(deps: BoardMoveDeps) {
  const store = createStore<{ done: Record<string, number>; busy: ReadonlySet<string> }>(() => ({
    done: {}, busy: new Set()
  }));
  const timers = new Map<string, { item: FleetItem; timer: ReturnType<typeof setTimeout> }>();
  let generation = 0;
  function forget(key: string) {
    const pending = timers.get(key);
    if (pending) clearTimeout(pending.timer);
    timers.delete(key);
    store.setState(({ done, busy }) => {
      const next = { ...done };
      delete next[key];
      const remaining = new Set(busy);
      remaining.delete(key);
      return { done: next, busy: remaining };
    });
  }
  return {
    store,
    async move(item: FleetItem, from: LaneKey, to: LaneKey) {
      const action = boardDropAction(item, from, to);
      const key = boardItemKey(item);
      if (!action || store.getState().busy.has(key) || store.getState().done[key] !== undefined || !deps.exists(item)) return;
      const started = generation;
      store.setState(({ busy }) => ({ busy: new Set([...busy, key]) }));
      try {
        // Idle→Done requires no interrupt. Active agents stop immediately,
        // keeping their session/conversation available for the grace period.
        if (from !== 'idle') await deps.stop(item);
        if (started !== generation) return;
        if (action === 'stop' || !deps.exists(item)) {
          forget(key);
          return;
        }
        store.setState(({ done }) => ({ done: { ...done, [key]: Date.now() + BOARD_DONE_DELAY_MS } }));
        const timer = setTimeout(async () => {
          try {
            if (deps.exists(item)) await deps.close(item);
          } catch (error) {
            deps.onError(error);
          } finally {
            if (started === generation) forget(key);
          }
        }, BOARD_DONE_DELAY_MS);
        timers.set(key, { item, timer });
      } catch (error) {
        if (started !== generation) return;
        forget(key);
        deps.onError(error);
      }
    },
    /** Manual close/restart releases that session's pending timer immediately. */
    reconcile() {
      for (const [key, pending] of timers) if (!deps.exists(pending.item)) forget(key);
    },
    /** App shutdown/hot reload releases timers and invalidates in-flight work. */
    dispose() {
      generation++;
      for (const { timer } of timers.values()) clearTimeout(timer);
      timers.clear();
      store.setState({ done: {}, busy: new Set() });
    }
  };
}
