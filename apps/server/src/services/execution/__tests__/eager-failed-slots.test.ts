import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executionBoardProjection } from '../projection.js';
import { ExecutionService, type ExecutionServiceDeps } from '../service.js';
import { boundFailedWorkerSlots, createExecutionStore, formatFailedSlots, MAX_REPORTED_FAILED_SLOTS } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-eager-failed-slots-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

const base = { version: 1 as const, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build release', slots: [{ initialTask: 'Run tests' }] };
const structuredRequest = {
  ...base, coordinationMode: 'structured' as const,
  workUnits: [{ id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }]
};
const freeformRequest = { ...base, coordinationMode: 'freeform' as const };
const done = { ok: true, value: { canceledSessionIds: ['w'], pendingSessionIds: [], lifecycleState: 'canceled' } };
type Cancel = ExecutionServiceDeps['cancelTeamLaunch'];

function deps(filePath: string, over: Partial<ExecutionServiceDeps> = {}) {
  return {
    store: createExecutionStore({ filePath, id: () => 'execution-1' }),
    artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
    authorizeTeamLaunch: () => ({ ok: true as const, value: {
      teamId: 'team-1', projectId: 'project-1', slots: [],
      context: { version: 1 as const, principalId: 'team:team-1:session-1:request-1', authorizedAt: 10, expiresAt: 20, slots: [] }
    } }),
    launchTeam: async () => ({ ok: true }),
    getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', task: 'unknown', process: 'running' }] }),
    cancelTeamLaunch: (async () => done) as Cancel,
    cancelSettle: { attempts: 3, intervalMs: 5, sleep: vi.fn(async () => undefined) },
    replyToSession: () => true,
    resolveExactNativeRecoverySnapshots: () => [],
    ...over
  } as ExecutionServiceDeps & { store: ReturnType<typeof createExecutionStore> };
}

describe('formatFailedSlots', () => {
  it('lists slot reasons and strips control characters and absolute paths', () => {
    const text = formatFailedSlots([{ slotId: 'w1', reason: 'spawn\u0000 failed at /Users/me/secret/bin/tool' }]);
    expect(text).toBe('w1: spawn  failed at tool');
  });
  it('tolerates malformed entries and bounds both reason and total length', () => {
    expect(formatFailedSlots([null, { slotId: 5 }, 'x'])).toBe('unknown slot: unknown reason; unknown slot: unknown reason; unknown slot: unknown reason');
    expect(formatFailedSlots([])).toBe('One or more Team slots failed to launch');
    const many = Array.from({ length: 100 }, (_, i) => ({ slotId: `s${i}`, reason: 'r'.repeat(900) }));
    const text = formatFailedSlots(many);
    expect(text.length).toBeLessThanOrEqual(2048);
    const few = formatFailedSlots(Array.from({ length: MAX_REPORTED_FAILED_SLOTS + 5 }, (_, i) => ({ slotId: `s${i}`, reason: 'x' })));
    expect(few).toContain('and 5 more');
  });
});

describe('eager failed-slot evaluation', () => {
  it('fails a structured run at launch, names the slots and cancels the launch once', async () => fixture(async (filePath) => {
    const cancel = vi.fn(async () => done);
    const service = new ExecutionService(deps(filePath, {
      launchTeam: async () => ({ ok: true, value: { failedSlots: [{ slotId: 'slot-2', reason: 'spawn refused' }, { slotId: 'slot-3', reason: 'no model' }] } }),
      cancelTeamLaunch: cancel as Cancel
    }));
    const started = await service.start('session-1', 'project-1', structuredRequest);
    expect(started).toMatchObject({ ok: false, code: 'TEAM_LAUNCH_FAILED', message: 'slot-2: spawn refused; slot-3: no model' });
    const record = await service.status('session-1', 'project-1', 'execution-1');
    expect(record).toMatchObject({ state: 'FAILED', failureReason: 'slot-2: spawn refused; slot-3: no model' });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith('session-1', 'request-1');
    service.dispose();
  }));

  it('fails a structured run when every slot failed', async () => fixture(async (filePath) => {
    const service = new ExecutionService(deps(filePath, {
      launchTeam: async () => ({ ok: true, value: { failedSlots: [{ slotId: 'slot-1', reason: 'a' }] } })
    }));
    const started = await service.start('session-1', 'project-1', structuredRequest);
    expect(started.ok).toBe(false);
    expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('FAILED');
    service.dispose();
  }));

  it('bounds the structured failure reason', async () => fixture(async (filePath) => {
    const failedSlots = Array.from({ length: 60 }, (_, i) => ({ slotId: `s${i}`, reason: 'z'.repeat(700) }));
    const service = new ExecutionService(deps(filePath, { launchTeam: async () => ({ ok: true, value: { failedSlots } }) }));
    await service.start('session-1', 'project-1', structuredRequest);
    const record = await service.status('session-1', 'project-1', 'execution-1');
    expect(record?.failureReason?.length).toBeLessThanOrEqual(2048);
    service.dispose();
  }));

  it('lets a freeform run continue and records a bounded warning event', async () => fixture(async (filePath) => {
    const cancel = vi.fn(async () => done);
    const service = new ExecutionService(deps(filePath, {
      launchTeam: async () => ({ ok: true, value: { failedSlots: [{ slotId: 'slot-2', reason: 'spawn refused' }] } }),
      cancelTeamLaunch: cancel as Cancel
    }));
    const started = await service.start('session-1', 'project-1', freeformRequest);
    expect(started.ok).toBe(true);
    const record = await service.status('session-1', 'project-1', 'execution-1');
    expect(record?.state).not.toBe('FAILED');
    expect(cancel).not.toHaveBeenCalled();
    const { events } = await service.events('session-1', 'project-1', 'execution-1');
    expect(events).toContainEqual(expect.objectContaining({ severity: 'warning', summary: '1 Team slot(s) failed to launch: slot-2: spawn refused' }));
    service.dispose();
  }));

  it('retains bounded, sanitized failed worker slots on the record for the board projection', async () => fixture(async (filePath) => {
    const failedSlots = [
      { slotId: 'slot-2', reason: 'spawn\u0000 refused at /Users/me/secret/bin/tool' },
      { slotId: 5, reason: 7 },
      ...Array.from({ length: MAX_REPORTED_FAILED_SLOTS + 5 }, (_, i) => ({ slotId: `s${i}`, reason: 'r'.repeat(900) }))
    ];
    const service = new ExecutionService(deps(filePath, { launchTeam: async () => ({ ok: true, value: { failedSlots } }) }));
    await service.start('session-1', 'project-1', freeformRequest);
    const record = await service.status('session-1', 'project-1', 'execution-1');
    expect(record?.failedWorkerSlots).toHaveLength(MAX_REPORTED_FAILED_SLOTS);
    expect(record?.failedWorkerSlots?.[0]).toEqual({ slotId: 'slot-2', reason: 'spawn  refused at tool' });
    expect(record?.failedWorkerSlots?.[1]).toEqual({ slotId: 'unknown slot', reason: 'unknown reason' });
    expect(record?.failedWorkerSlots?.[2]?.reason.length).toBeLessThanOrEqual(500);
    expect(executionBoardProjection(record!).failedWorkers).toEqual(record?.failedWorkerSlots);
    service.dispose();
  }));

  it('keeps a freeform run RUNNING across later status reads that see failed slots in the lifecycle', async () => fixture(async (filePath) => {
    const cancel = vi.fn(async () => done);
    const lifecycle = {
      workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', task: 'unknown', process: 'running' }],
      launchResult: { failedSlots: [{ slotId: 'slot-2', reason: 'spawn refused' }] }
    };
    const service = new ExecutionService(deps(filePath, {
      launchTeam: async () => ({ ok: true, value: { failedSlots: lifecycle.launchResult.failedSlots } }),
      getTeamLaunch: async () => lifecycle, cancelTeamLaunch: cancel as Cancel
    }));
    await service.start('session-1', 'project-1', freeformRequest);
    for (let i = 0; i < 3; i += 1) expect((await service.status('session-1', 'project-1', 'execution-1'))?.state).toBe('RUNNING');
    expect(cancel).not.toHaveBeenCalled();
    service.dispose();
  }));

  it('treats legacy job-team like freeform: warn and continue', async () => fixture(async (filePath) => {
    const service = new ExecutionService(deps(filePath, {
      launchTeam: async () => ({ ok: true, value: { failedSlots: [{ slotId: 's', reason: 'r' }] } })
    }));
    expect((await service.start('session-1', 'project-1', { ...base, coordinationMode: 'job-team' as const })).ok).toBe(true);
    const { events } = await service.events('session-1', 'project-1', 'execution-1');
    expect(events).toContainEqual(expect.objectContaining({ severity: 'warning' }));
    service.dispose();
  }));

  it('revokes issued authorizations when a structured run fails on failed slots', async () => fixture(async (filePath) => {
    const revoke = vi.fn(async () => undefined);
    const service = new ExecutionService(deps(filePath, {
      revokeTeamAuthorizations: revoke,
      launchTeam: async () => ({ ok: true, value: { failedSlots: [{ slotId: 's', reason: 'r' }] } })
    }));
    await service.start('session-1', 'project-1', structuredRequest);
    expect(revoke).toHaveBeenCalled();
    service.dispose();
  }));

  it('does a direct best-effort cancel when failLaunch cannot land FAILED', async () => fixture(async (filePath) => {
    const cancel = vi.fn(async () => done);
    const d = deps(filePath, {
      launchTeam: async () => ({ ok: true, value: { failedSlots: [{ slotId: 's', reason: 'r' }] } }),
      cancelTeamLaunch: cancel as Cancel
    });
    const realTransition = d.store.transition.bind(d.store);
    vi.spyOn(d.store, 'transition').mockImplementation(async (id, version, to, severity, summary) => {
      if (to === 'FAILED') throw new Error('stale execution state');
      return realTransition(id, version, to, severity, summary);
    });
    const service = new ExecutionService(d);
    const started = await service.start('session-1', 'project-1', structuredRequest);
    expect(started.ok).toBe(false);
    expect(cancel).toHaveBeenCalled();
    service.dispose();
  }));

  it('falls back after sanitizing so control-only slot ids and reasons stay valid on reload', () => {
    const [slot] = boundFailedWorkerSlots([{ slotId: ' \u0000\n ', reason: '\u0007 \t' }]);
    expect(slot).toEqual({ slotId: 'unknown slot', reason: 'unknown reason' });
  });

  it('does not warn or fail when no slot failed', async () => fixture(async (filePath) => {
    const clean = new ExecutionService(deps(filePath, { launchTeam: async () => ({ ok: true, value: { failedSlots: [] } }) }));
    expect((await clean.start('session-1', 'project-1', base)).ok).toBe(true);
    const { events } = await clean.events('session-1', 'project-1', 'execution-1');
    expect(events.some((event) => event.severity === 'warning')).toBe(false);
    clean.dispose();
  }));

  it('keeps a freeform launch alive when the warning write throws', async () => fixture(async (filePath) => {
    const d = deps(filePath, { launchTeam: async () => ({ ok: true, value: { failedSlots: [{ slotId: 's', reason: 'r' }] } }), logError: vi.fn() });
    vi.spyOn(d.store, 'warning').mockRejectedValue(new Error('disk full'));
    const service = new ExecutionService(d);
    expect((await service.start('session-1', 'project-1', freeformRequest)).ok).toBe(true);
    expect(d.logError).toHaveBeenCalled();
    service.dispose();
  }));

  it('store.warning rejects an unknown execution and ignores an empty list', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    await expect(store.warning('missing', { slots: [{ slotId: 'a', reason: 'b' }] })).rejects.toThrow('execution not found');
    await expect(store.warning('missing', { slots: [] })).resolves.toBeUndefined();
  }));
});
