/**
 * @vitest-environment happy-dom
 */
import { createElement, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { useThreadComposerOptions } from './useThreadComposerOptions.js';
import { resetThreadModelCatalog } from './thread-model-catalog.js';
import { ComposerSession } from '../../composer/composer-session.js';

// `new URL('./x', import.meta.url)` resolves against the happy-dom-emulated
// `location` (not the given base) once this file's environment is happy-dom,
// so the source-scan assertions below read the file via a plain path instead.
const HOOK_SOURCE_PATH = join(import.meta.dirname, 'useThreadComposerOptions.ts');

function Probe({ threadId, initialAcpMode }: { threadId: string; initialAcpMode: string | null }) {
  const options = useThreadComposerOptions({
    threadId,
    lockedProviderId: 'claude-code',
    initialAcpMode
  });
  return createElement('span', { 'data-testid': 'acp-mode' }, options.acpMode ?? 'none');
}

describe('useThreadComposerOptions', () => {
  it('reads the session model catalog, reconciles hardness, and only falls back provider on a new thread', () => {
    const source = readFileSync(HOOK_SOURCE_PATH, 'utf8');
    expect(source).toContain('hostId?: string');
    expect(source).toContain('hostPending?: boolean');
    expect(source).toContain('if (input.hostPending) return');
    expect(source).toContain('void hostCatalog.ensure()');
    expect(source).toContain('threadModelCatalogForHost(input.hostId, input.projectId)');
    expect(source).toContain('hostCatalog.ensureProvider');
    expect(source).toContain('if (input.hostPending || cached) return');
    expect(source).toContain('[hostCatalog, input.hostPending, providerId, cached]');
    expect(source).toContain('catalog.inflight.has(providerId)');
    expect(source).toContain('hostCatalog.getSnapshot');
    expect(source).toContain('reconcileReasoningLevel');
    expect(source).toContain('if (catalog.providers.length === 0) return');
    expect(source).toContain('rememberComposerSelection');
    expect(source).toContain('rememberedProviderId');
    expect(source).toContain('rememberedSelectionFor');
    expect(source).toContain('setProviderIdState(next)');
    expect(source).toContain('fallbackModelsForProvider');
    expect(source).toContain('availableModelsToPickerOptions');
    expect(source).toContain('fallbackMoreModelsForProvider');
    expect(source).toContain('composerProvidersFromCatalog');
    expect(source).toContain('snapNewThreadProviderId');
    expect(source).toContain('input.preferredProviderId');
    expect(source).toContain('rosterReady');
    expect(source).toContain('registeredProviderIds');
    expect(source).toContain('input.threadId || input.lockedProviderId');
    expect(source).not.toContain('catalog.providers[0]');
    expect(source).toContain('visibleComposerReasoningLevels');
    expect(source).toContain('modelIsLoading: loading');
    expect(source).toContain('modelLoadError');
    expect(source).not.toContain('AgentLauncher');
    expect(source).not.toContain('list_models');
    expect(source).toContain('rememberComposerSelection({ providerId, model: value, reasoningLevel })');
    expect(source).toContain('const persistSelection = !input.threadId');
    expect(source).toContain('preferredComposerModel');
    expect(source).toContain('defaultOfferedComposerModel');
    expect(source).toContain('persistRemembered: persistSelection');
    expect(source).toContain('rememberComposerSelection({ providerId, model: nextModel, reasoningLevel })');
    expect(source).not.toContain('if (restored.model)');
  });

  it('gates Native role on advertised modes, adopts the session default via the pure selector, and exposes refresh', () => {
    const source = readFileSync(HOOK_SOURCE_PATH, 'utf8');
    expect(source).toContain("const acpModeOptions = cached?.acpMode?.options ?? []");
    expect(source).toContain('nextAcpModeSelection');
    expect(source).toContain('selected: acpMode');
    expect(source).toContain('options: acpModeOptions');
    expect(source).toContain('if (next !== undefined && next !== acpMode) setAcpModeState(next)');
    expect(source).toContain('initialAcpMode');
    expect(source).toContain('requestedValid');
    expect(source).toContain('appliedRequestedAcpModeRef');
    expect(source).toContain('hostCatalog.refresh(providerId)');
    expect(source).toContain('refreshAcpModeOptions');
  });

  it('only auto-seeds the native role on a NEW thread, never for an existing thread', () => {
    // An existing thread has no per-thread mode source; seeding the sessionless
    // provider default (build) both misled the picker and force-reset the running
    // mode on every follow-up turn. The seed effect must bail for existing threads.
    const source = readFileSync(HOOK_SOURCE_PATH, 'utf8');
    expect(source).toContain('Existing threads: never auto-seed or reset the native role');
    expect(source).toContain('if (input.threadId) return;');
  });

  it('adopts the existing thread persisted native role via initialAcpMode', () => {
    // The picker must show the mode the thread is actually running: acpMode state
    // seeds from the fetched persisted value, and the rehydrate effect re-applies
    // it once the async thread fetch resolves.
    const source = readFileSync(HOOK_SOURCE_PATH, 'utf8');
    expect(source).toContain('initialAcpMode?: string | null');
    expect(source).toContain('hasAcpMode ? savedAcpMode : input.initialAcpMode ?? undefined');
    expect(source).toContain('if (!hasAcpMode) setAcpModeState(input.initialAcpMode ?? undefined);');
    expect(source).toContain('}, [input.initialAcpMode, hasAcpMode]);');
  });
});

describe('useThreadComposerOptions acpMode rehydration (rendered)', () => {
  afterEach(() => {
    cleanup();
  });

  it('clears a stale truthy acpMode when reused for a new thread whose persisted mode resolves to null', async () => {
    resetThreadModelCatalog(async () => ({
      providers: [],
      models: [],
      selectedOnlyModels: [],
      modelLoadError: null
    }) as never);

    const { getByTestId, rerender } = render(
      createElement(Probe, { threadId: 'thread-a', initialAcpMode: 'reviewer' })
    );
    expect(getByTestId('acp-mode').textContent).toBe('reviewer');

    rerender(createElement(Probe, { threadId: 'thread-b', initialAcpMode: null }));
    expect(getByTestId('acp-mode').textContent).toBe('none');
  });
});

describe('composer host cache subscriptions', () => {
  afterEach(() => { cleanup(); resetThreadModelCatalog(); });

  it('does not reload commands on unrelated renders while a custom provider host is unavailable', () => {
    resetThreadModelCatalog(async () => ({ providers: [], models: [], selectedOnlyModels: [], modelLoadError: null }) as never);
    const reloadCommands = vi.fn();
    const view = renderHook(({ providerId }) => {
      const options = useThreadComposerOptions({ threadId: 'offline', lockedProviderId: providerId, hostPending: true });
      useEffect(() => { reloadCommands(); }, [options.provider?.composerActions]);
      return options;
    }, { initialProps: { providerId: 'acp-custom' } });
    expect(reloadCommands).toHaveBeenCalledOnce();
    view.rerender({ providerId: 'acp-custom' });
    view.rerender({ providerId: 'acp-custom' });
    expect(reloadCommands).toHaveBeenCalledOnce();
    view.rerender({ providerId: 'another-custom' });
    expect(reloadCommands).toHaveBeenCalledTimes(2);
    expect(view.result.current.provider?.id).toBe('another-custom');
  });

  it('restores explicit model, reasoning and role instead of late thread defaults', async () => {
    resetThreadModelCatalog(async () => ({ providers: [], models: [], selectedOnlyModels: [], modelLoadError: null }) as never);
    const session = new ComposerSession();
    const view = renderHook(() => useThreadComposerOptions({ session, threadId: 'a', lockedProviderId: 'codex', initialModel: 'baseline', initialReasoningLevel: 'medium', initialAcpMode: 'agent' }));
    act(() => {
      view.result.current.setModel('chosen-model');
      view.result.current.setReasoningLevel('high');
      view.result.current.setAcpMode('reviewer');
    });
    view.unmount();
    const restored = renderHook(({ model }) => useThreadComposerOptions({ session, threadId: 'a', lockedProviderId: 'codex', initialModel: model, initialReasoningLevel: 'low', initialAcpMode: null }), { initialProps: { model: 'old-model' } });
    await act(async () => {});
    expect(restored.result.current.model).toBe('chosen-model');
    expect(restored.result.current.reasoningLevel).toBe('high');
    expect(restored.result.current.acpMode).toBe('reviewer');
    restored.rerender({ model: 'late-model' });
    expect(restored.result.current.model).toBe('chosen-model');
    expect(restored.result.current.reasoningLevel).toBe('high');
  });

  it('reports unavailable saved models and roles rather than silently replacing them', async () => {
    resetThreadModelCatalog(async () => ({ providers: [{ id: 'codex', displayName: 'Codex', capabilities: { permissionModes: ['auto'] } }], models: [{ model: 'available', displayName: 'Available', supportedReasoningEfforts: [], defaultReasoningEffort: 'medium' }], selectedOnlyModels: [], acpMode: { options: [{ value: 'agent', label: 'Agent' }] }, modelLoadError: null }) as never);
    const session = new ComposerSession();
    session.setSetting('modern.model', 'missing');
    const view = renderHook(() => useThreadComposerOptions({ session, lockedProviderId: 'codex' }));
    await waitFor(() => expect(view.result.current.selectionError).toMatch(/saved model/));
    expect(view.result.current.model).toBe('missing');
    act(() => {
      view.result.current.setModel('available');
      view.result.current.setAcpMode('missing-role');
    });
    await waitFor(() => expect(view.result.current.selectionError).toMatch(/saved role/));
  });

  it('does not flash an unavailable-model warning while discovery is still settling', async () => {
    let resolveDiscovery!: (value: unknown) => void;
    const discovery = new Promise((resolve) => { resolveDiscovery = resolve; });
    const warmCatalog = {
      providers: [{ id: 'codex', displayName: 'Codex', capabilities: { permissionModes: ['auto'] } }],
      models: [{ model: 'warm-model', displayName: 'Warm', supportedReasoningEfforts: [], defaultReasoningEffort: 'medium' }],
      selectedOnlyModels: [],
      modelLoadError: null
    };
    resetThreadModelCatalog((query) => query?.projectId === 'project-a'
      ? Promise.resolve(warmCatalog) as never
      : discovery as never);

    const warm = renderHook(() => useThreadComposerOptions({
      lockedProviderId: 'codex', hostId: 'host', projectId: 'project-a'
    }));
    await waitFor(() => expect(warm.result.current.model).toBe('warm-model'));

    const session = new ComposerSession();
    session.setSetting('modern.model', 'saved-model');
    const view = renderHook(() => useThreadComposerOptions({
      session, lockedProviderId: 'codex', hostId: 'host', projectId: 'project-b'
    }));

    // Warm rows stay visible while the project's own discovery settles.
    expect(view.result.current.modelIsLoading).toBe(false);
    expect(view.result.current.catalogSettled).toBe(false);
    expect(view.result.current.modelOptions.map(row => row.value)).toContain('warm-model');
    expect(view.result.current.selectionError).toBeNull();
    await act(async () => {
      resolveDiscovery({
        providers: [{ id: 'codex', displayName: 'Codex', capabilities: { permissionModes: ['auto'] } }],
        models: [{ model: 'saved-model', displayName: 'Saved', supportedReasoningEfforts: [], defaultReasoningEffort: 'medium' }],
        selectedOnlyModels: [],
        modelLoadError: null
      });
    });
    await waitFor(() => expect(view.result.current.catalogSettled).toBe(true));
    expect(view.result.current.selectionError).toBeNull();
  });

  it('treats a provider switch as defaults, so the new catalog reconciles model and role', async () => {
    const providers = [
      { id: 'codex', displayName: 'Codex', capabilities: { permissionModes: ['auto'] } },
      { id: 'pi', displayName: 'Pi', capabilities: { permissionModes: ['auto'] } }
    ];
    resetThreadModelCatalog(async (query?: { providerId?: string }) => ({
      providers,
      models: query?.providerId === 'pi'
        ? [{ model: 'pi-model', displayName: 'Pi model', supportedReasoningEfforts: [], defaultReasoningEffort: 'medium' }]
        : [{ model: 'codex-model', displayName: 'Codex model', supportedReasoningEfforts: [], defaultReasoningEffort: 'medium' }],
      selectedOnlyModels: [],
      acpMode: query?.providerId === 'pi' ? { currentValue: 'build', options: [{ value: 'build', label: 'Build' }] } : undefined,
      modelLoadError: null
    }) as never);
    const session = new ComposerSession();
    session.setSetting('modern.provider', 'codex');
    const view = renderHook(() => useThreadComposerOptions({ session, hostId: 'host', projectId: 'p' }));
    await waitFor(() => expect(view.result.current.catalogSettled).toBe(true));
    act(() => { view.result.current.setModel('codex-model'); });
    act(() => { view.result.current.setProviderId('pi'); });
    expect(Object.hasOwn(session.getSnapshot().settings, 'modern.model')).toBe(false);
    expect(Object.hasOwn(session.getSnapshot().settings, 'modern.acpMode')).toBe(false);
    await waitFor(() => expect(view.result.current.model).toBe('pi-model'));
    await waitFor(() => expect(view.result.current.acpMode).toBe('build'));
    expect(view.result.current.selectionError).toBeNull();
  });

  it('snaps a defaulted reasoning level onto an explicitly picked model', async () => {
    const effort = (reasoningEffort: string) => ({ reasoningEffort, description: reasoningEffort });
    resetThreadModelCatalog(async () => ({
      providers: [{ id: 'codex', displayName: 'Codex', capabilities: { permissionModes: ['auto'] } }],
      models: [
        { model: 'deep', displayName: 'Deep', supportedReasoningEfforts: [effort('low'), effort('high')], defaultReasoningEffort: 'high' },
        { model: 'quick', displayName: 'Quick', supportedReasoningEfforts: [effort('low')], defaultReasoningEffort: 'low' }
      ],
      selectedOnlyModels: [],
      modelLoadError: null
    }) as never);
    const session = new ComposerSession();
    const view = renderHook(() => useThreadComposerOptions({ session, threadId: 't', lockedProviderId: 'codex', initialModel: 'deep', initialReasoningLevel: 'high' }));
    await waitFor(() => expect(view.result.current.catalogSettled).toBe(true));
    expect(view.result.current.model).toBe('deep');
    expect(view.result.current.reasoningLevel).toBe('high');
    act(() => { view.result.current.setModel('quick'); });
    await waitFor(() => expect(view.result.current.reasoningLevel).toBe('low'));
    expect(view.result.current.selectionError).toBeNull();
  });

  it('does not report a saved role as unavailable until discovery settles', async () => {
    let resolveDiscovery!: (value: unknown) => void;
    const discovery = new Promise((resolve) => { resolveDiscovery = resolve; });
    const row = { model: 'm', displayName: 'M', supportedReasoningEfforts: [], defaultReasoningEffort: 'medium' };
    const providers = [{ id: 'codex', displayName: 'Codex', capabilities: { permissionModes: ['auto'] } }];
    resetThreadModelCatalog((query) => query?.projectId === 'project-a'
      ? Promise.resolve({ providers, models: [row], selectedOnlyModels: [], modelLoadError: null }) as never
      : discovery as never);
    const warm = renderHook(() => useThreadComposerOptions({ lockedProviderId: 'codex', hostId: 'host', projectId: 'project-a' }));
    await waitFor(() => expect(warm.result.current.catalogSettled).toBe(true));

    const session = new ComposerSession();
    session.setSetting('modern.acpMode', 'reviewer');
    const view = renderHook(() => useThreadComposerOptions({ session, lockedProviderId: 'codex', hostId: 'host', projectId: 'project-b' }));
    expect(view.result.current.catalogSettled).toBe(false);
    expect(view.result.current.selectionError).toBeNull();
    await act(async () => {
      resolveDiscovery({ providers, models: [row], selectedOnlyModels: [], acpMode: { options: [{ value: 'agent', label: 'Agent' }] }, modelLoadError: null });
    });
    await waitFor(() => expect(view.result.current.selectionError).toMatch(/saved role/));
  });

  it('keeps simultaneous composers on different hosts isolated and reuses local models on return', async () => {
    const fetcher = vi.fn(async (query?: { hostId?: string; providerId?: string }) => ({
      providers: [{ id: 'codex', displayName: 'Codex', capabilities: { permissionModes: ['full'] } }],
      models: [{ id: query?.hostId, model: query?.hostId, displayName: query?.hostId,
        supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Medium' }],
        defaultReasoningEffort: 'medium', isDefault: true }],
      selectedOnlyModels: [], modelLoadError: null
    }));
    resetThreadModelCatalog(fetcher as never);
    const local = renderHook(({ hostId }) => useThreadComposerOptions({ lockedProviderId: 'codex', hostId }), {
      initialProps: { hostId: 'local-model' }
    });
    await waitFor(() => expect(local.result.current.model).toBe('local-model'));
    const remote = renderHook(() => useThreadComposerOptions({ lockedProviderId: 'codex', hostId: 'remote-model' }));
    await waitFor(() => expect(remote.result.current.model).toBe('remote-model'));
    expect(local.result.current.model).toBe('local-model');
    fetcher.mockClear();
    local.rerender({ hostId: 'remote-model' });
    await waitFor(() => expect(local.result.current.model).toBe('remote-model'));
    local.rerender({ hostId: 'local-model' });
    await waitFor(() => expect(local.result.current.model).toBe('local-model'));
    expect(local.result.current.modelIsLoading).toBe(false);
    expect(remote.result.current.model).toBe('remote-model');
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => local.result.current.refreshAcpModeOptions());
    expect(fetcher).toHaveBeenCalledWith(
      { providerId: 'codex', hostId: 'local-model', refresh: true },
      { signal: expect.objectContaining({ aborted: false }) }
    );
    fetcher.mockClear();
    await act(async () => local.result.current.refreshModels());
    // The picker reload re-reads this host's roster and forces only the selected provider.
    expect(fetcher.mock.calls.map(([query]) => query)).toEqual([
      { hostId: 'local-model' },
      { providerId: 'codex', hostId: 'local-model', refresh: true }
    ]);
    expect(remote.result.current.model).toBe('remote-model');
  });

  it('does not start discovery before the host roster is ready', async () => {
    const fetcher = vi.fn(async () => ({ providers: [], models: [], selectedOnlyModels: [], modelLoadError: null }));
    resetThreadModelCatalog(fetcher as never);
    renderHook(() => useThreadComposerOptions({ lockedProviderId: 'codex', hostPending: true }));
    await act(async () => {});
    expect(fetcher).not.toHaveBeenCalled();
  });
});
