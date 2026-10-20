/**
 * A thread view window shows one thread and its side panel in its own OS
 * window. Main loads it with `?surface=thread-view&threadId[&projectId]`. A
 * thread's `projectId` also makes it a scoped window (see windowScope.ts); a
 * thread with no project is not scoped, so main-window duties such as session
 * restore check {@link isThreadViewSurface} too.
 *
 * The target is read once and remembered in `sessionStorage`, so a reload that
 * drops the query still shows the same thread. Like window scope, this is a
 * display choice, not a security boundary: main authorizes the window.
 */
export type ThreadViewSurfaceTarget = { threadId: string; projectId?: string };

const STORAGE_KEY = 'zcc.threadViewTarget';
const THREAD_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

export function parseThreadViewSearch(search: string): ThreadViewSurfaceTarget | null {
  const params = new URLSearchParams(search);
  if (params.get('surface') !== 'thread-view') return null;
  return parseTarget({ threadId: params.get('threadId'), projectId: params.get('projectId') });
}

function parseTarget(value: unknown): ThreadViewSurfaceTarget | null {
  if (!value || typeof value !== 'object') return null;
  const { threadId, projectId } = value as Record<string, unknown>;
  if (typeof threadId !== 'string' || !THREAD_ID.test(threadId)) return null;
  if (typeof projectId === 'string' && projectId.trim()) return { threadId, projectId };
  return { threadId };
}

function readThreadViewTarget(): ThreadViewSurfaceTarget | null {
  if (typeof window === 'undefined') return null;
  try {
    const fromQuery = parseThreadViewSearch(window.location.search);
    if (fromQuery) {
      try {
        window.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(fromQuery));
      } catch {
        /* storage unavailable: the query still applies to this load */
      }
      return fromQuery;
    }
    const stored = window.sessionStorage?.getItem(STORAGE_KEY);
    return stored ? parseTarget(JSON.parse(stored)) : null;
  } catch {
    return null;
  }
}

const target = readThreadViewTarget();

/** The thread this window shows, or `null` outside a thread view window. */
export function getThreadViewTarget(): ThreadViewSurfaceTarget | null {
  return target;
}

export function isThreadViewSurface(): boolean {
  return target !== null;
}
