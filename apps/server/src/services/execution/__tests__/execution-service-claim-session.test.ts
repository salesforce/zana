import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SquadExecutionService } from '../service.js';
import { createExecutionStore, KICKOFF_FAILURE_BLOCK_THRESHOLD, type ExecutionRecord } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';

// Session fence on worker-initiated claims.

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-claim-session-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

const request = { version: 1 as const, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build', slots: [{ initialTask: 'Run' }] };
const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
const unitInput = { id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'], routing: { version: 1 as const, requiredRole: 'engineer' } };
const worker = (slotId: string) => ({ executionId: 'execution-1', projectId: 'project-1', slotId, role: 'worker' as const });

function build(filePath: string, clock: { t: number }, slots: string[], extra: Record<string, unknown> = {}) {
  const now = () => clock.t;
  const store = createExecutionStore({ filePath, id: () => 'execution-1', now });
  const replyToSession = vi.fn(() => true);
  const workers = slots.map((slotId) => ({ slotId, personaId: 'engineer' }));
  const service = new SquadExecutionService({
    store,
    artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
    authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
      version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
        { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
        ...workers.map((w) => ({ ...w, authorizationIdDigest: `${w.slotId}-d` }))
      ] } } }),
    launchTeam: async () => ({ ok: true }),
    getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: workers.map((w) => ({ slotId: w.slotId, sessionId: `session-${w.slotId}`, projectId: 'project-1' })) }),
    cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }),
    resolveTeamModelSnapshots: () => workers.map((w) => ({ ...w, provider: 'anthropic', model: 'm' })),
    replyToSession, now, inbox: { append: vi.fn(async () => undefined) }, logError: vi.fn(),
    claimRecoveryObserveEnabled: () => true, claimRecoveryEnforceEnabled: () => true,
    resolveExactNativeRecoverySnapshots: (record: ExecutionRecord) => record.nativeRecoverySnapshots ?? [],
    ...extra
  } as never);
  return { service, store };
}

async function start(service: SquadExecutionService) {
  const started = await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [unitInput] } as never);
  if (!started.ok) throw new Error(started.message);
}


const unitOf = async (store: ReturnType<typeof build>['store']) => (await store.get('execution-1'))!.workUnits![0];

describe('session fence on worker-initiated claims', () => {
  it('refuses a claim from a stale session and leaves the unit READY', async () => fixture(async (filePath) => {
    const { service, store } = build(filePath, { t: 1_000 }, ['engineer:0']);
    await start(service);
    const out = await service.claimWork(worker('engineer:0'), 'a', undefined, 'old-session');
    expect(out).toMatchObject({ ok: false, code: 'DENIED' });
    expect((out as { message: string }).message).toContain('old-session');
    expect((await unitOf(store)).state).toBe('READY');
  }));

  it('accepts a claim from the live session and binds it so later stale signals are dropped', async () => fixture(async (filePath) => {
    const { service, store } = build(filePath, { t: 1_000 }, ['engineer:0']);
    await start(service);
    const out = await service.claimWork(worker('engineer:0'), 'a', undefined, 'session-engineer:0');
    expect(out.ok).toBe(true);
    const unit = await unitOf(store);
    expect(unit).toMatchObject({ state: 'CLAIMED', claimedBy: { slotId: 'engineer:0', sessionId: 'session-engineer:0' } });
    expect(await store.recordClaimSignal('execution-1', 'engineer:0', { turn: true, sessionId: 'old-session' })).toBe(false);
    expect(await store.recordClaimSignal('execution-1', 'engineer:0', { turn: true, sessionId: 'session-engineer:0' })).toBe(true);
  }));

  it('fails open without a caller session (modern member path) and leaves the claim unbound', async () => fixture(async (filePath) => {
    const { service, store } = build(filePath, { t: 1_000 }, ['engineer:0']);
    await start(service);
    expect((await service.claimWork(worker('engineer:0'), 'a')).ok).toBe(true);
    expect((await unitOf(store)).claimedBy?.sessionId).toBeUndefined();
  }));

  it('fails open when the slot session is unknown or the lifecycle read throws', async () => fixture(async (filePath) => {
    const { service, store } = build(filePath, { t: 1_000 }, ['engineer:0'], { getTeamLaunch: async () => { throw new Error('lifecycle down'); } });
    await start(service);
    expect((await service.claimWork(worker('engineer:0'), 'a', undefined, 'anything')).ok).toBe(true);
    expect((await unitOf(store)).state).toBe('CLAIMED');
  }));

  it('does not touch the fence when the store rejects the claim', async () => fixture(async (filePath) => {
    const { service } = build(filePath, { t: 1_000 }, ['engineer:0']);
    await start(service);
    const out = await service.claimWork(worker('engineer:0'), 'missing-unit', undefined, 'session-engineer:0');
    expect(out.ok).toBe(false);
  }));

  it('coordinator assignment is still refused through claimWork', async () => fixture(async (filePath) => {
    const { service } = build(filePath, { t: 1_000 }, ['engineer:0']);
    await start(service);
    expect(await service.claimWork(coordinator, 'a', undefined, 'x')).toMatchObject({ ok: false, code: 'DENIED' });
  }));
});

describe('session fence on modern-member claims', () => {
  const modernLifecycle = (threadId: unknown, generation: unknown) => async () => ({
    orchestratorSessionId: 'coordinator',
    workers: [{ slotId: 'engineer:0', projectId: 'project-1', ...(threadId === undefined ? {} : { threadId }), ...(generation === undefined ? {} : { generation }) }]
  });

  it('refuses a claim from a stale thread', async () => fixture(async (filePath) => {
    const { service, store } = build(filePath, { t: 1_000 }, ['engineer:0'], { getTeamLaunch: modernLifecycle('thread-new', 3) });
    await start(service);
    expect(await service.claimWork(worker('engineer:0'), 'a', undefined, 'thread-old', 3)).toMatchObject({ ok: false, code: 'DENIED' });
    expect((await unitOf(store)).state).toBe('READY');
  }));

  it('refuses a claim from a stale generation of the same thread', async () => fixture(async (filePath) => {
    const { service } = build(filePath, { t: 1_000 }, ['engineer:0'], { getTeamLaunch: modernLifecycle('thread-1', 4) });
    await start(service);
    expect(await service.claimWork(worker('engineer:0'), 'a', undefined, 'thread-1', 3)).toMatchObject({ ok: false, code: 'DENIED' });
  }));

  it('accepts the current member and does not bind a session to the claim', async () => fixture(async (filePath) => {
    const { service, store } = build(filePath, { t: 1_000 }, ['engineer:0'], { getTeamLaunch: modernLifecycle('thread-1', 3) });
    await start(service);
    expect((await service.claimWork(worker('engineer:0'), 'a', undefined, 'thread-1', 3)).ok).toBe(true);
    expect((await unitOf(store)).claimedBy?.sessionId).toBeUndefined();
  }));

  it('fails open when the lifecycle has no member identity, no such worker, or throws', async () => fixture(async (filePath) => {
    for (const [i, getTeamLaunch] of [modernLifecycle(undefined, undefined), async () => ({ workers: [] }), async () => { throw new Error('down'); }].entries()) {
      const { service, store } = build(`${filePath}-${i}`, { t: 1_000 }, ['engineer:0'], { getTeamLaunch });
      await start(service);
      expect((await service.claimWork(worker('engineer:0'), 'a', undefined, 'thread-x', 1)).ok).toBe(true);
      expect((await unitOf(store)).state).toBe('CLAIMED');
    }
  }));
});

