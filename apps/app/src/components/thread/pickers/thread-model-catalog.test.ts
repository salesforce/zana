import { afterEach, describe, expect, it } from 'vitest';
import {
  ensureThreadProviderModels,
  getThreadModelCatalog,
  prefetchThreadModelCatalog,
  reloadThreadModelCatalog,
  reloadThreadProviderModels,
  resetThreadModelCatalog,
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
        return { ...body, models: [], modelLoadError: { providerId: 'acp-cursor', code: 'timeout' } };
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
        return { ...body, models: [], modelLoadError: { providerId: 'acp-cursor', code: 'auth_required' } };
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
    expect(second).toBe(first);
    release();
    await first;
    expect(getThreadModelCatalog().byProvider.codex).toBeDefined();
  });
});
