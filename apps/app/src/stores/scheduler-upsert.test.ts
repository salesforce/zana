import { afterEach, describe, expect, it } from 'vitest';
import type { ScheduledTask } from '@zana-ai/zcc-domain/product';
import { upsertSchedulerTask, useScheduler } from './live.js';

const sample = {
  id: 'created-1',
  name: 'Nightly',
  enabled: true,
  projectId: 'p1',
  profile: 'claude',
  schedule: { every: '1h' },
  overlap: 'skip',
  history: { retain: 10 },
  status: { runCount: 0, runs: [] },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z'
} as ScheduledTask;

describe('upsertSchedulerTask', () => {
  afterEach(() => {
    useScheduler.setState({ tasks: [], loading: true });
  });

  it('inserts a created schedule so the detail route can find it before onChanged', () => {
    useScheduler.setState({ tasks: [], loading: false });
    upsertSchedulerTask(sample);
    const state = useScheduler.getState();
    expect(state.loading).toBe(false);
    expect(state.tasks).toEqual([sample]);
  });

  it('replaces an existing row with the same id', () => {
    useScheduler.setState({ tasks: [{ ...sample, name: 'Old' }], loading: false });
    upsertSchedulerTask({ ...sample, name: 'Nightly' });
    expect(useScheduler.getState().tasks).toEqual([sample]);
  });
});
