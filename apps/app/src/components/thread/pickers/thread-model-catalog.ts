import type { AvailableModel } from '@zana-ai/zcc-domain/thread-runtime';
import { product } from '../../../lib/product-client.js';
import { composerActionsFromProvider } from './composer-mode.js';
import { createModelDiscoveryFetcher } from './model-discovery-fetcher.js';
import {
  fallbackModelsForProvider,
  fallbackMoreModelsForProvider,
  type ThreadComposerProviderOption
} from './fallback-models.js';

export type ThreadModelCatalogEntry = {
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
  modelLoadError: string | null;
  modelLoadErrorDetail?: string | null;
  lastSuccessAt?: number;
  lastAttemptAt?: number;
  acpMode?: { currentValue?: string; options: Array<{ value: string; name?: string }> };
};

export type ThreadModelCatalogSnapshot = {
  hostId?: string;
  projectId?: string;
  providers: ThreadComposerProviderOption[];
  byProvider: Readonly<Record<string, ThreadModelCatalogEntry>>;
  inflight: ReadonlySet<string>;
  rosterError?: string | null;
};

type ExecutionOptionsBody = Awaited<ReturnType<typeof product.threads.executionOptions>>;
export type ThreadExecutionOptionsQuery = { providerId?: string; hostId?: string; projectId?: string; refresh?: boolean };
export type ThreadExecutionOptionsFetcher = (
  query?: ThreadExecutionOptionsQuery,
  options?: { signal: AbortSignal }
) => Promise<ExecutionOptionsBody>;

// Independent discovery per host/project. New projects reuse the same host's
// models while their own roles and configuration are discovered in the background.
export const MODEL_CATALOG_TIMEOUT_MS = 60_000;
export const MODEL_CATALOG_FRESH_MS = 5 * 60_000;
export const MODEL_CATALOG_RETRY_DELAYS_MS = [1_000, 4_000, 15_000] as const;
export const MODEL_CATALOG_FOCUS_COOLDOWN_MS = 60_000;
const MAX_IDLE_HOST_CATALOGS = 8;
const defaultFetcher = createModelDiscoveryFetcher((query, options) => product.threads.executionOptions(query, options));
let fetchOptions: ThreadExecutionOptionsFetcher = defaultFetcher;
const catalogs = new Map<string, ReturnType<typeof createCatalog>>();
export type ModelCatalogRefreshResult = { failedCatalogs: number; failedProviders: string[] };
let catalogReload: Promise<ModelCatalogRefreshResult> | null = null;
const providerReloads = new Map<string, Promise<void>>();

function createCatalog(
  catalogHostId: string | undefined,
  fetchOptions: ThreadExecutionOptionsFetcher,
  catalogProjectId?: string,
  seed?: ThreadModelCatalogSnapshot
) {
  const listeners = new Set<() => void>();
  const loads = new Map<string, Promise<void>>();
  let prefetchInflight: Promise<void> | null = null;
  let prefetchDirty = false;
  let offeredSignature = offeredKey((seed?.providers ?? []).map((provider) => provider.id));
  let providers: ThreadComposerProviderOption[] = seed?.providers ?? [];
  // Roles are project-local. Only model rows may serve as a warm placeholder.
  let byProvider: Record<string, ThreadModelCatalogEntry> = Object.fromEntries(
    Object.entries(seed?.byProvider ?? {})
      .filter(([, entry]) => !entry.modelLoadError)
      .map(([id, { acpMode: _acpMode, ...entry }]) => [id, entry])
  );
  const inherited = new Set(Object.keys(byProvider));
  let inflight = new Set<string>();
  let catalogEpoch = 0;
  let initialized = false;
  let rosterError: string | null = null;
  let rosterSuccessAt = 0;
  let paused = false;
  let lastRecoveryAt = -Infinity;
  let forceProviderLoads = false;
  const attempts = new Map<string, number>();
  const retries = new Map<string, number>();
  const controllers = new Set<AbortController>();
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;

  function clearRecoveryTimer(): void {
    clearTimeout(recoveryTimer);
    recoveryTimer = undefined;
  }

  function scheduleRecovery(): void {
    clearRecoveryTimer();
    if (paused || listeners.size === 0) return;
    const deadlines = [...retries.values()];
    if (initialized && !rosterError && !prefetchInflight) deadlines.push(rosterSuccessAt + MODEL_CATALOG_FRESH_MS);
    if (deadlines.length === 0) return;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = undefined;
      const now = Date.now();
      const due = [...retries].filter(([, at]) => at <= now).map(([id]) => id);
      for (const id of due) retries.delete(id);
      if (due.includes('') || (initialized && !rosterError && now - rosterSuccessAt >= MODEL_CATALOG_FRESH_MS)) {
        void prefetchThreadModelCatalog();
      }
      for (const id of due.filter(Boolean)) void loadProvider(id);
    }, Math.max(1, Math.min(...deadlines) - Date.now()));
  }

  function recordOutcome(id: string, error: string | null): void {
    if (!error) { attempts.delete(id); retries.delete(id); return; }
    const count = attempts.get(id) ?? 0;
    attempts.set(id, count + 1);
    if (['failed', 'timeout', 'host_unavailable', 'provider_unavailable'].includes(error) && count < MODEL_CATALOG_RETRY_DELAYS_MS.length) {
      retries.set(id, Date.now() + MODEL_CATALOG_RETRY_DELAYS_MS[count]);
    } else retries.delete(id);
  }

  function failure(error: unknown): { code: string; detail: string } {
    const value = error as { status?: number; code?: string; message?: string } | null;
    const detail = (value?.message ?? 'Could not load models').slice(0, 300);
    const code = value?.status === 401 || value?.status === 403 ? 'auth_required'
      : value?.status === 400 || value?.status === 404 ? 'invalid_request'
      : /timeout|timed out/i.test(detail) ? 'timeout'
      : value?.code === 'host-unavailable' ? 'host_unavailable' : 'failed';
    return { code, detail };
  }

  function storeEntry(id: string, entry: ThreadModelCatalogEntry): void {
    const previous = byProvider[id];
    byProvider = { ...byProvider, [id]: entry.modelLoadError && entry.modelLoadError !== 'provider_unavailable' && previous?.lastSuccessAt != null
      ? { ...previous, modelLoadError: entry.modelLoadError, modelLoadErrorDetail: entry.modelLoadErrorDetail, lastAttemptAt: Date.now() }
      : { ...entry, lastAttemptAt: Date.now(), ...(entry.modelLoadError ? {} : { lastSuccessAt: Date.now() }) } };
    recordOutcome(id, entry.modelLoadError);
  }

  let snapshot: ThreadModelCatalogSnapshot = freezeSnapshot();

  function freezeSnapshot(): ThreadModelCatalogSnapshot {
    return {
      providers,
      byProvider,
      inflight,
      hostId: catalogHostId,
      projectId: catalogProjectId,
      rosterError
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
      composerActions: composerActionsFromProvider(row.composerActions),
      serviceTiers: row.serviceTiers ?? (row.capabilities?.supportsServiceTier ? [{id:'default',label:'Default'},{id:'fast',label:'Fast'}] : [])
    }));
  }

  function entryFor(
    providerId: string,
    body: Pick<ExecutionOptionsBody, 'models' | 'selectedOnlyModels' | 'modelLoadError' | 'acpMode'> | null
  ): ThreadModelCatalogEntry {
    const models = (body?.models ?? []) as AvailableModel[];
    const selectedOnlyModels = (body?.selectedOnlyModels ?? []) as AvailableModel[];
    const modelLoadError = body?.modelLoadError?.code ?? (body ? null : 'failed');
    const modelLoadErrorDetail = body?.modelLoadError?.detail ?? null;
    const useFallbacks = modelLoadError == null;
    return {
      models: models.length > 0 ? models : (useFallbacks ? fallbackModelsForProvider(providerId) : []),
      selectedOnlyModels:
        selectedOnlyModels.length > 0
          ? selectedOnlyModels
          : (useFallbacks ? fallbackMoreModelsForProvider(providerId) : []),
      modelLoadError,
      modelLoadErrorDetail,
      ...(body?.acpMode ? { acpMode: body.acpMode } : {})
    };
  }

  function applyRoster(rows: ThreadComposerProviderOption[]): void {
    const nextKey = offeredKey(rows.map((row) => row.id));
    if (nextKey !== offeredSignature) {
      const keep = new Set(rows.map((row) => row.id));
      const next: Record<string, ThreadModelCatalogEntry> = {};
      for (const [id, entry] of Object.entries(byProvider)) {
        if (keep.has(id)) next[id] = entry;
      }
      byProvider = next;
      for (const id of retries.keys()) if (id && !keep.has(id)) { retries.delete(id); attempts.delete(id); }
      offeredSignature = nextKey;
    }
    providers = rows;
  }

  function optionsQuery(providerId?: string, refresh = false): ThreadExecutionOptionsQuery | undefined {
    if (!providerId && !catalogHostId && !catalogProjectId) return undefined;
    return {
      ...(providerId ? { providerId } : {}),
      ...(catalogHostId ? { hostId: catalogHostId } : {}),
      ...(catalogProjectId ? { projectId: catalogProjectId } : {}),
      ...(refresh ? { refresh: true } : {})
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
        const body = await fetchBounded(optionsQuery(providerId, forceProviderLoads));
        if (epoch !== catalogEpoch) return;
        inherited.delete(providerId);
        applyRoster(mapProviders(body.providers));
        storeEntry(providerId, entryFor(providerId, body));
      } catch (error) {
        if (epoch !== catalogEpoch) return;
        inherited.delete(providerId);
        const reason = failure(error);
        storeEntry(providerId, { ...entryFor(providerId, null), modelLoadError: reason.code, modelLoadErrorDetail: reason.detail });
      } finally {
        if (epoch === catalogEpoch) {
          const next = new Set(inflight);
          next.delete(providerId);
          inflight = next;
          emit();
          scheduleRecovery();
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
    let availableProviders = new Set<string>();
    try {
      const body = await fetchBounded(optionsQuery());
      if (epoch !== catalogEpoch) return;
      initialized = true;
      rosterError = null;
      rosterSuccessAt = Date.now();
      recordOutcome('', null);
      roster = mapProviders(body.providers);
      availableProviders = new Set(body.providers.filter((row) => row.available !== false).map((row) => row.id));
      applyRoster(roster);
      emit();
    } catch (error) {
      if (epoch === catalogEpoch) {
        rosterError = failure(error).detail;
        recordOutcome('', failure(error).code);
        emit();
      }
      return;
    }
    const missing = roster.filter((row) => {
      const entry = byProvider[row.id];
      return !entry || inherited.has(row.id)
        || (entry.modelLoadError === 'provider_unavailable' && availableProviders.has(row.id))
        || (!entry.modelLoadError && Date.now() - (entry.lastSuccessAt ?? 0) >= MODEL_CATALOG_FRESH_MS);
    }).map((row) => row.id);
    if (missing.length === 0) return;
    await Promise.allSettled(missing.map((id) => loadProvider(id)));
  }

  function getThreadModelCatalog(): ThreadModelCatalogSnapshot {
    return snapshot;
  }

  function subscribeThreadModelCatalog(listener: () => void): () => void {
    listeners.add(listener);
    scheduleRecovery();
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) clearRecoveryTimer();
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
      forceProviderLoads = false;
      scheduleRecovery();
    });
    prefetchInflight = pending;
    return pending;
  }

  function resetForRecovery(forceServer = false): void {
    catalogEpoch += 1;
    for (const controller of controllers) controller.abort();
    controllers.clear();
    clearRecoveryTimer();
    retries.clear();
    attempts.clear();
    rosterError = null;
    prefetchInflight = null;
    initialized = false;
    forceProviderLoads = forceServer;
    loads.clear();
    inherited.clear();
    // Keep usable rows and project-local roles visible until their replacements
    // arrive. Mark every cached provider for discovery, including prior errors.
    for (const id of Object.keys(byProvider)) inherited.add(id);
    inflight = new Set();
    emit();
  }

  function reloadThreadModelCatalog(forceServer = true): Promise<void> {
    resetForRecovery(forceServer);
    prefetchDirty = true;
    return prefetchThreadModelCatalog();
  }

  function ensureCatalog(): Promise<void> {
    if (prefetchInflight) return prefetchInflight;
    if (paused) return Promise.resolve();
    // Returning to a previously failed picker is a deliberate recovery trigger,
    // but rapid mounts must not turn authentication errors into a polling loop.
    const failed = Object.entries(byProvider).filter(([, entry]) => entry.modelLoadError
      && Date.now() - (entry.lastAttemptAt ?? 0) >= MODEL_CATALOG_FOCUS_COOLDOWN_MS);
    for (const [id] of failed) inherited.add(id);
    if (!initialized || rosterError || failed.length || Date.now() - rosterSuccessAt >= MODEL_CATALOG_FRESH_MS) {
      return prefetchThreadModelCatalog();
    }
    return Promise.resolve();
  }

  function ensureThreadProviderModels(providerId: string): Promise<void> {
    if (inherited.has(providerId)) return loadProvider(providerId);
    const cached = byProvider[providerId];
    if (cached && !cached.modelLoadError && Date.now() - (cached.lastSuccessAt ?? 0) < MODEL_CATALOG_FRESH_MS) return Promise.resolve();
    return loadProvider(providerId);
  }

  /** Settings Reload: always refetch this provider; share an in-flight load. */
  function reloadThreadProviderModels(providerId: string): Promise<void> {
    const existing = loads.get(providerId);
    if (existing) return existing;
    attempts.delete(providerId);
    retries.delete(providerId);
    forceProviderLoads = true;
    return loadProvider(providerId).finally(() => { forceProviderLoads = false; });
  }


  async function fetchBounded(query: ThreadExecutionOptionsQuery | undefined): Promise<ExecutionOptionsBody> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    controllers.add(controller);
    let onAbort: () => void = () => undefined;
    try {
      return await Promise.race([
        fetchOptions(query, { signal: controller.signal }),
        new Promise<never>((_, reject) => {
          onAbort = () => reject(new Error('Model discovery cancelled'));
          controller.signal.addEventListener('abort', onAbort, { once: true });
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error('Model discovery timed out'));
            controller.abort();
          }, MODEL_CATALOG_TIMEOUT_MS);
        })
      ]);
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', onAbort);
      controllers.delete(controller);
    }
  }

  return {
    getSnapshot: getThreadModelCatalog,
    subscribe: subscribeThreadModelCatalog,
    ensure: ensureCatalog,
    prefetch: prefetchThreadModelCatalog,
    reload: reloadThreadModelCatalog,
    ensureProvider: ensureThreadProviderModels,
    reloadProvider: reloadThreadProviderModels,
    refreshProviderFromPush: (providerId: string) => {
      inherited.add(providerId);
      return loadProvider(providerId);
    },
    hasSubscribers: () => listeners.size > 0,
    refreshResult: () => ({
      failedCatalogs: initialized && !rosterError ? 0 : 1,
      failedProviders: providers.filter((provider) => byProvider[provider.id]?.modelLoadError)
        .map((provider) => provider.displayName)
    }),
    recover: (force = false) => {
      if (force && (paused || listeners.size === 0)) { resetForRecovery(); return; }
      if (paused || listeners.size === 0 || (!force && Date.now() - lastRecoveryAt < MODEL_CATALOG_FOCUS_COOLDOWN_MS)) return;
      const stale = !initialized || rosterError || Date.now() - rosterSuccessAt >= MODEL_CATALOG_FRESH_MS
        || Object.values(byProvider).some((entry) => entry.modelLoadError && Date.now() - (entry.lastAttemptAt ?? 0) >= MODEL_CATALOG_FOCUS_COOLDOWN_MS);
      if (!force && !stale) return;
      lastRecoveryAt = Date.now();
      void reloadThreadModelCatalog(false);
    },
    setOnline: (online: boolean) => {
      const wasPaused = paused;
      paused = !online;
      if (paused) clearRecoveryTimer();
      else { scheduleRecovery(); if (wasPaused) lastRecoveryAt = -Infinity; }
    },
    invalidate: () => {
      catalogEpoch += 1;
      clearRecoveryTimer();
      retries.clear();
      for (const controller of controllers) controller.abort();
      controllers.clear();
    }
  };
}

export function threadModelCatalogForHost(hostId?: string, projectId?: string) {
  const normalizedHostId = hostId?.trim() || undefined;
  const normalizedProjectId = projectId?.trim() || undefined;
  const key = JSON.stringify([normalizedHostId, normalizedProjectId]);
  let catalog = catalogs.get(key);
  if (!catalog) {
    const seed = [...catalogs.values()].reverse().map((entry) => entry.getSnapshot())
      .find((entry) => entry.hostId === normalizedHostId && Object.keys(entry.byProvider).length > 0);
    catalog = createCatalog(normalizedHostId, fetchOptions, normalizedProjectId, seed);
    const host = normalizedHostId ?? primaryCatalogHost;
    if (host && knownHostStates.has(host)) catalog.setOnline(knownHostStates.get(host) === 'connected');
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
export function reloadThreadModelCatalog(): Promise<ModelCatalogRefreshResult> {
  if (catalogReload) return catalogReload;
  const defaultCatalog = threadModelCatalogForHost();
  // Start visible project scopes before background scopes. Each scope streams
  // its parallel provider discoveries over a single HTTP connection.
  const targets = [...new Set([
    ...[...catalogs.values()].sort((a, b) => Number(Boolean(b.getSnapshot().projectId)) - Number(Boolean(a.getSnapshot().projectId))),
    defaultCatalog
  ])];
  const pending = Promise.all(targets.map((catalog) => catalog.reload())).then(() => {
    const results = targets.map((catalog) => catalog.refreshResult());
    return {
      failedCatalogs: results.reduce((sum, result) => sum + result.failedCatalogs, 0),
      failedProviders: [...new Set(results.flatMap((result) => result.failedProviders))]
    };
  }).finally(() => { if (catalogReload === pending) catalogReload = null; });
  catalogReload = pending;
  return pending;
}
export function ensureThreadProviderModels(providerId: string): Promise<void> {
  return threadModelCatalogForHost().ensureProvider(providerId);
}
export function reloadThreadProviderModels(providerId: string): Promise<void> {
  const existing = providerReloads.get(providerId);
  if (existing) return existing;
  const defaultCatalog = threadModelCatalogForHost();
  const targets = [...catalogs.values()].filter((catalog) => catalog === defaultCatalog
    || catalog.getSnapshot().providers.some((provider) => provider.id === providerId)
    || catalog.getSnapshot().byProvider[providerId]);
  const pending = Promise.all(targets.map((catalog) => catalog.reloadProvider(providerId)))
    .then(() => undefined)
    .finally(() => { if (providerReloads.get(providerId) === pending) providerReloads.delete(providerId); });
  providerReloads.set(providerId, pending);
  return pending;
}
export function refreshThreadProviderModelsFromPush(hostId: string, providerId: string): void {
  for (const catalog of catalogs.values()) {
    const catalogHostId = catalog.getSnapshot().hostId ?? primaryCatalogHost;
    if (catalogHostId !== hostId) continue;
    void catalog.refreshProviderFromPush(providerId);
  }
}
export function resetThreadModelCatalog(fetcher?: ThreadExecutionOptionsFetcher | null): void {
  for (const catalog of catalogs.values()) catalog.invalidate();
  catalogs.clear();
  catalogReload = null;
  providerReloads.clear();
  knownHostStates.clear();
  primaryCatalogHost = undefined;
  fetchOptions = fetcher ?? defaultFetcher;
}

/** Revalidate on a return from an external login/configuration edit, with a cooldown. */
export function recoverStaleModelCatalogs(): void {
  // Recovery emits synchronously. Subscribers can read a catalog and move it
  // to the end of the LRU Map, so always iterate a snapshot of the roster.
  for (const catalog of [...catalogs.values()]) catalog.recover();
}

/** Plugin lifecycle pushes can repair a failed provider without a host reconnect. */
export function recoverUnavailableModelCatalogs(): void {
  for (const catalog of [...catalogs.values()]) {
    if (Object.values(catalog.getSnapshot().byProvider).some((entry) => entry.modelLoadError === 'provider_unavailable')) {
      catalog.recover(true);
    }
  }
}

let knownHostStates = new Map<string, string>();
let primaryCatalogHost: string | undefined;
export function updateModelCatalogHosts(hosts: readonly { id: string; status: string; isPrimary?: boolean }[]): void {
  const next = new Map(hosts.map((host) => [host.id, host.status]));
  const primary = hosts.find((host) => host.isPrimary)?.id ?? hosts[0]?.id;
  for (const catalog of [...catalogs.values()]) {
    const host = catalog.getSnapshot().hostId ?? primary;
    const online = host != null && next.get(host) === 'connected';
    const reconnected = online && (knownHostStates.get(host!) !== 'connected'
      || (!catalog.getSnapshot().hostId && primary !== primaryCatalogHost));
    catalog.setOnline(online);
    if (reconnected) catalog.recover(true);
  }
  knownHostStates = next;
  primaryCatalogHost = primary;
}

/** Relevant config changes invalidate mounted and idle scopes without theme/layout churn. */
export function modelDiscoveryConfigKey(config: object): string {
  return JSON.stringify(Object.entries(config).filter(([key]) => key === 'providerServiceTiersDisabled' || /^harness.*Enabled$|Binary$/.test(key))
    .sort(([a], [b]) => a.localeCompare(b)));
}
export function invalidateModelCatalogs(): void {
  for (const catalog of [...catalogs.values()]) catalog.recover(true);
}
