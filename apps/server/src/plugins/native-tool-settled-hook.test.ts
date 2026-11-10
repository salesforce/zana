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

describe('toolResponseText edge cases', () => {
  it('skips empty strings and stops once the budget is spent', () => {
    expect(toolResponseText(['', 'abcd', 'efgh'], 4)).toBe('abcd');
    expect(toolResponseText({ stdout: 'abcd', stderr: 'zzz' }, 4)).toBe('abcd');
  });
  it('bounds recursion depth and array fan-out', () => {
    const deep = { content: { content: { content: { content: { content: { content: 'deep' } } } } } };
    expect(toolResponseText(deep, 500)).toBe(JSON.stringify(deep));
    const many = Array.from({ length: 100 }, (_, i) => `l${i}`);
    const text = toolResponseText({ content: many }, 10_000).split('\n');
    expect(text).toHaveLength(64);
    expect(text[63]).toBe('l63');
  });
  it('ignores non-object scalars then falls back to JSON, and survives unserialisable values', () => {
    expect(toolResponseText(42, 50)).toBe('42');
    expect(toolResponseText(undefined, 50)).toBe('');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(toolResponseText(circular, 50)).toBe('');
    expect(toolResponseText({ other: 'x'.repeat(100) }, 10)).toHaveLength(10);
  });
});

describe('parseToolSettledBody metadata', () => {
  it('reads exit code from metadata and camelCase keys, ignoring non-integers', () => {
    expect(parseToolSettledBody(body({ tool_response: { metadata: { exit_code: 3 } } }), 100)).toMatchObject({ state: 'failed', exitCode: 3 });
    expect(parseToolSettledBody(body({ tool_response: { exitCode: 0, stdout: 'ok' } }), 100)).toMatchObject({ state: 'succeeded', exitCode: 0 });
    const r = parseToolSettledBody(body({ tool_response: { exit_code: 1.5, stdout: 'ok' } }), 100)!;
    expect(r.exitCode).toBeUndefined();
    expect(r.state).toBe('succeeded');
  });
  it('flags is_error and interrupted responses, and tolerates a non-object response', () => {
    expect(parseToolSettledBody(body({ tool_response: { is_error: true, content: 'bad' } }), 100)?.state).toBe('failed');
    expect(parseToolSettledBody(body({ tool_response: { interrupted: true } }), 100)?.state).toBe('cancelled');
    expect(parseToolSettledBody(body({ tool_response: 'plain text' }), 100)).toMatchObject({ state: 'succeeded', output: 'plain text' });
  });
  it('omits output fields when there is no output', () => {
    const r = parseToolSettledBody(JSON.stringify({ hook_event_name: 'PostToolUse' }), 100)!;
    expect(r).toEqual({ state: 'succeeded' });
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

  it('drops non-object events, bad turn ids, bad tool names, and unparseable bodies', async () => {
    const { sink, hook } = make();
    await hook('p1', 'sess', '[]');
    await hook('p1', 'sess', 'not json');
    await hook('p1', 'sess', body({ turn_id: '' }));
    await hook('p1', 'sess', body({ tool_name: 7 }));
    expect(sink).not.toHaveBeenCalled();
  });

  it('treats missing turn id and tool input as null and {}', async () => {
    const { sink, hook } = make();
    const raw = JSON.stringify({ tool_use_id: 'u1', tool_name: 'Bash' });
    await hook('p1', 'sess', raw);
    const expected = createHash('sha256').update(JSON.stringify(['sess', null, 'u1', 'Bash', {}])).digest('hex');
    expect(sink.mock.calls[0]![0]).toMatchObject({ invocationId: expected, state: 'succeeded', durationMs: 0 });
    expect(sink.mock.calls[0]![0]).not.toHaveProperty('output');
    expect(sink.mock.calls[0]![0]).not.toHaveProperty('exitCode');
  });

  it('omits threadId when the session has none and forwards exit code and output', async () => {
    const noThread = { id: 'sess', projectId: 'p1', profile: 'claude' } as never;
    const { sink, hook } = make({ getSession: () => noThread });
    await hook('p1', 'sess', body({ tool_response: { stdout: 'hi', exit_code: 4 } }));
    const req = sink.mock.calls[0]![0];
    expect(req).not.toHaveProperty('threadId');
    expect(req).toMatchObject({ state: 'failed', exitCode: 4, output: 'hi', outputBytes: 2, toolName: 'Bash' });
  });
});
