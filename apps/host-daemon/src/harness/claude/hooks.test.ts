import { describe, expect, it, vi } from 'vitest';
import { executeNativeToolHook, type NativeToolHookEvent, type NativeToolHookState } from './hooks.js';

function statesOf(calls: unknown[][]): NativeToolHookState[] {
  return calls.map((call) => (call[0] as NativeToolHookEvent).state);
}

describe('executeNativeToolHook', () => {
  it('skips the decision gate and lifecycle when the bridge is disabled', async () => {
    const emit = vi.fn();
    const before = vi.fn();
    const after = vi.fn();
    const execute = vi.fn().mockResolvedValue('ok');
    const result = await executeNativeToolHook('Bash', { cmd: 'ls' }, execute, { enabled: false, before, after, emit });
    expect(result).toBe('ok');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(before).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('rethrows execution failures without lifecycle events when disabled', async () => {
    const emit = vi.fn();
    const error = new Error('tool failed');
    await expect(executeNativeToolHook('Bash', {}, () => Promise.reject(error), { enabled: false, emit })).rejects.toBe(error);
    expect(emit).not.toHaveBeenCalled();
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

  it('redacts nested objects and arrays for every callback without changing execution input', async () => {
    const emit = vi.fn();
    const before = vi.fn().mockReturnValue(true);
    const after = vi.fn();
    const input = { args: [{ headers: { authorizationToken: 'private', label: 'safe' } }], secret: 'top' };
    await executeNativeToolHook('Bash', input, async () => {
      expect(input.args[0].headers.authorizationToken).toBe('private');
      return 'ok';
    }, { enabled: true, emit, before, after });
    const expected = { args: [{ headers: { authorizationToken: '[REDACTED]', label: 'safe' } }], secret: '[REDACTED]' };
    for (const callback of [emit, before, after]) {
      for (const [event] of callback.mock.calls) expect((event as NativeToolHookEvent).input).toEqual(expected);
    }
  });

  it('bounds cyclic and deeply nested input without leaking secrets', async () => {
    const input: Record<string, unknown> = { apiKey: 'private' };
    input.self = input;
    let current = input;
    for (let i = 0; i < 25; i++) {
      const next: Record<string, unknown> = {};
      current.child = next;
      current = next;
    }
    current.password = 'deep-private';
    const emit = vi.fn();
    await executeNativeToolHook('Bash', input, async () => 'ok', { enabled: true, emit });
    const payload = (emit.mock.calls[0][0] as NativeToolHookEvent).input;
    expect(payload.apiKey).toBe('[REDACTED]');
    expect(payload.self).toBe('[REDACTED]');
    expect(JSON.stringify(payload)).not.toContain('deep-private');
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
