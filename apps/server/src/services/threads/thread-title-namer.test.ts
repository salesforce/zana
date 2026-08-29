import { describe, expect, it, vi } from 'vitest';
import type { LlmPromptEntry, LlmRunResult } from '@zana-ai/zcc-domain/llm';
import { TAB_NAMER_PROMPT_ID } from '@zana-ai/zcc-llm';
import { createThreadTitleNamer } from './thread-title-namer.js';

const entry: LlmPromptEntry = {
  id: TAB_NAMER_PROMPT_ID,
  label: 'Tab namer',
  systemPrompt: 'sys',
  userTemplate: '{{prompt}}',
  provider: 'claude-cli'
};

function ok(text: string): LlmRunResult {
  return { ok: true, text, provider: 'claude-cli', ms: 1 };
}

describe('createThreadTitleNamer', () => {
  it('persists a successful namer result', async () => {
    const applyTitle = vi.fn();
    const namer = createThreadTitleNamer({
      autoRenameEnabled: () => true,
      getEntry: () => entry,
      run: async () => ok('Fix Login Redirect'),
      applyTitle
    });
    namer.request('thr-1', 'please fix the login redirect');
    await vi.waitFor(() => {
      expect(applyTitle).toHaveBeenCalledWith('thr-1', 'Fix Login Redirect');
    });
  });

  it('skips when auto-rename is off', async () => {
    const run = vi.fn(async () => ok('Named'));
    const applyTitle = vi.fn();
    const namer = createThreadTitleNamer({
      autoRenameEnabled: () => false,
      getEntry: () => entry,
      run,
      applyTitle
    });
    namer.request('thr-1', 'work');
    await Promise.resolve();
    expect(run).not.toHaveBeenCalled();
    expect(applyTitle).not.toHaveBeenCalled();
  });

  it('leaves the placeholder when the call fails, then retries on a later prompt', async () => {
    const applyTitle = vi.fn();
    const run = vi.fn()
      .mockResolvedValueOnce({ ok: false, text: '', error: 'timeout', provider: 'claude-cli', ms: 1 })
      .mockResolvedValueOnce(ok('Named'));
    const namer = createThreadTitleNamer({
      autoRenameEnabled: () => true,
      getEntry: () => entry,
      run,
      applyTitle
    });
    namer.request('thr-1', 'first');
    await Promise.resolve();
    await Promise.resolve();
    expect(applyTitle).not.toHaveBeenCalled();
    namer.request('thr-1', 'second');
    await vi.waitFor(() => {
      expect(applyTitle).toHaveBeenCalledWith('thr-1', 'Named');
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not overwrite an explicit title that was reserved', async () => {
    const applyTitle = vi.fn();
    const run = vi.fn(async () => ok('Named'));
    const namer = createThreadTitleNamer({
      autoRenameEnabled: () => true,
      getEntry: () => entry,
      run,
      applyTitle
    });
    namer.reserve('thr-1');
    namer.request('thr-1', 'work');
    await Promise.resolve();
    expect(run).not.toHaveBeenCalled();
    expect(applyTitle).not.toHaveBeenCalled();
  });

  it('does not apply a namer result after a later reserve', async () => {
    let resolveRun!: (value: LlmRunResult) => void;
    const applyTitle = vi.fn();
    const namer = createThreadTitleNamer({
      autoRenameEnabled: () => true,
      getEntry: () => entry,
      run: () => new Promise((resolve) => { resolveRun = resolve; }),
      applyTitle
    });
    namer.request('thr-1', 'work');
    namer.reserve('thr-1');
    resolveRun(ok('Named'));
    await Promise.resolve();
    await Promise.resolve();
    expect(applyTitle).not.toHaveBeenCalled();
  });

  it('does not apply a title after the thread is gone', async () => {
    const applyTitle = vi.fn();
    const namer = createThreadTitleNamer({
      autoRenameEnabled: () => true,
      getEntry: () => entry,
      run: async () => ok('Named'),
      applyTitle,
      stillLive: () => false
    });
    namer.request('thr-1', 'work');
    await Promise.resolve();
    await Promise.resolve();
    expect(applyTitle).not.toHaveBeenCalled();
  });
});
