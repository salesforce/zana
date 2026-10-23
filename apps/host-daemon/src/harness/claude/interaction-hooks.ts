import type { HarnessInteractionEvent } from '@zcc/harness-sdk';

const MAX_ERROR = 64;
const MAX_TEXT = 4096;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
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
    return { kind: 'api-error-stop', error, text };
  } catch {
    return null;
  }
}
