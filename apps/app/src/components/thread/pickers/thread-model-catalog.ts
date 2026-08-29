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
};

export type ThreadModelCatalogSnapshot = {
  providers: ThreadComposerProviderOption[];
  byProvider: Readonly<Record<string, ThreadModelCatalogEntry>>;
  inflight: ReadonlySet<string>;
};

type ExecutionOptionsBody = Awaited<ReturnType<typeof product.threads.executionOptions>>;
export type ThreadExecutionOptionsFetcher = (
  query?: { providerId?: string }
) => Promise<ExecutionOptionsBody>;

const listeners = new Set<() => void>();
const loads = new Map<string, Promise<void>>();
let fetchOptions: ThreadExecutionOptionsFetcher = (query) =>
  product.threads.executionOptions(query);
let prefetchInflight: Promise<void> | null = null;
let prefetchDirty = false;
let offeredSignature = '';
let providers: ThreadComposerProviderOption[] = [];
let byProvider: Record<string, ThreadModelCatalogEntry> = {};
let inflight = new Set<string>();
let catalogEpoch = 0;
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
  body: Pick<ExecutionOptionsBody, 'models' | 'selectedOnlyModels' | 'modelLoadError'> | null
): ThreadModelCatalogEntry {
  const models = (body?.models ?? []) as AvailableModel[];
  const selectedOnlyModels = (body?.selectedOnlyModels ?? []) as AvailableModel[];
  return {
    models: models.length > 0 ? models : fallbackModelsForProvider(providerId),
    selectedOnlyModels:
      selectedOnlyModels.length > 0
        ? selectedOnlyModels
        : fallbackMoreModelsForProvider(providerId),
    modelLoadError: body?.modelLoadError?.code ?? (body ? null : 'failed')
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

async function loadProvider(providerId: string): Promise<void> {
  const existing = loads.get(providerId);
  if (existing) return existing;
  const epoch = catalogEpoch;
  const pending = (async () => {
    inflight = new Set(inflight).add(providerId);
    emit();
    try {
      const body = await fetchOptions({ providerId });
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
  try {
    await pending;
  } finally {
    loads.delete(providerId);
  }
}

async function runPrefetch(): Promise<void> {
  let roster: ThreadComposerProviderOption[] = [];
  try {
    const body = await fetchOptions();
    roster = mapProviders(body.providers);
    applyRoster(roster);
    emit();
  } catch {
    emit();
    return;
  }
  const missing = roster.filter((row) => !byProvider[row.id]).map((row) => row.id);
  if (missing.length === 0) return;
  await Promise.allSettled(missing.map((id) => loadProvider(id)));
}

export function getThreadModelCatalog(): ThreadModelCatalogSnapshot {
  return snapshot;
}

export function subscribeThreadModelCatalog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function prefetchThreadModelCatalog(): Promise<void> {
  if (prefetchInflight) {
    prefetchDirty = true;
    return prefetchInflight;
  }
  prefetchInflight = (async () => {
    do {
      prefetchDirty = false;
      await runPrefetch();
    } while (prefetchDirty);
  })().finally(() => {
    prefetchInflight = null;
  });
  return prefetchInflight;
}

export function reloadThreadModelCatalog(): Promise<void> {
  catalogEpoch += 1;
  loads.clear();
  offeredSignature = '';
  providers = [];
  byProvider = {};
  inflight = new Set();
  emit();
  prefetchDirty = true;
  return prefetchThreadModelCatalog();
}

export function ensureThreadProviderModels(providerId: string): Promise<void> {
  const cached = byProvider[providerId];
  if (cached && cached.modelLoadError !== 'auth_required') return Promise.resolve();
  return loadProvider(providerId);
}

export function resetThreadModelCatalog(fetcher?: ThreadExecutionOptionsFetcher | null): void {
  fetchOptions = fetcher ?? ((query) => product.threads.executionOptions(query));
  prefetchInflight = null;
  prefetchDirty = false;
  catalogEpoch += 1;
  loads.clear();
  offeredSignature = '';
  providers = [];
  byProvider = {};
  inflight = new Set();
  emit();
}
