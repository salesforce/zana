import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { failedTurnFromRollout, mapCodexErrorInfo } from '../failed-turn.js';

const fixture = (name: string) => readFileSync(join(__dirname, '..', '__fixtures__', `${name}.jsonl`));
const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const started = (n: number) => line({ type: 'event_msg', payload: { type: 'task_started', turn_id: `t${n}` } });
const failed = (n: number, info: unknown = 'server_overloaded', message = 'boom') =>
  line({ type: 'event_msg', payload: { type: 'task_complete', turn_id: `t${n}`, error: { message, codex_error_info: info } } });
const ok = (n: number) => line({ type: 'event_msg', payload: { type: 'task_complete', turn_id: `t${n}`, last_agent_message: 'done' } });
const buf = (s: string) => Buffer.from(s);

describe('mapCodexErrorInfo', () => {
  it.each([
    ['server_overloaded', 'overloaded'],
    ['internal_server_error', 'server_error'],
    [{ response_too_many_failed_attempts: { http_status_code: 429 } }, 'rate_limit'],
    [{ http_connection_failed: { http_status_code: 401 } }, 'authentication_failed'],
    [{ response_too_many_failed_attempts: { http_status_code: 500 } }, 'unknown'],
    [{ http_connection_failed: { http_status_code: 502 } }, 'unknown'],
    [{ response_too_many_failed_attempts: {} }, 'unknown'],
    ['something_new', 'unknown'],
    [{ something_new: { http_status_code: 429 } }, 'unknown'],
    [null, 'unknown'], [undefined, 'unknown'], [[], 'unknown'], [{}, 'unknown'], [7, 'unknown']
  ])('maps %j to %s', (info, kind) => {
    expect(mapCodexErrorInfo(info)).toBe(kind);
  });
});

describe('failedTurnFromRollout (captured fixtures)', () => {
  it.each([
    ['overloaded-503', 'overloaded', true],
    ['rate-limit-429', 'rate_limit', true],
    ['auth-401', 'authentication_failed', false],
    ['server-500', 'server_error', true],
    ['tui-overloaded', 'overloaded', true]
  ])('%s', (name, error, retryable) => {
    const event = failedTurnFromRollout(fixture(name), 0, 0);
    expect(event).toMatchObject({ kind: 'api-error-stop', error, retryable });
    expect((event as { text: string }).text.length).toBeGreaterThan(0);
  });
});

describe('failedTurnFromRollout (turn scoping)', () => {
  it('returns null for a turn with no error and for an empty tail', () => {
    expect(failedTurnFromRollout(buf(started(1) + ok(1)), 0, 0)).toBeNull();
    expect(failedTurnFromRollout(buf(''), 0, 0)).toBeNull();
  });

  it('ignores an old failure followed by a successful turn', () => {
    const old = started(1) + failed(1);
    const text = old + started(2) + ok(2);
    expect(failedTurnFromRollout(buf(text), 0, 0)).toBeNull();
    expect(failedTurnFromRollout(buf(text), 0, Buffer.byteLength(old))).toBeNull();
  });

  it('ignores an older failed turn when scoped to the current turn offset', () => {
    const old = started(1) + failed(1);
    expect(failedTurnFromRollout(buf(old + started(2)), 0, Buffer.byteLength(old))).toBeNull();
  });

  it('finds the failure of the current turn after an older success (resume appending to an old file)', () => {
    const old = started(1) + ok(1);
    const text = old + started(2) + failed(2, 'internal_server_error');
    expect(failedTurnFromRollout(buf(text), 0, Buffer.byteLength(old))).toMatchObject({ error: 'server_error' });
  });

  it('a retry that succeeded leaves no error record', () => {
    expect(failedTurnFromRollout(buf(started(1) + ok(1)), 0, 0)).toBeNull();
  });

  it('returns null when a newer turn already started after the failure', () => {
    expect(failedTurnFromRollout(buf(started(1) + failed(1) + started(2)), 0, 0)).toBeNull();
  });

  it('drops the partial first line of a mid-file tail, and a tail with no newline', () => {
    const full = started(1) + failed(1);
    const cut = full.slice(5);
    expect(failedTurnFromRollout(buf(cut), 5, 0)).toMatchObject({ kind: 'api-error-stop' });
    expect(failedTurnFromRollout(buf('{"type":"event_msg"'), 10, 0)).toBeNull();
  });

  it('a tail that lost the turn start still reports a failure after the offset', () => {
    const text = started(1) + failed(1);
    expect(failedTurnFromRollout(buf(text), 100, 50)).toMatchObject({ error: 'overloaded' });
  });

  it('skips malformed, non-object and oversize lines', () => {
    const huge = line({ type: 'response_item', payload: { text: 'x'.repeat(300 * 1024) } });
    const text = `not json\n[]\n"str"\n${huge}${started(1)}${failed(1)}`;
    expect(failedTurnFromRollout(buf(text), 0, 0)).toMatchObject({ kind: 'api-error-stop' });
  });

  it('caps the lines scanned', () => {
    const filler = line({ type: 'response_item', payload: {} }).repeat(6000);
    expect(failedTurnFromRollout(buf(started(1) + failed(1) + filler), 0, 0)).toMatchObject({ kind: 'api-error-stop' });
    expect(failedTurnFromRollout(buf(filler + started(1) + failed(1)), 0, 0)).toBeNull();
  });

  it('a model reply that says "rate limit exceeded" does not match', () => {
    const reply = line({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ text: 'rate limit exceeded 429 server_overloaded' }] } });
    expect(failedTurnFromRollout(buf(started(1) + reply + ok(1)), 0, 0)).toBeNull();
  });

  it('sanitises control characters in the message', () => {
    const event = failedTurnFromRollout(buf(started(1) + failed(1, 'server_overloaded', '\u001b[31mbad\u0000 text\u001b[0m')), 0, 0);
    expect(event).toMatchObject({ text: 'bad text' });
  });

  it('an unobserved error name maps to unknown and is retried; an error with no info too', () => {
    expect(failedTurnFromRollout(buf(started(1) + failed(1, 'brand_new')), 0, 0)).toMatchObject({ error: 'unknown', retryable: true });
    expect(failedTurnFromRollout(buf(started(1) + failed(1, null)), 0, 0)).toMatchObject({ error: 'unknown', retryable: true });
  });

  it('requireSingleTurn: accepts one turn, rejects several or a mid-file tail', () => {
    expect(failedTurnFromRollout(buf(started(1) + failed(1)), 0, 0, { requireSingleTurn: true })).not.toBeNull();
    expect(failedTurnFromRollout(buf(started(1) + ok(1) + started(2) + failed(2)), 0, 0, { requireSingleTurn: true })).toBeNull();
    expect(failedTurnFromRollout(buf(started(1) + failed(1)), 100, 0, { requireSingleTurn: true })).toBeNull();
  });
});
