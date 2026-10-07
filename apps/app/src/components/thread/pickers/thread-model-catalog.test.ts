import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ensureThreadProviderModels,
  getThreadModelCatalog,
  prefetchThreadModelCatalog,
  reloadThreadModelCatalog,
  reloadThreadProviderModels,
  resetThreadModelCatalog,
  threadModelCatalogForHost,
  MODEL_CATALOG_TIMEOUT_MS,
  MODEL_CATALOG_FRESH_MS,
  recoverStaleModelCatalogs, recoverUnavailableModelCatalogs, updateModelCatalogHosts, invalidateModelCatalogs, modelDiscoveryConfigKey,
  type ThreadExecutionOptionsFetcher
} from './thread-model-catalog.js';

type OptionsBody = Awaited<ReturnType<ThreadExecutionOptionsFetcher>>;

function modelRow(id: string): OptionsBody['models'][number] {
  return {
    id,
    model: id,
    displayName: id,
    supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'medium' }],
    defaultReasoningEffort: 'medium',
    isDefault: true
  };
}

function providerRow(id: string, displayName = id): OptionsBody['providers'][number] {
  return {
    id,
    displayName,
    available: true,
    composerActions: [],
    capabilities: { permissionModes: ['full'] }
  };
}

function optionsBody(
  providerIds: string[],
  modelsFor: string
): OptionsBody {
  return {
    providers: providerIds.map((id) => providerRow(id)),
    models: [modelRow(`${modelsFor}-model`)],
    selectedOnlyModels: [],
    permissionCeiling: 'full',
    modelLoadError: null
  };
}

afterEach(() => {
  resetThreadModelCatalog();
  vi.useRealTimers();
});

describe('thread model catalog', () => {
  it('publishes fast providers while every slow provider starts in parallel', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started: string[] = [];
    const roster = ['slow', 'slow-2', 'slow-3', 'fast', 'queued'];
    resetThreadModelCatalog(async (query) => {
      if (query?.providerId) started.push(query.providerId);
      if (query?.providerId?.startsWith('slow')) await gate;
      return optionsBody(roster, query?.providerId ?? 'roster');
    });
    const catalog = threadModelCatalogForHost();
    const published: string[][] = [];
    const unsubscribe = catalog.subscribe(() => {
      published.push(Object.keys(catalog.getSnapshot().byProvider));
    });
    let finished = false;
    const pending = catalog.ensure().then(() => { finished = true; });
    try {
      await vi.waitFor(() => {
        expect(catalog.getSnapshot().byProvider.queued?.models[0].model).toBe('queued-model');
      });
      expect(started).toEqual(roster);
      expect(finished).toBe(false);
      expect(catalog.getSnapshot().byProvider.slow).toBeUndefined();
      expect(catalog.getSnapshot().inflight).toEqual(new Set(['slow', 'slow-2', 'slow-3']));
      expect(published).toContainEqual(['fast']);
      expect(published).toContainEqual(['fast', 'queued']);
    } finally {
      release();
      await pending;
      unsubscribe();
    }
    expect(catalog.getSnapshot().byProvider.slow?.models[0].model).toBe('slow-model');
  });

  it('starts project scopes independently and cancels all scopes on reset', async () => {
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn<ThreadExecutionOptionsFetcher>((_query, options) => {
      signals.push(options!.signal);
      return new Promise(() => undefined);
    });
    resetThreadModelCatalog(fetcher);
    const pending = ['one', 'two', 'three', 'four'].map(project => threadModelCatalogForHost('local', project).ensure());
    expect(fetcher).toHaveBeenCalledTimes(4);
    resetThreadModelCatalog(async () => optionsBody(['codex'], 'recovered'));
    await Promise.all(pending);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(4);
    await threadModelCatalogForHost().ensure();
    expect(getThreadModelCatalog().byProvider.codex.models[0].model).toBe('recovered-model');
  });

  it('refreshes all scopes, shares concurrent recovery, and preserves rows while loading', async () => {
    let version = 'old';
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    resetThreadModelCatalog(async (query) => {
      if (version === 'new') await gate;
      return optionsBody(['codex'], `${query?.projectId ?? 'default'}-${version}`);
    });
    const project = threadModelCatalogForHost('local', 'project');
    await project.ensure();
    await prefetchThreadModelCatalog();
    const old = project.getSnapshot().byProvider.codex;
    version = 'new';
    const refresh = reloadThreadModelCatalog();
    expect(reloadThreadModelCatalog()).toBe(refresh);
    expect(project.getSnapshot().byProvider.codex).toBe(old);
    release();
    expect(await refresh).toEqual({ failedCatalogs: 0, failedProviders: [] });
    expect(project.getSnapshot().byProvider.codex.models[0].model).toBe('project-new-model');
    expect(getThreadModelCatalog().byProvider.codex.models[0].model).toBe('default-new-model');
  });

  it('reports unavailable scopes and failed providers instead of claiming refresh succeeded', async () => {
    resetThreadModelCatalog(async (query) => {
      if (query?.hostId === 'offline') throw new Error('offline');
      const body = optionsBody(['codex'], 'loaded');
      return query?.providerId ? { ...body, models: [],
        modelLoadError: { providerId: 'codex', code: 'auth_required', detail: null } } : body;
    });
    threadModelCatalogForHost('offline');
    expect(await reloadThreadModelCatalog()).toEqual({ failedCatalogs: 1, failedProviders: ['codex'] });
  });

  it('removes stale provider rows when a refreshed roster is empty', async () => {
    let roster = ['codex'];
    resetThreadModelCatalog(async () => optionsBody(roster, 'loaded'));
    await prefetchThreadModelCatalog();
    const seeded = threadModelCatalogForHost(undefined, 'empty-project');
    roster = [];
    await reloadThreadModelCatalog();
    expect(getThreadModelCatalog().providers).toEqual([]);
    expect(getThreadModelCatalog().byProvider).toEqual({});
    expect(seeded.getSnapshot().byProvider).toEqual({});
  });

  it('refreshes one provider across affected projects without mixing roles or touching other hosts', async () => {
    let version = 'old';
    const fetcher = vi.fn(async (query?: { hostId?: string; projectId?: string; providerId?: string }) => ({
      ...optionsBody(query?.hostId === 'other' ? ['pi'] : ['codex', 'pi'], `${query?.providerId}-${version}`),
      acpMode: { options: [{ value: query?.projectId ?? 'default' }] }
    }));
    resetThreadModelCatalog(fetcher);
    const a = threadModelCatalogForHost('local', 'a');
    const b = threadModelCatalogForHost('local', 'b');
    const other = threadModelCatalogForHost('other');
    await Promise.all([a.ensure(), b.ensure(), other.ensure(), prefetchThreadModelCatalog()]);
    const pi = a.getSnapshot().byProvider.pi;
    fetcher.mockClear();
    version = 'new';
    await reloadThreadProviderModels('codex');
    expect(a.getSnapshot().byProvider.codex.models[0].model).toBe('codex-new-model');
    expect(b.getSnapshot().byProvider.codex.models[0].model).toBe('codex-new-model');
    expect(a.getSnapshot().byProvider.codex.acpMode?.options).toEqual([{ value: 'a' }]);
    expect(b.getSnapshot().byProvider.codex.acpMode?.options).toEqual([{ value: 'b' }]);
    expect(a.getSnapshot().byProvider.pi).toBe(pi);
    expect(fetcher.mock.calls.every(([query]) => query?.providerId === 'codex' && query.hostId !== 'other')).toBe(true);
  });

  it('prefetches models for every offered harness and reuses the cache', async () => {
    const calls: Array<string | undefined> = [];
    const fetcher: ThreadExecutionOptionsFetcher = async (query) => {
      calls.push(query?.providerId);
      const roster = ['claude-code', 'codex', 'acp-opencode'];
      return optionsBody(roster, query?.providerId ?? 'roster');
    };
    resetThreadModelCatalog(fetcher);

    await prefetchThreadModelCatalog();
    expect(calls).toEqual([undefined, 'claude-code', 'codex', 'acp-opencode']);
    expect(getThreadModelCatalog().byProvider['codex']?.models[0]?.model).toBe('codex-model');
    expect(getThreadModelCatalog().byProvider['acp-opencode']?.models[0]?.model).toBe('acp-opencode-model');

    calls.length = 0;
    await prefetchThreadModelCatalog();
    await ensureThreadProviderModels('codex');
    expect(calls).toEqual([undefined]);
    expect(getThreadModelCatalog().inflight.size).toBe(0);
  });

  it('fetches only a newly offered harness and drops a removed one', async () => {
    let roster = ['claude-code', 'codex'];
    const calls: Array<string | undefined> = [];
    const fetcher: ThreadExecutionOptionsFetcher = async (query) => {
      calls.push(query?.providerId);
      return optionsBody(roster, query?.providerId ?? 'roster');
    };
    resetThreadModelCatalog(fetcher);

    await prefetchThreadModelCatalog();
    expect(Object.keys(getThreadModelCatalog().byProvider).sort()).toEqual(['claude-code', 'codex']);

    roster = ['claude-code', 'codex', 'pi'];
    calls.length = 0;
    await prefetchThreadModelCatalog();
    expect(calls).toEqual([undefined, 'pi']);
    expect(getThreadModelCatalog().byProvider.pi?.models[0]?.model).toBe('pi-model');

    roster = ['claude-code'];
    await prefetchThreadModelCatalog();
    expect(Object.keys(getThreadModelCatalog().byProvider)).toEqual(['claude-code']);
  });

  it('caches fallbacks after a provider fetch fails so the picker is not stuck loading', async () => {
    const fetcher: ThreadExecutionOptionsFetcher = async (query) => {
      if (query?.providerId === 'pi') throw new Error('unavailable');
      return optionsBody(['claude-code', 'pi'], query?.providerId ?? 'roster');
    };
    resetThreadModelCatalog(fetcher);
    await prefetchThreadModelCatalog();
    expect(getThreadModelCatalog().byProvider.pi).toBeDefined();
    expect(getThreadModelCatalog().byProvider.pi?.models).toEqual([]);
    expect(getThreadModelCatalog().byProvider.pi?.modelLoadError).toBe('failed');
    expect(getThreadModelCatalog().inflight.size).toBe(0);
  });

  it('retries a timed-out catalog so a slow Cursor/OpenCode list can refill the picker', async () => {
    let timedOut = true;
    const fetcher: ThreadExecutionOptionsFetcher = async (query) => {
      const body = optionsBody(['acp-cursor'], query?.providerId ?? 'roster');
      if (query?.providerId === 'acp-cursor' && timedOut) {
        return { ...body, models: [], modelLoadError: { providerId: 'acp-cursor', code: 'timeout' , detail: null } };
      }
      return body;
    };
    resetThreadModelCatalog(fetcher);
    await prefetchThreadModelCatalog();
    expect(getThreadModelCatalog().byProvider['acp-cursor']?.modelLoadError).toBe('timeout');
    expect(getThreadModelCatalog().byProvider['acp-cursor']?.models).toEqual([]);

    timedOut = false;
    await ensureThreadProviderModels('acp-cursor');
    expect(getThreadModelCatalog().byProvider['acp-cursor']?.modelLoadError).toBeNull();
    expect(getThreadModelCatalog().byProvider['acp-cursor']?.models[0]?.model).toBe('acp-cursor-model');
  });

  it('stores auth_required so Settings can show sign-in and a later retry can refill models', async () => {
    let signedIn = false;
    const fetcher: ThreadExecutionOptionsFetcher = async (query) => {
      const body = optionsBody(['acp-cursor'], query?.providerId ?? 'roster');
      if (query?.providerId === 'acp-cursor' && !signedIn) {
        return { ...body, models: [], modelLoadError: { providerId: 'acp-cursor', code: 'auth_required' , detail: null } };
      }
      return body;
    };
    resetThreadModelCatalog(fetcher);
    await prefetchThreadModelCatalog();
    expect(getThreadModelCatalog().byProvider['acp-cursor']?.modelLoadError).toBe('auth_required');
    expect(getThreadModelCatalog().byProvider['acp-cursor']?.models).toEqual([]);

    signedIn = true;
    await ensureThreadProviderModels('acp-cursor');
    expect(getThreadModelCatalog().byProvider['acp-cursor']?.modelLoadError).toBeNull();
    expect(getThreadModelCatalog().byProvider['acp-cursor']?.models[0]?.model).toBe('acp-cursor-model');
  });

  it('reloads every offered harness so Settings Check can pick up a new login', async () => {
    const calls: Array<string | undefined> = [];
    const fetcher: ThreadExecutionOptionsFetcher = async (query) => {
      calls.push(query?.providerId);
      return optionsBody(['claude-code', 'codex'], query?.providerId ?? 'roster');
    };
    resetThreadModelCatalog(fetcher);
    await prefetchThreadModelCatalog();
    calls.length = 0;
    await reloadThreadModelCatalog();
    expect(calls).toEqual([undefined, 'claude-code', 'codex']);
  });

  it('reloads one provider after a successful cache without wiping the others', async () => {
    const calls: Array<string | undefined> = [];
    const fetcher: ThreadExecutionOptionsFetcher = async (query) => {
      calls.push(query?.providerId);
      return optionsBody(['claude-code', 'codex'], query?.providerId ?? 'roster');
    };
    resetThreadModelCatalog(fetcher);
    await prefetchThreadModelCatalog();
    calls.length = 0;
    await reloadThreadProviderModels('codex');
    expect(calls).toEqual(['codex']);
    expect(getThreadModelCatalog().byProvider['claude-code']?.models[0]?.model).toBe('claude-code-model');
    expect(getThreadModelCatalog().byProvider.codex?.models[0]?.model).toBe('codex-model');
  });

  it('stores session-advertised ACP modes verbatim and refreshes them with the provider', async () => {
    let load = 0;
    const fetcher: ThreadExecutionOptionsFetcher = async (query) => {
      load += 1;
      const body = optionsBody(['acp-cursor'], query?.providerId ?? 'roster');
      return {
        ...body,
        acpMode: {
          currentValue: load < 3 ? 'build' : 'review',
          options: load < 3
            ? [{ value: 'build', name: 'Build' }, { value: 'plan', name: 'Plan' }]
            : [{ value: 'review', name: 'Review changes' }]
        }
      };
    };
    resetThreadModelCatalog(fetcher);

    await prefetchThreadModelCatalog();
    expect(getThreadModelCatalog().byProvider['acp-cursor']?.acpMode).toEqual({
      currentValue: 'build',
      options: [{ value: 'build', name: 'Build' }, { value: 'plan', name: 'Plan' }]
    });

    await reloadThreadProviderModels('acp-cursor');
    expect(getThreadModelCatalog().byProvider['acp-cursor']?.acpMode).toEqual({
      currentValue: 'review',
      options: [{ value: 'review', name: 'Review changes' }]
    });
  });

  it('shares an in-flight reload instead of starting a second fetch', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let providerFetches = 0;
    const fetcher: ThreadExecutionOptionsFetcher = async (query) => {
      if (query?.providerId === 'codex') {
        providerFetches += 1;
        await gate;
      }
      return optionsBody(['codex'], query?.providerId ?? 'roster');
    };
    resetThreadModelCatalog(fetcher);
    const first = reloadThreadProviderModels('codex');
    const second = reloadThreadProviderModels('codex');
    expect(second).toBe(first);
    release();
    await first;
    expect(providerFetches).toBe(1);
    expect(getThreadModelCatalog().byProvider.codex?.models[0]?.model).toBe('codex-model');
  });

  it('re-runs prefetch when a harness is added while the first load is in flight', async () => {
    let roster = ['claude-code'];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let gated = true;
    const fetcher: ThreadExecutionOptionsFetcher = async (query) => {
      const ids = [...roster];
      if (!query?.providerId && gated) {
        gated = false;
        await gate;
      }
      return optionsBody(ids, query?.providerId ?? 'roster');
    };
    resetThreadModelCatalog(fetcher);
    const first = prefetchThreadModelCatalog();
    roster = ['claude-code', 'codex'];
    const second = prefetchThreadModelCatalog();
    release();
    await Promise.all([first, second]);
    expect(getThreadModelCatalog().byProvider.codex).toBeDefined();
  });

  it('refills after reload wipes an in-flight provider fetch', async () => {
    let releaseClaude: () => void = () => undefined;
    const claudeGate = new Promise<void>((resolve) => {
      releaseClaude = resolve;
    });
    let claudeFetches = 0;
    const fetcher: ThreadExecutionOptionsFetcher = async (query) => {
      if (query?.providerId === 'claude-code') {
        claudeFetches += 1;
        if (claudeFetches === 1) await claudeGate;
      }
      return optionsBody(['claude-code'], query?.providerId ?? 'roster');
    };
    resetThreadModelCatalog(fetcher);
    const first = prefetchThreadModelCatalog();
    await vi.waitFor(() => expect(claudeFetches).toBe(1));
    const reloaded = reloadThreadModelCatalog();
    expect(getThreadModelCatalog().byProvider['claude-code']).toBeUndefined();
    releaseClaude();
    await reloaded;
    await vi.waitFor(() => {
      expect(getThreadModelCatalog().byProvider['claude-code']?.models[0]?.model).toBe('claude-code-model');
    });
    expect(claudeFetches).toBeGreaterThanOrEqual(2);
  });

  it('refills when reload races prefetch settle', async () => {
    const fetcher: ThreadExecutionOptionsFetcher = async (query) => (
      optionsBody(['claude-code'], query?.providerId ?? 'roster')
    );
    resetThreadModelCatalog(fetcher);
    const first = prefetchThreadModelCatalog();
    queueMicrotask(() => {
      void reloadThreadModelCatalog();
    });
    await first;
    await vi.waitFor(() => {
      expect(getThreadModelCatalog().byProvider['claude-code']?.models[0]?.model).toBe('claude-code-model');
    });
  });

  it('scopes every request and cached roster to its own machine', async () => {
    const calls: Array<{ providerId?: string; hostId?: string } | undefined> = [];
    resetThreadModelCatalog(async (query) => {
      calls.push(query);
      return optionsBody(query?.hostId === 'remote' ? ['acp-opencode'] : ['codex'], query?.hostId ?? 'local');
    });
    const local = threadModelCatalogForHost('local');
    const remote = threadModelCatalogForHost('remote');
    await local.ensure();
    await remote.ensure();
    expect(local.getSnapshot().byProvider.codex?.models[0]?.model).toBe('local-model');
    expect(remote.getSnapshot().byProvider['acp-opencode']?.models[0]?.model).toBe('remote-model');
    expect(local.getSnapshot().byProvider['acp-opencode']).toBeUndefined();
    expect(calls).toEqual([
      { hostId: 'local' }, { hostId: 'local', providerId: 'codex' },
      { hostId: 'remote' }, { hostId: 'remote', providerId: 'acp-opencode' }
    ]);
    calls.length = 0;
    await threadModelCatalogForHost('local').ensure();
    await local.ensureProvider('codex');
    expect(calls).toEqual([]);
    expect(threadModelCatalogForHost(' local ')).toBe(local);
    expect(threadModelCatalogForHost(' ')).toBe(threadModelCatalogForHost());
  });

  it('loads local models while a remote roster is stalled, without cross-host notifications', async () => {
    let release!: (body: OptionsBody) => void;
    const gate = new Promise<OptionsBody>((resolve) => { release = resolve; });
    resetThreadModelCatalog(async (query) => query?.hostId === 'remote' ? gate : optionsBody(['codex'], 'local'));
    const remote = threadModelCatalogForHost('remote');
    const local = threadModelCatalogForHost('local');
    const changed = vi.fn();
    const unsubscribe = local.subscribe(changed);
    const waiting = remote.ensure();
    expect(remote.ensure()).toBe(waiting);
    await local.ensure();
    expect(local.getSnapshot().byProvider.codex?.models[0]?.model).toBe('local-model');
    changed.mockClear();
    release(optionsBody(['acp-opencode'], 'remote'));
    await waiting;
    expect(local.getSnapshot().providers.map((row) => row.id)).toEqual(['codex']);
    expect(changed).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('restores a warm local cache immediately while a remote provider is still discovering models', async () => {
    let release!: (body: OptionsBody) => void;
    const gate = new Promise<OptionsBody>((resolve) => { release = resolve; });
    resetThreadModelCatalog(async (query) => query?.hostId === 'remote' && query.providerId
      ? gate : optionsBody(['codex'], query?.hostId ?? 'local'));
    const local = threadModelCatalogForHost('local');
    await local.ensure();
    const snapshot = local.getSnapshot();
    const remote = threadModelCatalogForHost('remote');
    const waiting = remote.ensure();
    await vi.waitFor(() => expect(remote.getSnapshot().inflight.has('codex')).toBe(true));
    await local.ensure();
    expect(local.getSnapshot()).toBe(snapshot);
    expect(local.getSnapshot().inflight.size).toBe(0);
    release(optionsBody(['codex'], 'remote'));
    await waiting;
    expect(local.getSnapshot()).toBe(snapshot);
  });

  it('ignores a late stale roster after reload and starts the new load immediately', async () => {
    let release!: (body: OptionsBody) => void;
    const gate = new Promise<OptionsBody>((resolve) => { release = resolve; });
    let first = true;
    resetThreadModelCatalog(async () => {
      if (first) { first = false; return gate; }
      return optionsBody(['codex'], 'fresh');
    });
    const catalog = threadModelCatalogForHost();
    const old = catalog.ensure();
    await catalog.reload();
    expect(catalog.getSnapshot().byProvider.codex?.models[0]?.model).toBe('fresh-model');
    release(optionsBody(['acp-opencode'], 'stale'));
    await old;
    expect(catalog.getSnapshot().providers.map((row) => row.id)).toEqual(['codex']);
    expect(catalog.getSnapshot().inflight.size).toBe(0);
  });

  it('ends a hung provider load at the deadline and allows an explicit retry', async () => {
    vi.useFakeTimers();
    let stalled = true;
    resetThreadModelCatalog(async () => stalled ? new Promise<OptionsBody>(() => {}) : optionsBody(['codex'], 'recovered'));
    const catalog = threadModelCatalogForHost('local');
    const waiting = catalog.ensureProvider('codex');
    expect(catalog.getSnapshot().inflight.has('codex')).toBe(true);
    await vi.advanceTimersByTimeAsync(MODEL_CATALOG_TIMEOUT_MS);
    await waiting;
    expect(catalog.getSnapshot().inflight.size).toBe(0);
    expect(catalog.getSnapshot().byProvider.codex?.modelLoadError).toBe('timeout');
    expect(vi.getTimerCount()).toBe(0);
    stalled = false;
    await catalog.reloadProvider('codex');
    expect(catalog.getSnapshot().byProvider.codex?.models[0]?.model).toBe('recovered-model');
  });

  it('can retry a failed roster and keeps models visible during a provider refresh', async () => {
    let fails = true;
    resetThreadModelCatalog(async () => {
      if (fails) throw new Error('offline');
      return optionsBody(['codex'], 'loaded');
    });
    const catalog = threadModelCatalogForHost();
    await catalog.ensure();
    fails = false;
    await catalog.ensure();
    const models = catalog.getSnapshot().byProvider.codex;
    const refresh = catalog.reloadProvider('codex');
    expect(catalog.getSnapshot().byProvider.codex).toBe(models);
    await refresh;
  });

  it('reuses same-host models immediately but discovers each project’s own roles', async () => {
    let release!: (body: OptionsBody) => void;
    const gate = new Promise<OptionsBody>((resolve) => { release = resolve; });
    const fetcher = vi.fn(async (query?: { hostId?: string; projectId?: string; providerId?: string }) => {
      if (query?.projectId === 'project-b' && query.providerId) return gate;
      return { ...optionsBody(['acp-opencode'], 'shared'), acpMode: {
        currentValue: 'build', options: [{ value: 'build', name: 'Build' }, { value: 'project-a-role', name: 'A role' }]
      } };
    });
    resetThreadModelCatalog(fetcher);
    const a = threadModelCatalogForHost('local', 'project-a');
    await a.ensure();
    const b = threadModelCatalogForHost('local', 'project-b');
    expect(b.getSnapshot().byProvider['acp-opencode']?.models).toBe(a.getSnapshot().byProvider['acp-opencode']?.models);
    expect(b.getSnapshot().byProvider['acp-opencode']?.acpMode).toBeUndefined();
    const loading = b.ensure();
    const providerLoading = b.ensureProvider('acp-opencode');
    await vi.waitFor(() => expect(b.getSnapshot().inflight.has('acp-opencode')).toBe(true));
    expect(b.getSnapshot().byProvider['acp-opencode']?.models[0]?.model).toBe('shared-model');
    await a.ensure();
    expect(a.getSnapshot().inflight.size).toBe(0);
    release({ ...optionsBody(['acp-opencode'], 'shared'), acpMode: { currentValue: 'build', options: [{ value: 'build' }] } });
    await Promise.all([loading, providerLoading]);
    expect(b.getSnapshot().byProvider['acp-opencode']?.acpMode?.options).toEqual([{ value: 'build' }]);
    expect(a.getSnapshot().byProvider['acp-opencode']?.acpMode?.options).toHaveLength(2);
    expect(fetcher.mock.calls.every(([query]) => query?.hostId === 'local' && query.projectId)).toBe(true);
    expect(threadModelCatalogForHost('local', ' project-b ')).toBe(b);
    fetcher.mockClear();
    await threadModelCatalogForHost('local', 'project-a').ensure();
    await b.ensure();
    expect(fetcher).not.toHaveBeenCalled();
    const hostOnly = threadModelCatalogForHost('local');
    await hostOnly.ensure();
    expect(fetcher.mock.calls.every(([query]) => query?.projectId === undefined)).toBe(true);
  });

  it('bounds inactive host caches while retaining mounted subscribers', () => {
    const mounted = threadModelCatalogForHost('mounted');
    const unsubscribe = mounted.subscribe(() => {});
    const oldest = threadModelCatalogForHost('oldest');
    for (let i = 0; i < 12; i += 1) threadModelCatalogForHost(`host-${i}`);
    expect(threadModelCatalogForHost('mounted')).toBe(mounted);
    expect(threadModelCatalogForHost('oldest')).not.toBe(oldest);
    unsubscribe();
  });
});

describe('automatic catalog recovery', () => {
  it('automatically retries a missing provider and clears its error when registration returns', async () => {
    vi.useFakeTimers();
    let missing = true;
    const fetcher = vi.fn(async (query) => query?.providerId && missing
      ? { ...optionsBody(['codex'], 'stale'), models: [], modelLoadError: { providerId: 'codex', code: 'provider_unavailable' as const, detail: null } }
      : optionsBody(['codex'], 'working'));
    resetThreadModelCatalog(fetcher);
    const catalog = threadModelCatalogForHost('local', 'project');
    const unsubscribe = catalog.subscribe(() => undefined);
    await catalog.ensure();
    expect(catalog.getSnapshot().byProvider.codex).toMatchObject({ models: [], modelLoadError: 'provider_unavailable' });
    missing = false;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(catalog.getSnapshot().byProvider.codex).toMatchObject({ modelLoadError: null, models: [modelRow('working-model')] });
    expect(fetcher).toHaveBeenCalledTimes(3);
    unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds unavailable-provider retries and rediscovers only repaired providers on roster refresh', async () => {
    vi.useFakeTimers();
    let repaired = false;
    const fetcher = vi.fn(async (query) => {
      const body = optionsBody(['codex', 'pi'], 'working');
      body.providers[0].available = repaired;
      body.providers[1].available = false;
      if (!query?.providerId || (query.providerId === 'codex' && repaired)) return body;
      return { ...body, models: [], modelLoadError: { providerId: query.providerId, code: 'provider_unavailable' as const, detail: 'Plugin unavailable' } };
    });
    resetThreadModelCatalog(fetcher);
    const catalog = threadModelCatalogForHost();
    const unsubscribe = catalog.subscribe(() => undefined);
    await catalog.ensure();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher.mock.calls.filter(([query]) => query?.providerId === 'codex')).toHaveLength(4);
    expect(fetcher.mock.calls.filter(([query]) => query?.providerId === 'pi')).toHaveLength(4);
    repaired = true;
    await vi.advanceTimersByTimeAsync(MODEL_CATALOG_FRESH_MS);
    expect(catalog.getSnapshot().byProvider.codex.modelLoadError).toBeNull();
    expect(catalog.getSnapshot().byProvider.pi.modelLoadError).toBe('provider_unavailable');
    expect(fetcher.mock.calls.filter(([query]) => query?.providerId === 'pi')).toHaveLength(4);
    unsubscribe();
  });

  it('recovers failed catalogs on plugin lifecycle changes while leaving healthy and offline scopes idle', async () => {
    vi.useFakeTimers();
    let failed = true;
    const fetcher = vi.fn(async (query) => query?.providerId && query.projectId !== 'healthy' && failed
      ? { ...optionsBody(['codex'], 'stale'), models: [], modelLoadError: { providerId: 'codex', code: 'provider_unavailable' as const, detail: null } }
      : optionsBody(['codex'], 'working'));
    resetThreadModelCatalog(fetcher);
    updateModelCatalogHosts([{ id: 'local', status: 'connected' }, { id: 'offline', status: 'connected' }]);
    const mounted = threadModelCatalogForHost('local', 'failed');
    const idle = threadModelCatalogForHost('local', 'idle');
    const healthy = threadModelCatalogForHost('local', 'healthy');
    const offline = threadModelCatalogForHost('offline', 'failed');
    const unsubscribers = [mounted, healthy, offline].map((catalog) => catalog.subscribe(() => undefined));
    await Promise.all([mounted.ensure(), idle.ensure(), healthy.ensure(), offline.ensure()]);
    updateModelCatalogHosts([{ id: 'local', status: 'connected' }, { id: 'offline', status: 'disconnected' }]);
    fetcher.mockClear();
    failed = false;
    recoverUnavailableModelCatalogs();
    await vi.advanceTimersByTimeAsync(0);
    expect(mounted.getSnapshot().byProvider.codex.modelLoadError).toBeNull();
    expect(fetcher.mock.calls.map(([query]) => query?.projectId)).toEqual(['failed', 'failed']);
    await idle.ensure();
    expect(idle.getSnapshot().byProvider.codex.modelLoadError).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(4);
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears cached models and modes when the provider plugin becomes unavailable', async () => {
    let unavailable = false;
    resetThreadModelCatalog(async () => unavailable
      ? { ...optionsBody(['codex'], 'stale'), models: [], selectedOnlyModels: [], modelLoadError: { providerId: 'codex', code: 'provider_unavailable', detail: 'Open Plugins to reload' } }
      : optionsBody(['codex'], 'working'));
    const catalog = threadModelCatalogForHost();
    await catalog.ensure();
    expect(catalog.getSnapshot().byProvider.codex.models).not.toEqual([]);
    unavailable = true;
    await catalog.reloadProvider('codex');
    expect(catalog.getSnapshot().byProvider.codex).toMatchObject({ models: [], selectedOnlyModels: [], modelLoadError: 'provider_unavailable' });
    expect(catalog.getSnapshot().byProvider.codex.lastSuccessAt).toBeUndefined();
    unavailable = false;
    await catalog.reloadProvider('codex');
    expect(catalog.getSnapshot().byProvider.codex.models).not.toEqual([]);
  });

  it('retries temporary provider failures, keeps successful rows and clears the error on recovery', async () => {
    vi.useFakeTimers();
    let failed = false;
    const fetcher = vi.fn(async () => {
      if (failed) throw new Error('temporarily unavailable');
      return optionsBody(['codex'], 'working');
    });
    resetThreadModelCatalog(fetcher);
    const catalog = threadModelCatalogForHost();
    const unsubscribe = catalog.subscribe(() => undefined);
    await catalog.ensure();
    const success = catalog.getSnapshot().byProvider.codex;
    failed = true;
    await catalog.reloadProvider('codex');
    expect(catalog.getSnapshot().byProvider.codex).toMatchObject({
      models: success.models, lastSuccessAt: success.lastSuccessAt, modelLoadError: 'failed'
    });
    failed = false;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(catalog.getSnapshot().byProvider.codex.modelLoadError).toBeNull();
    unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds automatic retries and does not poll authentication failures', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => { throw new Error('offline'); });
    resetThreadModelCatalog(fetcher);
    const catalog = threadModelCatalogForHost();
    catalog.subscribe(() => undefined);
    await catalog.ensure();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(catalog.getSnapshot().rosterError).toBe('offline');
    expect(vi.getTimerCount()).toBe(0);
    fetcher.mockImplementation(async () => { throw Object.assign(new Error('login'), { status: 401 }); });
    await catalog.reload();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).toHaveBeenCalledTimes(5);
    recoverStaleModelCatalogs();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(6);
    recoverStaleModelCatalogs();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it('refreshes successful mounted catalogs after expiry and cancels work when idle', async () => {
    vi.useFakeTimers();
    let version = 'one';
    const fetcher = vi.fn(async () => optionsBody(['codex'], version));
    resetThreadModelCatalog(fetcher);
    const catalog = threadModelCatalogForHost();
    const unsubscribe = catalog.subscribe(() => undefined);
    await catalog.ensure();
    version = 'two';
    recoverStaleModelCatalogs();
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(MODEL_CATALOG_FRESH_MS);
    expect(catalog.getSnapshot().byProvider.codex.models[0].model).toBe('two-model');
    unsubscribe();
    const count = fetcher.mock.calls.length;
    await vi.advanceTimersByTimeAsync(MODEL_CATALOG_FRESH_MS * 2);
    expect(fetcher).toHaveBeenCalledTimes(count);
    await catalog.ensure();
    expect(fetcher).toHaveBeenCalledTimes(count + 2);
  });

  it('recovers only the reconnected host and invalidates idle scopes until they mount', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => optionsBody(['codex'], 'working'));
    resetThreadModelCatalog(fetcher);
    updateModelCatalogHosts([{ id: 'one', status: 'connected', isPrimary: true }, { id: 'two', status: 'connected' }]);
    const mounted = threadModelCatalogForHost('one');
    const idle = threadModelCatalogForHost('one', 'idle');
    const other = threadModelCatalogForHost('two');
    mounted.subscribe(() => undefined);
    other.subscribe(() => undefined);
    await Promise.all([mounted.ensure(), idle.ensure(), other.ensure()]);
    fetcher.mockClear();
    updateModelCatalogHosts([{ id: 'one', status: 'disconnected', isPrimary: true }, { id: 'two', status: 'connected' }]);
    await vi.advanceTimersByTimeAsync(100);
    expect(fetcher).not.toHaveBeenCalled();
    updateModelCatalogHosts([{ id: 'one', status: 'connected', isPrimary: true }, { id: 'two', status: 'connected' }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher.mock.calls.map(([query]) => query)).toEqual([{ hostId: 'one' }, { hostId: 'one', providerId: 'codex' }]);
    await idle.ensure();
    expect(fetcher).toHaveBeenCalledTimes(4);
    updateModelCatalogHosts([{ id: 'one', status: 'connected', isPrimary: true }, { id: 'two', status: 'connected' }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('does not start automatic discovery for a newly mounted offline host', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => optionsBody(['codex'], 'working'));
    resetThreadModelCatalog(fetcher);
    updateModelCatalogHosts([{ id: 'one', status: 'disconnected' }]);
    const catalog = threadModelCatalogForHost('one');
    catalog.subscribe(() => undefined);
    await catalog.ensure();
    invalidateModelCatalogs();
    expect(fetcher).not.toHaveBeenCalled();
    updateModelCatalogHosts([{ id: 'one', status: 'connected' }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('preserves the roster on a temporary roster failure and retries it', async () => {
    vi.useFakeTimers();
    let failed = false;
    resetThreadModelCatalog(async () => {
      if (failed) throw Object.assign(new Error('Host disconnected'), { code: 'host-unavailable' });
      return optionsBody(['codex'], 'working');
    });
    const catalog = threadModelCatalogForHost();
    catalog.subscribe(() => undefined);
    await catalog.ensure();
    failed = true;
    await catalog.reload();
    expect(catalog.getSnapshot().providers.map(p => p.id)).toEqual(['codex']);
    expect(catalog.getSnapshot().byProvider.codex.models).toHaveLength(1);
    failed = false;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(catalog.getSnapshot().rosterError).toBeNull();
  });

  it('aborts hung transport work on timeout and on invalidation', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    resetThreadModelCatalog((_query, options) => {
      signals.push(options!.signal);
      return new Promise(() => undefined);
    });
    const catalog = threadModelCatalogForHost();
    const first = catalog.ensure();
    const second = catalog.reload();
    await first;
    expect(signals[0].aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(MODEL_CATALOG_TIMEOUT_MS);
    await second;
    expect(signals[1].aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not retry invalid requests and shows their bounded diagnostic', async () => {
    vi.useFakeTimers();
    resetThreadModelCatalog(async () => { throw Object.assign(new Error('bad project'.repeat(100)), { status: 404 }); });
    const catalog = threadModelCatalogForHost();
    catalog.subscribe(() => undefined);
    await catalog.ensureProvider('codex');
    expect(catalog.getSnapshot().byProvider.codex.modelLoadError).toBe('invalid_request');
    expect(catalog.getSnapshot().byProvider.codex.modelLoadErrorDetail).toHaveLength(300);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores cosmetic config changes but invalidates model discovery settings', () => {
    const initial = { theme: 'light', codexBinary: 'codex', harnessCodexEnabled: true };
    expect(modelDiscoveryConfigKey(initial)).toBe(modelDiscoveryConfigKey({ ...initial, theme: 'dark' }));
    expect(modelDiscoveryConfigKey(initial)).not.toBe(modelDiscoveryConfigKey({ ...initial, codexBinary: 'new' }));
    expect(modelDiscoveryConfigKey(initial)).not.toBe(modelDiscoveryConfigKey({ ...initial, harnessCodexEnabled: false }));
    expect(modelDiscoveryConfigKey(initial)).not.toBe(modelDiscoveryConfigKey({ ...initial, providerServiceTiersDisabled: true }));
  });
});

it('retries an old authentication failure when the picker remounts, with a cooldown', async () => {
  vi.useFakeTimers();
  let failed = true;
  const fetcher = vi.fn<ThreadExecutionOptionsFetcher>(async () => ({ ...optionsBody(['codex'], 'working'),
    modelLoadError: failed ? { providerId: 'codex', code: 'auth_required', detail: null } : null }));
  resetThreadModelCatalog(fetcher);
  const catalog = threadModelCatalogForHost();
  await catalog.ensure();
  await catalog.ensure();
  expect(fetcher).toHaveBeenCalledTimes(2);
  failed = false;
  await vi.advanceTimersByTimeAsync(60_000);
  await catalog.ensure();
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(catalog.getSnapshot().byProvider.codex.modelLoadError).toBeNull();
});


describe('recovery with subscribers that read the LRU catalog', () => {
  it.each(['config', 'reconnect', 'plugin', 'focus'] as const)('bounds %s recovery even when notification reorders the catalog Map', async (trigger) => {
    let fail = trigger === 'plugin';
    const fetcher = vi.fn(async () => ({
      ...optionsBody(['codex'], 'fresh'),
      modelLoadError: fail ? { providerId: 'codex', code: 'provider_unavailable', detail: null } : null
    }));
    resetThreadModelCatalog(fetcher);
    updateModelCatalogHosts([{ id: 'local', status: 'connected', isPrimary: true }]);
    await prefetchThreadModelCatalog();
    if (trigger === 'reconnect') updateModelCatalogHosts([{ id: 'local', status: 'disconnected', isPrimary: true }]);
    if (trigger === 'focus') vi.spyOn(Date, 'now').mockReturnValue(Date.now() + MODEL_CATALOG_FRESH_MS + 1);
    const before = fetcher.mock.calls.length;
    let notifications = 0;
    const catalog = threadModelCatalogForHost();
    const unsubscribe = catalog.subscribe(() => {
      // Fail quickly on regression instead of allowing an infinite loop to
      // wedge the worker. React's external-store subscriber reads like this.
      if (++notifications > 20) throw new Error('Recovery revisited a catalog indefinitely');
      getThreadModelCatalog();
    });
    fail = false;
    try {
      if (trigger === 'config') invalidateModelCatalogs();
      if (trigger === 'reconnect') updateModelCatalogHosts([{ id: 'local', status: 'connected', isPrimary: true }]);
      if (trigger === 'plugin') recoverUnavailableModelCatalogs();
      if (trigger === 'focus') recoverStaleModelCatalogs();
      await vi.waitFor(() => expect(fetcher.mock.calls.length).toBeGreaterThan(before));
      await vi.waitFor(() => expect(getThreadModelCatalog().inflight.size).toBe(0));
      expect(notifications).toBeLessThan(20);
      await vi.waitFor(() => expect(getThreadModelCatalog().byProvider.codex.modelLoadError).toBeNull());
    } finally {
      unsubscribe();
      vi.restoreAllMocks();
    }
  });
});
