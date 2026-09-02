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
    expect(source).toContain('if (persistSelection)');
  });

  it('gates Native role on advertised modes, adopts the session default, and exposes refresh', () => {
    const source = readFileSync(new URL('./useThreadComposerOptions.ts', import.meta.url), 'utf8');
    expect(source).toContain("const acpModeOptions = cached?.acpMode?.options ?? []");
    expect(source).toContain('setAcpMode(current)');
    expect(source).toContain('acpModeOptions.some((option) => option.value === acpMode)');
    expect(source).toContain('reloadThreadProviderModels(providerId)');
    expect(source).toContain('refreshAcpModeOptions');
  });
});
