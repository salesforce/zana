import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { HarnessVerifyResult } from '@zana-ai/zcc-domain/product';
import {
  buildThreadExecutionOptions,
  isThreadProviderOffered,
  modelsForThreadProvider,
  selectedOnlyModelsForThreadProvider,
  threadProviderFamily
} from './thread-execution-options.js';

function verify(
  family: HarnessVerifyResult['family'],
  overrides: Partial<HarnessVerifyResult> = {}
): HarnessVerifyResult {
  return {
    family,
    label: family,
    binary: family,
    enabled: true,
    alwaysEnabled: family === 'claude',
    installed: true,
    installHint: '',
    ...overrides
  };
}

describe('threadProviderFamily', () => {
  it('maps thread ids onto PTY harness families and skips fake', () => {
    expect(threadProviderFamily('claude-code')).toBe('claude');
    expect(threadProviderFamily('acp-cursor')).toBe('cursor');
    expect(threadProviderFamily('codex')).toBe('codex');
    expect(threadProviderFamily('pi')).toBe('pi');
    expect(threadProviderFamily('fake')).toBeNull();
  });
});

describe('isThreadProviderOffered', () => {
  it('hides an uninstalled or Settings-disabled harness and treats a missing probe as installed', () => {
    expect(isThreadProviderOffered({ id: 'codex' }, [verify('codex', { installed: false })])).toBe(false);
    expect(isThreadProviderOffered({ id: 'codex' }, [verify('codex', { enabled: false })])).toBe(false);
    expect(isThreadProviderOffered({ id: 'codex' }, [])).toBe(true);
    expect(isThreadProviderOffered({ id: 'codex' }, [verify('codex')])).toBe(true);
    expect(isThreadProviderOffered({ id: 'fake' }, [verify('codex', { installed: false })])).toBe(true);
  });
});

describe('buildThreadExecutionOptions', () => {
  it('omits Codex from provider tabs when the CLI is not installed', () => {
    const body = buildThreadExecutionOptions({
      availability: [
        verify('claude'),
        verify('codex', { installed: false }),
        verify('pi'),
        verify('cursor')
      ]
    });
    expect(body.providers.map((row) => row.id)).not.toContain('codex');
    expect(body.providers.map((row) => row.id)).toContain('claude-code');
    expect(body.providers.every((row) => row.available)).toBe(true);
    expect(body.providers.find((row) => row.id === 'claude-code')?.composerActions).toEqual(['plan']);
  });

  it('exposes Plan and Goal from the provider catalog', () => {
    const body = buildThreadExecutionOptions({
      availability: [verify('claude'), verify('codex'), verify('pi'), verify('cursor')]
    });
    expect(body.providers.find((row) => row.id === 'claude-code')?.composerActions).toEqual(['plan']);
    expect(body.providers.find((row) => row.id === 'codex')?.composerActions).toEqual(['plan', 'goal']);
    expect(body.providers.find((row) => row.id === 'pi')?.composerActions).toEqual([]);
  });

  it('still returns models for a requested uninstalled provider so an existing thread can hydrate', () => {
    const body = buildThreadExecutionOptions({
      providerId: 'codex',
      availability: [
        verify('claude'),
        verify('codex', { installed: false }),
        verify('pi'),
        verify('cursor')
      ]
    });
    expect(body.providers.map((row) => row.id)).not.toContain('codex');
    expect(body.models.map((row) => row.displayName)).toEqual([
      'GPT-5.5',
      'GPT-5.4',
      'GPT-5.4 Mini',
      'GPT-5.6 Sol'
    ]);
    expect(body.models[0]?.supportedReasoningEfforts.length).toBeGreaterThan(0);
  });

  it('returns the Claude fallback catalog for claude-code', () => {
    const models = modelsForThreadProvider('claude-code', []);
    expect(models.map((row) => row.displayName)).toEqual([
      'Fable 5',
      'Opus 5 (1M)',
      'Opus 4.8 (1M)',
      'Opus 4.7 (1M)',
      'Sonnet 5'
    ]);
    expect(models.find((row) => row.isDefault)?.model).toBe('claude-opus-5[1m]');
  });

  it('returns Claude aliases under selectedOnlyModels so the picker can show More models', () => {
    const body = buildThreadExecutionOptions({
      providerId: 'claude-code',
      availability: [verify('claude')]
    });
    expect(body.selectedOnlyModels.map((row) => row.displayName)).toEqual([
      'Opus Alias (1M, Current)',
      'Opus Alias (Current)',
      'Sonnet Alias (1M, Legacy)',
      'Sonnet Alias (Legacy)',
      'Haiku Alias (Legacy)',
      'Fable Alias',
      'Best Alias'
    ]);
    expect(selectedOnlyModelsForThreadProvider('codex')).toEqual([]);
  });

  it('prefers a live host catalog over the static fallback', () => {
    const body = buildThreadExecutionOptions({
      providerId: 'codex',
      availability: [verify('codex')],
      listed: {
        models: [{
          id: 'gpt-5.5',
          model: 'gpt-5.5',
          displayName: 'GPT-5.5',
          description: 'Live Codex model',
          supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Medium' }],
          defaultReasoningEffort: 'medium',
          isDefault: true
        }],
        selectedOnlyModels: []
      }
    });
    expect(body.models).toHaveLength(1);
    expect(body.models[0]?.description).toBe('Live Codex model');
  });
});

describe('execution-options API wiring', () => {
  it('serves GET /system/execution-options from harnessVerify and the catalog', () => {
    const source = readFileSync(new URL('../../http/product-api.ts', import.meta.url), 'utf8');
    expect(source).toContain("/api/v1/system/execution-options");
    expect(source).toContain('buildThreadExecutionOptions');
    expect(source).toContain('harnessVerify');
    expect(source).toContain('provider.list_models');
    expect(source).toContain('availability = []');
    expect(source).toContain('parseReasoningLevel(body.reasoningLevel)');
    expect(source).toContain('readLastThreadExecution');
  });
});
