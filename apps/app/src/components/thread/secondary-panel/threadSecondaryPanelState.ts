import type { JsonValue } from '@zana-ai/zcc-domain/thread-runtime';

export const SECONDARY_PANEL_STORAGE_PREFIX = 'zcc.secondaryPanel.';
export const LEGACY_THREAD_STORAGE_PREFIX = 'zcc.thread.secondaryPanel.';
export const SECONDARY_PANEL_DEFAULT_WIDTH_PX = 352;
export const SECONDARY_PANEL_MIN_WIDTH_PX = 288;
export const SECONDARY_PANEL_MAX_WIDTH_RATIO = 0.7;

export type PinnedSecondaryView = 'info' | 'diff' | 'plan';

export type ClosableSecondaryTabKind =
  | 'new-tab'
  | 'file-preview'
  | 'storage-preview'
  | 'browser'
  | 'terminal'
  | 'explorer'
  | 'plugin';

export interface ClosableSecondaryTab {
  id: string;
  kind: ClosableSecondaryTabKind;
  title: string;
  path?: string;
  url?: string;
  sessionId?: string;
  moduleId?: string;
  actionId?: string;
  pluginId?: string;
  params?: JsonValue | null;
  layout?: 'padded' | 'flush';
  openerKey?: string | null;
  automationTargetId?: string | null;
}

export interface ThreadSecondaryPanelState {
  version: 1;
  isOpen: boolean;
  isMaximized: boolean;
  widthPx: number;
  activeId: string;
  tabs: ClosableSecondaryTab[];
}

export const INFO_PIN_ID = 'info';
export const DIFF_PIN_ID = 'diff';
export const PLAN_PIN_ID = 'plan';

export function emptySecondaryPanelState(options?: { isOpen?: boolean }): ThreadSecondaryPanelState {
  return {
    version: 1,
    isOpen: options?.isOpen === true,
    isMaximized: false,
    widthPx: SECONDARY_PANEL_DEFAULT_WIDTH_PX,
    activeId: INFO_PIN_ID,
    tabs: []
  };
}

export function storageKeyForOwner(ownerId: string): string {
  return `${SECONDARY_PANEL_STORAGE_PREFIX}${ownerId}`;
}

export function storageKeyForThread(threadId: string): string {
  return storageKeyForOwner(threadId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonValue(value: unknown): JsonValue | null {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return null;
  }
}

function isTabKind(value: unknown): value is ClosableSecondaryTabKind {
  return (
    value === 'new-tab'
    || value === 'file-preview'
    || value === 'storage-preview'
    || value === 'browser'
    || value === 'terminal'
    || value === 'explorer'
    || value === 'plugin'
  );
}

function parseTab(value: unknown): ClosableSecondaryTab | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !isTabKind(value.kind)) return null;
  if (typeof value.title !== 'string') return null;
  return {
    id: value.id,
    kind: value.kind,
    title: value.title,
    ...(typeof value.path === 'string' ? { path: value.path } : {}),
    ...(typeof value.url === 'string' ? { url: value.url } : {}),
    ...(typeof value.sessionId === 'string' ? { sessionId: value.sessionId } : {}),
    ...(typeof value.moduleId === 'string' ? { moduleId: value.moduleId } : {}),
    ...(typeof value.actionId === 'string' ? { actionId: value.actionId } : {}),
    ...(typeof value.pluginId === 'string' ? { pluginId: value.pluginId } : {}),
    ...(value.layout === 'padded' || value.layout === 'flush' ? { layout: value.layout } : {}),
    ...(value.openerKey === null || typeof value.openerKey === 'string' ? { openerKey: value.openerKey } : {}),
    ...(value.automationTargetId === null || typeof value.automationTargetId === 'string'
      ? { automationTargetId: value.automationTargetId }
      : {}),
    ...('params' in value ? { params: parseJsonValue(value.params) } : {})
  };
}

export function parseSecondaryPanelState(raw: unknown): ThreadSecondaryPanelState {
  const fallback = emptySecondaryPanelState();
  if (!isRecord(raw) || raw.version !== 1) return fallback;
  const tabs = Array.isArray(raw.tabs)
    ? raw.tabs.map(parseTab).filter((tab): tab is ClosableSecondaryTab => tab !== null)
    : [];
  const activeId = typeof raw.activeId === 'string' ? raw.activeId : INFO_PIN_ID;
  const known = new Set<string>([INFO_PIN_ID, DIFF_PIN_ID, PLAN_PIN_ID, ...tabs.map((tab) => tab.id)]);
  return {
    version: 1,
    isOpen: raw.isOpen === true,
    isMaximized: raw.isMaximized === true,
    widthPx: clampWidth(typeof raw.widthPx === 'number' ? raw.widthPx : fallback.widthPx),
    activeId: known.has(activeId) ? activeId : INFO_PIN_ID,
    tabs
  };
}

export function clampWidth(widthPx: number, containerWidthPx = 1200): number {
  const max = Math.max(
    SECONDARY_PANEL_MIN_WIDTH_PX,
    Math.floor(containerWidthPx * SECONDARY_PANEL_MAX_WIDTH_RATIO)
  );
  return Math.min(max, Math.max(SECONDARY_PANEL_MIN_WIDTH_PX, Math.round(widthPx)));
}

function readStoredPanelRaw(ownerId: string): string | null {
  return localStorage.getItem(storageKeyForOwner(ownerId))
    ?? localStorage.getItem(`${LEGACY_THREAD_STORAGE_PREFIX}${ownerId}`);
}

export function loadSecondaryPanelState(
  ownerId: string,
  fallback: ThreadSecondaryPanelState = emptySecondaryPanelState()
): ThreadSecondaryPanelState {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = readStoredPanelRaw(ownerId);
    if (!raw) return fallback;
    return parseSecondaryPanelState(JSON.parse(raw) as unknown);
  } catch {
    return fallback;
  }
}

export function persistSecondaryPanelState(ownerId: string, state: ThreadSecondaryPanelState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKeyForOwner(ownerId), JSON.stringify(state));
  } catch {
    /* quota / private mode */
  }
}

export function uniqueTabSuffix(randomUUID?: () => string): string {
  return typeof randomUUID === 'function'
    ? randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function restoreSecondaryPanel(
  ownerId: string | undefined,
  options?: { defaultOpen?: boolean }
): ThreadSecondaryPanelState {
  const fallback = emptySecondaryPanelState({ isOpen: options?.defaultOpen === true });
  return loadSecondaryPanelState(ownerId ?? 'pending', fallback);
}

export function persistSecondaryPanel(
  ownerId: string | undefined,
  state: ThreadSecondaryPanelState
): void {
  if (!ownerId) return;
  persistSecondaryPanelState(ownerId, state);
}

export function restoreIfThread(threadId: string | undefined): ThreadSecondaryPanelState {
  return restoreSecondaryPanel(threadId);
}

export function persistIfThread(threadId: string | undefined, state: ThreadSecondaryPanelState): void {
  persistSecondaryPanel(threadId, state);
}

function mintTabId(kind: ClosableSecondaryTabKind): string {
  return `${kind}:${uniqueTabSuffix(globalThis.crypto?.randomUUID?.bind(globalThis.crypto))}`;
}

function stableParams(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return 'null';
  }
}

export function openSecondaryPanel(state: ThreadSecondaryPanelState): ThreadSecondaryPanelState {
  return { ...state, isOpen: true };
}

export function closeSecondaryPanel(state: ThreadSecondaryPanelState): ThreadSecondaryPanelState {
  return { ...state, isOpen: false, isMaximized: false };
}

export function toggleSecondaryPanelMaximized(state: ThreadSecondaryPanelState): ThreadSecondaryPanelState {
  if (!state.isOpen) return { ...state, isOpen: true, isMaximized: true };
  return { ...state, isMaximized: !state.isMaximized };
}

export function selectPinnedView(
  state: ThreadSecondaryPanelState,
  pin: PinnedSecondaryView
): ThreadSecondaryPanelState {
  return { ...state, isOpen: true, activeId: pin };
}

export function setSecondaryPanelWidth(
  state: ThreadSecondaryPanelState,
  widthPx: number,
  containerWidthPx?: number
): ThreadSecondaryPanelState {
  return { ...state, widthPx: clampWidth(widthPx, containerWidthPx) };
}

export function addClosableTab(
  state: ThreadSecondaryPanelState,
  input: Omit<ClosableSecondaryTab, 'id'> & { id?: string }
): ThreadSecondaryPanelState {
  const existing = matchExistingTab(state.tabs, input);
  if (existing) {
    return { ...state, isOpen: true, activeId: existing.id };
  }
  const tab: ClosableSecondaryTab = {
    ...input,
    id: input.id ?? mintTabId(input.kind)
  };
  const tabs = replaceConsumedNewTab(state, tab);
  return { ...state, isOpen: true, activeId: tab.id, tabs };
}

function matchExistingTab(
  tabs: ClosableSecondaryTab[],
  input: Omit<ClosableSecondaryTab, 'id'> & { id?: string }
): ClosableSecondaryTab | undefined {
  return tabs.find((tab) => {
    if (tab.kind !== input.kind) return false;
    if (input.kind === 'explorer') return true;
    if (input.kind === 'file-preview' || input.kind === 'storage-preview') return tab.path === input.path;
    if (input.kind === 'terminal') return tab.sessionId === input.sessionId;
    if (input.kind === 'plugin') {
      if (input.actionId) {
        return (
          tab.moduleId === input.moduleId
          && tab.actionId === input.actionId
          && stableParams(tab.params) === stableParams(input.params)
        );
      }
      return tab.moduleId === input.moduleId && !tab.actionId;
    }
    if (input.kind === 'browser') return tab.url === input.url && Boolean(input.url);
    return false;
  });
}

function replaceConsumedNewTab(
  state: ThreadSecondaryPanelState,
  next: ClosableSecondaryTab
): ClosableSecondaryTab[] {
  if (next.kind === 'new-tab') return [...state.tabs, next];
  const active = state.tabs.find((tab) => tab.id === state.activeId);
  if (active?.kind === 'new-tab') {
    return state.tabs.map((tab) => (tab.id === active.id ? next : tab));
  }
  return [...state.tabs, next];
}

export function closeClosableTab(
  state: ThreadSecondaryPanelState,
  tabId: string
): ThreadSecondaryPanelState {
  const tabs = state.tabs.filter((tab) => tab.id !== tabId);
  if (state.activeId !== tabId) return { ...state, tabs };
  return { ...state, tabs, activeId: INFO_PIN_ID };
}

export function activateClosableTab(
  state: ThreadSecondaryPanelState,
  tabId: string
): ThreadSecondaryPanelState {
  if (!state.tabs.some((tab) => tab.id === tabId)) return state;
  return { ...state, isOpen: true, activeId: tabId };
}

export function patchClosableTab(
  state: ThreadSecondaryPanelState,
  tabId: string,
  patch: Partial<Omit<ClosableSecondaryTab, 'id' | 'kind'>>
): ThreadSecondaryPanelState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab))
  };
}

export function openNewTab(state: ThreadSecondaryPanelState): ThreadSecondaryPanelState {
  return addClosableTab(state, { kind: 'new-tab', title: 'New Tab' });
}

export function activePinnedView(state: ThreadSecondaryPanelState): PinnedSecondaryView | null {
  if (state.activeId === INFO_PIN_ID) return 'info';
  if (state.activeId === DIFF_PIN_ID) return 'diff';
  if (state.activeId === PLAN_PIN_ID) return 'plan';
  return null;
}

export function activeClosableTab(state: ThreadSecondaryPanelState): ClosableSecondaryTab | null {
  return state.tabs.find((tab) => tab.id === state.activeId) ?? null;
}
