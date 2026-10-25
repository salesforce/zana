import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { FsEntry } from '@zana-ai/zcc-domain/product';

export const DIRECTORY_SLOW_MS = 5000;

interface DirectoryState {
  entries: Map<string, FsEntry[]>;
  loading: Set<string>;
  slow: Set<string>;
  errors: Map<string, string>;
}

type DirectoryAction =
  | { type: 'RESET' }
  | { type: 'START_LOAD'; path: string }
  | { type: 'MARK_SLOW'; path: string }
  | { type: 'SUCCESS'; path: string; entries: FsEntry[] }
  | { type: 'FAILURE'; path: string; error: string };

const INITIAL_STATE: DirectoryState = {
  entries: new Map(),
  loading: new Set(),
  slow: new Set(),
  errors: new Map(),
};

function directoryReducer(state: DirectoryState, action: DirectoryAction): DirectoryState {
  switch (action.type) {
    case 'RESET':
      return {
        entries: new Map(),
        loading: new Set(),
        slow: new Set(),
        errors: new Map(),
      };
    case 'START_LOAD': {
      const entries = new Map(state.entries);
      entries.delete(action.path);
      const errors = new Map(state.errors);
      errors.delete(action.path);
      const slow = new Set(state.slow);
      slow.delete(action.path);
      const loading = new Set(state.loading);
      loading.add(action.path);
      return { entries, loading, slow, errors };
    }
    case 'MARK_SLOW': {
      if (!state.loading.has(action.path)) return state;
      const slow = new Set(state.slow);
      slow.add(action.path);
      return { ...state, slow };
    }
    case 'SUCCESS': {
      const entries = new Map(state.entries);
      entries.set(action.path, action.entries);
      const loading = new Set(state.loading);
      loading.delete(action.path);
      const slow = new Set(state.slow);
      slow.delete(action.path);
      return { ...state, entries, loading, slow };
    }
    case 'FAILURE': {
      const errors = new Map(state.errors);
      errors.set(action.path, action.error);
      const loading = new Set(state.loading);
      loading.delete(action.path);
      const slow = new Set(state.slow);
      slow.delete(action.path);
      return { ...state, errors, loading, slow };
    }
  }
}

interface PendingRequest {
  promise: Promise<FsEntry[]>;
  timer: ReturnType<typeof setTimeout>;
}

function cancelPendingRequests(requests: Map<string, PendingRequest>): void {
  for (const request of requests.values()) clearTimeout(request.timer);
  requests.clear();
}

interface RequestContext {
  path: string;
  epoch: number;
  readDirectory: (path: string) => Promise<FsEntry[]>;
  generation: React.MutableRefObject<number>;
  requests: React.MutableRefObject<Map<string, PendingRequest>>;
  promiseCache: React.MutableRefObject<Map<string, Promise<FsEntry[]>>>;
  dispatch: React.Dispatch<DirectoryAction>;
}

function createDirectoryRequest(ctx: RequestContext): PendingRequest {
  const { path, epoch, readDirectory, generation, requests, promiseCache, dispatch } = ctx;
  let timer: ReturnType<typeof setTimeout>;
  const isCurrent = () => generation.current === epoch && requests.current.get(path)?.timer === timer;

  timer = setTimeout(() => {
    if (isCurrent()) dispatch({ type: 'MARK_SLOW', path });
  }, DIRECTORY_SLOW_MS);

  const promise = Promise.resolve()
    .then(() => (isCurrent() ? readDirectory(path) : []))
    .then((list) => {
      if (!isCurrent()) return [];
      promiseCache.current.set(path, Promise.resolve(list));
      dispatch({ type: 'SUCCESS', path, entries: list });
      return list;
    })
    .catch((error) => {
      if (isCurrent()) {
        const message = error instanceof Error ? error.message : 'Failed to list directory';
        dispatch({ type: 'FAILURE', path, error: message });
      }
      return [];
    })
    .finally(() => {
      clearTimeout(timer);
      if (isCurrent()) requests.current.delete(path);
    });

  return { promise, timer };
}

/** Mount-local listings: never reused across Explorer visits or checkout scopes. */
export function useDirectoryLoader(readDirectory: (path: string) => Promise<FsEntry[]>) {
  const [{ entries, loading, slow, errors }, dispatch] = useReducer(directoryReducer, INITIAL_STATE);
  const promiseCache = useRef(new Map<string, Promise<FsEntry[]>>());
  const requests = useRef(new Map<string, PendingRequest>());
  const generation = useRef(0);

  const invalidate = useCallback(() => {
    generation.current++;
    cancelPendingRequests(requests.current);
    promiseCache.current.clear();
  }, []);

  const reset = useCallback(() => {
    invalidate();
    dispatch({ type: 'RESET' });
  }, [invalidate]);

  useEffect(() => {
    reset();
    return invalidate;
  }, [readDirectory, reset, invalidate]);

  const loadDir = useCallback((path: string, force = false): Promise<FsEntry[]> => {
    if (!force) {
      const pending = requests.current.get(path);
      if (pending) return pending.promise;
      const cached = promiseCache.current.get(path);
      if (cached) return cached;
    }
    const previous = requests.current.get(path);
    if (previous) clearTimeout(previous.timer);
    promiseCache.current.delete(path);
    dispatch({ type: 'START_LOAD', path });

    const request = createDirectoryRequest({
      path,
      epoch: generation.current,
      readDirectory,
      generation,
      requests,
      promiseCache,
      dispatch,
    });
    requests.current.set(path, request);
    return request.promise;
  }, [readDirectory]);

  return { entries, loading, slow, errors, loadDir, reset };
}
