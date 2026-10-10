import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { threadScope, turnScope } from '@zana-ai/zcc-domain/thread-runtime';
import { EMPTY_THREAD_ACTIVITY, threadActivityFromEvents } from '@zana-ai/zcc-thread-view';
import {
  appendConversationThreadEvent, createConversationThread, openDatabase, upsertHost,
  listConversationThreadEvents, listConversationActiveTurnInputs, deleteConversationThreadEventsAfter,
  getConversationThreadActivityCounts, listConversationOpenBackgroundTaskItems, ACTIVE_PLAN_INPUT_PAGE_SIZE,
  OPEN_BACKGROUND_TASK_LIMIT, type ZccDatabase
} from '@zana-ai/zcc-db';
import { activePlanTurnForConversation, resetThreadActivityCache, threadActivityForConversation } from './conversation-thread-activity.js';
import type { ProductHttpContext } from '../../http/product-context.js';

vi.mock('./thread-provider-catalog.js', () => ({
  planCommandForProvider: (id: string) => id === 'codex' ? { trigger: '/', name: 'plan' } : null
}));
let db: ZccDatabase;
let dir: string;
let thread: ReturnType<typeof createConversationThread>;
let ctx: ProductHttpContext;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thread-activity-'));
  db = openDatabase(join(dir, 'test.sqlite'));
  const host = upsertHost(db, { name: 'host', hostKeyHash: 'a'.repeat(64) });
  thread = createConversationThread(db, { projectId: 'p', hostId: host.id, providerId: 'codex', status: 'active' });
  ctx = { db } as ProductHttpContext;
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); resetThreadActivityCache(); });
function event(type: string, fields: object = {}, wrapped = false, threadId = thread.id) {
  const payload = { type, threadId, providerThreadId: 'p1', scope: threadScope(), ...fields };
  return appendConversationThreadEvent(db, { threadId, type, payload: wrapped ? { event: payload } : payload });
}
function task(id: string, taskType = 'local_bash', status = 'pending', extra = {}, wrapped = false) {
  return event(status === 'pending' ? 'item/started' : 'item/backgroundTask/completed', {
    item: { id, type: 'backgroundTask', taskType, status, taskStatus: status === 'pending' ? 'running' : 'completed', skipTranscript: false, description: id, ...extra }
  }, wrapped);
}
function accepted(id: string, mode = 'plan', wrapped = false) {
  event('client/turn/requested', {
    requestId: id, input: [{ type: 'text', text: `Prompt ${id}`, mentions: [] }], execution: { acpMode: mode }
  }, wrapped);
  return event('turn/input/accepted', { clientRequestId: id, scope: turnScope(id) }, wrapped);
}

describe('bounded conversation activity', () => {
  it('lists the running task items however old, with their latest state', () => {
    task('dev'); task('done'); task('done', 'local_bash', 'completed');
    task('hidden', 'local_bash', 'pending', { skipTranscript: true }); task('wrapped', 'local_agent', 'pending', {}, true);
    for (let i = 0; i < 300; i++) event('turn/diff/updated', { diff: 'x' });
    event('item/backgroundTask/progress', { item: { id: 'dev', type: 'backgroundTask', taskType: 'local_bash', status: 'pending', taskStatus: 'running', skipTranscript: false, description: 'npm run dev' } });
    expect(listConversationOpenBackgroundTaskItems(db, thread.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'dev', description: 'npm run dev' }),
      expect.objectContaining({ id: 'wrapped' })
    ]));
    expect(listConversationOpenBackgroundTaskItems(db, thread.id)).toHaveLength(2);
    expect(listConversationOpenBackgroundTaskItems(db, 'missing')).toEqual([]);
    expect(OPEN_BACKGROUND_TASK_LIMIT).toBe(200);
  });

  it('returns empty counts for missing history and skips the database for sequence zero', () => {
    expect(getConversationThreadActivityCounts(db, 'missing')).toEqual({ activeWorkflowCount: 0, activeBackgroundAgentCount: 0, activeBackgroundCommandCount: 0, activeGoalCount: 0 });
    const prepare = vi.spyOn(db.sqlite, 'prepare');
    expect(threadActivityForConversation(ctx, thread, 0)).toEqual(EMPTY_THREAD_ACTIVITY);
    expect(prepare).not.toHaveBeenCalled();
    prepare.mockRestore();
  });

  it('matches the existing projector across task kinds, settlements, hidden tasks, wrapped events and goals', () => {
    task('bash'); task('agent', 'local_agent'); task('subagent', 'local_subagent'); task('workflow', 'local_workflow');
    task('done'); task('done', 'local_bash', 'completed');
    task('failed', 'local_bash', 'failed'); task('hidden', 'local_bash', 'pending', { skipTranscript: true });
    task('unknown', 'monitor'); task('wrapped', 'local_bash', 'pending', {}, true);
    task('progress', 'local_bash', 'completed');
    event('item/backgroundTask/progress', { item: { id: 'progress', type: 'backgroundTask', taskType: 'local_agent', status: 'pending', taskStatus: 'running' } });
    event('item/completed', { item: { id: 'bash', type: 'backgroundTask', taskType: 'local_bash', status: 'completed' } });
    event('thread/goal/updated', { objective: 'Ship', status: 'active' }, true);
    appendConversationThreadEvent(db, { threadId: thread.id, type: 'thread/goal/cleared', payload: {} });
    const events = listConversationThreadEvents(db, thread.id).flatMap(row => {
      const payload = row.payload as any; const event = payload.event ?? payload;
      return event.scope ? [{ event, meta: { id: row.id, seq: row.sequence, createdAt: row.createdAt } }] : [];
    });
    expect(threadActivityForConversation(ctx, thread, 100)).toEqual(threadActivityFromEvents(events));
    expect(threadActivityForConversation(ctx, thread, 100).activeGoalCount).toBe(1);
    event('thread/goal/cleared');
    expect(threadActivityForConversation(ctx, thread, 101).activeGoalCount).toBe(0);
  });

  it('retains old tasks and Plan inputs beyond long output, and reads no transcript payloads', () => {
    task('long-running'); accepted('plan', 'plan', true);
    const output = 'x'.repeat(100_000);
    db.transaction(() => {
      for (let i = 0; i < 300; i++) event('turn/diff/updated', { diff: output });
      event('item/completed', { item: { type: 'commandExecution', output } });
    });
    const read = vi.spyOn(db.sqlite, 'prepare');
    expect(threadActivityForConversation(ctx, thread, 304)).toEqual({ ...EMPTY_THREAD_ACTIVITY, activeBackgroundCommandCount: 1, activePlanModeCount: 1 });
    expect(read.mock.calls.every(([sql]) => !sql.includes('SELECT * FROM thread_events'))).toBe(true);
    expect(activePlanTurnForConversation(ctx, thread)?.promptMode.prompt).toBe('Prompt plan');
    read.mockRestore();
  });

  it('filters completed, interrupted, unmatched and other-thread inputs before paging', () => {
    accepted('done'); event('turn/completed', { scope: turnScope('done') }, true);
    accepted('interrupted'); event('system/thread/interrupted');
    event('turn/input/accepted', { clientRequestId: 'missing', scope: turnScope('missing') });
    accepted('active', 'plan', true);
    const other = createConversationThread(db, { projectId: 'p', hostId: thread.hostId, providerId: 'codex' });
    event('turn/completed', { scope: turnScope('active') }, false, other.id);
    expect(listConversationActiveTurnInputs(db, thread.id)).toHaveLength(1);
    expect(activePlanTurnForConversation(ctx, thread)?.turnId).toBe('active');
    event('turn/completed', { scope: turnScope('active') });
    expect(activePlanTurnForConversation(ctx, thread)).toBeNull();
  });

  it('finds the latest Plan input across pages of newer non-Plan inputs', () => {
    const plan = accepted('old-plan');
    for (let i = 0; i <= ACTIVE_PLAN_INPUT_PAGE_SIZE; i++) accepted(`agent-${i}`, 'agent');
    const first = listConversationActiveTurnInputs(db, thread.id);
    expect(first).toHaveLength(ACTIVE_PLAN_INPUT_PAGE_SIZE);
    expect(listConversationActiveTurnInputs(db, thread.id, first.at(-1)!.sequence)).toHaveLength(2);
    expect(activePlanTurnForConversation(ctx, thread)?.turnId).toBe('old-plan');
    deleteConversationThreadEventsAfter(db, thread.id, plan.sequence - 1);
    expect(activePlanTurnForConversation(ctx, thread)).toBeNull();
  });

  it('invalidates cached activity on sequence, status, provider or database changes and evicts old keys', () => {
    accepted('plan');
    const first = threadActivityForConversation(ctx, thread, 2);
    expect(threadActivityForConversation(ctx, thread, 2)).toBe(first);
    expect(threadActivityForConversation(ctx, { ...thread, status: 'idle' }, 2).activePlanModeCount).toBe(0);
    expect(threadActivityForConversation(ctx, { ...thread, providerId: 'acp-cursor' }, 2).activePlanModeCount).toBe(1);
    expect(threadActivityForConversation({ ...ctx, db: { ...db } }, thread, 2)).not.toBe(first);
    event('turn/completed', { scope: turnScope('plan') });
    expect(threadActivityForConversation(ctx, thread, 3).activePlanModeCount).toBe(0);
    for (let i = 0; i < 260; i++) threadActivityForConversation(ctx, { ...thread, id: `other-${i}` }, 0);
    expect(threadActivityForConversation(ctx, thread, 2)).not.toBe(first);
  });
});
