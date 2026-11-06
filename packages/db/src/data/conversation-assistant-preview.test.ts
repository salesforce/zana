import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { appendConversationThreadEvent, createConversationThread, openDatabase, upsertHost, type ZccDatabase } from '../index.js';
import { ASSISTANT_PREVIEW_CHARS, ASSISTANT_PREVIEW_EVENT_LIMIT, getConversationAssistantPreview, getConversationFailurePreview } from './conversation-assistant-preview.js';

let db: ZccDatabase;
let dir: string;
afterEach(() => { db?.close(); if (dir) rmSync(dir, { recursive: true, force: true }); });
function setup() {
  dir = mkdtempSync(join(tmpdir(), 'assistant-preview-'));
  db = openDatabase(join(dir, 'db.sqlite'));
  const host = upsertHost(db, { name: 'test', hostKeyHash: 'a'.repeat(64) });
  const thread = createConversationThread(db, { projectId: 'p', hostId: host.id, providerId: 'fake', status: 'active' });
  return thread.id;
}
function message(id: string, text: string, over: Record<string, unknown> = {}, wrapped = false) {
  const payload = { type: 'item/completed', threadId: id, scope: { kind: 'turn', turnId: 'turn-1' }, item: { type: 'agentMessage', id: 'm', text }, ...over };
  return appendConversationThreadEvent(db, { threadId: id, type: 'item/completed', payload: wrapped ? { event: payload } : payload });
}
it('seeks only the latest assistant message from the pending turn before the question', () => {
  const id = setup();
  message(id, 'Previous');
  message(id, 'Relevant context');
  message(id, 'Other turn', { scope: { kind: 'turn', turnId: 'turn-2' } });
  message(id, 'Nested', { parentToolCallId: 'child' });
  message(id, ' ', {});
  message(id, 'Tool output', { item: { type: 'commandExecution', text: 'Tool output' } });
  const future = message(id, 'After the question');
  db.sqlite.prepare('UPDATE thread_events SET created_at = ? WHERE id = ?').run(Date.now() + 10_000, future.id);
  expect(getConversationAssistantPreview(db, id, 'turn-1', Date.now())).toEqual({ text: 'Relevant context', truncated: false });
  expect(getConversationAssistantPreview(db, id, null, Date.now())).toBeUndefined();
  expect(getConversationAssistantPreview(db, id, 'missing', Date.now())).toBeUndefined();
});
it('supports wrapped events and caps very large text in SQLite', () => {
  const id = setup();
  message(id, 'x'.repeat(100_000), {}, true);
  expect(getConversationAssistantPreview(db, id, 'turn-1', Date.now())).toEqual({ text: 'x'.repeat(ASSISTANT_PREVIEW_CHARS), truncated: true });
});
it('bounds the history scan when no recent assistant context exists', () => {
  const id = setup();
  message(id, 'Outside the preview window');
  db.sqlite.transaction(() => {
    for (let i = 0; i < ASSISTANT_PREVIEW_EVENT_LIMIT; i++) {
      message(id, 'Tool output', { item: { type: 'commandExecution', text: 'output' } });
    }
  })();
  expect(getConversationAssistantPreview(db, id, 'turn-1', Date.now())).toBeUndefined();
});

function completion(id: string, status: string, error?: unknown, wrapped = false, parentToolCallId?: string) {
  const payload = { type: 'turn/completed', status, error, parentToolCallId };
  appendConversationThreadEvent(db, { threadId: id, type: 'turn/completed', payload: wrapped ? { event: payload } : payload });
}
it('extracts a bounded failure from direct and wrapped terminal events, excluding nested failures', () => {
  const id = setup();
  expect(getConversationFailurePreview(db, id)).toBeUndefined();
  completion(id, 'failed', { message: '  Connection closed.  ' });
  expect(getConversationFailurePreview(db, id)).toBe('Connection closed.');
  completion(id, 'failed', { message: 'x'.repeat(100_000) }, true);
  expect(getConversationFailurePreview(db, id)).toBe('x'.repeat(ASSISTANT_PREVIEW_CHARS));
  completion(id, 'failed', { message: 'Nested failure' }, false, 'tool-1');
  expect(getConversationFailurePreview(db, id)).toBe('x'.repeat(ASSISTANT_PREVIEW_CHARS));
});
it('never reuses an older failure after a newer successful or unexplained completion', () => {
  const id = setup();
  completion(id, 'failed', { message: 'Old error' });
  completion(id, 'completed');
  expect(getConversationFailurePreview(db, id)).toBeUndefined();
  for (const error of [undefined, { message: '  ' }, { message: 42 }, { message: { invalid: true } }]) {
    completion(id, 'failed', error);
    expect(getConversationFailurePreview(db, id)).toBeUndefined();
  }
});

it('uses the latest root turn, even when a child completion omits its parent id', () => {
  const id = setup();
  const event = (type: string, turnId: string, fields: Record<string, unknown> = {}) => appendConversationThreadEvent(db, {
    threadId: id, type, payload: { type, scope: { kind: 'turn', turnId }, ...fields }
  });
  event('turn/started', 'root');
  event('turn/completed', 'root', { status: 'failed', error: { message: 'Root failure' } });
  event('turn/started', 'child', { parentToolCallId: 'tool' });
  event('turn/completed', 'child', { status: 'failed', error: { message: 'Child failure' } });
  expect(getConversationFailurePreview(db, id)).toBe('Root failure');
  event('turn/started', 'new-root');
  expect(getConversationFailurePreview(db, id)).toBeUndefined();
});

it('reads interrupted system errors and provider errors but never in-flight retries', () => {
  const id = setup();
  const event = (type: string, fields: Record<string, unknown>, wrapped = false) => {
    const payload = { type, ...fields };
    appendConversationThreadEvent(db, { threadId: id, type, payload: wrapped ? { event: payload } : payload });
  };
  event('turn/started', { scope: { turnId: 'root' } });
  event('turn/completed', { scope: { turnId: 'root' }, status: 'interrupted' });
  event('system/error', { scope: { turnId: 'root' }, message: 'Thread interrupted because the host daemon disconnected' });
  expect(getConversationFailurePreview(db, id)).toBe('Thread interrupted because the host daemon disconnected');
  event('provider/error', { message: 'Provider unavailable', willRetry: false }, true);
  expect(getConversationFailurePreview(db, id)).toBe('Provider unavailable');
  event('provider/error', { message: 'Retrying', willRetry: true });
  expect(getConversationFailurePreview(db, id)).toBeUndefined();
  event('system/error', { message: 'Reconnecting', reconnectAttempt: 1 });
  expect(getConversationFailurePreview(db, id)).toBeUndefined();
  event('turn/started', { scope: { turnId: 'new-root' } });
  expect(getConversationFailurePreview(db, id)).toBeUndefined();
});

it('accepts dot-kind terminal envelopes from the host event stream', () => {
  const id = setup();
  appendConversationThreadEvent(db, { threadId: id, type: 'turn.started', payload: { type: 'turn/started', scope: { turnId: 'root' } } });
  appendConversationThreadEvent(db, { threadId: id, type: 'turn.completed', payload: { type: 'turn/completed', scope: { turnId: 'root' }, status: 'failed', error: { message: 'Host failure' } } });
  expect(getConversationFailurePreview(db, id)).toBe('Host failure');
});
