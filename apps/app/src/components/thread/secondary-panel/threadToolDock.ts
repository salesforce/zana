import type { PinnedSecondaryView, ThreadSecondaryPanelState } from './threadSecondaryPanelState.js';

export type ToolDockSide = 'right' | 'bottom';
export const DOCK_PINNED_VIEWS: readonly PinnedSecondaryView[] = ['info', 'diff', 'plan'];
export const isDockPinnedView = (id: string): id is PinnedSecondaryView => DOCK_PINNED_VIEWS.some(pin => pin === id);
export interface ThreadToolDock {
  bottomIds: string[];
  bottomActiveId: string | null;
  rightActiveId: string;
  heightPx: number;
  collapsed: boolean;
  maximized: boolean;
}
export const TOOL_DOCK_STORAGE_KEY = 'zcc.thread-tool-docks.v1';
const MAX_OWNERS = 64;
const MAX_STORAGE_CHARS = 262144;
export const emptyToolDock = (): ThreadToolDock => ({ bottomIds: [], bottomActiveId: null, rightActiveId: 'info', heightPx: 240, collapsed: false, maximized: false });
export const clampDockHeight = (height: number) => Math.max(120, Math.min(480, Number.isFinite(height) ? Math.round(height) : 240));

export function parseToolDock(raw: unknown): ThreadToolDock {
  const fallback = emptyToolDock();
  if (!raw || typeof raw !== 'object') return fallback;
  const row = raw as Record<string, unknown>;
  return {
    bottomIds: Array.isArray(row.bottomIds) ? [...new Set(row.bottomIds.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 512))].slice(0, 100) : [],
    bottomActiveId: typeof row.bottomActiveId === 'string' ? row.bottomActiveId : null,
    rightActiveId: typeof row.rightActiveId === 'string' ? row.rightActiveId : 'info',
    heightPx: clampDockHeight(typeof row.heightPx === 'number' ? row.heightPx : 240),
    collapsed: row.collapsed === true,
    maximized: false // Maximize is transient; reopen into the usable arrangement.
  };
}

type StoredDocks = Array<{ owner: string; dock: ThreadToolDock }>;
function readDocks(storage: Pick<Storage, 'getItem'>): StoredDocks {
  try {
    const raw = storage.getItem(TOOL_DOCK_STORAGE_KEY);
    if (!raw || raw.length > MAX_STORAGE_CHARS) return [];
    const rows: unknown = JSON.parse(raw);
    if (!Array.isArray(rows)) return [];
    return rows.slice(-MAX_OWNERS).flatMap(row => row && typeof row.owner === 'string' && row.owner.length <= 512
      ? [{ owner: row.owner, dock: parseToolDock(row.dock) }] : []);
  } catch { return []; }
}
export function loadToolDock(owner: string, storage?: Pick<Storage, 'getItem'>, initialActiveId = 'info'): ThreadToolDock {
  const fallback = () => ({ ...emptyToolDock(), rightActiveId: initialActiveId });
  try { return readDocks(storage ?? localStorage).find(row => row.owner === owner)?.dock ?? fallback(); }
  catch { return fallback(); }
}
export function saveToolDock(owner: string, dock: ThreadToolDock, storage?: Pick<Storage, 'getItem' | 'setItem'>): void {
  try {
    if (!owner || owner.length > 512) return;
    const target = storage ?? localStorage;
    const rows = readDocks(target).filter(row => row.owner !== owner);
    rows.push({ owner, dock: parseToolDock(dock) });
    let bounded = rows.slice(-MAX_OWNERS);
    while (JSON.stringify(bounded).length > MAX_STORAGE_CHARS) bounded = bounded.slice(1);
    target.setItem(TOOL_DOCK_STORAGE_KEY, JSON.stringify(bounded));
  } catch { /* Keep the current arrangement usable when storage is unavailable. */ }
}

export function resolveToolDock(dock: ThreadToolDock, state: ThreadSecondaryPanelState, availablePins = DOCK_PINNED_VIEWS) {
  const bottomTabs = state.tabs.filter(tab => dock.bottomIds.includes(tab.id));
  const rightTabs = state.tabs.filter(tab => !dock.bottomIds.includes(tab.id));
  const bottomPins = availablePins.filter(id => dock.bottomIds.includes(id));
  const rightPins = availablePins.filter(id => !dock.bottomIds.includes(id));
  const rightActiveId = dock.rightActiveId;
  const knownRight = [...rightPins, ...rightTabs.map(tab => tab.id)];
  const knownBottom = [...bottomPins, ...bottomTabs.map(tab => tab.id)];
  return {
    rightPins,
    bottomPins,
    right: { ...state, tabs: rightTabs, activeId: knownRight.includes(rightActiveId) ? rightActiveId : knownRight[0] ?? '' },
    bottom: { ...state, tabs: bottomTabs, activeId: knownBottom.includes(dock.bottomActiveId ?? '') ? dock.bottomActiveId! : knownBottom[0] ?? '', isOpen: knownBottom.length > 0, isMaximized: dock.maximized }
  };
}

export function moveDockTab(dock: ThreadToolDock, state: ThreadSecondaryPanelState, id: string, side: ToolDockSide): ThreadToolDock {
  if (!isDockPinnedView(id) && !state.tabs.some(tab => tab.id === id)) return dock;
  if (side === 'bottom') {
    const { right, rightPins } = resolveToolDock(dock, state);
    const selectedRight = right.activeId === id || (!dock.bottomIds.includes(id) && state.activeId === id);
    return { ...dock, bottomIds: [...new Set([...dock.bottomIds, id])], bottomActiveId: id, rightActiveId: selectedRight ? right.tabs.find(tab => tab.id !== id)?.id ?? rightPins.find(pin => pin !== id) ?? '' : right.activeId, collapsed: false, maximized: false };
  }
  return { ...dock, bottomIds: dock.bottomIds.filter(tabId => tabId !== id), rightActiveId: id, maximized: false };
}
