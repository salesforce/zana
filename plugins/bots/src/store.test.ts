import { describe, expect, it } from 'vitest';
import { MAX_BOTS, MAX_ROUTINE_RESULT_LENGTH, MAX_ROUTINES_PER_BOT } from './model.js';
import { BotStore, MAX_JOB_RECORDS_PER_BOT, findRoutine } from './store.js';

function memoryKv(initial: Record<string, unknown> = {}) {
  const map = new Map<string, unknown>(Object.entries(initial));
  return {
    map,
    kv: {
      get: async <T,>(key: string) => map.get(key) as T | undefined,
      set: async (key: string, value: unknown) => { map.set(key, structuredClone(value)); },
      delete: async (key: string) => { map.delete(key); },
      list: async () => [...map.keys()]
    }
  };
}

function makeStore(initial?: Record<string, unknown>) {
  let seq = 0;
  const { kv, map } = memoryKv(initial);
  return { store: new BotStore(kv as never, () => `x${++seq}`, () => 100), map };
}

describe('BotStore', () => {
  it('creates, lists and isolates copies', async () => {
    const { store, map } = makeStore();
    expect(store.snapshot()).toEqual([]);
    const bot = await store.create({ name: 'Scout', projectId: 'p1' });
    expect(bot.id).toBe('scout');
    bot.name = 'mutated';
    expect((await store.get('scout'))?.name).toBe('Scout');
    expect(await store.get('nobody')).toBeUndefined();
    expect((map.get('bots:v1') as unknown[]).length).toBe(1);
    expect(store.snapshot()).toHaveLength(1);
  });

  it('persists sidebar pins across reloads and preserves the original pin time on repeated requests', async () => {
    const { kv } = memoryKv();
    let now = 1;
    const store = new BotStore(kv as never, undefined, () => now++);
    await store.create({ name: 'Scout', projectId: 'p1' });
    expect((await store.get('scout'))?.pinnedAt).toBeUndefined();
    const pinned = await store.update('scout', { pinned: true });
    expect(pinned.pinnedAt).toBe(2);
    const reopened = new BotStore(kv as never, undefined, () => now++);
    expect((await reopened.update('scout', { pinned: true })).pinnedAt).toBe(2);
    await expect(reopened.update('scout', { pinned: 'yes' })).rejects.toThrow('pinned must be a boolean');
    expect((await reopened.update('scout', { pinned: false })).pinnedAt).toBeUndefined();
    expect((await new BotStore(kv as never).get('scout'))?.pinnedAt).toBeUndefined();
  });

  it('rejects duplicate names and enforces the bot cap', async () => {
    const { store } = makeStore();
    await store.create({ name: 'Scout', projectId: 'p1' });
    await expect(store.create({ name: 'scout!', projectId: 'p1' })).rejects.toThrow('already exists');
    const { store: full } = makeStore({
      'bots:v1': Array.from({ length: MAX_BOTS }, (_, i) => ({ id: `b${i}`, name: `B${i}`, projectId: 'p', routines: [] }))
    });
    await expect(full.create({ name: 'One more', projectId: 'p' })).rejects.toThrow(`at most ${MAX_BOTS}`);
  });

  it('refuses names whose slug is a renamed bot\'s id, so refs cannot be hijacked', async () => {
    const { store } = makeStore();
    await store.create({ name: 'Scout', projectId: 'p1' });
    await store.update('scout', { name: 'Ranger' });
    await expect(store.create({ name: 'Scout', projectId: 'p1' })).rejects.toThrow('already exists');
    await store.create({ name: 'Other', projectId: 'p1' });
    await expect(store.update('other', { name: 'scout' })).rejects.toThrow('already exists');
    expect((await store.get('scout'))!.name).toBe('Ranger');
  });

  it('loads older bots without the emoji and preserves their thread and color on save', async () => {
    const bot = { ...await_bot(), mainThreadId: 't1', color: '#123456' };
    const { store, map } = makeStore({ 'bots:v1': [{ ...bot, avatar: '🦉' }] });
    expect(await store.list()).toEqual([bot]);
    await store.update(bot.id, { name: 'Scout' });
    // A rename with a live main thread flags the role change until it is delivered.
    expect(map.get('bots:v1')).toEqual([{ ...bot, name: 'Scout', updatedAt: 100, roleChanged: true }]);
    await store.clearRoleChanged(bot.id);
    await store.clearRoleChanged(bot.id);
    expect(map.get('bots:v1')).toEqual([{ ...bot, name: 'Scout', updatedAt: 100 }]);
  });

  it('drops malformed persisted rows', async () => {
    const { store } = makeStore({ 'bots:v1': [null, { id: 1 }, { id: 'a', name: 'A', projectId: 'p', routines: [] }], 'jobs:v1': 'bad' });
    await store.warm();
    expect(store.snapshot().map((bot) => bot.id)).toEqual(['a']);
    expect(store.jobsSnapshot()).toEqual([]);
  });

  it('updates, guards renames and sets the main thread', async () => {
    const { store } = makeStore();
    await store.create({ name: 'A', projectId: 'p' });
    await store.create({ name: 'B', projectId: 'p' });
    await expect(store.update('a', { name: 'B' })).rejects.toThrow('already exists');
    await expect(store.update('zzz', {})).rejects.toThrow('unknown bot');
    expect((await store.setMainThread('a', 't1')).mainThreadId).toBe('t1');
    expect((await store.clearMainThread('a', 'previous')).mainThreadId).toBe('t1');
    expect((await store.clearMainThread('a', 't1')).mainThreadId).toBeUndefined();
  });

  it('manages routines', async () => {
    const { store } = makeStore();
    await store.create({ name: 'A', projectId: 'p' });
    const { routine } = await store.addRoutine('a', { name: 'Digest', cron: '0 9 * * *', prompt: 'go' });
    expect(routine.id).toBe('digest');
    await expect(store.addRoutine('a', { name: 'digest', cron: '0 9 * * *', prompt: 'go' })).rejects.toThrow('already has a routine');
    await store.addRoutine('a', { name: 'Digest 2', cron: '0 9 * * *', prompt: 'go' });
    expect(findRoutine((await store.get('a'))!, 'DIGEST').id).toBe('digest');
    expect(findRoutine((await store.get('a'))!, 'digest!').id).toBe('digest');
    expect(() => findRoutine((await_bot()), 'nope')).toThrow('unknown routine');
    const updated = await store.updateRoutine('a', 'digest', { enabled: false });
    expect(updated.routines[0]!.enabled).toBe(false);
    expect((await store.markRoutineRun('a', 'digest', 7)).routines[0]!.lastRunAt).toBe(7);
    expect((await store.removeRoutine('a', 'digest')).routines.map((row) => row.id)).toEqual(['digest-2']);
  });

  it('records quiet routine runs by thread and keeps the last result', async () => {
    const { store } = makeStore();
    await store.create({ name: 'A', projectId: 'p' });
    await store.addRoutine('a', { name: 'Watch', cron: '0 9 * * *', prompt: 'go' });
    await store.addRoutine('a', { name: 'Other', cron: '0 9 * * *', prompt: 'go' });
    // Two runs in the same millisecond stay distinct because they are keyed by thread.
    await store.markRoutineRun('a', 'watch', 5, 'running', { threadId: 'r1', error: 'x'.repeat(300) });
    await store.markRoutineRun('a', 'watch', 5, 'running', { threadId: 'r2' });
    let bot = await store.finishRoutineRun('a', 'watch', 'r1', 5, 'posted', { result: 'y'.repeat(MAX_ROUTINE_RESULT_LENGTH + 10) });
    let watch = findRoutine(bot, 'watch');
    expect(watch.runs!.map(r => [r.threadId, r.status])).toEqual([['r2', 'running'], ['r1', 'posted']]);
    expect(watch.lastResult).toHaveLength(MAX_ROUTINE_RESULT_LENGTH);
    expect(findRoutine(bot, 'other').runs).toBeUndefined();

    // A failure keeps the previous result; a pruned run is prepended and capped at five.
    bot = await store.finishRoutineRun('a', 'watch', 'r2', 5, 'failed', { error: 'e'.repeat(300) });
    watch = findRoutine(bot, 'watch');
    expect(watch.runs![0]).toMatchObject({ threadId: 'r2', status: 'failed' });
    expect(watch.runs![0]!.error).toHaveLength(200);
    expect(watch.lastResult).toHaveLength(MAX_ROUTINE_RESULT_LENGTH);
    for (let i = 0; i < 5; i++) bot = await store.finishRoutineRun('a', 'watch', `p${i}`, 10 + i, 'quiet');
    watch = findRoutine(bot, 'watch');
    expect(watch.runs!.map(r => r.threadId)).toEqual(['p4', 'p3', 'p2', 'p1', 'p0']);
    // A routine with no runs yet gets its first one.
    bot = await store.finishRoutineRun('a', 'other', 'o1', 20, 'quiet');
    expect(findRoutine(bot, 'other').runs).toEqual([{ at: 20, status: 'quiet', threadId: 'o1' }]);
  });

  it('stores and validates routine job records', async () => {
    const { store } = makeStore({ 'jobs:v1': [
      { threadId: 'j1', botId: 'a', title: 't', startedAt: 1, routineId: 'watch', runAt: 1 },
      { threadId: 'j2', botId: 'a', title: 't', startedAt: 2, routineId: 7 }
    ] });
    expect((await store.jobs('a')).map(job => job.threadId)).toEqual(['j1']);
  });

  it('caps routines per bot', async () => {
    const { store } = makeStore({
      'bots:v1': [{ id: 'a', name: 'A', projectId: 'p', routines: Array.from({ length: MAX_ROUTINES_PER_BOT }, (_, i) => ({ id: `r${i}`, name: `R${i}`, cron: '* * * * *', prompt: 'p', enabled: true })) }]
    });
    await expect(store.addRoutine('a', { name: 'More', cron: '* * * * *', prompt: 'p' })).rejects.toThrow('at most');
  });

  it('records jobs with a retention cap and removes them with the bot', async () => {
    const { store } = makeStore();
    await store.create({ name: 'A', projectId: 'p' });
    await store.create({ name: 'B', projectId: 'p' });
    for (let i = 0; i < MAX_JOB_RECORDS_PER_BOT + 2; i += 1) {
      await store.addJob({ threadId: `a${i}`, botId: 'a', title: 't', startedAt: i });
    }
    await store.addJob({ threadId: 'b0', botId: 'b', title: 't', startedAt: 0 });
    const jobs = await store.jobs('a');
    expect(jobs).toHaveLength(MAX_JOB_RECORDS_PER_BOT);
    expect(jobs.some((job) => job.threadId === 'a0')).toBe(false);
    expect(await store.removeJob('a5')).toBe(true);
    expect(await store.removeJob('a5')).toBe(false);
    await store.remove('a');
    await expect(store.remove('a')).rejects.toThrow('unknown bot');
    expect(store.jobsSnapshot().map((job) => job.threadId)).toEqual(['b0']);
  });

  it('serializes concurrent writes', async () => {
    const { store } = makeStore();
    await store.create({ name: 'A', projectId: 'p' });
    await Promise.all(Array.from({ length: 5 }, (_, i) => store.addRoutine('a', { name: `R${i}`, cron: '0 * * * *', prompt: 'p' })));
    expect((await store.get('a'))!.routines).toHaveLength(5);
  });
});

function await_bot() {
  return { id: 'a', name: 'A', personality: '', projectId: 'p', routines: [], createdAt: 0, updatedAt: 0 };
}
