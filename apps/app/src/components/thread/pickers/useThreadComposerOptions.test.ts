import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('useThreadComposerOptions', () => {
  it('reads the session model catalog, reconciles hardness, and only falls back provider on a new thread', () => {
    const source = readFileSync(new URL('./useThreadComposerOptions.ts', import.meta.url), 'utf8');
    expect(source).toContain('prefetchThreadModelCatalog');
    expect(source).toContain('ensureThreadProviderModels');
    expect(source).toContain('getThreadModelCatalog');
    expect(source).toContain('reconcileReasoningLevel');
    expect(source).toContain('if (input.threadId || input.lockedProviderId) return');
    expect(source).toContain('rememberComposerSelection');
    expect(source).toContain('rememberedProviderId');
    expect(source).toContain('rememberedSelectionFor');
    expect(source).toContain('setProviderIdState(next)');
    expect(source).toContain('fallbackModelsForProvider');
    expect(source).toContain('fallbackMoreModelsForProvider');
    expect(source).toContain('composerProvidersFromCatalog');
    expect(source).toContain('snapNewThreadProviderId');
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
  });

  it('gates Native role on advertised modes, adopts the session default via the pure selector, and exposes refresh', () => {
    const source = readFileSync(new URL('./useThreadComposerOptions.ts', import.meta.url), 'utf8');
    expect(source).toContain("const acpModeOptions = cached?.acpMode?.options ?? []");
    expect(source).toContain('nextAcpModeSelection');
    expect(source).toContain('selected: acpMode');
    expect(source).toContain('options: acpModeOptions');
    expect(source).toContain('if (next !== undefined && next !== acpMode) setAcpMode(next)');
    expect(source).toContain('reloadThreadProviderModels(providerId)');
    expect(source).toContain('refreshAcpModeOptions');
  });

  it('only auto-seeds the native role on a NEW thread, never for an existing thread', () => {
    // An existing thread has no per-thread mode source; seeding the sessionless
    // provider default (build) both misled the picker and force-reset the running
    // mode on every follow-up turn. The seed effect must bail for existing threads.
    const source = readFileSync(new URL('./useThreadComposerOptions.ts', import.meta.url), 'utf8');
    expect(source).toContain('Existing threads: never auto-seed or reset the native role');
    expect(source).toContain('if (input.threadId) return;');
  });

  it('adopts the existing thread persisted native role via initialAcpMode', () => {
    // The picker must show the mode the thread is actually running: acpMode state
    // seeds from the fetched persisted value, and the rehydrate effect re-applies
    // it once the async thread fetch resolves.
    const source = readFileSync(new URL('./useThreadComposerOptions.ts', import.meta.url), 'utf8');
    expect(source).toContain('initialAcpMode?: string | null');
    expect(source).toContain('useState<string | undefined>(() => input.initialAcpMode ?? undefined)');
    expect(source).toContain('if (input.initialAcpMode) setAcpMode(input.initialAcpMode);');
  });
});
