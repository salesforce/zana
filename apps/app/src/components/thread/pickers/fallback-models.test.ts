import { describe, expect, it } from 'vitest';
import { fallbackModelsForProvider, fallbackMoreModelsForProvider, fallbackProviderOption } from './fallback-models.js';

describe('fallback thread catalogs', () => {
  it('seeds Claude models so the picker is never empty before execution-options returns', () => {
    const models = fallbackModelsForProvider('claude-code');
    expect(models.map((row) => row.displayName)).toEqual([
      'Fable 5',
      'Opus 5 (1M)',
      'Opus 4.8 (1M)',
      'Opus 4.7 (1M)',
      'Sonnet 5'
    ]);
    expect(models.find((row) => row.isDefault)?.model).toBe('claude-opus-5[1m]');
    expect(fallbackProviderOption('claude-code').displayName).toBe('Claude Code');
    expect(fallbackProviderOption('claude-code').composerActions).toEqual(['plan']);
    expect(fallbackProviderOption('codex').composerActions).toEqual(['plan', 'goal']);
  });

  it('seeds Claude aliases so More models can appear before execution-options returns', () => {
    expect(fallbackMoreModelsForProvider('claude-code').map((row) => row.displayName)).toEqual([
      'Opus Alias (1M, Current)',
      'Opus Alias (Current)',
      'Sonnet Alias (1M, Legacy)',
      'Sonnet Alias (Legacy)',
      'Haiku Alias (Legacy)',
      'Fable Alias',
      'Best Alias'
    ]);
    expect(fallbackMoreModelsForProvider('codex')).toEqual([]);
  });

  it('seeds Codex models so the picker is not stuck on Default', () => {
    expect(fallbackModelsForProvider('codex').map((row) => row.displayName)).toEqual([
      'GPT-5.5',
      'GPT-5.4',
      'GPT-5.4 Mini',
      'GPT-5.6 Sol'
    ]);
    expect(fallbackModelsForProvider('pi')).toEqual([]);
    expect(fallbackModelsForProvider('acp-cursor')).toEqual([]);
    expect(fallbackModelsForProvider('acp-opencode')).toEqual([]);
    expect(fallbackProviderOption('acp-opencode').displayName).toBe('OpenCode');
  });
});
