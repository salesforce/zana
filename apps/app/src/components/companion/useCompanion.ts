import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CompanionRequest, CompanionSnapshot } from '@zana-ai/zcc-domain/product';
import { product } from '../../lib/product-client.js';
import {
  ANSWERED_STORAGE_KEY,
  pendingRequests,
  readAnswered,
  writeAnswered,
  type AnsweredIds
} from './companion-model.js';

export const EMPTY_SNAPSHOT: CompanionSnapshot = {
  theme: 'dark',
  edge: 'right',
  requests: [],
  agents: [],
  schedules: [],
  counts: { blocked: 0, working: 0, idle: 0, recentlyCompleted: 0, runningSchedules: 0 },
  userInitials: ''
};

/** How long a just-answered blocked agent stays hidden while it resumes. */
const DISMISS_MS = 30_000;

/**
 * Live companion state shared by the rail and panel windows: the main-pushed
 * snapshot, the cross-window answered set (localStorage, same key the app
 * uses), and the derived pending Needs You list.
 */
export function useCompanion() {
  const [snapshot, setSnapshot] = useState<CompanionSnapshot>(EMPTY_SNAPSHOT);
  const [answered, setAnswered] = useState<AnsweredIds>(() => readAnswered(safeStorage()));
  const [dismissed, setDismissed] = useState<Map<string, number>>(() => new Map());

  useEffect(() => {
    let alive = true;
    product.companion
      .request()
      .then((s) => {
        if (alive && s) setSnapshot(s);
      })
      .catch(() => undefined);
    const off = product.companion.onSnapshot((s) => setSnapshot(s));
    const onStorage = (e: StorageEvent) => {
      if (e.key === ANSWERED_STORAGE_KEY) setAnswered(readAnswered(safeStorage()));
    };
    window.addEventListener('storage', onStorage);
    return () => {
      alive = false;
      off();
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = snapshot.theme;
  }, [snapshot.theme]);

  // Expire local dismissals so a blocked agent that's STILL blocked comes back.
  useEffect(() => {
    if (dismissed.size === 0) return;
    const t = setTimeout(() => {
      const now = Date.now();
      setDismissed((prev) => new Map([...prev].filter(([, at]) => now - at < DISMISS_MS)));
    }, DISMISS_MS);
    return () => clearTimeout(t);
  }, [dismissed]);

  const pending = useMemo(
    () => pendingRequests(snapshot.requests, answered, new Set(dismissed.keys())),
    [snapshot.requests, answered, dismissed]
  );

  /** Mark a request handled locally (answered or skipped). */
  const resolve = useCallback((request: CompanionRequest) => {
    if (request.entryId) setAnswered(writeAnswered(safeStorage(), request.entryId));
    else setDismissed((prev) => new Map(prev).set(request.id, Date.now()));
  }, []);

  return { snapshot, pending, resolve };
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Re-render every `ms` so relative ages stay honest. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}


