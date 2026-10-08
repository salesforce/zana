import type { WorkspaceProvisionType } from '@zana-ai/zcc-domain';
import type { ProductHttpContext } from '../../http/product-context.js';

/**
 * Several renderer surfaces poll the same checkout's status every few
 * seconds. Share one host RPC per (host, checkout): concurrent callers join
 * the request in flight, and a successful result is reused for `ttlMs`.
 * Failures are never reused. The host keeps its own untracked-scan cache;
 * this only removes duplicate round trips.
 */
export const WORKSPACE_STATUS_TTL_MS = 1_500;
const MAX_ENTRIES = 256;

interface Entry {
  promise: Promise<unknown>;
  settledAt: number | null;
}

export interface WorkspaceStatusCache {
  get<T>(key: WorkspaceStatusKey, load: () => Promise<T>): Promise<T>;
  invalidate(hostId: string, workspacePath: string): void;
}

export interface WorkspaceStatusKey {
  hostId: string;
  workspacePath: string;
  workspaceProvisionType: WorkspaceProvisionType;
}

export function createWorkspaceStatusCache(options: { ttlMs?: number; now?: () => number; maxEntries?: number } = {}): WorkspaceStatusCache {
  const ttlMs = options.ttlMs ?? WORKSPACE_STATUS_TTL_MS;
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? MAX_ENTRIES;
  const entries = new Map<string, Entry>();
  const keyOf = (key: WorkspaceStatusKey) => `${key.hostId}\0${key.workspacePath}\0${key.workspaceProvisionType}`;
  const pathPrefix = (hostId: string, workspacePath: string) => `${hostId}\0${workspacePath}\0`;

  return {
    get<T>(key: WorkspaceStatusKey, load: () => Promise<T>): Promise<T> {
      const id = keyOf(key);
      const existing = entries.get(id);
      if (existing && (existing.settledAt === null || now() - existing.settledAt < ttlMs)) {
        return existing.promise as Promise<T>;
      }
      const entry: Entry = { promise: Promise.resolve(), settledAt: null };
      const promise = load().then(
        (value) => {
          if (entries.get(id) === entry) entry.settledAt = now();
          return value;
        },
        (error: unknown) => {
          if (entries.get(id) === entry) entries.delete(id);
          throw error;
        }
      );
      entry.promise = promise;
      entries.delete(id);
      entries.set(id, entry);
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value as string);
      return promise;
    },
    invalidate(hostId, workspacePath) {
      const prefix = pathPrefix(hostId, workspacePath);
      for (const id of [...entries.keys()]) if (id.startsWith(prefix)) entries.delete(id);
    }
  };
}

const caches = new WeakMap<ProductHttpContext['hostHub'], WorkspaceStatusCache>();

/** One cache per host hub, so separate server instances (and tests) never share results. */
export function workspaceStatusCacheFor(ctx: Pick<ProductHttpContext, 'hostHub'>): WorkspaceStatusCache {
  let cache = caches.get(ctx.hostHub);
  if (!cache) {
    cache = createWorkspaceStatusCache();
    caches.set(ctx.hostHub, cache);
  }
  return cache;
}

export function cachedWorkspaceStatus<T>(ctx: Pick<ProductHttpContext, 'hostHub'>, key: WorkspaceStatusKey): Promise<T> {
  return workspaceStatusCacheFor(ctx).get(key, () => ctx.hostHub.callHostOnlineRpc<T>({
    hostId: key.hostId,
    command: { type: 'workspace.status', workspacePath: key.workspacePath, workspaceProvisionType: key.workspaceProvisionType }
  }));
}
