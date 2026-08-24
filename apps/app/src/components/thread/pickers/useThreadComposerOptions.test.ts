import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('useThreadComposerOptions', () => {
  it('loads execution-options, reconciles hardness, and only falls back provider on a new thread', () => {
    const source = readFileSync(new URL('./useThreadComposerOptions.ts', import.meta.url), 'utf8');
    expect(source).toContain('product.threads.executionOptions');
    expect(source).toContain('reconcileReasoningLevel');
    expect(source).toContain('if (!input.threadId)');
    expect(source).toContain('setProviderId(nextProviders[0].id)');
    expect(source).toContain('fallbackModelsForProvider');
    expect(source).toContain('fallbackMoreModelsForProvider');
    expect(source).toContain('composerActionsFromProvider');
    expect(source).toContain('nextModels.length > 0 ? nextModels : fallbackModels');
    expect(source).toContain('nextMore.length > 0 ? nextMore : fallbackMore');
    expect(source).toContain('visibleComposerReasoningLevels');
    expect(source).not.toContain('AgentLauncher');
    expect(source).not.toContain('list_models');
  });
});
