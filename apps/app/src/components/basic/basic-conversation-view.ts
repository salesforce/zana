import { create } from 'zustand';

/**
 * Basic sidebar view options: how conversations are sorted and which ones are
 * shown. Stored locally (shared by every window); never synced to AppConfig.
 */
export const BASIC_CONVERSATION_VIEW_KEY = 'zana.basicSidebar.conversationView';

export type BasicConversationSort = 'activity' | 'created' | 'title';
export type BasicConversationStatus = 'active' | 'archived' | 'all';
export type BasicConversationWindow = 'all' | 'day' | 'week' | 'month';

export interface BasicConversationView {
  sort: BasicConversationSort;
  status: BasicConversationStatus;
  window: BasicConversationWindow;
  /** Show conversations a plugin or automation created (bots, routines). */
  automations: boolean;
}

export const DEFAULT_BASIC_CONVERSATION_VIEW: BasicConversationView = Object.freeze({
  sort: 'activity', status: 'active', window: 'all', automations: true
});

export const BASIC_CONVERSATION_SORTS: ReadonlyArray<readonly [BasicConversationSort, string]> = [
  ['activity', 'Last activity'], ['created', 'Created'], ['title', 'Title']
];
export const BASIC_CONVERSATION_STATUSES: ReadonlyArray<readonly [BasicConversationStatus, string]> = [
  ['active', 'Active'], ['archived', 'Archived'], ['all', 'All']
];
export const BASIC_CONVERSATION_WINDOWS: ReadonlyArray<readonly [BasicConversationWindow, string]> = [
  ['all', 'All'], ['day', 'Today'], ['week', 'Last 7 days'], ['month', 'Last 30 days']
];

const DAY = 24 * 60 * 60 * 1000;
/** Oldest last-activity time a window keeps, or null for no limit. */
export function windowCutoff(window: BasicConversationWindow, now: number): number | null {
  if (window === 'day') return now - DAY;
  if (window === 'week') return now - 7 * DAY;
  if (window === 'month') return now - 30 * DAY;
  return null;
}

function pick<T extends string>(value: unknown, options: ReadonlyArray<readonly [T, string]>, fallback: T): T {
  return options.some(([id]) => id === value) ? value as T : fallback;
}

export function normalizeBasicConversationView(value: unknown): BasicConversationView {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const d = DEFAULT_BASIC_CONVERSATION_VIEW;
  return {
    sort: pick(raw.sort, BASIC_CONVERSATION_SORTS, d.sort),
    status: pick(raw.status, BASIC_CONVERSATION_STATUSES, d.status),
    window: pick(raw.window, BASIC_CONVERSATION_WINDOWS, d.window),
    automations: typeof raw.automations === 'boolean' ? raw.automations : d.automations
  };
}

export function isDefaultBasicConversationView(view: BasicConversationView): boolean {
  const d = DEFAULT_BASIC_CONVERSATION_VIEW;
  return view.sort === d.sort && view.status === d.status && view.window === d.window && view.automations === d.automations;
}

function read(): BasicConversationView {
  try {
    const raw = globalThis.localStorage?.getItem(BASIC_CONVERSATION_VIEW_KEY);
    return normalizeBasicConversationView(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_BASIC_CONVERSATION_VIEW };
  }
}

interface BasicConversationViewState {
  view: BasicConversationView;
  update(patch: Partial<BasicConversationView>): void;
}

export const useBasicConversationView = create<BasicConversationViewState>((set, get) => ({
  view: read(),
  update(patch) {
    const view = normalizeBasicConversationView({ ...get().view, ...patch });
    set({ view });
    try {
      globalThis.localStorage?.setItem(BASIC_CONVERSATION_VIEW_KEY, JSON.stringify(view));
    } catch {
      // Storage is best-effort; the in-memory choice still applies.
    }
  }
}));
