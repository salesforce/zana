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
    expect(catalog.getSnapshot().byProvider.codex?.modelLoadError).toBe('failed');
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
