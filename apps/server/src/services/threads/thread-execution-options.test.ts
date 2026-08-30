import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { HarnessVerifyResult } from '@zana-ai/zcc-domain/product';
import {
  buildThreadExecutionOptions,
  classifyModelListError,
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
    expect(threadProviderFamily('acp-opencode')).toBe('opencode');
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
    expect(isThreadProviderOffered({ id: 'acp-opencode' }, [verify('opencode', { installed: false })])).toBe(false);
    expect(isThreadProviderOffered({ id: 'acp-opencode' }, [verify('opencode')])).toBe(true);
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
    expect(models.find((row) => row.isDefault)?.model).toBe('claude-sonnet-5');
    expect(models[0]?.supportedReasoningEfforts.map((effort) => effort.reasoningEffort)[0]).toBe('none');
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

  it('keeps static Codex models and reports auth_required when listing needs login', () => {
    const body = buildThreadExecutionOptions({
      providerId: 'codex',
      availability: [verify('codex')],
      listError: 'auth_required'
    });
    expect(body.modelLoadError).toEqual({ providerId: 'codex', code: 'auth_required' });
    expect(body.models.map((row) => row.displayName)).toEqual([
      'GPT-5.5',
      'GPT-5.4',
      'GPT-5.4 Mini',
      'GPT-5.6 Sol'
    ]);
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
    expect(source).toContain('classifyModelListError');
    expect(source).toContain('listError');
    expect(source).toContain('timeoutMs: 45_000');
  });
});

describe('classifyModelListError', () => {
  it('maps Cursor/Codex login failures onto auth_required', () => {
    expect(classifyModelListError(Object.assign(new Error('ACP agent is not authenticated.'), { code: 'auth_required' }))).toBe('auth_required');
    expect(classifyModelListError(new Error("Error: Authentication required. Run 'agent login'"))).toBe('auth_required');
    expect(classifyModelListError(new Error('Run `codex login` on this host'))).toBe('auth_required');
    expect(classifyModelListError(new Error('spawn cursor-agent ENOENT'))).toBe('missing_executable');
    expect(classifyModelListError(new Error('host rpc timed out: provider.list_models'))).toBe('timeout');
    expect(classifyModelListError(new Error('bridge crashed'))).toBe('failed');
  });
});
