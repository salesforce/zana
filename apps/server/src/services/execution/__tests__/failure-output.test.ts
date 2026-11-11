import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createExecutionStore, type ExecutionWorkUnitInput } from '../store.js';

const worker = { role: 'worker' as const, slotId: 'slot-1' };
const output = {
  version: 1 as const,
  schema: {
    type: 'object' as const,
    properties: { detail: { type: 'string' as const } },
    required: ['detail'],
    additionalProperties: false as const
  }
};

async function fixture(run: (store: ReturnType<typeof createExecutionStore>) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'execution-failure-output-'));
  try {
    await run(createExecutionStore({ filePath: join(dir, 'executions.json') }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function setup(store: ReturnType<typeof createExecutionStore>) {
  let record = (await store.claim({
    callerPrincipalId: 'owner', projectId: 'p', teamId: 't', jobTitle: 'Work', launchRequestId: 'failure-output', requestDigest: 'failure-output', resolvedModels: [],
    request: { version: 1, slots: [{ initialTask: 'Work' }], resolvedModels: [] },
    workUnits: [
      { id: 'build', title: 'Build', task: 'Build', dependencies: [], readOnly: true },
      { id: 'check', title: 'Check', task: 'Check', dependencies: ['build'], readOnly: true, output, onFailure: { kind: 'retry', stepId: 'build', maxRetries: 3 } }
    ] as ExecutionWorkUnitInput[]
  })).record;
  record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
  record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
  record = await store.claimWork(record.id, record.stateVersion, worker, 'build');
  record = await store.completeWork(record.id, record.stateVersion, worker, 'build', 'built');
  return store.claimWork(record.id, record.stateVersion, worker, 'check');
}

describe('execution failure output', () => {
  it('accepts absent or differently-shaped declared failure evidence, hands it to retry, and rejects unbounded evidence', async () => fixture(async (store) => {
    let record = await setup(store);
    record = await store.failWork(record.id, record.stateVersion, worker, 'check', 'runner failed');
    expect(record.workUnits![0]).toMatchObject({ state: 'READY', retryFeedback: { kind: 'prose', body: 'runner failed' } });
    expect(record.workUnits![1]).toMatchObject({ state: 'PENDING' });
    expect(record.workUnits![1]).not.toHaveProperty('structuredResult');

    record = await store.claimWork(record.id, record.stateVersion, worker, 'build');
    record = await store.completeWork(record.id, record.stateVersion, worker, 'build', 'built');
    record = await store.claimWork(record.id, record.stateVersion, worker, 'check');
    const evidence = { failure: { code: 'TEST_FAILED', files: ['report.txt'] } };
    record = await store.failWork(record.id, record.stateVersion, worker, 'check', 'test failed', 'UNKNOWN', undefined, false, evidence);
    expect(record.workUnits![0].retryFeedback).toEqual({ kind: 'structured', body: JSON.stringify(evidence) });
    expect(record.workUnits![1].structuredResult).toEqual(evidence);

    record = await store.claimWork(record.id, record.stateVersion, worker, 'build');
    record = await store.completeWork(record.id, record.stateVersion, worker, 'build', 'built');
    record = await store.claimWork(record.id, record.stateVersion, worker, 'check');
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    for (const invalid of [{ evidence: 'x'.repeat(64 * 1024) }, cyclic]) {
      await expect(store.failWork(record.id, record.stateVersion, worker, 'check', 'test failed', 'UNKNOWN', undefined, false, invalid)).rejects.toThrow();
    }
    expect((await store.get(record.id))!.workUnits![1].state).toBe('CLAIMED');
  }));
});
