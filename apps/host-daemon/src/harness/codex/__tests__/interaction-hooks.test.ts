import { describe, expect, it } from 'vitest';
import { codexInteractionHook } from '../interaction-hooks.js';

const hook = (event: Record<string, unknown>) => codexInteractionHook(JSON.stringify({
  turn_id: 'turn-1', tool_name: 'Bash', tool_input: { command: 'echo hello' }, ...event
}));

describe('Codex interaction hooks', () => {
  it('correlates permission and completion despite an approval-only description', () => {
    const requested = hook({ hook_event_name: 'PermissionRequest', tool_input: { command: 'echo hello', description: 'Approve?' } });
    const resolved = hook({ hook_event_name: 'PostToolUse', tool_use_id: 'call-1' });
    expect(requested?.kind).toBe('requested');
    expect(resolved?.kind).toBe('resolved');
    if (requested?.kind !== 'requested' || resolved?.kind !== 'resolved') throw new Error('missing event');
    expect(resolved.keys).toContain(requested.key);
    expect(requested.key).not.toContain('echo hello');
    expect(hook({ hook_event_name: 'PermissionRequest', tool_input: { command: 'another' } })).not.toEqual(requested);
    expect(hook({ hook_event_name: 'PermissionRequest', turn_id: 'turn-2' })).not.toEqual(requested);
  });

  it('matches MCP input independent of property order without dropping real arguments', () => {
    const requested = hook({ hook_event_name: 'PermissionRequest', tool_name: 'mcp__s__tool', tool_input: { b: [2, null], a: { c: 1 }, description: 'input' } });
    const resolved = hook({ hook_event_name: 'PostToolUse', tool_name: 'mcp__s__tool', tool_input: { description: 'input', a: { c: 1 }, b: [2, null] } });
    if (requested?.kind !== 'requested' || resolved?.kind !== 'resolved') throw new Error('missing event');
    expect(resolved.keys).toEqual([requested.key]);
  });

  it('does not surface retired native blocking questions as CLI Agent UI input', () => {
    const requested = hook({ hook_event_name: 'PreToolUse', tool_name: 'request_user_input', tool_use_id: 'question-1' });
    const resolved = hook({ hook_event_name: 'PostToolUse', tool_name: 'request_user_input', tool_use_id: 'question-1' });
    expect(requested).toBeNull();
    expect(resolved).toMatchObject({ kind: 'resolved', keys: expect.not.arrayContaining(['call:turn-1:question-1']) });
    expect(hook({ hook_event_name: 'PreToolUse' })).toBeNull();
    expect(hook({ hook_event_name: 'PreToolUse', tool_name: 'request_user_input' })).toBeNull();
    expect(hook({ hook_event_name: 'PreToolUse', tool_name: 'request_user_input_async', tool_use_id: 'async' })).toBeNull();
  });

  it('clears on interruption without requiring a tool identity', () => {
    expect(codexInteractionHook('{"hook_event_name":"Interrupt"}')).toEqual({ kind: 'interrupted' });
  });

  it.each(['invalid', 'null', '[]', '{}'])('ignores malformed input %s', (body) => {
    expect(codexInteractionHook(body)).toBeNull();
  });

  it('ignores unsupported, oversized-identity and excessively nested input', () => {
    expect(hook({ hook_event_name: 'Stop' })).toBeNull();
    expect(hook({ hook_event_name: 'PermissionRequest', turn_id: '' })).toBeNull();
    expect(hook({ hook_event_name: 'PermissionRequest', tool_name: 'x'.repeat(513) })).toBeNull();
    expect(hook({ hook_event_name: 'PermissionRequest', tool_input: null })).toBeNull();
    let input: unknown = {};
    for (let n = 0; n < 35; n++) input = { child: input };
    expect(hook({ hook_event_name: 'PermissionRequest', tool_input: input })).toBeNull();
  });
});
