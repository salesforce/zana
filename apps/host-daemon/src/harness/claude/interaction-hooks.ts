import type { HarnessInteractionEvent } from '@zcc/harness-sdk';

const MAX_ERROR = 64;
const MAX_TEXT = 4096;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

const TEMPORARY_KINDS = new Set(['rate_limit', 'overloaded', 'server_error', 'unknown']);
// A LiteLLM-style proxy that could not reach its upstream provider reports invalid_request; that is temporary.
const PROXY_UPSTREAM_TEXT = /LLM Provider NOT provided|Provider \S+ not found/i;

/** `details` is the API's own error text only, never the model's reply, which could quote anything. */
export function isRetryableApiError(error: string, details: string): boolean {
  if (TEMPORARY_KINDS.has(error)) return true;
  return error === 'invalid_request' && PROXY_UPSTREAM_TEXT.test(details);
}

// Claude fires StopFailure (not Stop) when a turn ends on an API error.
export function claudeInteractionHook(body: string): HarnessInteractionEvent | null {
  try {
    const event = record(JSON.parse(body));
    if (!event || event.hook_event_name !== 'StopFailure') return null;
    const rawError = typeof event.error === 'string' ? event.error.trim() : '';
    const error = rawError ? rawError.slice(0, MAX_ERROR) : 'unknown';
    const text = [event.error_details, event.last_assistant_message]
      .filter((v): v is string => typeof v === 'string')
      .join(' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
    const details = typeof event.error_details === 'string' ? event.error_details : '';
    return { kind: 'api-error-stop', error, text, retryable: isRetryableApiError(error, details) };
  } catch {
    return null;
  }
}
