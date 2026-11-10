import { createHash } from 'node:crypto';
import { parseNativeToolHookEvent } from './native-tool-hook.js';
import { describe, expect, it, vi } from 'vitest';
import {
  createNativeToolSettledHook,
  createToolStartTracker,
  parseToolSettledBody,
  toolResponseText
} from './native-tool-settled-hook.js';

const session = { id: 'sess', projectId: 'p1', threadId: 'th', profile: 'claude' } as never;
const body = (extra: Record<string, unknown> = {}) => JSON.stringify({
  hook_event_name: 'PostToolUse', turn_id: 't1', tool_use_id: 'u1', tool_name: 'Bash',
  tool_input: { command: 'ls' }, tool_response: { stdout: 'a\nb', exit_code: 0 }, ...extra
});

describe('ToolStartTracker', () => {
  it('reports elapsed time once and 0 when unknown', () => {
    const t = createToolStartTracker();
    t.started('a', 100);
    expect(t.take('a', 250)).toBe(150);
    expect(t.take('a', 300)).toBe(0);
  });
  it.each([-1, Number.NaN])('terminates on an invalid capacity %s', (capacity) => {
    const t = createToolStartTracker(capacity);
    expect(() => t.started('a', 1)).not.toThrow();
  });
  it('is bounded', () => {
    const t = createToolStartTracker(1);
    t.started('a', 1);
    t.started('b', 2);
    expect(t.take('a', 10)).toBe(0);
    expect(t.take('b', 10)).toBe(8);
  });
});

describe('parseToolSettledBody', () => {
  it('maps success, failure, exit codes and interrupts', () => {
    expect(parseToolSettledBody(body(), 100)).toMatchObject({ state: 'succeeded', exitCode: 0, output: 'a\nb', outputBytes: 3 });
    expect(parseToolSettledBody(body({ hook_event_name: 'PostToolUseFailure', error: 'nope' }), 100)?.state).toBe('failed');
    expect(parseToolSettledBody(body({ tool_response: { exit_code: 2 } }), 100)).toMatchObject({ state: 'failed', exitCode: 2 });
    expect(parseToolSettledBody(body({ is_interrupt: true, hook_event_name: 'PostToolUseFailure' }), 100)?.state).toBe('cancelled');
  });
  it('rejects unparseable bodies', () => {
    expect(parseToolSettledBody('nope', 10)).toBeNull();
    expect(parseToolSettledBody('[]', 10)).toBeNull();
  });
  it('bounds output text', () => {
    expect(toolResponseText({ stdout: 'x'.repeat(100) }, 10)).toHaveLength(10);
    expect(toolResponseText('abc', 10)).toBe('abc');
  });
});

describe('createNativeToolSettledHook', () => {
  const make = (overrides: Record<string, unknown> = {}) => {
    const sink = vi.fn().mockResolvedValue({ delivered: true });
    const starts = createToolStartTracker();
    const hook = createNativeToolSettledHook({
      getSession: (id) => (id === 'sess' ? session : null), sink: () => sink, starts, ...overrides
    } as never);
    return { sink, starts, hook };
  };

  it('uses the policy invocation formula and live identity', async () => {
    const { sink, starts, hook } = make();
    const invocationId = createHash('sha256').update(JSON.stringify(['sess', 't1', 'u1', 'Bash', { command: 'ls' }])).digest('hex');
    expect(parseNativeToolHookEvent('sess', body())?.invocationId).toBe(invocationId);
    starts.started(invocationId, Date.now() - 50);
    await hook('p1', 'sess', body());
    expect(sink).toHaveBeenCalledOnce();
    expect(sink.mock.calls[0]![0]).toMatchObject({ invocationId, sessionId: 'sess', threadId: 'th', projectId: 'p1', state: 'succeeded' });
    expect(sink.mock.calls[0]![0].durationMs).toBeGreaterThanOrEqual(40);
  });

  it('drops unknown sessions, project mismatches, and missing sinks', async () => {
    const a = make();
    await a.hook('p1', 'other', body());
    await a.hook('p2', 'sess', body());
    expect(a.sink).not.toHaveBeenCalled();
    const b = make({ sink: () => null });
    await b.hook('p1', 'sess', body());
    expect(b.sink).not.toHaveBeenCalled();
  });

  it('drops malformed identity fields and logs without the body', async () => {
    const log = vi.fn();
    const { sink, hook } = make({ log });
    await hook('p1', 'sess', body({ tool_use_id: '' }));
    await hook('p1', 'sess', body({ tool_input: [] }));
    expect(sink).not.toHaveBeenCalled();
    const failing = make({ log });
    failing.sink.mockRejectedValue(new Error('secret-output'));
    await failing.hook('p1', 'sess', body());
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]![0]).not.toContain('secret-output');
  });
});
