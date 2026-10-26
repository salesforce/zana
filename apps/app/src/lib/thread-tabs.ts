/** Window-local navigation history; closing an entry never mutates a thread. */
export interface ThreadTab {
  threadId: string;
  projectId: string;
  projectScoped: boolean;
}

export interface ThreadTabsState {
  open: ThreadTab[];
  closed: ThreadTab[];
}

export const MAX_THREAD_TABS = 40;
const MAX_CLOSED_TABS = 10;
const empty = (): ThreadTabsState => ({ open: [], closed: [] });

function entries(value: unknown, scope: string | null, limit: number): ThreadTab[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter((row): row is ThreadTab => {
    if (!row || typeof row !== 'object') return false;
    if (typeof row.threadId !== 'string' || !row.threadId || row.threadId.length > 512
      || typeof row.projectId !== 'string' || !row.projectId || row.projectId.length > 512
      || typeof row.projectScoped !== 'boolean' || (scope && row.projectId !== scope)
      || seen.has(row.threadId)) return false;
    seen.add(row.threadId);
    return true;
  }).slice(-limit).map(({ threadId, projectId, projectScoped }) => ({ threadId, projectId, projectScoped }));
}

export function readThreadTabs(storage: Pick<Storage, 'getItem'>, scope: string | null): ThreadTabsState {
  try {
    const saved = storage.getItem(threadTabsKey(scope));
    if (saved && saved.length > 128_000) return empty();
    const value = JSON.parse(saved ?? 'null');
    if (!value || typeof value !== 'object') return empty();
    const open = entries(value.open, scope, MAX_THREAD_TABS);
    return { open, closed: entries(value.closed, scope, MAX_CLOSED_TABS).filter(row => !open.some(tab => tab.threadId === row.threadId)) };
  } catch {
    return empty();
  }
}

function threadTabsKey(scope: string | null): string {
  return `zcc.thread-tabs.v1:${scope ?? 'main'}`;
}

export function saveThreadTabs(storage: Pick<Storage, 'setItem'>, scope: string | null, state: ThreadTabsState): void {
  try { storage.setItem(threadTabsKey(scope), JSON.stringify(state)); } catch { /* Navigation works with storage unavailable. */ }
}

export function openThreadTab(state: ThreadTabsState, tab: ThreadTab): ThreadTabsState {
  const existing = state.open.find(row => row.threadId === tab.threadId);
  if (existing?.projectId === tab.projectId && existing.projectScoped === tab.projectScoped) return state;
  return {
    open: (existing ? state.open.map(row => row.threadId === tab.threadId ? tab : row) : [...state.open, tab]).slice(-MAX_THREAD_TABS),
    closed: state.closed.filter(row => row.threadId !== tab.threadId)
  };
}

export function closeThreadTab(state: ThreadTabsState, id: string, remember = true): ThreadTabsState {
  const tab = state.open.find(row => row.threadId === id);
  if (!tab && !state.closed.some(row => row.threadId === id)) return state;
  const closed = state.closed.filter(row => row.threadId !== id);
  return {
    open: state.open.filter(row => row.threadId !== id),
    closed: remember && tab ? [...closed, tab].slice(-MAX_CLOSED_TABS) : closed
  };
}
