import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { openDatabase, upsertHost, createEnvironment, createConversationThread } from '@zana-ai/zcc-db';
import { createTimelineEventFactory, renderTimelineFixture } from '../../../../../packages/thread-view/test/timeline-test-harness.js';
import { decodeThreadEventRow } from '../../../../../packages/thread-view/src/event-decode.js';
import { conversationItemsFromRows, conversationOutline, conversationSearchTextsFromRows } from './conversation-timeline.js';
import type { ProductHttpContext } from '../../http/product-context.js';

it('matches the full nested projection, reuses SQL results and invalidates interior edits and rewind', () => {
  const home = mkdtempSync(join(tmpdir(), 'zcc-outline-integration-'));
  const db = openDatabase(join(home, 'db.sqlite'));
  try {
    const host = upsertHost(db, { name: 'fixture', hostKeyHash: 'p'.repeat(64) });
    const environment = createEnvironment(db, { projectId: 'fixture', hostId: host.id, path: home });
    const thread = createConversationThread(db, { projectId: 'fixture', hostId: host.id, environmentId: environment.id, providerId: 'fake', status: 'idle' });
    const event = createTimelineEventFactory({ threadId: thread.id });
    const events = [
      event.clientTurnRequested({ text: 'Root question', input: [{ type: 'text', text: 'Root question', mentions: [] }, { type: 'localFile', path: join(home, 'note.txt'), mimeType: 'text/plain', name: 'note.txt' }] }),
      event.turnStarted({ turnId: 'parent' }),
      event.delegationStarted({ turnId: 'parent', itemId: 'call', childRef: 'child', label: 'Read note' }),
      event.turnStarted({ turnId: 'child-turn', parentToolCallId: 'call' }),
      event.assistantCompleted({ turnId: 'child-turn', parentToolCallId: 'call', itemId: 'child-answer', text: 'Nested answer' }),
      event.turnCompleted({ turnId: 'child-turn' }),
      event.delegationCompleted({ turnId: 'parent', itemId: 'call', childRef: 'child', label: 'Read note', summary: 'Done' }),
      event.assistantDelta({ turnId: 'parent', itemId: 'root-answer', delta: 'Partial answer' }),
      event.assistantCompleted({ turnId: 'parent', itemId: 'root-answer', text: 'Root answer' }),
      event.turnCompleted({ turnId: 'parent' })
    ];
    const insert = db.sqlite.prepare('INSERT INTO thread_events(id,thread_id,sequence,type,payload,created_at) VALUES (?,?,?,?,?,?)');
    for (const row of events) insert.run(row.id, thread.id, row.seq, row.type, JSON.stringify(decodeThreadEventRow(row).event), row.createdAt);
    const ctx = { db, dataDir: home } as ProductHttpContext;
    const fullNested = renderTimelineFixture({ events, includeNestedRows: true, projectionOptions: { threadStatus: 'idle', turnMessageDetail: 'full' } });
    const first = conversationOutline(ctx, thread.id);
    expect(first.items).toEqual(conversationItemsFromRows(fullNested.rows));
    expect(first.items.map(item => item.preview)).toEqual(['Root question', 'Root answer']);
    expect(first.items[0]?.attachmentSummary).toEqual({ imageCount: 0, fileCount: 1 });
    const prepare = vi.spyOn(db.sqlite, 'prepare');
    expect(conversationOutline(ctx, thread.id)).toEqual(first);
    expect(prepare.mock.calls.some(([sql]) => /FROM thread_events/i.test(sql))).toBe(false);
    prepare.mockRestore();
    // Find-in-thread counts the full text, case-insensitively and literally.
    expect(conversationOutline(ctx, thread.id, '  ROOT ')).toEqual({ ...first, matches: [{ id: first.items[0]!.id, seq: events[0]!.seq, count: 1 }, { id: first.items[1]!.id, seq: expect.any(Number), count: 1 }] });
    expect(conversationOutline(ctx, thread.id, 'answer').matches).toEqual([{ id: first.items[1]!.id, seq: expect.any(Number), count: 1 }]);
    expect(conversationOutline(ctx, thread.id, '.*').matches).toEqual([]);
    expect(conversationOutline(ctx, thread.id, '   ')).toEqual(first);
    const searchPrepare = vi.spyOn(db.sqlite, 'prepare');
    expect(conversationOutline(ctx, thread.id, 'question').matches).toEqual([{ id: first.items[0]!.id, seq: events[0]!.seq, count: 1 }]);
    expect(searchPrepare.mock.calls.some(([sql]) => /FROM thread_events/i.test(sql))).toBe(false);
    searchPrepare.mockRestore();
    db.sqlite.prepare("UPDATE thread_events SET payload=json_set(payload,'$.item.text',?) WHERE id=?").run('Revised root answer', events[8]!.id);
    expect(conversationOutline(ctx, thread.id).items[1]?.preview).toBe('Revised root answer');
    expect(conversationOutline(ctx, thread.id, 'revised').matches).toEqual([{ id: first.items[1]!.id, seq: expect.any(Number), count: 1 }]);
    // Matches past the 80-character preview still count.
    db.sqlite.prepare("UPDATE thread_events SET payload=json_set(payload,'$.item.text',?) WHERE id=?").run(`${'filler '.repeat(20)}needle and NEEDLE`, events[8]!.id);
    const long = conversationOutline(ctx, thread.id, 'needle');
    expect(long.items[1]?.preview).not.toContain('needle');
    expect(long.matches).toEqual([{ id: first.items[1]!.id, seq: expect.any(Number), count: 2 }]);
    db.sqlite.prepare('DELETE FROM thread_events WHERE sequence>=? AND thread_id=?').run(events[7]!.seq, thread.id);
    const rewound = conversationOutline(ctx, thread.id);
    expect(rewound.maxSeq).toBe(events[6]!.seq);
    expect(rewound.items.map(item => item.preview)).toEqual(['Root question']);
    db.sqlite.prepare('DELETE FROM threads WHERE id=?').run(thread.id);
    expect(() => conversationOutline(ctx, thread.id)).toThrow(/not registered/);
  } finally { vi.restoreAllMocks(); db.close(); rmSync(home, { recursive: true, force: true }); }
});

it('reads outline messages from turns, defaulting missing fields', () => {
  const rows = [
    { kind: 'conversation', id: 'u1', role: 'user', text: 'hello', sourceSeqStart: 4, attachments: { webImages: 1, localImages: 1, localFiles: 2 } },
    { kind: 'turn', id: 't1', children: [{ kind: 'conversation', id: 'a1' }] },
    { kind: 'turn', id: 't2', children: null },
    { kind: 'work', id: 'w1', text: 'not a message' }
  ] as unknown as Parameters<typeof conversationItemsFromRows>[0];
  expect(conversationItemsFromRows(rows)).toEqual([
    { id: 'u1', role: 'user', preview: 'hello', attachmentSummary: { imageCount: 2, fileCount: 2 } },
    { id: 'a1', role: 'assistant', preview: '', attachmentSummary: null }
  ]);
  expect(conversationSearchTextsFromRows(rows)).toEqual([
    { id: 'u1', seq: 4, text: 'hello' },
    { id: 'a1', seq: 0, text: '' }
  ]);
});
