import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SquadExecutionService } from '../service.js';
import { createExecutionStore, KICKOFF_FAILURE_BLOCK_THRESHOLD, NO_PROGRESS_CLAIM_REASON } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';

// Production wiring: the service derives deferred (startOnDemand, unstarted) seats from the team lifecycle
// and hands them to the store, so a live seat beats a deferred one at equal price (D11).

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-execution-cheapest-fit-svc-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
const unit = { id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] };
interface Seat { slotId: string; model: string; deferred?: boolean; skillAllowlist?: string[] }

function build(filePath: string, seats: Seat[], opts: { teamId?: string; lifecycleFails?: boolean; installedSkills?: string[] } = {}) {
  const now = () => 1_000;
  const store = createExecutionStore({ filePath, id: () => 'execution-1', now });
  const service = new SquadExecutionService({
    store,
    artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
    authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: opts.teamId ?? 'team-1', projectId: 'project-1', slots: [], context: {
      version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
        { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
        ...seats.map((seat) => ({ slotId: seat.slotId, personaId: 'engineer', authorizationIdDigest: `${seat.slotId}-d` }))
      ] } } }),
    launchTeam: async () => ({ ok: true }),
    ...(opts.installedSkills ? { admissionInput: (_p: string, request: { workUnits?: unknown; slots: { initialTask: string }[] }) => ({ workUnits: request.workUnits, slotCount: request.slots.length, maxSlots: 32, initialTasks: request.slots.map((slot) => slot.initialTask), inventory: { version: 1 as const, observedAt: Date.now(), maxAgeMs: 3_600_000, skills: opts.installedSkills!.map((name) => ({ name, available: true })), mcpServers: [], models: [], providers: [] } }) } : {}),
    getTeamLaunch: async () => {
      if (opts.lifecycleFails) throw new Error('lifecycle down');
      return { id: 'lifecycle-1', orchestratorSessionId: 'coordinator', workers: seats.map((seat) => seat.deferred
        ? { slotId: seat.slotId, projectId: 'project-1', process: 'authorized', onDemand: true }
        : { slotId: seat.slotId, sessionId: `session-${seat.slotId}`, projectId: 'project-1', process: 'running' }) };
    },
    cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }),
    resolveTeamModelSnapshots: () => seats.map((seat) => ({ slotId: seat.slotId, personaId: 'engineer', provider: 'claude', model: seat.model, ...(seat.skillAllowlist ? { skillAllowlist: seat.skillAllowlist } : {}) })),
    replyToSession: vi.fn(() => true), now, inbox: { append: vi.fn(async () => undefined) }, logError: vi.fn(),
    spawnDeferredWorker: vi.fn(async (_id: string, slotId: string) => ({ ok: true as const, sessionId: `s-${slotId}` }))
  } as never);
  return { service, store };
}

async function assigned(filePath: string, seats: Seat[], opts?: Parameters<typeof build>[2]) {
  const { service, store } = build(filePath, seats, opts);
  const request = { version: 1 as const, teamId: opts?.teamId ?? 'team-1', launchRequestId: 'request-1', summary: 'Build', slots: [{ initialTask: 'Run tests' }] };
  const started = await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [unit] } as never);
  if (!started.ok) throw new Error(started.message);
  await service.dispatchReady(coordinator);
  return (await store.get('execution-1'))!.workUnits![0].assignedSlotId;
}

describe('service passes deferred seats into cheapest-fit dispatch', () => {
  it('prefers a live seat over a deferred seat at equal price, even when the deferred one is listed first', async () => fixture(async (filePath) => {
    expect(await assigned(`${filePath}.a`, [{ slotId: 'engineer:0', model: 'claude-sonnet-4', deferred: true }, { slotId: 'engineer:1', model: 'claude-sonnet-4' }])).toBe('engineer:1');
  }));
  it('lets a strictly cheaper deferred seat win', async () => fixture(async (filePath) => {
    expect(await assigned(filePath, [{ slotId: 'engineer:0', model: 'claude-opus-4' }, { slotId: 'engineer:1', model: 'claude-haiku-4', deferred: true }])).toBe('engineer:1');
  }));
  it('passes no deferred hint (roster-order fallback) when the lifecycle read fails', async () => fixture(async (filePath) => {
    const { service, store } = build(filePath, [{ slotId: 'engineer:0', model: 'claude-sonnet-4', deferred: true }, { slotId: 'engineer:1', model: 'claude-sonnet-4' }], { lifecycleFails: true });
    const spy = vi.spyOn(store, 'dispatchReady');
    const started = await service.start('owner', 'project-1', { version: 1, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build', slots: [{ initialTask: 'Run tests' }], coordinationMode: 'job-team', workUnits: [unit] } as never);
    if (!started.ok) throw new Error(started.message);
    await service.dispatchReady(coordinator);
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][1]).not.toHaveProperty('deferredSlotIds');
  }));
  it('gives identical assignments for an identically configured Team under another id (no per-Team branching)', async () => fixture(async (filePath) => {
    const seats = [{ slotId: 'engineer:0', model: 'claude-opus-4' }, { slotId: 'engineer:1', model: 'claude-haiku-4' }];
    expect(await assigned(`${filePath}.a`, seats, { teamId: 'builtin-team' })).toBe(await assigned(`${filePath}.b`, seats, { teamId: 'copy-of-builtin-team' }));
  }));

  it('escalateKickoffFailures hands deferredSlotIds to reassignKickoffToFreshSlot and prefers a live untried seat at equal price', async () => fixture(async (filePath) => {
    // w0 is the churning seat; w1 is deferred (listed first), w2 live; all equal price.
    const seats: Seat[] = [{ slotId: 'engineer:0', model: 'claude-sonnet-4' }, { slotId: 'engineer:1', model: 'claude-sonnet-4', deferred: true }, { slotId: 'engineer:2', model: 'claude-sonnet-4' }];
    const { service, store } = build(filePath, seats);
    const started = await service.start('owner', 'project-1', { version: 1, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build', slots: [{ initialTask: 'Run tests' }], coordinationMode: 'job-team', workUnits: [unit] } as never);
    if (!started.ok) throw new Error(started.message);
    let record = (await store.get('execution-1'))!;
    record = (await store.dispatchReady(record.id, {})).record;
    // Force the churn onto engineer:0 regardless of dispatch tie-breaking.
    record = await store.reassignWork(record.id, record.stateVersion, coordinator as never, 'a', 'engineer:0').catch(() => record);
    record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'engineer:0' }, 'a');
    for (let i = 0; i < KICKOFF_FAILURE_BLOCK_THRESHOLD; i++) {
      const claim = (await store.get(record.id))!.workUnits![0];
      record = await store.reclaimExpiredClaims(record.id, [{ workUnitId: 'a', claimId: claim.claimId!, claimGeneration: claim.claimGeneration!, reason: NO_PROGRESS_CLAIM_REASON.SILENT, force: true }]);
      if (i < KICKOFF_FAILURE_BLOCK_THRESHOLD - 1) record = await store.claimWork(record.id, record.stateVersion, { role: 'worker', slotId: 'engineer:0' }, 'a');
    }
    const spy = vi.spyOn(store, 'reassignKickoffToFreshSlot');
    const changed = await (service as unknown as { escalateKickoffFailures(r: unknown): Promise<boolean> }).escalateKickoffFailures(record);
    expect(changed).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][2]?.deferredSlotIds).toEqual(new Set(['engineer:1']));
    expect((await store.get('execution-1'))!.workUnits![0].assignedSlotId).toBe('engineer:2');
  }));
  it('a released unit redispatches through cascadeDispatch with the deferred hint (live peer wins at equal price)', async () => fixture(async (filePath) => {
    const { service, store } = build(filePath, [{ slotId: 'engineer:0', model: 'claude-sonnet-4', deferred: true }, { slotId: 'engineer:1', model: 'claude-sonnet-4' }]);
    const spy = vi.spyOn(store, 'dispatchReady');
    const started = await service.start('owner', 'project-1', { version: 1, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build', slots: [{ initialTask: 'Run tests' }], coordinationMode: 'job-team', workUnits: [unit] } as never);
    if (!started.ok) throw new Error(started.message);
    await (service as unknown as { cascadeDispatch(id: string, slot?: string): Promise<void> }).cascadeDispatch('execution-1', 'engineer:1');
    expect(spy.mock.calls.at(-1)![1]).toMatchObject({ deprioritizeSlotId: 'engineer:1', deferredSlotIds: new Set(['engineer:0']) });
  }));
  it('deferredDispatchOpts ignores seats that are Modern, session-bound, other-project, or not authorized', async () => fixture(async (filePath) => {
    const { service } = build(filePath, [{ slotId: 'engineer:0', model: 'claude-sonnet-4', deferred: true }]);
    const deps = (service as unknown as { deps: { getTeamLaunch: unknown } }).deps;
    const rec = { callerPrincipalId: 'owner', teamLaunchRequestId: 'r', projectId: 'project-1' };
    const opts = (workers: unknown[]) => { deps.getTeamLaunch = async () => ({ id: 'l', orchestratorSessionId: 'c', workers }); return (service as unknown as { deferredDispatchOpts(r: unknown): Promise<unknown> }).deferredDispatchOpts(rec); };
    const base = { slotId: 'w', projectId: 'project-1', process: 'authorized', onDemand: true };
    expect(await opts([base])).toEqual({ deferredSlotIds: new Set(['w']) });
    expect(await opts([{ ...base, transport: 'MODERN' }])).toEqual({});
    expect(await opts([{ ...base, sessionId: 's' }])).toEqual({});
    expect(await opts([{ ...base, projectId: 'other' }])).toEqual({});
    expect(await opts([{ ...base, process: 'running' }])).toEqual({});
    expect(await opts([{ ...base, onDemand: false }])).toEqual({});
    expect(await opts([{ ...base, slotId: undefined }])).toEqual({});
  }));

  it('never dispatches a unit to a slot whose skillAllowlist does not cover requires.skills, and persists the allowlist', async () => fixture(async (filePath) => {
    const skilled = { ...unit, requires: { skills: ['review'] } };
    const { service, store } = build(filePath, [
      { slotId: 'engineer:0', model: 'claude-haiku-4', skillAllowlist: ['zcc-inbox'] },
      { slotId: 'engineer:1', model: 'claude-opus-4' }
    ], { installedSkills: ['review', 'zcc-inbox'] });
    const started = await service.start('owner', 'project-1', { version: 1, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build', slots: [{ initialTask: 'Run tests' }], coordinationMode: 'job-team', workUnits: [skilled] } as never);
    if (!started.ok) throw new Error(started.message);
    await service.dispatchReady(coordinator);
    const record = (await store.get('execution-1'))!;
    expect(record.workUnits![0].assignedSlotId).toBe('engineer:1');
    expect(record.resolvedModels.find((m) => m.slotId === 'engineer:0')?.skillAllowlist).toEqual(['zcc-inbox']);
    expect(record.resolvedModels.find((m) => m.slotId === 'engineer:1')).not.toHaveProperty('skillAllowlist');
  }));
});
