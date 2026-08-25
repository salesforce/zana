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
    expect(source).toContain('setProviderId(catalog.providers[0].id)');
    expect(source).toContain('fallbackModelsForProvider');
    expect(source).toContain('fallbackMoreModelsForProvider');
    expect(source).toContain('visibleComposerReasoningLevels');
    expect(source).toContain('modelIsLoading: loading');
    expect(source).toContain('modelLoadError');
    expect(source).not.toContain('AgentLauncher');
    expect(source).not.toContain('list_models');
  });
});
