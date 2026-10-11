import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendConversationThreadEvent,
  archiveConversationThread,
  createConversationThread,
  createPendingInteraction,
  openDatabase,
  setPendingInteractionResolved,
  upsertHost,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { NotificationLimitError } from './level-store.js';
import { createNotificationService } from './notification-service.js';
import { FALLBACK_BODIES } from './previews.js';

let db: ZccDatabase;
let dir: string;
let hostId: string;
let config: Partial<AppConfig>;

function thread(opts: { parentThreadId?: string | null; title?: string | null } = {}) {
  return createConversationThread(db, { projectId: 'p', hostId, providerId: 'codex', ...opts });
}
function service(max?: number) {
  return createNotificationService({ db, getConfig: () => config, ...(max === undefined ? {} : { maxOverrides: max }) });
}
function reply(threadId: string, text: string) {
  appendConversationThreadEvent(db, {
    threadId,
    type: 'item/completed',
    payload: { type: 'item/completed', scope: { kind: 'turn', turnId: 't1' }, item: { id: `i-${text.length}`, type: 'agentMessage', text } }
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'notification-service-'));
  db = openDatabase(join(dir, 'db.sqlite'));
  hostId = upsertHost(db, { name: 'test', hostKeyHash: 'h'.repeat(64) }).id;
  config = {};
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('get / set', () => {
  it('returns null for an unknown thread', () => {
    expect(service().get('thr_missing')).toBeNull();
    expect(service().set('thr_missing', 'muted')).toBeNull();
  });

  it('applies the shipped defaults: all for a top-level thread, input-only for a child', () => {
    const parent = thread();
    const child = thread({ parentThreadId: parent.id });
    expect(service().get(parent.id)).toEqual({
      threadId: parent.id,
      own: 'inherit',
      effective: 'all',
      source: 'global',
      defaultLevel: 'all',
      childLevel: 'input-only'
    });
    expect(service().get(child.id)).toMatchObject({ own: 'inherit', effective: 'input-only', source: 'child-default' });
  });

  it('honours the configured defaults', () => {
    config = { notificationDefaultLevel: 'muted', notificationChildLevel: 'inherit' };
    const parent = thread();
    const child = thread({ parentThreadId: parent.id });
    expect(service().get(parent.id)).toMatchObject({ effective: 'muted', source: 'global', defaultLevel: 'muted', childLevel: 'inherit' });
    expect(service().get(child.id)).toMatchObject({ effective: 'muted', source: 'global' });
  });

  it('stores an own level and returns the resolved state', () => {
    const t = thread();
    expect(service().set(t.id, 'muted')).toMatchObject({ own: 'muted', effective: 'muted', source: 'self' });
    expect(service().get(t.id)).toMatchObject({ own: 'muted', effective: 'muted', source: 'self' });
    expect(service().set(t.id, 'inherit')).toMatchObject({ own: 'inherit', effective: 'all', source: 'global' });
  });

  it('lets the quietest ancestor cap a thread, parent first and then ancestor', () => {
    const root = thread();
    const mid = thread({ parentThreadId: root.id });
    const leaf = thread({ parentThreadId: mid.id });
    service().set(leaf.id, 'all');
    service().set(root.id, 'muted');
    expect(service().get(leaf.id)).toMatchObject({ own: 'all', effective: 'muted', source: 'ancestor' });
    expect(service().get(mid.id)).toMatchObject({ own: 'inherit', effective: 'muted', source: 'parent' });
    service().set(mid.id, 'input-only');
    // the quietest ancestor (root, muted) still wins over the parent's input-only
    expect(service().get(leaf.id)).toMatchObject({ effective: 'muted', source: 'ancestor' });
    service().set(root.id, 'inherit');
    expect(service().get(leaf.id)).toMatchObject({ effective: 'input-only', source: 'parent' });
  });

  it('terminates on a parent cycle and on an over-deep chain', () => {
    const a = thread();
    const b = thread({ parentThreadId: a.id });
    db.sqlite.prepare('UPDATE threads SET parent_thread_id = ? WHERE id = ?').run(b.id, a.id);
    service().set(a.id, 'muted');
    expect(service().get(b.id)).toMatchObject({ effective: 'muted' });

    let parent = thread();
    service().set(parent.id, 'muted');
    for (let i = 0; i < 60; i += 1) parent = thread({ parentThreadId: parent.id });
    // The muted root is deeper than the walk limit, so the leaf falls back to its default.
    expect(service().get(parent.id)).toMatchObject({ effective: 'input-only', source: 'child-default' });
  });

  it('propagates the retention cap error', () => {
    const [a, b] = [thread(), thread()];
    const limited = service(1);
    limited.set(a.id, 'muted');
    expect(() => limited.set(b.id, 'muted')).toThrow(NotificationLimitError);
  });
});

describe('verdict', () => {
  const question = JSON.stringify({
    kind: 'user_question',
    questions: [{ id: 'q', prompt: 'Which branch should I use?', multiSelect: false, allowFreeText: true }]
  });

  it('is null for an unknown thread and refuses archived threads', () => {
    expect(service().verdict('thr_missing', 'turn-finished')).toBeNull();
    const t = thread({ title: 'Old' });
    archiveConversationThread(db, t.id);
    expect(service().verdict(t.id, 'turn-finished')).toMatchObject({ send: false, reason: 'archived' });
  });

  it('gates each kind by the effective level', () => {
    const t = thread({ title: 'Build' });
    const kinds = ['pending-interaction', 'thread-error', 'turn-finished'] as const;
    const sends = () => kinds.map((kind) => service().verdict(t.id, kind)?.send);
    expect(sends()).toEqual([true, true, true]);
    service().set(t.id, 'input-only');
    expect(sends()).toEqual([true, true, false]);
    service().set(t.id, 'muted');
    expect(sends()).toEqual([false, false, false]);
    expect(service().verdict(t.id, 'turn-finished')).toMatchObject({ send: false, level: 'muted', source: 'self', reason: 'level' });
  });

  it('keeps a muted thread silent when a muted ancestor caps its louder level', () => {
    const parent = thread();
    const child = thread({ parentThreadId: parent.id });
    service().set(child.id, 'all');
    service().set(parent.id, 'muted');
    expect(service().verdict(child.id, 'pending-interaction')?.send).toBe(false);
  });

  it('uses the title of a plugin-defined request', () => {
    const t = thread({ title: 'Release prep' });
    createPendingInteraction(db, {
      originKind: 'plugin',
      threadId: t.id,
      pluginId: 'acme',
      rendererId: 'review',
      payload: JSON.stringify({ kind: 'acme/review', title: 'Review the draft', data: { token: 'x' } })
    });
    expect(service().verdict(t.id, 'pending-interaction')).toMatchObject({
      send: true,
      level: 'all',
      title: 'Release prep',
      body: 'Review the draft'
    });
  });

  it('quotes a user question from the stored payload', () => {
    const t = thread({ title: 'Release prep' });
    createPendingInteraction(db, {
      originKind: 'provider',
      threadId: t.id,
      turnId: 'turn-1',
      providerId: 'codex',
      providerThreadId: 'pt-1',
      providerRequestId: 'req-1',
      payload: question
    });
    expect(service().verdict(t.id, 'pending-interaction')).toMatchObject({
      send: true,
      title: 'Release prep',
      body: 'Which branch should I use?'
    });
  });

  it('falls back to a generic body once the interaction is resolved', () => {
    const t = thread({ title: 'Release prep' });
    const interaction = createPendingInteraction(db, {
      originKind: 'provider',
      threadId: t.id,
      turnId: 'turn-1',
      providerId: 'codex',
      providerThreadId: 'pt-1',
      providerRequestId: 'req-1',
      payload: question
    });
    setPendingInteractionResolved(db, { id: interaction.id, resolution: '{}' });
    expect(service().verdict(t.id, 'pending-interaction')).toMatchObject({
      send: true,
      body: FALLBACK_BODIES['pending-interaction']
    });
  });

  it('summarises the last assistant reply for a finished turn, skipping tool output', () => {
    const t = thread({ title: 'Fix flaky test' });
    reply(t.id, 'First pass done.');
    appendConversationThreadEvent(db, {
      threadId: t.id,
      type: 'item/completed',
      payload: { type: 'item/completed', item: { id: 'cmd', type: 'commandExecution', command: 'cat .env', aggregatedOutput: 'SECRET=hunter2' } }
    });
    reply(t.id, '**All tests pass now.**\n\n```\nSECRET=hunter2\n```');
    expect(service().verdict(t.id, 'turn-finished')).toMatchObject({
      send: true,
      title: 'Fix flaky test',
      body: 'All tests pass now.'
    });
  });

  it('uses the generic body for a finished turn without any reply and for errors', () => {
    const t = thread({ title: 'Quiet' });
    expect(service().verdict(t.id, 'turn-finished')?.body).toBe(FALLBACK_BODIES['turn-finished']);
    reply(t.id, 'Something secret-ish');
    expect(service().verdict(t.id, 'thread-error')?.body).toBe(FALLBACK_BODIES['thread-error']);
  });

  it('omits the preview text entirely when previews are switched off', () => {
    config = { notificationPreviews: false };
    const t = thread({ title: 'Private' });
    reply(t.id, 'Top secret plan');
    const verdict = service().verdict(t.id, 'turn-finished');
    expect(verdict).toMatchObject({ send: true, level: 'all' });
    expect(verdict).not.toHaveProperty('title');
    expect(verdict).not.toHaveProperty('body');
  });
});
