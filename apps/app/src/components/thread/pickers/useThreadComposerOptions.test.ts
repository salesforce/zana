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
    expect(source).toContain('fallbackProviderOption(providerId)');
    expect(source).toContain('input.threadId || input.lockedProviderId');
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
});
