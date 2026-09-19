import type { AvailableModel } from '@zana-ai/zcc-domain/thread-runtime';
import { product } from '../../../lib/product-client.js';
import { composerActionsFromProvider } from './composer-mode.js';
import {
  fallbackModelsForProvider,
  fallbackMoreModelsForProvider,
  type ThreadComposerProviderOption
} from './fallback-models.js';

export type ThreadModelCatalogEntry = {
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
  modelLoadError: string | null;
  acpMode?: { currentValue?: string; options: Array<{ value: string; name?: string }> };
};

export type ThreadModelCatalogSnapshot = {
  providers: ThreadComposerProviderOption[];
  byProvider: Readonly<Record<string, ThreadModelCatalogEntry>>;
  inflight: ReadonlySet<string>;
};

type ExecutionOptionsBody = Awaited<ReturnType<typeof product.threads.executionOptions>>;
export type ThreadExecutionOptionsQuery = { providerId?: string; hostId?: string };
export type ThreadExecutionOptionsFetcher = (
  query?: ThreadExecutionOptionsQuery
) => Promise<ExecutionOptionsBody>;

// One cache per execution machine. A remote probe must never hold up, replace,
// or clear a local composer's models (including composers mounted behind a modal).
export const MODEL_CATALOG_TIMEOUT_MS = 60_000;
const MAX_IDLE_HOST_CATALOGS = 8;
let fetchOptions: ThreadExecutionOptionsFetcher = (query) => product.threads.executionOptions(query);
const catalogs = new Map<string | undefined, ReturnType<typeof createCatalog>>();

function createCatalog(catalogHostId: string | undefined, fetchOptions: ThreadExecutionOptionsFetcher) {
  const listeners = new Set<() => void>();
  const loads = new Map<string, Promise<void>>();
  let prefetchInflight: Promise<void> | null = null;
  let prefetchDirty = false;
  let offeredSignature = '';
  let providers: ThreadComposerProviderOption[] = [];
  let byProvider: Record<string, ThreadModelCatalogEntry> = {};
  let inflight = new Set<string>();
  let catalogEpoch = 0;
  let initialized = false;
  let snapshot: ThreadModelCatalogSnapshot = freezeSnapshot();

  function freezeSnapshot(): ThreadModelCatalogSnapshot {
    return {
      providers,
      byProvider,
      inflight
    };
  }

  function emit(): void {
    snapshot = freezeSnapshot();
    for (const listener of listeners) listener();
  }

  function offeredKey(ids: readonly string[]): string {
    return [...ids].sort().join(',');
  }

  function mapProviders(rows: ExecutionOptionsBody['providers'] | undefined): ThreadComposerProviderOption[] {
    return (rows ?? []).map((row) => ({
      id: row.id,
      displayName: row.displayName,
      permissionModes: row.capabilities?.permissionModes ?? [],
      composerActions: composerActionsFromProvider(row.composerActions)
    }));
  }

  function entryFor(
    providerId: string,
    body: Pick<ExecutionOptionsBody, 'models' | 'selectedOnlyModels' | 'modelLoadError' | 'acpMode'> | null
  ): ThreadModelCatalogEntry {
    const models = (body?.models ?? []) as AvailableModel[];
    const selectedOnlyModels = (body?.selectedOnlyModels ?? []) as AvailableModel[];
    const modelLoadError = body?.modelLoadError?.code ?? (body ? null : 'failed');
    const useFallbacks = modelLoadError == null;
    return {
      models: models.length > 0 ? models : (useFallbacks ? fallbackModelsForProvider(providerId) : []),
      selectedOnlyModels:
        selectedOnlyModels.length > 0
          ? selectedOnlyModels
          : (useFallbacks ? fallbackMoreModelsForProvider(providerId) : []),
      modelLoadError,
      ...(body?.acpMode ? { acpMode: body.acpMode } : {})
    };
  }

  function applyRoster(rows: ThreadComposerProviderOption[]): void {
    if (rows.length === 0) return;
    const nextKey = offeredKey(rows.map((row) => row.id));
    if (nextKey !== offeredSignature) {
      const keep = new Set(rows.map((row) => row.id));
      const next: Record<string, ThreadModelCatalogEntry> = {};
      for (const [id, entry] of Object.entries(byProvider)) {
        if (keep.has(id)) next[id] = entry;
      }
      byProvider = next;
      offeredSignature = nextKey;
    }
    providers = rows;
  }

  function optionsQuery(providerId?: string): ThreadExecutionOptionsQuery | undefined {
    if (!providerId && !catalogHostId) return undefined;
    return {
      ...(providerId ? { providerId } : {}),
      ...(catalogHostId ? { hostId: catalogHostId } : {})
    };
  }

  function loadProvider(providerId: string): Promise<void> {
    const existing = loads.get(providerId);
    if (existing) return existing;
    const epoch = catalogEpoch;
    const pending = (async () => {
      inflight = new Set(inflight).add(providerId);
      emit();
      try {
        const body = await fetchBounded(optionsQuery(providerId));
        if (epoch !== catalogEpoch) return;
        applyRoster(mapProviders(body.providers));
        byProvider = { ...byProvider, [providerId]: entryFor(providerId, body) };
      } catch {
        if (epoch !== catalogEpoch) return;
        byProvider = { ...byProvider, [providerId]: entryFor(providerId, null) };
      } finally {
        if (epoch === catalogEpoch) {
          const next = new Set(inflight);
          next.delete(providerId);
          inflight = next;
          emit();
        }
      }
    })();
    loads.set(providerId, pending);
    void pending.finally(() => {
      if (loads.get(providerId) === pending) loads.delete(providerId);
    });
    return pending;
  }

  async function runPrefetch(epoch: number): Promise<void> {
    let roster: ThreadComposerProviderOption[] = [];
    try {
      const body = await fetchBounded(optionsQuery());
      if (epoch !== catalogEpoch) return;
      initialized = true;
      roster = mapProviders(body.providers);
      applyRoster(roster);
      emit();
    } catch {
      if (epoch === catalogEpoch) emit();
      return;
    }
    const missing = roster.filter((row) => !byProvider[row.id]).map((row) => row.id);
    if (missing.length === 0) return;
    await Promise.allSettled(missing.map((id) => loadProvider(id)));
  }

  function getThreadModelCatalog(): ThreadModelCatalogSnapshot {
    return snapshot;
  }

  function subscribeThreadModelCatalog(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function prefetchThreadModelCatalog(): Promise<void> {
    if (prefetchInflight) {
      prefetchDirty = true;
      return prefetchInflight;
    }
    const epoch = catalogEpoch;
    const pending = (async () => {
      do {
        prefetchDirty = false;
        await runPrefetch(epoch);
      } while (epoch === catalogEpoch && prefetchDirty);
    })().finally(() => {
      if (prefetchInflight !== pending) return;
      prefetchInflight = null;
      if (prefetchDirty) return prefetchThreadModelCatalog();
    });
    prefetchInflight = pending;
    return pending;
  }

  function reloadThreadModelCatalog(): Promise<void> {
    catalogEpoch += 1;
    prefetchInflight = null;
    initialized = false;
    loads.clear();
    offeredSignature = '';
    providers = [];
    byProvider = {};
    inflight = new Set();
    emit();
    prefetchDirty = true;
    return prefetchThreadModelCatalog();
  }

  function ensureThreadProviderModels(providerId: string): Promise<void> {
    const cached = byProvider[providerId];
    if (cached && cached.models.length > 0) return Promise.resolve();
    if (cached && cached.modelLoadError === null) return Promise.resolve();
    return loadProvider(providerId);
  }

  /** Settings Reload: always refetch this provider; share an in-flight load. */
  function reloadThreadProviderModels(providerId: string): Promise<void> {
    const existing = loads.get(providerId);
    if (existing) return existing;
    return loadProvider(providerId);
  }


  async function fetchBounded(query: ThreadExecutionOptionsQuery | undefined): Promise<ExecutionOptionsBody> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        fetchOptions(query),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Model discovery timed out')), MODEL_CATALOG_TIMEOUT_MS);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    getSnapshot: getThreadModelCatalog,
    subscribe: subscribeThreadModelCatalog,
    ensure: () => prefetchInflight ?? (initialized ? Promise.resolve() : prefetchThreadModelCatalog()),
    prefetch: prefetchThreadModelCatalog,
    reload: reloadThreadModelCatalog,
    ensureProvider: ensureThreadProviderModels,
    reloadProvider: reloadThreadProviderModels,
    hasSubscribers: () => listeners.size > 0,
    invalidate: () => { catalogEpoch += 1; }
  };
}

export function threadModelCatalogForHost(hostId?: string) {
  const key = hostId?.trim() || undefined;
  let catalog = catalogs.get(key);
  if (!catalog) {
    catalog = createCatalog(key, fetchOptions);
    catalogs.set(key, catalog);
  } else {
    catalogs.delete(key);
    catalogs.set(key, catalog);
  }
  // Keep mounted consumers; bound the idle host cache using least-recent access.
  const idle = [...catalogs].filter(([id, entry]) => id !== key && !entry.hasSubscribers());
  for (const [id, entry] of idle.slice(0, Math.max(0, idle.length - MAX_IDLE_HOST_CATALOGS))) {
    entry.invalidate();
    catalogs.delete(id);
  }
  return catalog;
}

// Settings and global harness availability operate on the default host.
export function getThreadModelCatalog(): ThreadModelCatalogSnapshot {
  return threadModelCatalogForHost().getSnapshot();
}
export function subscribeThreadModelCatalog(listener: () => void): () => void {
  return threadModelCatalogForHost().subscribe(listener);
}
export function prefetchThreadModelCatalog(): Promise<void> {
  return Promise.all([...new Set([threadModelCatalogForHost(), ...catalogs.values()])]
    .map((catalog) => catalog.prefetch())).then(() => undefined);
}
export function reloadThreadModelCatalog(): Promise<void> {
  return Promise.all([...new Set([threadModelCatalogForHost(), ...catalogs.values()])]
    .map((catalog) => catalog.reload())).then(() => undefined);
}
export function ensureThreadProviderModels(providerId: string): Promise<void> {
  return threadModelCatalogForHost().ensureProvider(providerId);
}
export function reloadThreadProviderModels(providerId: string): Promise<void> {
  return threadModelCatalogForHost().reloadProvider(providerId);
}
export function resetThreadModelCatalog(fetcher?: ThreadExecutionOptionsFetcher | null): void {
  for (const catalog of catalogs.values()) catalog.invalidate();
  catalogs.clear();
  fetchOptions = fetcher ?? ((query) => product.threads.executionOptions(query));
}
