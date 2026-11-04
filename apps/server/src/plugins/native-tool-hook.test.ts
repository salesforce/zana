import { describe, expect, it, vi } from 'vitest';
import { NATIVE_TOOL_INPUT_TOO_LARGE, createNativeToolPolicyHook, parseNativeToolHookEvent } from './native-tool-hook.js';

const session = { id: 's1', projectId: 'p1', profile: 'claude', status: 'running' };
const event = (patch: object = {}) => JSON.stringify({ tool_use_id: 'u1', tool_name: 'Bash', tool_input: { command: 'ls' }, ...patch });

describe('parseNativeToolHookEvent', () => {
  it('derives a stable invocation id bound to session and content', () => {
    const a = parseNativeToolHookEvent('s1', event()), b = parseNativeToolHookEvent('s1', event());
    expect(a).toEqual(b);
    expect(parseNativeToolHookEvent('s2', event())?.invocationId).not.toBe(a?.invocationId);
    expect(parseNativeToolHookEvent('s1', event({ tool_input: { command: 'pwd' } }))?.invocationId).not.toBe(a?.invocationId);
  });
  it.each([
    ['not json', 'nope'], ['array', '[]'], ['missing tool', event({ tool_name: undefined })],
    ['bad turn', event({ turn_id: '' })], ['array input', event({ tool_input: [] })], ['control char id', event({ tool_use_id: 'a\nb' })]
  ])('rejects %s', (_label, body) => { expect(parseNativeToolHookEvent('s1', body)).toBeNull(); });
  it('reads absent tool_input as an empty object and ignores forged identity keys', () => {
    expect(parseNativeToolHookEvent('s1', event({ tool_input: undefined, session_id: 'forged', project_id: 'x' }))?.input).toEqual({});
  });
});

describe('createNativeToolPolicyHook', () => {
  const hook = (deps: Partial<Parameters<typeof createNativeToolPolicyHook>[0]> = {}) =>
    createNativeToolPolicyHook({ getSession: () => session, decider: () => async () => ({ action: 'allow' }), ...deps });
  it('answers allow with a fixed reason and a plugin deny with its own', async () => {
    expect(await hook()('p1', 's1', event())).toEqual({ decision: 'allow', reason: 'allowed' });
    expect(await hook({ decider: () => async () => ({ action: 'deny', reason: 'nope' }) })('p1', 's1', event())).toEqual({ decision: 'deny', reason: 'nope' });
  });
  it('passes the session record identity to the decider', async () => {
    const decide = vi.fn(async () => ({ action: 'allow' }));
    await hook({ decider: () => decide })('p1', 's1', event({ profile: 'forged' }));
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ threadId: 's1', projectId: 'p1', profile: 'claude', toolName: 'Bash' }));
  });
  it.each([
    ['unknown session', { getSession: () => null }], ['exited session', { getSession: () => ({ ...session, status: 'exited' }) }],
    ['other project', { getSession: () => ({ ...session, projectId: 'other' }) }], ['no decider', { decider: () => null }]
  ])('returns null for %s', async (_label, deps) => { expect(await hook(deps)('p1', 's1', event())).toBeNull(); });
  it('returns null for a malformed event, a throwing decider, and an invalid decision', async () => {
    const log = vi.fn();
    expect(await hook({ log })('p1', 's1', 'nope')).toBeNull();
    expect(await hook({ log, decider: () => async () => { throw new Error('boom'); } })('p1', 's1', event())).toBeNull();
    expect(await hook({ log, decider: () => async () => ({ action: 'maybe' }) })('p1', 's1', event())).toBeNull();
    expect(log).toHaveBeenCalledTimes(2);
  });
  it('denies oversize input without asking the decider', async () => {
    const decide = vi.fn();
    const result = await hook({ decider: () => decide })('p1', 's1', event({ tool_input: { blob: 'x'.repeat(300 * 1024) } }));
    expect(result).toEqual({ decision: 'deny', reason: NATIVE_TOOL_INPUT_TOO_LARGE });
    expect(decide).not.toHaveBeenCalled();
  });
});
