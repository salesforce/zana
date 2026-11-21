import { useSyncExternalStore } from 'react';
import { paneContentForPathname } from './split-layout/splitThreadNavigation.js';

export type BasicUiMode = 'basic' | 'advanced';
export const BASIC_UI_SESSION_KEY = 'zcc.interface-view.v1';

type SessionStorage = Pick<Storage, 'getItem' | 'setItem'>;
type SessionChoice = { mode: BasicUiMode; queryMode?: BasicUiMode };

function isMode(value: unknown): value is BasicUiMode {
  return value === 'basic' || value === 'advanced';
}

/** A URL hint is deliberately strict; duplicate or unknown values are ignored. */
export function basicUiModeFromSearch(search: string): BasicUiMode | null {
  const values = new URLSearchParams(search).getAll('ui');
  return values.length === 1 && isMode(values[0]) ? values[0] : null;
}

/** This slice presents existing native conversations, with other pages in Advanced. */
export function isBasicUiRouteSupported(pathname: string): boolean {
  const kind = paneContentForPathname(pathname)?.kind;
  return kind === 'home' || kind === 'new-thread' || kind === 'thread';
}

/** Each renderer owns its choice; no AppConfig writes or cross-window events. */
export function createBasicUiStore(search = '', storage?: SessionStorage) {
  let remembered: SessionChoice | undefined;
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(BASIC_UI_SESSION_KEY) ?? 'null');
    if (parsed && typeof parsed === 'object' && 'mode' in parsed && isMode(parsed.mode)) {
      const queryMode = 'queryMode' in parsed && isMode(parsed.queryMode) ? parsed.queryMode : undefined;
      remembered = { mode: parsed.mode, queryMode };
    }
  } catch { /* An unavailable or malformed session keeps the normal default. */ }
  const queryMode = basicUiModeFromSearch(search);
  const choice: SessionChoice = {
    mode: queryMode && queryMode !== remembered?.queryMode ? queryMode : remembered?.mode ?? 'advanced',
    queryMode: queryMode ?? remembered?.queryMode
  };
  const persist = () => {
    try { storage?.setItem(BASIC_UI_SESSION_KEY, JSON.stringify(choice)); }
    catch { /* The in-memory choice still works when storage is unavailable. */ }
  };
  if (queryMode) persist();
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => choice.mode,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setMode(mode: BasicUiMode) {
      if (!isMode(mode) || mode === choice.mode) return;
      choice.mode = mode;
      persist();
      for (const listener of listeners) listener();
    }
  };
}

function browserStore() {
  if (typeof window === 'undefined') return createBasicUiStore();
  let storage: SessionStorage | undefined;
  try { storage = window.sessionStorage; } catch { /* Private browser storage. */ }
  return createBasicUiStore(window.location?.search ?? '', storage);
}

const store = browserStore();
export const getBasicUiMode = store.getSnapshot;
export const setBasicUiMode = store.setMode;

export function useBasicUi(): boolean {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => 'advanced') === 'basic';
}
