import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SquadExecutionService } from '../service.js';
import { createExecutionStore, type ExecutionRecord } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';
import { executionBoardProjection } from '../projection.js';
import { createResumeGrantStore } from '../resume-grant-store.js';

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

describe('report marker', () => {
  it('is terminal-only, idempotent, keeps stateVersion and survives a reload', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const record = (await store.claim(claimInput({ proposal }) as never)).record;
    await expect(store.markReported(record.id, record.attempt)).rejects.toThrow('terminal report target is unavailable');
    await expect(store.markReported('missing', 1)).rejects.toThrow('execution not found');
    expect(await store.listUnreportedExecutions()).toEqual([]);

    const stopped = await store.stopForPlanCorrection(record.id);
    expect((await store.listUnreportedExecutions()).map((r) => r.id)).toEqual([record.id]);
    await expect(store.markReported(record.id, stopped.attempt + 1)).rejects.toThrow('stale execution attempt');

    const marked = await store.markReported(record.id, stopped.attempt);
    expect(marked.reportNoticeVersion).toBe(stopped.attempt);
    // The earlier key too, so a downgraded build sees the proposer's report as handled.
    expect(marked.proposalNoticeVersion).toBe(stopped.attempt);
    expect(marked.stateVersion).toBe(stopped.stateVersion);
    const again = await store.markReported(record.id, stopped.attempt);
    expect(again).toEqual(marked);

    const reloaded = createExecutionStore({ filePath });
    expect((await reloaded.get(record.id))?.reportNoticeVersion).toBe(stopped.attempt);
    expect(await reloaded.listUnreportedExecutions()).toEqual([]);
  }));

  it('lists terminal records with a report target (owner or proposer) not yet reported', async () => fixture(async (filePath) => {
    let n = 0;
    const store = createExecutionStore({ filePath, id: () => `execution-${++n}` });
    const withProposal = (await store.claim(claimInput({ proposal, launchRequestId: 'r1' }) as never)).record;
    const withoutTarget = (await store.claim(claimInput({ launchRequestId: 'r2' }) as never)).record;
    const owned = (await store.claim(claimInput({ launchRequestId: 'r3', reportTo: { kind: 'thread', id: 'thread-9', role: 'owner' } }) as never)).record;
    for (const record of [withProposal, withoutTarget, owned]) await store.stopForPlanCorrection(record.id);
    expect((await store.listUnreportedExecutions()).map((r) => r.id).sort()).toEqual([withProposal.id, owned.id].sort());
    expect((await store.get(owned.id))?.reportTo).toEqual({ kind: 'thread', id: 'thread-9', role: 'owner' });
    expect((await store.markReported(owned.id, 1)).proposalNoticeVersion).toBeUndefined();
  }));

  it('reads the earlier proposalNoticeVersion key as reported, without rewriting it', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const record = (await store.claim(claimInput({ proposal }) as never)).record;
    const stopped = await store.stopForPlanCorrection(record.id);
    const durable = JSON.parse(await readFile(filePath, 'utf8'));
    durable.records[0].proposalNoticeVersion = stopped.attempt;
    await writeFile(filePath, JSON.stringify(durable));
    const reloaded = createExecutionStore({ filePath });
    expect(await reloaded.listUnreportedExecutions()).toEqual([]);
    expect(await reloaded.markReported(record.id, stopped.attempt)).toMatchObject({ proposalNoticeVersion: stopped.attempt });
    expect((await reloaded.get(record.id))?.reportNoticeVersion).toBeUndefined();
  }));

  it.each([
    ['an unknown kind', { kind: 'mesh', id: 's', role: 'owner' }],
    ['an unknown role', { kind: 'pty', id: 's', role: 'boss' }],
    ['an empty id', { kind: 'pty', id: '', role: 'owner' }]
  ])('treats a malformed reportTo (%s) as a corrupt store', async (_name, bad) => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    await store.claim(claimInput({ proposal }) as never);
    const durable = JSON.parse(await readFile(filePath, 'utf8'));
    durable.records[0].reportTo = bad;
    await writeFile(filePath, JSON.stringify(durable));
    await expect(createExecutionStore({ filePath }).get('execution-1')).rejects.toThrow('corrupt execution store');
  }));
});

describe('start with a report target', () => {
  it('stores reportTo next to the proposal', async () => fixture(async (filePath) => {
    const { store, svc } = service(filePath);
    const reportTo = { kind: 'pty' as const, id: 'owner-session', role: 'owner' as const };
    expect((await svc.start('owner', 'project-1', request, { reportTo })).ok).toBe(true);
    expect((await store.get('execution-1'))?.reportTo).toEqual(reportTo);
  }));
});

describe('blocker report marker', () => {
  const ownerTarget = { kind: 'pty' as const, id: 'owner-session', role: 'owner' as const };
  async function blockedRun(filePath: string, extra: Record<string, unknown> = {}) {
    const { store, svc } = service(filePath);
    await svc.start('owner', 'project-1', jobTeam, { reportTo: ownerTarget, ...extra });
    await svc.dispatchReady(coordinator);
    await svc.blockWork(worker, 'a', { id: 'blocker', question: 'Choose?' });
    return { store, svc };
  }

  it('lists a live run with an open human blocker until it is marked, and survives a reload', async () => fixture(async (filePath) => {
    const { store } = await blockedRun(filePath);
    expect((await store.listUnreportedBlockers()).map((r) => r.id)).toEqual(['execution-1']);
    const before = (await store.get('execution-1'))!;
    const marked = await store.markBlockerReported('execution-1', 'blocker');
    expect(marked.reportedBlockerIds).toEqual(['blocker']);
    expect(marked.stateVersion).toBe(before.stateVersion);
    expect(await store.markBlockerReported('execution-1', 'blocker')).toEqual(marked);
    const reloaded = createExecutionStore({ filePath });
    expect((await reloaded.get('execution-1'))?.reportedBlockerIds).toEqual(['blocker']);
    expect(await reloaded.listUnreportedBlockers()).toEqual([]);
  }));

  it('lists proposed runs too, but not coordinator blockers, runs without a target, or terminal runs', async () => fixture(async (filePath) => {
    const proposed = await blockedRun(filePath, { reportTo: { kind: 'thread', id: 'thread-1', role: 'proposer' }, proposal });
    expect((await proposed.store.listUnreportedBlockers()).map((r) => r.id)).toEqual(['execution-1']);
    await fixture(async (otherPath) => {
      const { store, svc } = service(otherPath);
      await svc.start('owner', 'project-1', jobTeam, { reportTo: ownerTarget });
      await svc.dispatchReady(coordinator);
      await svc.blockWork(worker, 'a', { id: 'c1', question: 'Ask coordinator', audience: 'coordinator' });
      expect(await store.listUnreportedBlockers()).toEqual([]);
    });
    await fixture(async (plainPath) => {
      const { store, svc } = service(plainPath);
      await svc.start('owner', 'project-1', jobTeam);
      await svc.dispatchReady(coordinator);
      await svc.blockWork(worker, 'a', { id: 'blocker', question: 'Choose?' });
      expect(await store.listUnreportedBlockers()).toEqual([]);
    });
  }));

  it('never lists a record written before report-back (proposal only, no reportTo or reportedBlockerIds)', async () => fixture(async (filePath) => {
    const { store } = await blockedRun(filePath, { reportTo: undefined, proposal });
    const stored = (await store.get('execution-1'))!;
    expect(stored.reportTo).toBeUndefined();
    expect(stored.reportedBlockerIds).toBeUndefined();
    expect(stored.blockers?.some((b) => !b.resolved)).toBe(true);
    expect(await store.listUnreportedBlockers()).toEqual([]);
  }));

  it('rejects an unknown run or blocker', async () => fixture(async (filePath) => {
    const { store } = await blockedRun(filePath);
    await expect(store.markBlockerReported('missing', 'blocker')).rejects.toThrow('execution not found');
    await expect(store.markBlockerReported('execution-1', 'nope')).rejects.toThrow('execution blocker not found');
  }));

  it('keeps at most 100 ids, and prunes resolved or gone ones first so an open blocker is never evicted', async () => fixture(async (filePath) => {
    await blockedRun(filePath);
    const durable = JSON.parse(await readFile(filePath, 'utf8'));
    const record = durable.records[0];
    const template = record.blockers[0];
    const resolved = Array.from({ length: 60 }, (_, i) => ({ ...template, id: `res-${i}`, resolved: true }));
    record.blockers = [{ ...template, id: 'old-open' }, ...resolved, template];
    // 100 ids, the oldest being a still-open blocker: a plain "newest 100" cap would evict it.
    record.reportedBlockerIds = ['old-open', ...resolved.map((b) => b.id), ...Array.from({ length: 39 }, (_, i) => `gone-${i}`)];
    expect(record.reportedBlockerIds).toHaveLength(100);
    await writeFile(filePath, JSON.stringify(durable));
    const full = createExecutionStore({ filePath });
    const marked = await full.markBlockerReported('execution-1', 'blocker');
    expect(marked.reportedBlockerIds).toEqual(['old-open', 'blocker']);
    // old-open stays reported, so it is not replayed after a restart; only a never-reported one would be.
    expect((await full.listUnreportedBlockers()).map((r) => r.id)).toEqual([]);
  }));

  it('caps the ids at 100 even when every one is an open blocker', async () => fixture(async (filePath) => {
    await blockedRun(filePath);
    const durable = JSON.parse(await readFile(filePath, 'utf8'));
    const record = durable.records[0];
    const template = record.blockers[0];
    const open = Array.from({ length: 100 }, (_, i) => ({ ...template, id: `open-${i}` }));
    record.blockers = [...open.slice(0, 99), template];
    record.reportedBlockerIds = open.slice(0, 99).map((b) => b.id);
    await writeFile(filePath, JSON.stringify(durable));
    const marked = await createExecutionStore({ filePath }).markBlockerReported('execution-1', 'blocker');
    expect(marked.reportedBlockerIds).toHaveLength(100);
    expect(marked.reportedBlockerIds?.at(-1)).toBe('blocker');
  }));

  it('refuses a run with no report target', async () => fixture(async (filePath) => {
    const { store, svc } = service(filePath);
    await svc.start('owner', 'project-1', jobTeam);
    await svc.dispatchReady(coordinator);
    await svc.blockWork(worker, 'a', { id: 'blocker', question: 'Choose?' });
    await expect(store.markBlockerReported('execution-1', 'blocker')).rejects.toThrow('report target is unavailable');
  }));

  it.each([
    ['not an array', 'blocker'],
    ['a non-string entry', [1]],
    ['an empty id', ['']],
    ['more than 100 ids', Array.from({ length: 101 }, (_, i) => `b${i}`)]
  ])('treats malformed reportedBlockerIds (%s) as a corrupt store, and an absent field as fine', async (_name, bad) => fixture(async (filePath) => {
    await blockedRun(filePath);
    expect((await createExecutionStore({ filePath }).get('execution-1'))?.reportedBlockerIds).toBeUndefined();
    const durable = JSON.parse(await readFile(filePath, 'utf8'));
    durable.records[0].reportedBlockerIds = bad;
    await writeFile(filePath, JSON.stringify(durable));
    await expect(createExecutionStore({ filePath }).get('execution-1')).rejects.toThrow('corrupt execution store');
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

describe('owner answers and report-back follow-through', () => {
  const ownerTarget = { kind: 'pty' as const, id: 'owner-session', role: 'owner' as const };

  async function blocked(filePath: string, audience?: 'coordinator', over: Record<string, unknown> = {}) {
    const made = service(filePath, over);
    await made.svc.start('owner', 'project-1', jobTeam, { reportTo: ownerTarget });
    await made.svc.dispatchReady(coordinator);
    await made.svc.blockWork(worker, 'a', { id: 'blocker', question: 'Choose?', ...(audience ? { audience } : {}) });
    return made;
  }

  it('lets the owner answer a human blocker without a version, and still rejects an explicit stale one', async () => fixture(async (filePath) => {
    const { store, svc } = await blocked(filePath);
    const current = (await store.get('execution-1'))!;
    const stale = await svc.respondToHumanBlockerAsOwner('owner', 'project-1', 'execution-1', current.stateVersion - 1, 'blocker', 'c-stale', 'Atlas');
    expect(stale).toMatchObject({ ok: false, code: 'CONFLICT' });
    const answered = await svc.respondToHumanBlockerAsOwner('owner', 'project-1', 'execution-1', undefined, 'blocker', 'c-latest', 'Atlas');
    expect(answered).toMatchObject({ ok: true, pending: true });
  }));

  it('refuses a coordinator-audience blocker for the owner, with a clear error', async () => fixture(async (filePath) => {
    const { svc } = await blocked(filePath, 'coordinator');
    const result = await svc.respondToHumanBlockerAsOwner('owner', 'project-1', 'execution-1', undefined, 'blocker', 'c1', 'Atlas');
    expect(result).toMatchObject({ ok: false, message: 'blocker blocker is for the coordinator, not the owner' });
  }));

  it('refuses an invalid, unknown or already answered owner blocker answer', async () => fixture(async (filePath) => {
    const { svc } = await blocked(filePath);
    const answer = (over: Partial<{ execution: string; blocker: string; request: string; message: string; caller: string }> = {}) =>
      svc.respondToHumanBlockerAsOwner(over.caller ?? 'owner', 'project-1', over.execution ?? 'execution-1', undefined, over.blocker ?? 'blocker', over.request ?? 'c1', over.message ?? 'Atlas');
    for (const bad of [{ blocker: ' ' }, { request: ' ' }, { message: ' ' }, { message: 'x'.repeat(16 * 1024 + 1) }]) {
      await expect(answer(bad)).resolves.toMatchObject({ ok: false, code: 'INVALID' });
    }
    await expect(answer({ execution: 'missing' })).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND', message: 'execution not found for caller' });
    await expect(answer({ caller: 'someone-else' })).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND', message: 'execution not found for caller' });
    await expect(answer({ blocker: 'nope' })).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND', message: 'execution blocker not found' });
  }));

  it('retries a versionless owner answer on a concurrent write, at most five times', async () => fixture(async (filePath) => {
    const { store, svc } = await blocked(filePath);
    // A real concurrent write: another writer bumps stateVersion just before the answer is enqueued.
    const enqueue = store.enqueueBlockerDelivery.bind(store);
    let calls = 0;
    let conflicts = 0;
    store.enqueueBlockerDelivery = (async (...args: Parameters<typeof enqueue>) => {
      calls += 1;
      if (conflicts > 0) {
        conflicts -= 1;
        await store.event(args[0], (await store.get(args[0]))!.stateVersion, 'info', 'concurrent write');
      }
      return enqueue(...args);
    }) as typeof store.enqueueBlockerDelivery;
    conflicts = 1;
    await expect(svc.respondToHumanBlockerAsOwner('owner', 'project-1', 'execution-1', undefined, 'blocker', 'c1', 'Atlas')).resolves.toMatchObject({ ok: true });
    expect(calls).toBe(2);
    calls = 0; conflicts = 99;
    await expect(svc.respondToHumanBlockerAsOwner('owner', 'project-1', 'execution-1', undefined, 'blocker', 'c2', 'Atlas')).resolves.toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(calls).toBe(5);
    calls = 0; conflicts = 99;
    const current = (await store.get('execution-1'))!.stateVersion;
    await expect(svc.respondToHumanBlockerAsOwner('owner', 'project-1', 'execution-1', current, 'blocker', 'c3', 'Atlas')).resolves.toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(calls).toBe(1);
  }));

  it('does not re-offer blockers when resume_binding passes no report kind', async () => fixture(async (filePath) => {
    const onHumanBlocker = vi.fn();
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'resume-token' });
    const { store, svc } = service(filePath, { resumeGrants: grants, onHumanBlocker });
    const started = await svc.start('owner', 'project-1', jobTeam, { reportTo: ownerTarget });
    if (!started.ok || !started.value.resumeToken) throw new Error('missing resume token');
    await svc.dispatchReady(coordinator);
    await svc.blockWork(worker, 'a', { id: 'blocker', question: 'Choose?' });
    onHumanBlocker.mockClear();
    await expect(svc.resumeBinding('thread-2', 'project-1', 'execution-1', started.value.resumeToken)).resolves.toMatchObject({ ok: true });
    await new Promise((resolve) => setImmediate(resolve));
    expect(onHumanBlocker).not.toHaveBeenCalled();
    expect((await store.get('execution-1'))?.reportTo?.id).toBe('owner-session');
  }));

  it('re-offers open unreported human blockers when resume_binding moves the owner target, and only then', async () => fixture(async (filePath) => {
    const onHumanBlocker = vi.fn();
    const grants = createResumeGrantStore({ filePath: `${filePath}.grants`, token: () => 'resume-token' });
    const { store, svc } = service(filePath, { resumeGrants: grants, onHumanBlocker });
    const started = await svc.start('owner', 'project-1', jobTeam, { reportTo: ownerTarget });
    if (!started.ok || !started.value.resumeToken) throw new Error('missing resume token');
    await svc.dispatchReady(coordinator);
    await svc.blockWork(worker, 'a', { id: 'blocker', question: 'Choose?' });
    await svc.blockWork(worker, 'a', { id: 'ask', question: 'Which?', audience: 'coordinator' }).catch(() => undefined);
    onHumanBlocker.mockClear();
    const moved = await svc.resumeBinding('thread-2', 'project-1', 'execution-1', started.value.resumeToken, 'thread');
    expect(moved).toMatchObject({ ok: true, value: { reportTo: { kind: 'thread', id: 'thread-2', role: 'owner' } } });
    await new Promise((resolve) => setImmediate(resolve));
    expect(onHumanBlocker).toHaveBeenCalledOnce();
    expect(onHumanBlocker).toHaveBeenCalledWith(expect.objectContaining({ reportTo: expect.objectContaining({ id: 'thread-2' }) }), expect.objectContaining({ id: 'blocker' }));
    expect((await store.get('execution-1'))?.reportTo?.id).toBe('thread-2');
  }));
});
