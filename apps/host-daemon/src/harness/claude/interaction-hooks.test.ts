import { describe, expect, it } from 'vitest';
import { claudeInteractionHook } from './interaction-hooks.js';

const hook = (o: unknown) => claudeInteractionHook(JSON.stringify(o));

describe('claudeInteractionHook', () => {
  it('maps a full StopFailure payload', () => {
    expect(hook({
      hook_event_name: 'StopFailure', error: ' rate_limit ',
      error_details: '429  Too\nmany', last_assistant_message: 'partial   reply',
    })).toEqual({ kind: 'api-error-stop', error: 'rate_limit', text: '429 Too many partial reply' });
  });
  it('falls back to unknown for a missing or empty error', () => {
    expect(hook({ hook_event_name: 'StopFailure' })).toMatchObject({ error: 'unknown', text: '' });
    expect(hook({ hook_event_name: 'StopFailure', error: '  ' })).toMatchObject({ error: 'unknown' });
  });
  it('ignores non-string fields and caps the error length', () => {
    expect(hook({ hook_event_name: 'StopFailure', error: 5, error_details: { a: 1 }, last_assistant_message: 'x' }))
      .toEqual({ kind: 'api-error-stop', error: 'unknown', text: 'x' });
    expect((hook({ hook_event_name: 'StopFailure', error: 'e'.repeat(100) }) as { error: string }).error).toHaveLength(64);
  });
  it('bounds a huge message to 4096 chars', () => {
    const r = hook({ hook_event_name: 'StopFailure', last_assistant_message: 'a'.repeat(200 * 1024) });
    expect((r as { text: string }).text).toHaveLength(4096);
  });
  it('returns null for invalid JSON, non-objects and other hooks', () => {
    expect(claudeInteractionHook('{nope')).toBeNull();
    expect(claudeInteractionHook('[]')).toBeNull();
    expect(claudeInteractionHook('null')).toBeNull();
    for (const n of ['Stop', 'Notification', 'PreToolUse']) expect(hook({ hook_event_name: n })).toBeNull();
  });
});
