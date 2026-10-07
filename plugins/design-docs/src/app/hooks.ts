import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtime } from '@zana-ai/zcc-plugin-sdk/app';
import {
  CHANGED_CHANNEL,
  type DesignDocDetail,
  type DesignDocFile,
  type DesignDocSummary
} from '../shared/contract.js';
import { errorMessage, useApi, type ListArgs, type ProjectInfo, type TemplateInfo } from './api.js';

export interface Resource<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload(): void;
}

/**
 * Load `key` with `load`, keeping the previous data while a reload is in
 * flight so live refreshes never flash an empty state. Stale responses from an
 * earlier key are dropped.
 */
export function useResource<T>(key: string | null, load: () => Promise<T>): Resource<T> {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null; loading: boolean }>({
    key,
    data: null,
    error: null,
    loading: key !== null
  });
  const [version, setVersion] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (key === null) {
      setState({ key, data: null, error: null, loading: false });
      return;
    }
    let cancelled = false;
    setState((previous) => ({
      key,
      data: previous.key === key ? previous.data : null,
      error: null,
      loading: true
    }));
    loadRef.current().then(
      (data) => {
        if (!cancelled) setState({ key, data, error: null, loading: false });
      },
      (error: unknown) => {
        if (!cancelled) {
          setState((previous) => ({ key, data: previous.key === key ? previous.data : null, error: errorMessage(error), loading: false }));
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [key, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  const current = state.key === key;
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    loading: current ? state.loading : key !== null,
    reload
  };
}

/** Run `onChange(docId)` after server mutations, coalescing bursts of agent edits. */
export function useDocChanges(onChange: (docId: string | null) => void, delayMs = 120): void {
  const handlerRef = useRef(onChange);
  handlerRef.current = onChange;
  const pending = useRef(new Set<string | null>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  useRealtime(CHANGED_CHANNEL, (payload) => {
    const docId = typeof (payload as { docId?: unknown } | null)?.docId === 'string' ? (payload as { docId: string }).docId : null;
    pending.current.add(docId);
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const ids = [...pending.current];
      pending.current.clear();
      for (const id of ids) handlerRef.current(id);
    }, delayMs);
  });
}

export function useDocs(args: ListArgs): Resource<DesignDocSummary[]> {
  const api = useApi();
  const resource = useResource(JSON.stringify(args), () => api.list(args));
  useDocChanges(() => resource.reload());
  return resource;
}

export function useDoc(docId: string | null): Resource<DesignDocDetail> {
  const api = useApi();
  const resource = useResource(docId, () => api.get(docId!));
  useDocChanges((changed) => {
    if (changed === null || changed === docId) resource.reload();
  });
  return resource;
}

/** One file's content, refetched whenever its revision moves. */
export function useFile(docId: string | null, path: string | null, revision: number | null): Resource<DesignDocFile> {
  const api = useApi();
  const key = docId && path && revision !== null ? `${docId}\u0000${path}\u0000${revision}` : null;
  return useResource(key, () => api.readFile(docId!, path!));
}

export function useTemplates(): Resource<TemplateInfo[]> {
  const api = useApi();
  return useResource('templates', () => api.templates());
}

export function useProjects(): Resource<ProjectInfo[]> {
  const api = useApi();
  return useResource('projects', () => api.projects());
}

const STORAGE_PREFIX = 'zcc.design-docs.';

/** A small piece of UI state remembered across sessions (view mode, open rail). */
export function usePersistentState<T extends string | boolean>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = globalThis.localStorage?.getItem(STORAGE_PREFIX + key);
      if (raw === null || raw === undefined) return initial;
      const parsed = JSON.parse(raw) as unknown;
      return typeof parsed === typeof initial ? (parsed as T) : initial;
    } catch {
      return initial;
    }
  });
  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        globalThis.localStorage?.setItem(STORAGE_PREFIX + key, JSON.stringify(next));
      } catch {
        // Storage can be full or disabled; the in-memory value still applies.
      }
    },
    [key]
  );
  return [value, update];
}

/** Re-render every minute so "2m ago" labels stay honest. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
