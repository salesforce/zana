import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SquadExecutionService } from '../service.js';
import { createExecutionStore, type ExecutionRecord } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';
import { executionBoardProjection } from '../projection.js';

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-execution-proposal-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

const proposal = { id: 'proposal-1', proposerKind: 'thread' as const, proposerId: 'thread-1', proposerTitle: 'Fix login' };

function claimInput(over: Record<string, unknown> = {}) {
  return {
    callerPrincipalId: 'session-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Ship feature',
    requestDigest: 'digest-1', launchRequestId: 'request-1', resolvedModels: [],
    request: { version: 1 as const, slots: [{ initialTask: 'Run tests' }], resolvedModels: [] },
    ...over
  };
}

const request = {
  version: 1 as const, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build release',
  slots: [{ initialTask: 'Run tests' }]
};
const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
const worker = { ...coordinator, slotId: 'slot-1', role: 'worker' as const };

function service(filePath: string, over: Record<string, unknown> = {}, now?: () => number) {
  const store = createExecutionStore({ filePath, id: () => 'execution-1', ...(now ? { now } : {}) });
  const svc = new SquadExecutionService({
    store,
    artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
    authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
      version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
        { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
        { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
      ] } } }),
    launchTeam: async () => ({ ok: true }),
    getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] }),
    cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }),
    replyToSession: () => true,
    resolveExactNativeRecoverySnapshots: (record: ExecutionRecord) => record.nativeRecoverySnapshots ?? [],
    ...(now ? { now } : {}),
    ...over
  } as never);
  return { store, svc };
}

const jobTeam = { ...request, coordinationMode: 'job-team' as const, workUnits: [{ id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }] };

describe('execution record proposer', () => {
  it('round-trips a claim proposal through a store reload', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    await store.claim(claimInput({ proposal }) as never);
    expect((await createExecutionStore({ filePath }).get('execution-1'))?.proposal).toEqual(proposal);
  }));

  it('omits an absent proposerTitle and loads legacy records unchanged', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    await store.claim(claimInput({ proposal: { id: 'p', proposerKind: 'pty', proposerId: 's' } }) as never);
    expect((await store.get('execution-1'))?.proposal).toEqual({ id: 'p', proposerKind: 'pty', proposerId: 's' });
    const legacy = createExecutionStore({ filePath: `${filePath}.legacy`, id: () => 'legacy' });
    const record = (await legacy.claim(claimInput() as never)).record;
    expect(record.proposal).toBeUndefined();
    expect(record.proposalNoticeVersion).toBeUndefined();
    expect(await createExecutionStore({ filePath: `${filePath}.legacy` }).get('legacy')).toEqual(await legacy.get('legacy'));
  }));

  it.each([
    ['unknown proposer kind', { id: 'p', proposerKind: 'x', proposerId: 's' }],
    ['empty id', { id: '', proposerKind: 'pty', proposerId: 's' }],
    ['non-string title', { id: 'p', proposerKind: 'pty', proposerId: 's', proposerTitle: 5 }],
    ['non-object', 'p']
  ])('treats a malformed proposal (%s) as a corrupt store', async (_name, bad) => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    await store.claim(claimInput({ proposal }) as never);
    const durable = JSON.parse(await readFile(filePath, 'utf8'));
    durable.records[0].proposal = bad;
    await writeFile(filePath, JSON.stringify(durable));
    await expect(createExecutionStore({ filePath }).get('execution-1')).rejects.toThrow('corrupt execution store');
  }));

  it('rejects a malformed proposalNoticeVersion on load', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    await store.claim(claimInput({ proposal }) as never);
    const durable = JSON.parse(await readFile(filePath, 'utf8'));
    durable.records[0].proposalNoticeVersion = -1;
    await writeFile(filePath, JSON.stringify(durable));
    await expect(createExecutionStore({ filePath }).get('execution-1')).rejects.toThrow('corrupt execution store');
  }));
});

describe('start with a proposal', () => {
  it('stores the proposal and replays with a different proposerTitle without a CONFLICT', async () => fixture(async (filePath) => {
    const { store, svc } = service(filePath);
    const first = await svc.start('owner', 'project-1', request, { proposal });
    expect(first.ok).toBe(true);
    expect((await store.get('execution-1'))?.proposal).toEqual(proposal);
    const replay = await svc.start('owner', 'project-1', request, { proposal: { ...proposal, proposerTitle: 'Renamed' } });
    expect(replay.ok).toBe(true);
    expect((await store.get('execution-1'))?.proposal?.proposerTitle).toBe('Fix login');
  }));

  it('starts without a proposal exactly as before', async () => fixture(async (filePath) => {
    const { store, svc } = service(filePath);
    expect((await svc.start('owner', 'project-1', request)).ok).toBe(true);
    expect((await store.get('execution-1'))?.proposal).toBeUndefined();
  }));
});

describe('proposal report marker', () => {
  it('is terminal-only, idempotent, keeps stateVersion and survives a reload', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const record = (await store.claim(claimInput({ proposal }) as never)).record;
    await expect(store.markProposalReported(record.id, record.attempt)).rejects.toThrow('terminal proposal is unavailable');
    await expect(store.markProposalReported('missing', 1)).rejects.toThrow('execution not found');
    expect(await store.listUnreportedProposalExecutions()).toEqual([]);

    const stopped = await store.stopForPlanCorrection(record.id);
    expect((await store.listUnreportedProposalExecutions()).map((r) => r.id)).toEqual([record.id]);
    await expect(store.markProposalReported(record.id, stopped.attempt + 1)).rejects.toThrow('stale execution attempt');

    const marked = await store.markProposalReported(record.id, stopped.attempt);
    expect(marked.proposalNoticeVersion).toBe(stopped.attempt);
    expect(marked.stateVersion).toBe(stopped.stateVersion);
    const again = await store.markProposalReported(record.id, stopped.attempt);
    expect(again).toEqual(marked);

    const reloaded = createExecutionStore({ filePath });
    expect((await reloaded.get(record.id))?.proposalNoticeVersion).toBe(stopped.attempt);
    expect(await reloaded.listUnreportedProposalExecutions()).toEqual([]);
  }));

  it('lists only terminal proposal records not yet reported', async () => fixture(async (filePath) => {
    let n = 0;
    const store = createExecutionStore({ filePath, id: () => `execution-${++n}` });
    const withProposal = (await store.claim(claimInput({ proposal, launchRequestId: 'r1' }) as never)).record;
    const withoutProposal = (await store.claim(claimInput({ launchRequestId: 'r2' }) as never)).record;
    await store.stopForPlanCorrection(withProposal.id);
    await store.stopForPlanCorrection(withoutProposal.id);
    expect((await store.listUnreportedProposalExecutions()).map((r) => r.id)).toEqual([withProposal.id]);
  }));
});

describe('onHumanBlocker', () => {
  it('fires once for a human blockWork and a throwing hook does not break the engine', async () => fixture(async (filePath) => {
    const onHumanBlocker = vi.fn();
    const { svc } = service(filePath, { onHumanBlocker });
    await svc.start('owner', 'project-1', jobTeam);
    await svc.dispatchReady(coordinator);
    await svc.blockWork(worker, 'a', { id: 'blocker', question: 'Choose?' });
    expect(onHumanBlocker).toHaveBeenCalledOnce();
    expect(onHumanBlocker).toHaveBeenCalledWith(expect.objectContaining({ id: 'execution-1' }), expect.objectContaining({ id: 'blocker', question: 'Choose?' }));
  }));

  it('does not fire for a coordinator-audience blocker', async () => fixture(async (filePath) => {
    const onHumanBlocker = vi.fn();
    const { svc } = service(filePath, { onHumanBlocker });
    await svc.start('owner', 'project-1', jobTeam);
    await svc.dispatchReady(coordinator);
    await svc.blockWork(worker, 'a', { id: 'blocker', question: 'Which?', audience: 'coordinator' });
    expect(onHumanBlocker).not.toHaveBeenCalled();
  }));

  it.each([
    ['throwing', () => { throw new Error('boom'); }],
    ['rejecting', () => Promise.reject(new Error('boom'))]
  ])('logs a %s hook and still blocks the work', async (_name, hook) => fixture(async (filePath) => {
    const logError = vi.fn();
    const { store, svc } = service(filePath, { onHumanBlocker: hook, logError });
    await svc.start('owner', 'project-1', jobTeam);
    await svc.dispatchReady(coordinator);
    await expect(svc.blockWork(worker, 'a', { id: 'blocker', question: 'Choose?' })).resolves.toMatchObject({ ok: true });
    await new Promise((resolve) => setImmediate(resolve));
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('human blocker hook failed for execution-1/blocker'), expect.any(Error));
    expect((await store.get('execution-1'))?.blockers?.[0]).toMatchObject({ id: 'blocker', question: 'Choose?' });
  }));

  it('falls back to console.error when no logError is wired', async () => fixture(async (filePath) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { svc } = service(filePath, { onHumanBlocker: () => { throw new Error('boom'); } });
      await svc.start('owner', 'project-1', jobTeam);
      await svc.dispatchReady(coordinator);
      await expect(svc.blockWork(worker, 'a', { id: 'blocker', question: 'Choose?' })).resolves.toMatchObject({ ok: true });
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('human blocker hook failed'), expect.any(Error));
    } finally { consoleError.mockRestore(); }
  }));

  it('fires once when a stale coordinator blocker escalates to a human', async () => fixture(async (filePath) => {
    let now = 1000;
    const onHumanBlocker = vi.fn();
    const { svc } = service(filePath, { onHumanBlocker, inbox: { append: vi.fn(async () => undefined) } }, () => now);
    await svc.start('owner', 'project-1', jobTeam);
    await svc.dispatchReady(coordinator);
    await svc.blockWork(worker, 'a', { id: 'blocker', question: 'Which?', audience: 'coordinator' });
    now += 5 * 60_000 + 1;
    await svc.escalateStaleCoordinatorBlockers();
    expect(onHumanBlocker).toHaveBeenCalledOnce();
    expect(onHumanBlocker).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'blocker', audience: 'human' }));
    await svc.escalateStaleCoordinatorBlockers();
    expect(onHumanBlocker).toHaveBeenCalledOnce();
  }));

  it('fires once when kickoff churn blocks a work unit on a human', async () => fixture(async (filePath) => {
    const clock = { t: 1_000 };
    const onHumanBlocker = vi.fn();
    const { svc } = service(filePath, {
      onHumanBlocker, inbox: { append: vi.fn(async () => undefined) },
      claimRecoveryObserveEnabled: () => true, claimRecoveryEnforceEnabled: () => true
    }, () => clock.t);
    await svc.start('owner', 'project-1', jobTeam);
    await svc.dispatchReady(coordinator);
    clock.t += 700_000;
    await svc.redispatchStalled();
    expect(onHumanBlocker).toHaveBeenCalledOnce();
    expect(onHumanBlocker).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ audience: 'human', workUnitId: 'a' }));
  }));
});

describe('board projection startedFrom', () => {
  it('maps the proposer when present and omits it otherwise', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const record = (await store.claim(claimInput({ proposal }) as never)).record;
    expect(executionBoardProjection(record).startedFrom).toEqual({ kind: 'thread', id: 'thread-1', title: 'Fix login' });
    const noTitle = { ...record, proposal: { id: 'p', proposerKind: 'pty' as const, proposerId: 's' } };
    expect(executionBoardProjection(noTitle).startedFrom).toEqual({ kind: 'pty', id: 's' });
    const { proposal: _drop, ...plain } = record;
    expect('startedFrom' in executionBoardProjection(plain as ExecutionRecord)).toBe(false);
  }));
});
