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

  // #649 REQ-2: Codex declares apiErrorSignal 'none', so its hook must never claim an API-error stop.
  it.each([
    'PreModelRequest', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PreCompact', 'PostCompact', 'SessionStart',
    'SessionEnd', 'SubagentStart', 'SubagentStop', 'Interrupt', 'Stop', 'UserPromptSubmit', 'StopFailure', 'TurnError'
  ])('never returns api-error-stop for %s, even with error fields', (name) => {
    const plain = hook({ hook_event_name: name });
    const withError = hook({ hook_event_name: name, error: 'rate_limit', error_details: '429 overloaded', last_assistant_message: 'API Error: 500' });
    expect(plain?.kind).not.toBe('api-error-stop');
    expect(withError?.kind).not.toBe('api-error-stop');
  });

  it('never turns an unknown event name or a Claude-shaped StopFailure body into api-error-stop', () => {
    const claudeBody = JSON.stringify({ hook_event_name: 'StopFailure', error: 'server_error', error_details: '500', last_assistant_message: 'API Error' });
    expect(codexInteractionHook(claudeBody)?.kind).not.toBe('api-error-stop');
    expect(hook({ hook_event_name: 'SomeFutureEvent', error: 'rate_limit' })?.kind).not.toBe('api-error-stop');
    expect(codexInteractionHook('{"hook_event_name":"StopFailure","error":')).toBeNull();
  });
});
