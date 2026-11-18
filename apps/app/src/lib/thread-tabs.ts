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
export const MAX_CLOSED_TABS = 10;
/** Plugin-contributed tabs are bounded separately so they never displace conversations. */
export const MAX_PLUGIN_TABS = 20;
export const MAX_PLUGIN_TABS_PER_PLUGIN = 10;
/** Serialized plugin rows stay far below the 128,000-char restore limit that wipes everything. */
export const MAX_PLUGIN_ROWS_CHARS = 100_000;
export const MAX_PLUGIN_TITLE_CHARS = 120;
export const MAX_PLUGIN_ITEM_KEY_CHARS = 256;
export const MAX_PLUGIN_ICON_CHARS = 32;
const empty = (): ThreadTabsState => ({ open: [], closed: [] });

/** Validates one persisted thread row; returns a normalized copy or null. */
export function parseThreadTab(row: unknown, scope: string | null): ThreadTab | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (typeof r.threadId !== 'string' || !r.threadId || r.threadId.length > 512
    || typeof r.projectId !== 'string' || !r.projectId || r.projectId.length > 512
    || typeof r.projectScoped !== 'boolean' || (scope && r.projectId !== scope)) return null;
  return { threadId: r.threadId, projectId: r.projectId, projectScoped: r.projectScoped };
}

function entries(value: unknown, scope: string | null, limit: number): ThreadTab[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rows: ThreadTab[] = [];
  for (const row of value) {
    const tab = parseThreadTab(row, scope);
    if (!tab || seen.has(tab.threadId)) continue;
    seen.add(tab.threadId);
    rows.push(tab);
  }
  return rows.slice(-limit);
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
