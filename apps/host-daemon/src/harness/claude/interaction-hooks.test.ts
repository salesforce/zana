import { describe, expect, it } from 'vitest';
import { claudeInteractionHook, isRetryableApiError } from './interaction-hooks.js';

const hook = (o: unknown) => claudeInteractionHook(JSON.stringify(o));

describe('claudeInteractionHook', () => {
  it('maps a full StopFailure payload', () => {
    expect(hook({
      hook_event_name: 'StopFailure', error: ' rate_limit ',
      error_details: '429  Too\nmany', last_assistant_message: 'partial   reply',
    })).toEqual({ kind: 'api-error-stop', error: 'rate_limit', text: '429 Too many partial reply', retryable: true });
  });
  it('falls back to unknown for a missing or empty error', () => {
    expect(hook({ hook_event_name: 'StopFailure' })).toMatchObject({ error: 'unknown', text: '' });
    expect(hook({ hook_event_name: 'StopFailure', error: '  ' })).toMatchObject({ error: 'unknown' });
  });
  it('ignores non-string fields and caps the error length', () => {
    expect(hook({ hook_event_name: 'StopFailure', error: 5, error_details: { a: 1 }, last_assistant_message: 'x' }))
      .toEqual({ kind: 'api-error-stop', error: 'unknown', text: 'x', retryable: true });
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

const GATEWAY_TEXT = '400 litellm.BadRequestError: LLM Provider NOT provided. Error doing the fallback: Provider anthropic not found';

describe('isRetryableApiError', () => {
  it.each([
    ['rate_limit', '', true],
    ['overloaded', '', true],
    ['server_error', '', true],
    ['unknown', '', true],
    ['invalid_request', GATEWAY_TEXT, true],
    ['invalid_request', 'Provider anthropic not found', true],
    ['invalid_request', 'prompt is too long', false],
    ['authentication_failed', '', false],
    ['authentication_failed', GATEWAY_TEXT, false],
    ['billing_error', '', false],
    ['cloud_credential_error', '', false],
    ['model_not_found', '', false],
    ['max_output_tokens', '', false],
    ['some_future_kind', '', false],
  ])('%s with %j -> %s', (error, text, expected) => {
    expect(isRetryableApiError(error, text)).toBe(expected);
  });

  it('is set on the hook event, including the real gateway payload and a missing error', () => {
    const run = (b: object) => claudeInteractionHook(JSON.stringify({ hook_event_name: 'StopFailure', ...b }));
    expect(run({ error: 'invalid_request', error_details: GATEWAY_TEXT })).toMatchObject({ retryable: true });
    expect(run({ error: 'invalid_request', error_details: 'bad' })).toMatchObject({ retryable: false });
    expect(run({ error: 'authentication_failed', error_details: GATEWAY_TEXT })).toMatchObject({ retryable: false });
    expect(run({})).toMatchObject({ error: 'unknown', retryable: true });
  });

  it('reads the proxy pattern from the API error only, never from the model reply', () => {
    const run = (b: object) => claudeInteractionHook(JSON.stringify({ hook_event_name: 'StopFailure', ...b }));
    // A permanent invalid_request whose reply happens to quote the gateway text stays permanent.
    expect(run({ error: 'invalid_request', error_details: 'prompt is too long', last_assistant_message: GATEWAY_TEXT }))
      .toMatchObject({ retryable: false, text: expect.stringContaining('Provider anthropic not found') });
    expect(run({ error: 'invalid_request', last_assistant_message: GATEWAY_TEXT })).toMatchObject({ retryable: false });
  });
});
