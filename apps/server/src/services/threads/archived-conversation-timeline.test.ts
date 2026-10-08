import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendConversationThreadEvent, compactArchivedConversations, createConversationThread, listConversationThreadEvents,
  openDatabase, upsertHost, type ZccDatabase
} from '@zana-ai/zcc-db';
import { buildThreadEvent, encodeClientTurnRequestIdNumber } from '@zana-ai/zcc-domain/thread-runtime';
import type { ThreadEventRow } from '@zana-ai/zcc-domain/thread-runtime';
import { EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT, buildThreadTimelineFromEvents, formatThreadTimelineText } from '@zana-ai/zcc-thread-view';
import { storedEventsToMeta } from './conversation-timeline.js';

let db: ZccDatabase, dir: string, threadId: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'archived-conversation-timeline-'));
  db = openDatabase(join(dir, 'db.sqlite'));
  const host = upsertHost(db, { name: 'test', hostKeyHash: 'h'.repeat(64) });
  threadId = createConversationThread(db, { projectId: 'p', hostId: host.id, providerId: 'codex' }).id;
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

let seq = 0;
function add(type: string, data: Record<string, unknown>, turn = true) {
  seq++;
  const scope = turn ? { kind: 'turn', turnId: 'turn-1' } : { kind: 'thread' };
  const provider = turn ? { providerThreadId: 'provider-thread-1', turnId: 'turn-1' } : {};
  const row = { id: `evt-${seq}`, threadId, seq, createdAt: seq, scope, type, data: { ...provider, ...data } } as unknown as ThreadEventRow;
  appendConversationThreadEvent(db, { threadId, type, payload: buildThreadEvent(row) });
}
const command = (status: string) => ({
  type: 'commandExecution', id: 'cmd-1', command: 'pnpm test', cwd: '/repo',
  status, approvalStatus: null, ...(status === 'completed' ? { aggregatedOutput: 'SECRET-TOOL-OUTPUT', exitCode: 0 } : {})
});
function render() {
  const events = storedEventsToMeta(listConversationThreadEvents(db, threadId));
  const timeline = buildThreadTimelineFromEvents({
    acceptedClientRequestContext: EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
    contextWindowEvents: [],
    events,
    options: { includeDebugRawEvents: false, includeProviderUnhandledOperations: false, includeNestedRows: true,
      isLatestPage: true, threadStatus: 'idle', threadName: '', workspaceRoot: null, turnMessageDetail: 'full' }
  } as Parameters<typeof buildThreadTimelineFromEvents>[0]);
  return formatThreadTimelineText(timeline.rows, { color: false, verbose: true });
}

it('still renders the prompt and answer of a compacted archived thread, without the tool detail', () => {
  add('client/turn/requested', {
    direction: 'outbound', requestId: encodeClientTurnRequestIdNumber({ value: 1 }), source: 'tell', initiator: 'user',
    senderThreadId: null, input: [{ type: 'text', text: 'Please fix the flaky test', mentions: [] }], target: { kind: 'new-turn' },
    request: { method: 'turn/start', params: {} },
    execution: { model: 'gpt-5', serviceTier: 'default', reasoningLevel: 'medium', permissionMode: 'full', source: 'client/turn/requested' }
  }, false);
  add('turn/started', {});
  add('item/started', { item: command('pending') });
  add('item/commandExecution/outputDelta', { itemId: 'cmd-1', delta: 'SECRET-TOOL-OUTPUT' });
  add('item/completed', { item: command('completed') });
  add('item/completed', { item: { type: 'agentMessage', id: 'answer-1', text: 'The flaky test is fixed.' } });
  add('turn/completed', { status: 'completed' });

  const before = render();
  expect(before).toContain('Please fix the flaky test');
  expect(before).toContain('The flaky test is fixed.');
  expect(before).toContain('pnpm test');

  db.sqlite.prepare('UPDATE threads SET archived_at = 1 WHERE id = ?').run(threadId);
  expect(compactArchivedConversations(db)).toMatchObject({ threadId, removed: 3 });
  const after = render();
  expect(after).toContain('Please fix the flaky test');
  expect(after).toContain('The flaky test is fixed.');
  expect(after).not.toContain('pnpm test');
  expect(after).not.toContain('SECRET-TOOL-OUTPUT');
});
