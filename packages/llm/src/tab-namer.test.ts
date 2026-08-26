import { describe, expect, it, vi } from 'vitest';
import type { LlmPromptEntry, LlmRunResult } from '@zana-ai/zcc-domain/llm';
import { TAB_NAMER_PROMPT_ID, runTabNamerOnce } from './tab-namer.js';

const entry: LlmPromptEntry = {
  id: TAB_NAMER_PROMPT_ID,
  label: 'Tab namer',
  systemPrompt: 'sys',
  userTemplate: 'First instruction:\n\n{{prompt}}\n\nLabel:',
  provider: 'claude-cli'
};

function ok(text: string): LlmRunResult {
  return { ok: true, text, provider: 'claude-cli', ms: 1 };
}

function fail(error = 'timeout'): LlmRunResult {
  return { ok: false, text: '', error, provider: 'claude-cli', ms: 1 };
}

describe('runTabNamerOnce', () => {
  it('returns the trimmed label and records the id as named', async () => {
    const namedIds = new Set<string>();
    const run = vi.fn(async () => ok('  Fix Login Redirect  '));
    const title = await runTabNamerOnce({
      id: 's1',
      prompt: 'please fix the login redirect',
      namedIds,
      enabled: true,
      getEntry: () => entry,
      run
    });
    expect(title).toBe('Fix Login Redirect');
    expect(namedIds.has('s1')).toBe(true);
    expect(run).toHaveBeenCalledWith(entry, { prompt: 'please fix the login redirect' }, 's1');
  });

  it('no-ops when disabled, empty, already named, or missing the prompt entry', async () => {
    const run = vi.fn(async () => ok('Named'));
    const namedIds = new Set(['s1']);
    expect(await runTabNamerOnce({
      id: 's2',
      prompt: 'work',
      namedIds: new Set(),
      enabled: false,
      getEntry: () => entry,
      run
    })).toBeNull();
    expect(await runTabNamerOnce({
      id: 's2',
      prompt: '   ',
      namedIds: new Set(),
      enabled: true,
      getEntry: () => entry,
      run
    })).toBeNull();
    expect(await runTabNamerOnce({
      id: 's1',
      prompt: 'work',
      namedIds,
      enabled: true,
      getEntry: () => entry,
      run
    })).toBeNull();
    expect(await runTabNamerOnce({
      id: 's3',
      prompt: 'work',
      namedIds: new Set(),
      enabled: true,
      getEntry: () => null,
      run
    })).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('releases the one-shot when the call fails or returns empty text so a later prompt can retry', async () => {
    const namedIds = new Set<string>();
    expect(await runTabNamerOnce({
      id: 's1',
      prompt: 'work',
      namedIds,
      enabled: true,
      getEntry: () => entry,
      run: async () => fail()
    })).toBeNull();
    expect(namedIds.has('s1')).toBe(false);

    expect(await runTabNamerOnce({
      id: 's1',
      prompt: 'work',
      namedIds,
      enabled: true,
      getEntry: () => entry,
      run: async () => ok('   ')
    })).toBeNull();
    expect(namedIds.has('s1')).toBe(false);
  });

  it('releases the one-shot and reports when the call throws', async () => {
    const namedIds = new Set<string>();
    const onError = vi.fn();
    expect(await runTabNamerOnce({
      id: 's1',
      prompt: 'work',
      namedIds,
      enabled: true,
      getEntry: () => entry,
      run: async () => {
        throw new Error('spawn failed');
      },
      onError
    })).toBeNull();
    expect(namedIds.has('s1')).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('does not double-run concurrent calls for the same id', async () => {
    const namedIds = new Set<string>();
    let resolveRun: ((value: LlmRunResult) => void) | undefined;
    const run = vi.fn(() => new Promise<LlmRunResult>((resolve) => {
      resolveRun = resolve;
    }));
    const first = runTabNamerOnce({
      id: 's1',
      prompt: 'one',
      namedIds,
      enabled: true,
      getEntry: () => entry,
      run
    });
    const second = runTabNamerOnce({
      id: 's1',
      prompt: 'two',
      namedIds,
      enabled: true,
      getEntry: () => entry,
      run
    });
    resolveRun?.(ok('Named'));
    expect(await first).toBe('Named');
    expect(await second).toBeNull();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('returns null when the target dies while the call is in flight', async () => {
    const title = await runTabNamerOnce({
      id: 's1',
      prompt: 'work',
      namedIds: new Set(),
      enabled: true,
      getEntry: () => entry,
      run: async () => ok('Named'),
      stillLive: () => false
    });
    expect(title).toBeNull();
  });
});
