import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SquadExecutionService } from '../service.js';
import { createExecutionStore, type ExecutionRecord } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';

// Through the service: escalateKickoffFailures must not hand a unit to a slot its routing forbids.

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-execution-kickoff-routing-svc-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

const request = { version: 1 as const, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build release', slots: [{ initialTask: 'Run tests' }] };
const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
const routedUnit = { id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'], routing: { version: 1 as const, requiredRole: 'engineer' } };

function build(filePath: string, clock: { t: number }, workers: Array<{ slotId: string; personaId: string }>) {
  const now = () => clock.t;
  const store = createExecutionStore({ filePath, id: () => 'execution-1', now });
  const replyToSession = vi.fn(() => true);
  const inbox = { append: vi.fn(async () => undefined) };
  const logError = vi.fn();
  const service = new SquadExecutionService({
    store,
    artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
    authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
      version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
        { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
        ...workers.map((worker) => ({ slotId: worker.slotId, personaId: worker.personaId, authorizationIdDigest: `${worker.slotId}-d` }))
      ] } } }),
    launchTeam: async () => ({ ok: true }),
    getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: workers.map((worker) => ({ slotId: worker.slotId, sessionId: `session-${worker.slotId}`, projectId: 'project-1' })) }),
    cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }),
    resolveTeamModelSnapshots: () => workers.map((worker) => ({ slotId: worker.slotId, personaId: worker.personaId, provider: 'anthropic', model: 'm' })),
    replyToSession, now, inbox, logError,
    claimRecoveryObserveEnabled: () => true, claimRecoveryEnforceEnabled: () => true,
    resolveExactNativeRecoverySnapshots: (record: ExecutionRecord) => record.nativeRecoverySnapshots ?? []
  } as never);
  return { service, store, replyToSession, inbox, logError };
}

async function startWedged(service: SquadExecutionService) {
  const started = await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [routedUnit] } as never);
  if (!started.ok) throw new Error(started.message);
  await service.dispatchReady(coordinator);
}

describe('stalled kickoff escalation honours routing', () => {
  it('re-homes a stalled engineer unit onto the next engineer, not the reviewer between them', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const { service, store, replyToSession } = build(filePath, clock, [
      { slotId: 'engineer:0', personaId: 'engineer' }, { slotId: 'reviewer:0', personaId: 'reviewer' }, { slotId: 'engineer:1', personaId: 'engineer' }
    ]);
    await startWedged(service);
    expect((await store.get('execution-1'))!.workUnits![0]).toMatchObject({ state: 'CLAIMED', assignedSlotId: 'engineer:0' });
    clock.t += 700_000;
    replyToSession.mockClear();
    await service.redispatchStalled();
    const unit = (await store.get('execution-1'))!.workUnits![0];
    expect(unit.assignedSlotId).toBe('engineer:1');
    expect(unit.state).not.toBe('BLOCKED');
    expect(replyToSession).not.toHaveBeenCalledWith('session-reviewer:0', expect.anything());
    expect(replyToSession).toHaveBeenCalledWith('session-engineer:1', expect.stringContaining('assigned work unit `a`'));
  }));

  it('blocks the unit to a human in the same pass when only a reviewer is left', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const { service, store, replyToSession, inbox } = build(filePath, clock, [
      { slotId: 'engineer:0', personaId: 'engineer' }, { slotId: 'reviewer:0', personaId: 'reviewer' }
    ]);
    await startWedged(service);
    clock.t += 700_000;
    replyToSession.mockClear();
    await service.redispatchStalled();
    const record = (await store.get('execution-1'))!;
    expect(record.workUnits![0].state).toBe('BLOCKED');
    expect(record.workUnits![0].assignedSlotId).toBeUndefined();
    const blocker = record.blockers!.find((entry) => entry.workUnitId === 'a');
    expect(blocker).toMatchObject({ audience: 'human', resolved: false });
    expect(blocker!.question).toContain('engineer:0');
    expect(replyToSession).toHaveBeenCalledWith('coordinator', expect.stringContaining('NO_PROGRESS_EXHAUSTED'));
    expect(replyToSession).not.toHaveBeenCalledWith('session-reviewer:0', expect.anything());
    expect(inbox.append).toHaveBeenCalledWith(expect.objectContaining({ blockerId: blocker!.id, comments: blocker!.question }));
  }));
});

describe('the service passes the routing enforcement flag to kickoff recovery', () => {
  it('an enforced run blocks to a human instead of moving the unit to an UNKNOWN slot', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const now = () => clock.t;
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now });
    const replyToSession = vi.fn(() => true);
    const workers = [{ slotId: 'engineer:0', personaId: 'engineer' }, { slotId: 'engineer:1', personaId: 'engineer' }];
    const service = new SquadExecutionService({
      store,
      artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
      authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
        version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
          { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
          ...workers.map((worker) => ({ ...worker, authorizationIdDigest: `${worker.slotId}-d` }))
        ] } } }),
      launchTeam: async () => ({ ok: true }),
      getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: workers.map((worker) => ({ slotId: worker.slotId, sessionId: `session-${worker.slotId}`, projectId: 'project-1' })) }),
      cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }),
      // engineer:0 has a context fact (PASS), engineer:1 has none (UNKNOWN for a context estimate).
      resolveTeamModelSnapshots: () => workers.map((worker) => ({ ...worker, provider: 'anthropic', model: 'm', ...(worker.slotId === 'engineer:0' ? { maxContextBytes: 10_000 } : {}) })),
      routingEnforcementEnabled: () => true,
      replyToSession, now, inbox: { append: vi.fn(async () => undefined) }, logError: vi.fn(),
      claimRecoveryObserveEnabled: () => true, claimRecoveryEnforceEnabled: () => true,
      resolveExactNativeRecoverySnapshots: (record: ExecutionRecord) => record.nativeRecoverySnapshots ?? []
    } as never);
    const unit = { id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'], routing: { version: 1 as const, requiredRole: 'engineer', estimatedContextBytes: 1_000 } };
    const started = await service.start('owner', 'project-1', { version: 1, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build', slots: [{ initialTask: 'Run' }], coordinationMode: 'job-team', workUnits: [unit] } as never);
    if (!started.ok) throw new Error(started.message);
    await service.dispatchReady({ executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' });
    expect((await store.get('execution-1'))!.workUnits![0]).toMatchObject({ state: 'CLAIMED', assignedSlotId: 'engineer:0' });
    clock.t += 700_000;
    await service.redispatchStalled();
    const after = (await store.get('execution-1'))!.workUnits![0];
    expect(after.state).toBe('BLOCKED');
    expect(after.assignedSlotId).toBeUndefined();
    // The same enforcement flag reaches the question: only the PASS slot is named as able to take the unit.
    const blocker = (await store.get('execution-1'))!.blockers!.find((entry) => entry.workUnitId === 'a');
    expect(blocker!.question).toContain('the only worker slot that can take it (engineer:0)');
  }));
});
