import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openExecutionDatabase, type ExecutionDatabase } from '@zana-ai/zcc-db';
import { createPlanCorrectionStore } from './store.js';

const record = {
  executionId: 'exec-1',
  ctx: { executionId: 'exec-1', projectId: 'project-1', projectRoot: '/root', sessionId: 'session-1', slotId: 'lead' },
  reason: 'invalid plan',
  retries: 1,
  status: 'pending' as const,
  offeredDigest: 'digest',
  offeredUnits: [{ id: 'one', title: 'One', task: 'work', dependencies: [] }]
};

describe('plan correction store', () => {
  it('restores execution-keyed correction status and immutable offer after restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zana-plan-correction-'));
    const filePath = join(directory, 'corrections.json');
    try {
      await createPlanCorrectionStore({ filePath }).put(record);
      const restored = await createPlanCorrectionStore({ filePath }).get(record.executionId);
      expect(restored).toEqual(record);
      restored!.offeredUnits![0].task = 'mutated caller value';
      expect((await createPlanCorrectionStore({ filePath }).get(record.executionId))!.offeredUnits![0].task).toBe('work');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('round-trips a register-channel record and fails closed on an unknown channel', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zana-plan-correction-'));
    const filePath = join(directory, 'corrections.json');
    try {
      const registered = { ...record, channel: 'register' as const };
      await createPlanCorrectionStore({ filePath }).put(registered);
      await expect(createPlanCorrectionStore({ filePath }).get(record.executionId)).resolves.toEqual(registered);
      const bogus = createPlanCorrectionStore({ filePath: join(directory, 'bogus.json') });
      await bogus.put({ ...record, channel: 'file' as never });
      await expect(bogus.get(record.executionId)).rejects.toThrow('corrupt plan correction store');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('returns undefined for an execution without a correction record', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zana-plan-correction-'));
    try {
      await expect(createPlanCorrectionStore({ filePath: join(directory, 'corrections.json') }).get('missing')).resolves.toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('restores every cancelled correction for terminal cleanup recovery', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zana-plan-correction-'));
    const filePath = join(directory, 'corrections.json');
    try {
      const store = createPlanCorrectionStore({ filePath });
      await store.put({ ...record, status: 'cancelled' });
      await store.put({ ...record, executionId: 'exec-pending', ctx: { ...record.ctx, executionId: 'exec-pending' } });

      const restarted = createPlanCorrectionStore({ filePath });
      await expect(restarted.listCancelled()).resolves.toEqual([
        expect.objectContaining({ executionId: 'exec-1', status: 'cancelled' })
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not let a stale non-cancelled write revive cancelled execution authority', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zana-plan-correction-'));
    const filePath = join(directory, 'corrections.json');
    try {
      const store = createPlanCorrectionStore({ filePath });
      await store.put({ ...record, status: 'cancelled' });
      await expect(store.put({ ...record, status: 'approved', approvedDigest: 'approved', approvedUnits: record.offeredUnits }))
        .resolves.toMatchObject({ status: 'cancelled' });
      await expect(store.get(record.executionId)).resolves.toMatchObject({ status: 'cancelled' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects new records at capacity without evicting correction authority', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zana-plan-correction-'));
    const filePath = join(directory, 'corrections.json');
    try {
      const store = createPlanCorrectionStore({ filePath, maxRecords: 2 });
      for (let index = 0; index < 2; index++) {
        await store.put({ ...record, executionId: `exec-${index}`, ctx: { ...record.ctx, executionId: `exec-${index}` } });
      }

      await expect(store.put({ ...record, executionId: 'exec-overflow', ctx: { ...record.ctx, executionId: 'exec-overflow' } }))
        .rejects.toThrow('plan correction store is at capacity');
      await expect(store.get('exec-0')).resolves.toMatchObject({ executionId: 'exec-0', status: 'pending' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  describe('capacity pruning', () => {
    const recordFor = (id: string) => ({ ...record, executionId: id, ctx: { ...record.ctx, executionId: id } });
    async function withStore<T>(run: (path: string) => Promise<T>): Promise<T> {
      const directory = await mkdtemp(join(tmpdir(), 'zana-plan-correction-'));
      try { return await run(join(directory, 'corrections.json')); } finally { await rm(directory, { recursive: true, force: true }); }
    }

    it('prunes only retired executions at capacity and keeps live ones', async () => {
      await withStore(async (filePath) => {
        const retired = new Set(['old-1', 'old-2']);
        const store = createPlanCorrectionStore({ filePath, maxRecords: 3, isExecutionRetired: async (id) => retired.has(id) });
        for (const id of ['old-1', 'live', 'old-2']) await store.put(recordFor(id));

        await store.put(recordFor('new'));

        await expect(store.get('old-1')).resolves.toBeUndefined();
        await expect(store.get('old-2')).resolves.toBeUndefined();
        await expect(store.get('live')).resolves.toMatchObject({ status: 'pending' });
        await expect(store.get('new')).resolves.toMatchObject({ executionId: 'new' });
      });
    });

    it('still rejects at capacity when nothing is provably retired', async () => {
      await withStore(async (filePath) => {
        const store = createPlanCorrectionStore({ filePath, maxRecords: 1, isExecutionRetired: async () => false });
        await store.put(recordFor('live'));
        await expect(store.put(recordFor('new'))).rejects.toThrow('at capacity');
        await expect(store.get('live')).resolves.toBeDefined();
      });
    });

    it('treats a failing retirement probe as live', async () => {
      await withStore(async (filePath) => {
        const store = createPlanCorrectionStore({ filePath, maxRecords: 1, isExecutionRetired: async () => { throw new Error('probe down'); } });
        await store.put(recordFor('live'));
        await expect(store.put(recordFor('new'))).rejects.toThrow('at capacity');
        await expect(store.get('live')).resolves.toBeDefined();
      });
    });

    it('does not consult retirement when updating an existing record', async () => {
      await withStore(async (filePath) => {
        const probe = vi.fn(async () => true);
        const store = createPlanCorrectionStore({ filePath, maxRecords: 1, isExecutionRetired: probe });
        await store.put(recordFor('live'));
        await store.put({ ...recordFor('live'), retries: 2 });
        expect(probe).not.toHaveBeenCalled();
      });
    });
  });

  describe('SQLite backend', () => {
    let directory: string;
    let database: ExecutionDatabase;
    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), 'zana-plan-correction-sqlite-'));
      database = openExecutionDatabase(join(directory, 'execution.db'));
    });
    afterEach(async () => {
      database.close();
      await rm(directory, { recursive: true, force: true });
    });
    const filePath = () => join(directory, 'unused.json');

    it('round-trips records through a fresh store over the same database', async () => {
      await createPlanCorrectionStore({ filePath: filePath(), database }).put(record);
      const restored = await createPlanCorrectionStore({ filePath: filePath(), database }).get(record.executionId);
      expect(restored).toEqual(record);
      expect(existsSync(filePath())).toBe(false);
    });

    it('starts empty when the database has no state', async () => {
      const store = createPlanCorrectionStore({ filePath: filePath(), database });
      await expect(store.get('nothing')).resolves.toBeUndefined();
      await expect(store.listCancelled()).resolves.toEqual([]);
    });

    it('fails closed on corrupt state instead of treating it as empty', async () => {
      database.sqlite.prepare('INSERT INTO execution_records (id, value_json, created_at, updated_at) VALUES (?, ?, 1, 1)')
        .run('plan-correction-store', JSON.stringify({ version: 1, revision: 0, records: [{ executionId: 'x' }] }));
      const store = createPlanCorrectionStore({ filePath: filePath(), database });
      await expect(store.get('x')).rejects.toThrow('corrupt plan correction store');
      await expect(store.put(record)).rejects.toThrow('corrupt plan correction store');
    });

    it('rejects a write whose expected hash no longer matches (concurrent writer)', async () => {
      const store = createPlanCorrectionStore({ filePath: filePath(), database });
      await store.put(record);
      // Another process rewrites the row between this store's read and write.
      const row = database.sqlite.prepare('SELECT value_json FROM execution_records WHERE id = ?').get('plan-correction-store') as { value_json: string };
      const racing = { ...JSON.parse(row.value_json), revision: 99 };
      const original = database.sqlite.prepare.bind(database.sqlite);
      let raced = false;
      vi.spyOn(database.sqlite, 'prepare').mockImplementation(((sql: string) => {
        const statement = original(sql);
        if (!raced && sql.startsWith('SELECT value_json, updated_at')) {
          raced = true;
          original('UPDATE execution_records SET value_json = ? WHERE id = ?').run(JSON.stringify(racing), 'plan-correction-store');
        }
        return statement;
      }) as typeof database.sqlite.prepare);

      await expect(store.put({ ...record, retries: 3 })).rejects.toThrow('stale execution SQLite state');
      vi.restoreAllMocks();
      await expect(store.get(record.executionId)).resolves.toMatchObject({ retries: 1 });
    });
  });
});
