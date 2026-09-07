import { describe, expect, it } from 'vitest';
import {
  composerProvidersFromCatalog,
  fallbackModelsForProvider,
  fallbackMoreModelsForProvider,
  fallbackProviderOption,
  fallbackProvidersForNewThread,
  isOfferedModernProvider,
  snapNewThreadProviderId
} from './fallback-models.js';

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
    expect(models.find((row) => row.isDefault)?.model).toBe('claude-sonnet-5');
    expect(models[0]?.supportedReasoningEfforts.map((effort) => effort.reasoningEffort)).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
      'ultracode',
      'max'
    ]);
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

  it('seeds every builtin harness on a new thread and locks to one on an existing thread', () => {
    expect(fallbackProvidersForNewThread().map((row) => row.id)).toEqual([
      'claude-code',
      'codex',
      'pi',
      'acp-cursor'
    ]);
    expect(composerProvidersFromCatalog([], false, 'claude-code').map((row) => row.id)).toEqual([
      'claude-code',
      'codex',
      'pi',
      'acp-cursor'
    ]);
    expect(composerProvidersFromCatalog([], true, 'codex').map((row) => row.id)).toEqual(['codex']);
    expect(composerProvidersFromCatalog(
      [{ id: 'claude-code', displayName: 'Claude', permissionModes: ['full'], composerActions: ['plan'] }],
      false,
      'claude-code'
    )[0]).toMatchObject({ displayName: 'Claude', composerActions: ['plan'] });
    expect(composerProvidersFromCatalog(
      [
        { id: 'claude-code', displayName: 'Claude Code', permissionModes: ['full'], composerActions: [] },
        { id: 'custom-agent', displayName: 'Custom', permissionModes: ['full'], composerActions: [] }
      ],
      false,
      'claude-code'
    ).map((row) => row.id)).toEqual(['claude-code', 'custom-agent']);
    expect(composerProvidersFromCatalog(
      [{ id: 'pi', displayName: 'Pi', permissionModes: ['full'], composerActions: [] }],
      true,
      'claude-code'
    ).map((row) => row.id)).toEqual(['pi']);
  });

  it('does not keep offering a builtin the live catalog omitted', () => {
    expect(composerProvidersFromCatalog(
      [{ id: 'acp-cursor', displayName: 'Cursor', permissionModes: ['full'], composerActions: [] }],
      false,
      'claude-code'
    ).map((row) => row.id)).toEqual(['acp-cursor']);
  });

  it('blocks a new-thread send unless the live roster includes the selected harness', () => {
    expect(isOfferedModernProvider(['acp-cursor', 'pi'], 'claude-code')).toBe(false);
    expect(isOfferedModernProvider(['claude-code', 'acp-cursor'], 'claude-code')).toBe(true);
    expect(isOfferedModernProvider(['claude-code'], undefined)).toBe(false);
  });

  it('snaps off a remembered id the live roster no longer offers', () => {
    const loading = composerProvidersFromCatalog([], false, 'acp-cursor').map((row) => row.id);
    expect(snapNewThreadProviderId(loading, 'acp-cursor')).toBeNull();
    const live = composerProvidersFromCatalog(
      [{ id: 'claude-code', displayName: 'Claude Code', permissionModes: ['full'], composerActions: [] }],
      false,
      'acp-cursor'
    ).map((row) => row.id);
    expect(snapNewThreadProviderId(live, 'claude-code')).toBeNull();
    expect(snapNewThreadProviderId(live, 'acp-cursor')).toBe('claude-code');
    expect(snapNewThreadProviderId(live, 'gone-plugin')).toBe('claude-code');
    expect(snapNewThreadProviderId([], 'acp-cursor')).toBeNull();
  });
});
