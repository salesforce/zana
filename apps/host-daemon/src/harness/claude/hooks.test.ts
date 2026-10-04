import { describe, expect, it, vi } from 'vitest';
import { executeNativeToolHook, type NativeToolHookEvent, type NativeToolHookState } from './hooks.js';

function statesOf(calls: unknown[][]): NativeToolHookState[] {
  return calls.map((call) => (call[0] as NativeToolHookEvent).state);
}

describe('executeNativeToolHook', () => {
  it('skips the decision gate and emits only announced when the bridge is disabled', async () => {
    const emit = vi.fn();
    const execute = vi.fn().mockResolvedValue('ok');
    const result = await executeNativeToolHook('Bash', { cmd: 'ls' }, execute, { enabled: false, emit });
    expect(result).toBe('ok');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(statesOf(emit.mock.calls)).toEqual(['announced']);
  });

  it('runs the full allowed lifecycle in order and calls after on success', async () => {
    const emit = vi.fn();
    const after = vi.fn();
    const execute = vi.fn().mockResolvedValue('result');
    const result = await executeNativeToolHook('Bash', { cmd: 'ls' }, execute, {
      enabled: true,
      before: () => true,
      after,
      emit
    });
    expect(result).toBe('result');
    expect(statesOf(emit.mock.calls)).toEqual(['announced', 'awaiting-decision', 'allowed', 'executing', 'succeeded']);
    expect(after).toHaveBeenCalledWith(expect.objectContaining({ state: 'succeeded', toolName: 'Bash' }));
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('denies before any side effect runs when before() returns false', async () => {
    const emit = vi.fn();
    const execute = vi.fn().mockResolvedValue('never');
    await expect(
      executeNativeToolHook('Bash', { cmd: 'rm -rf /' }, execute, { enabled: true, before: () => false, emit })
    ).rejects.toThrow('native tool denied: Bash');
    expect(execute).not.toHaveBeenCalled();
    expect(statesOf(emit.mock.calls)).toEqual(['announced', 'awaiting-decision', 'denied']);
  });

  it('fails closed (denied) when before() throws instead of resolving a decision', async () => {
    const emit = vi.fn();
    const execute = vi.fn().mockResolvedValue('never');
    await expect(
      executeNativeToolHook('Bash', {}, execute, {
        enabled: true,
        before: () => { throw new Error('transport down'); },
        emit
      })
    ).rejects.toThrow('native tool denied: Bash');
    expect(execute).not.toHaveBeenCalled();
    expect(statesOf(emit.mock.calls)).toEqual(['announced', 'awaiting-decision', 'denied']);
  });

  it('defaults to allowed when no before() callback is wired', async () => {
    const execute = vi.fn().mockResolvedValue('ok');
    const result = await executeNativeToolHook('Bash', {}, execute, { enabled: true });
    expect(result).toBe('ok');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('emits failed and calls after on a non-abort execution error, then rethrows', async () => {
    const emit = vi.fn();
    const after = vi.fn();
    const error = new Error('tool crashed');
    const execute = vi.fn().mockRejectedValue(error);
    await expect(
      executeNativeToolHook('Bash', {}, execute, { enabled: true, before: () => true, after, emit })
    ).rejects.toBe(error);
    expect(statesOf(emit.mock.calls)).toEqual(['announced', 'awaiting-decision', 'allowed', 'executing', 'failed']);
    expect(after).toHaveBeenCalledWith(expect.objectContaining({ state: 'failed' }));
  });

  it('emits cancelled instead of failed for an AbortError', async () => {
    const emit = vi.fn();
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const execute = vi.fn().mockRejectedValue(abortError);
    await expect(
      executeNativeToolHook('Bash', {}, execute, { enabled: true, before: () => true, emit })
    ).rejects.toBe(abortError);
    expect(statesOf(emit.mock.calls)).toEqual(['announced', 'awaiting-decision', 'allowed', 'executing', 'cancelled']);
  });

  it('redacts secret-shaped keys from the input before any emit, never the real values', async () => {
    const emit = vi.fn();
    const execute = vi.fn().mockResolvedValue('ok');
    await executeNativeToolHook(
      'Bash',
      { command: 'curl', apiKey: 'sk-live-abc', password: 'hunter2', token: 't0k3n', note: 'kept' },
      execute,
      { enabled: true, before: () => true, emit }
    );
    for (const call of emit.mock.calls) {
      const event = call[0] as NativeToolHookEvent;
      expect(event.input.apiKey).toBe('[REDACTED]');
      expect(event.input.password).toBe('[REDACTED]');
      expect(event.input.token).toBe('[REDACTED]');
      expect(event.input.command).toBe('curl');
      expect(event.input.note).toBe('kept');
    }
  });

  it('mints a stable invocation ID shared across every emitted lifecycle event', async () => {
    const emit = vi.fn();
    const execute = vi.fn().mockResolvedValue('ok');
    await executeNativeToolHook('Bash', {}, execute, { enabled: true, before: () => true, emit });
    const ids = new Set(emit.mock.calls.map((call) => (call[0] as NativeToolHookEvent).invocationId));
    expect(ids.size).toBe(1);
  });

  it('tolerates a non-object input by redacting to an empty payload', async () => {
    const emit = vi.fn();
    const execute = vi.fn().mockResolvedValue('ok');
    await executeNativeToolHook('Bash', 'raw string input', execute, { enabled: true, before: () => true, emit });
    for (const call of emit.mock.calls) {
      expect((call[0] as NativeToolHookEvent).input).toEqual({});
    }
  });
});
