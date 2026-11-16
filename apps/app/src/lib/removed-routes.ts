import { decodeRouteString } from './decode-route.js';
import { getProjectRoutePath } from './route-paths.js';

/**
 * Threads and CLI-agent sessions this window has seen go away (a thread
 * archived or removed from the roster, a session closed or dismissed), so a
 * remembered return route (Ctrl/Cmd+I, Ctrl/Cmd+, and Back) never lands on a
 * dead page.
 *
 * Positive evidence only: a thread missing from the roster is not "removed"
 * (the roster is capped and leaves hidden threads out), and a session missing
 * from `terminals` may belong to a project whose hydration failed.
 */
const MAX_REMOVED_IDS = 500;
// id → removal stamp (a running count), so a list response can tell a
// removal that happened while it was in flight from an older one.
const removedThreads = new Map<string, number>();
const removedSessions = new Map<string, number>();
const listeners = new Set<() => void>();
let version = 0;
let removalStamp = 0;

function changed(): void {
  version += 1;
  for (const listener of [...listeners]) listener();
}

function add(record: Map<string, number>, ids: Iterable<string>): void {
  let added = false;
  for (const id of ids) {
    if (record.has(id)) continue;
    record.set(id, ++removalStamp);
    added = true;
    // Bounded: drop the oldest ids first.
    if (record.size > MAX_REMOVED_IDS) record.delete(record.keys().next().value as string);
  }
  if (added) changed();
}

export function markThreadsRemoved(ids: Iterable<string>): void {
  add(removedThreads, ids);
}

function clear(record: Map<string, number>, ids: Iterable<string>, listedSince?: number): void {
  let cleared = false;
  for (const id of ids) {
    const stamp = record.get(id);
    if (stamp === undefined) continue;
    // A removal after the list request started wins over its stale response.
    if (listedSince !== undefined && stamp > listedSince) continue;
    record.delete(id);
    cleared = true;
  }
  if (cleared) changed();
}

/** Stamp to take when a list request starts; pass it back as `listedSince`. */
export function getRemovalStamp(): number {
  return removalStamp;
}

/**
 * A thread seen live again: restored from the archive (no `listedSince`), or
 * listed by main in a response to a request started at `listedSince`. A
 * thread removed after that request started stays removed.
 */
export function markThreadsLive(ids: Iterable<string>, listedSince?: number): void {
  clear(removedThreads, ids, listedSince);
}

export function markSessionsRemoved(ids: Iterable<string>): void {
  add(removedSessions, ids);
}

/** A session id seen live again (created or restored under the same id). */
export function markSessionsLive(ids: Iterable<string>): void {
  clear(removedSessions, ids);
}

/** Subscribe to removals, for `useSyncExternalStore`. */
export function subscribeRemovedRoutes(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getRemovedRoutesVersion(): number {
  return version;
}

/** Test-only: forget every removal so files don't leak across workers. */
export function resetRemovedRoutes(): void {
  removedThreads.clear();
  removedSessions.clear();
  changed();
}

/** True when the route opens a thread or session this window saw removed. */
export function isRemovedRoute(path: string): boolean {
  const { threadId, sessionId } = decodeRouteString(path);
  return (
    (threadId != null && removedThreads.has(threadId)) ||
    (sessionId != null && removedSessions.has(sessionId))
  );
}

/**
 * The shared "route still exists" check for every return path. A live route
 * comes back unchanged. A dead thread or session route inside a project falls
 * back to that project's home; a global one falls back to `fallback`.
 */
export function liveRoutePath<T extends string | null>(path: string, fallback: T): string | T {
  if (!isRemovedRoute(path)) return path;
  const projectId = decodeRouteString(path).focusedProjectId;
  return projectId ? getProjectRoutePath(projectId) : fallback;
}
