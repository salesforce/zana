import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, useCallback, type Dispatch, type SetStateAction, type ReactNode } from 'react';
import { ComposerSession, composerSession } from './composer-session.js';

const ComposerDraftContext = createContext<ComposerSession | null>(null);

/** A stable key retains a surface through navigation; omitted keys remain instance-local. */
export function ComposerDraftProvider({ children, sessionKey, session }: { children: ReactNode; sessionKey?: string; session?: ComposerSession }) {
  // A parent that already reads the session (AgentLauncher) passes it in so both
  // share one instance, even when storage is full and the session is unregistered.
  const owned = useMemo(() => session ? null : sessionKey ? composerSession(sessionKey) : new ComposerSession(), [session, sessionKey]);
  const draft = session ?? owned!;
  useEffect(() => {
    const release = draft.retain();
    return () => { release(); if ((owned && !sessionKey) || draft.retentionError) draft.dispose(); };
  }, [draft, owned, sessionKey]);
  return <ComposerDraftContext.Provider value={draft}>{children}</ComposerDraftContext.Provider>;
}

export function useComposerDraft() {
  return useContext(ComposerDraftContext);
}

export function useComposerSession(fallbackKey?: string) {
  const context = useComposerDraft();
  const session = useMemo(() => context ?? (fallbackKey ? composerSession(fallbackKey) : new ComposerSession()), [context, fallbackKey]);
  useEffect(() => {
    const release = session.retain();
    // Unkeyed sessions and unregistered overflow sessions are owned here alone.
    return () => { release(); if (!context && (!fallbackKey || session.retentionError)) session.dispose(); };
  }, [context, fallbackKey, session]);
  return session;
}

/**
 * Explicit field choices are stored separately from asynchronously arriving defaults.
 * The fallback is re-evaluated every render so late-hydrating defaults still apply
 * until the user chooses; `clear` returns the field to that fallback.
 */
export function useComposerSetting<T>(
  session: ComposerSession,
  key: string,
  initial: T | (() => T),
  options?: { content?: boolean }
): [T, Dispatch<SetStateAction<T>>, boolean, () => void] {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const fallback = typeof initial === 'function' ? (initial as () => T)() : initial;
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  const present = Object.hasOwn(snapshot.settings, key);
  const value = present ? snapshot.settings[key] as T : fallback;
  const content = options?.content ?? false;
  const set = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    const current = session.getSnapshot();
    const previous = Object.hasOwn(current.settings, key) ? current.settings[key] as T : fallbackRef.current;
    session.setSetting(key, typeof next === 'function' ? (next as (value: T) => T)(previous) : next, { content });
  }, [session, key, content]);
  const clear = useCallback(() => session.deleteSetting(key), [session, key]);
  return [value, set, present, clear];
}
