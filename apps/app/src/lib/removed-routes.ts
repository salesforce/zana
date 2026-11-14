import { decodeRoutePath } from './decode-route.js';
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
const removedThreads = new Map<string, true>();
const removedSessions = new Map<string, true>();
const listeners = new Set<() => void>();
let version = 0;

function changed(): void {
  version += 1;
  for (const listener of [...listeners]) listener();
}

function add(record: Map<string, true>, ids: Iterable<string>): void {
  let added = false;
  for (const id of ids) {
    if (record.has(id)) continue;
    record.set(id, true);
    added = true;
    // Bounded: drop the oldest ids first.
    if (record.size > MAX_REMOVED_IDS) record.delete(record.keys().next().value as string);
  }
  if (added) changed();
}

export function markThreadsRemoved(ids: Iterable<string>): void {
  add(removedThreads, ids);
}

/** A thread seen live again (restored from the archive, or listed by main). */
export function markThreadsLive(ids: Iterable<string>): void {
  let removed = false;
  for (const id of ids) removed = removedThreads.delete(id) || removed;
  if (removed) changed();
}

export function markSessionsRemoved(ids: Iterable<string>): void {
  add(removedSessions, ids);
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

/** Base for parsing an app route (path + query + hash) with `URL`. */
const ROUTE_PARSE_BASE = 'http://zcc.local';

function decode(path: string) {
  const url = new URL(path, ROUTE_PARSE_BASE);
  return decodeRoutePath(url.pathname, url.hash, url.search);
}

/** True when the route opens a thread or session this window saw removed. */
export function isRemovedRoute(path: string): boolean {
  const { threadId, sessionId } = decode(path);
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
  const projectId = decode(path).focusedProjectId;
  return projectId ? getProjectRoutePath(projectId) : fallback;
}
