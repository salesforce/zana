import { isRetryableApiErrorKind, type HarnessInteractionEvent } from '@zcc/harness-sdk';
import { classifyApiError } from '../api-error-kind.js';
import { sanitizeApiErrorText } from '../api-error-text.js';

/** Maximum (newest) lines examined in one tail, so a hostile or huge rollout cannot pin the event loop. */
const MAX_LINES = 5000;
/** A single rollout line larger than this is skipped rather than parsed. */
const MAX_LINE_BYTES = 256 * 1024;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/**
 * Map `codex_error_info` (a name string, or `{ name: { http_status_code } }`) into the shared kinds.
 * Only observed shapes are mapped; anything else is `unknown`, which is retried.
 */
export function mapCodexErrorInfo(info: unknown, text?: string): string {
  let name: string | undefined;
  let status: number | undefined;
  if (typeof info === 'string') name = info;
  else {
    const obj = record(info);
    const key = obj ? Object.keys(obj)[0] : undefined;
    if (obj && key) {
      name = key;
      const detail = record(obj[key]);
      if (typeof detail?.http_status_code === 'number') status = detail.http_status_code;
    }
  }
  if (name === 'server_overloaded') return 'overloaded';
  if (name === 'internal_server_error') return 'server_error';
  if (name === 'response_too_many_failed_attempts' && status === 429) return 'rate_limit';
  if (name === 'http_connection_failed' && status === 401) return 'authentication_failed';
  // Unmapped name: classify from the HTTP status and message with the shared rules (503/529, rate-limit text, ...).
  return classifyApiError({ status, text });
}

interface Line { offset: number; value: Record<string, unknown> }

/** Parse the lines of a rollout tail. `startOffset` is the file offset of `tail[0]`. */
function parseLines(tail: Buffer, startOffset: number): Line[] {
  const out: Line[] = [];
  let pos = 0;
  // A tail that starts mid-file begins with a partial line: drop it.
  if (startOffset > 0) {
    const nl = tail.indexOf(0x0a);
    if (nl === -1) return out;
    pos = nl + 1;
  }
  // Newest lines matter most: find every line boundary (cheap), then parse only the last MAX_LINES.
  const bounds: Array<[number, number]> = [];
  while (pos < tail.length) {
    let end = tail.indexOf(0x0a, pos);
    if (end === -1) end = tail.length; // a final unterminated line may still be mid-write; parse failure drops it
    bounds.push([pos, end]);
    pos = end + 1;
  }
  for (const [from, to] of bounds.slice(-MAX_LINES)) {
    if (to - from > MAX_LINE_BYTES) continue;
    try {
      const value = record(JSON.parse(tail.subarray(from, to).toString('utf8')));
      if (value) out.push({ offset: startOffset + from, value });
    } catch { /* partial or malformed line */ }
  }
  return out;
}

function payloadOf(line: Line, type: string): Record<string, unknown> | null {
  if (line.value.type !== 'event_msg') return null;
  const payload = record(line.value.payload);
  return payload && payload.type === type ? payload : null;
}

/**
 * The turn that began at `turnStartOffset` ended on an API error, or null. Takes the last `task_complete`
 * at or after the offset and only if it carries an `error`. A later `task_started` means a newer turn is
 * already running, so this one is not the current turn.
 */
export function failedTurnFromRollout(
  tail: Buffer,
  tailStartOffset: number,
  turnStartOffset: number,
  opts: { requireSingleTurn?: boolean } = {}
): HarnessInteractionEvent | null {
  const lines = parseLines(tail, tailStartOffset);
  // Turn start unknown: only a rollout that holds a single turn is unambiguous.
  if (opts.requireSingleTurn && (tailStartOffset > 0 || lines.filter((l) => payloadOf(l, 'task_started')).length > 1)) return null;
  let complete: { index: number; payload: Record<string, unknown> } | undefined;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].offset < turnStartOffset) continue;
    const done = payloadOf(lines[i], 'task_complete');
    if (done) complete = { index: i, payload: done };
  }
  if (!complete) return null;
  for (let i = complete.index + 1; i < lines.length; i++) if (payloadOf(lines[i], 'task_started')) return null;
  const error = record(complete.payload.error);
  if (!error) return null;
  const text = sanitizeApiErrorText(error.message);
  const kind = mapCodexErrorInfo(error.codex_error_info, text);
  return { kind: 'api-error-stop', error: kind, text, retryable: isRetryableApiErrorKind(kind) };
}
