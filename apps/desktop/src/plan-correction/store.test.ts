import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
});
