import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SquadExecutionService } from '../service.js';
import { ALL_UNKNOWN_ESCALATE_MS, createExecutionStore, type ExecutionWorkUnitInput } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-no-route-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

const SLOTS = [
  { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'o' },
  { slotId: 'eng:0', personaId: 'engineer', authorizationIdDigest: 'e' }
];

async function seed(store: ReturnType<typeof createExecutionStore>, units: Array<Partial<ExecutionWorkUnitInput> & { id: string }>) {
  let record = (await store.claim({
    callerPrincipalId: 's', projectId: 'project-1', teamId: 'team-1', jobTitle: 'j', requestDigest: 'd', launchRequestId: 'r', resolvedModels: [],
    request: { version: 1 as const, slots: [{ initialTask: 'x' }], resolvedModels: [] }, routingPolicy: { version: 1 as const, hardRequirements: true }
  })).record;
  record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
  record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
  record = await store.setAuthorizationContext(record.id, record.stateVersion, { version: 1, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: SLOTS }, 'digest');
  record = await store.replaceResolvedModels(record.id, [{ slotId: 'eng:0', personaId: 'engineer', provider: 'anthropic', model: 'm', label: 'Engineer' }]);
  return store.registerPlan(record.id, record.stateVersion, units.map((unit) => ({ title: unit.id, task: 'Work', dependencies: [], readOnly: true, ...unit })));
}

const NEEDS_REVIEWER = { id: 'a', routing: { version: 1 as const, requiredRole: 'reviewer' } };
const COORDINATOR = (executionId: string) => ({ executionId, projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const });

function build(filePath: string, now: () => number, extra: { inbox?: unknown; getTeamLaunch?: () => Promise<unknown>; replyToSession?: () => boolean } = {}) {
  const store = createExecutionStore({ filePath, id: () => 'execution-1', now });
  const service = new SquadExecutionService({
    store, now,
    artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
    authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: { version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: SLOTS } } }),
    launchTeam: async () => ({ ok: true }),
    getTeamLaunch: extra.getTeamLaunch ?? (async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'eng:0', sessionId: 'w1', projectId: 'project-1' }] })),
    cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: [], pendingSessionIds: [] } }),
    replyToSession: extra.replyToSession ?? (() => true),
    resolveExactNativeRecoverySnapshots: () => [],
    ...(extra.inbox ? { inbox: extra.inbox } : {})
  } as unknown as ConstructorParameters<typeof SquadExecutionService>[0]);
  return { store, service };
}

describe('runtime escalation for never-satisfiable steps', () => {
  it('blocks once per dispatch pass with a plain-words question and does not repeat', async () => fixture(async (filePath) => {
    const { store, service } = build(filePath, () => 1_000);
    const record = await seed(store, [NEEDS_REVIEWER]);
    const first = await store.dispatchReady(record.id, { enforceRouting: false });
    expect(first.noRouteBlockerIds).toHaveLength(1);
    const blocker = first.record.blockers![0];
    expect(blocker).toMatchObject({ audience: 'coordinator', noRoute: true, resolved: false, workUnitId: 'a' });
    expect(blocker.question).toContain('No worker in this Squad can do step a');
    expect(blocker.question).toContain('required role missing: reviewer');
    expect(blocker.question).toContain('Roles offered: engineer');
    expect(blocker.question).toContain('Reply to skip this step, or cancel the run and fix the plan.');
    expect(first.record.state).toBe('BLOCKED');
    const second = await store.dispatchReady(record.id, { enforceRouting: true });
    expect(second.noRouteBlockerIds).toEqual([]);
    expect(second.record.blockers).toHaveLength(1);
    service.dispose();
  }));

  it('escalates in enforce mode too and wakes the coordinator through the service', async () => fixture(async (filePath) => {
    const replyToSession = vi.fn(() => true);
    const { store, service } = build(filePath, () => 1_000, { replyToSession });
    const record = await seed(store, [NEEDS_REVIEWER]);
    const result = await service.dispatchReady(COORDINATOR(record.id));
    expect(result).toMatchObject({ ok: true });
    const current = (await store.get(record.id))!;
    expect(current.blockers).toHaveLength(1);
    expect(replyToSession).toHaveBeenCalledWith('coordinator', expect.stringContaining('has no qualified worker'));
    service.dispose();
  }));

  it('still waits (no block) when a matching slot is merely busy', async () => fixture(async (filePath) => {
    const { store, service } = build(filePath, () => 1_000);
    const record = await seed(store, [{ id: 'a', routing: { version: 1, requiredRole: 'engineer' } }, { id: 'b', routing: { version: 1, requiredRole: 'engineer' } }]);
    const result = await store.dispatchReady(record.id, { enforceRouting: false });
    expect(result.noRouteBlockerIds).toEqual([]);
    expect(result.record.blockers ?? []).toHaveLength(0);
    expect(result.record.workUnits!.find((unit) => unit.id === 'b')!.state).toBe('READY');
    service.dispose();
  }));

  it('escalates to the human with an Inbox notice once the coordinator is unavailable', async () => fixture(async (filePath) => {
    const inbox = { append: vi.fn(async () => ({ id: 'i' })), appendOnce: vi.fn(async () => ({ id: 'i' })) };
    const { store, service } = build(filePath, () => 1_000, { inbox, getTeamLaunch: async () => ({ workers: [] }) });
    const record = await seed(store, [NEEDS_REVIEWER]);
    await store.dispatchReady(record.id, { enforceRouting: false });
    await service.escalateStaleCoordinatorBlockers();
    const blocker = (await store.get(record.id))!.blockers![0];
    expect(blocker).toMatchObject({ audience: 'human', noRoute: true });
    expect(inbox.appendOnce.mock.calls.length + inbox.append.mock.calls.length).toBeGreaterThan(0);
    service.dispose();
  }));

  it('a coordinator or human reply skips the step as guidance and never runs it on a non-matching slot', async () => fixture(async (filePath) => {
    const { store, service } = build(filePath, () => 1_000);
    const record = await seed(store, [NEEDS_REVIEWER, { id: 'b', dependencies: ['a'] }]);
    await store.dispatchReady(record.id, { enforceRouting: false });
    const blockerId = (await store.get(record.id))!.blockers![0].id;
    const answered = await service.answerBlockerByCoordinator(COORDINATOR(record.id), blockerId, 'skip it, engineers cannot review');
    expect(answered).toMatchObject({ ok: true, pending: false });
    const after = (await store.get(record.id))!;
    expect(after.blockers![0]).toMatchObject({ resolved: true, response: 'skip it, engineers cannot review' });
    expect(after.workUnits!.find((unit) => unit.id === 'a')).toMatchObject({ state: 'FAILED', failureCode: 'NO_QUALIFIED_ROUTE' });
    expect(after.workUnits!.every((unit) => unit.state !== 'CLAIMED')).toBe(true);
    service.dispose();
  }));

  it('maps a lost race on a no-route reply to CONFLICT and any other failure to INVALID', async () => fixture(async (filePath) => {
    const { store, service } = build(filePath, () => 1_000);
    const record = await seed(store, [NEEDS_REVIEWER]);
    await store.dispatchReady(record.id, { enforceRouting: false });
    const blockerId = (await store.get(record.id))!.blockers![0].id;
    const spy = vi.spyOn(store, 'resolveNoRouteBlocker');
    spy.mockRejectedValueOnce(new Error('stale execution state'));
    expect(await service.answerBlockerByCoordinator(COORDINATOR(record.id), blockerId, 'skip')).toMatchObject({ ok: false, code: 'CONFLICT', message: 'stale execution state' });
    spy.mockRejectedValueOnce(new Error('disk full'));
    expect(await service.answerBlockerByCoordinator(COORDINATOR(record.id), blockerId, 'skip')).toMatchObject({ ok: false, code: 'INVALID', message: 'disk full' });
    spy.mockRejectedValueOnce('odd');
    expect(await service.answerBlockerByCoordinator(COORDINATOR(record.id), blockerId, 'skip')).toMatchObject({ ok: false, code: 'INVALID', message: 'odd' });
    service.dispose();
  }));

  it('rejects a second reply, and a no-route resolve on an ordinary blocker', async () => fixture(async (filePath) => {
    const { store, service } = build(filePath, () => 1_000);
    const record = await seed(store, [NEEDS_REVIEWER]);
    await store.dispatchReady(record.id, { enforceRouting: false });
    const blockerId = (await store.get(record.id))!.blockers![0].id;
    await store.resolveNoRouteBlocker(record.id, undefined, blockerId, 'skip');
    await expect(store.resolveNoRouteBlocker(record.id, undefined, blockerId, 'again')).rejects.toThrow('resolved');
    await expect(store.resolveNoRouteBlocker(record.id, undefined, 'missing', 'x')).rejects.toThrow();
    const stale = await service.answerBlockerByCoordinator(COORDINATOR(record.id), blockerId, 'late');
    expect(stale.ok).toBe(false);
    service.dispose();
  }));

  it('a unit blocked by the rule is released by the existing retry path and re-blocks with a fresh id', async () => fixture(async (filePath) => {
    const { store, service } = build(filePath, () => 1_000);
    const record = await seed(store, [NEEDS_REVIEWER]);
    const blocked = (await store.dispatchReady(record.id, { enforceRouting: false })).record;
    const retried = await store.retryWork(record.id, blocked.stateVersion, { role: 'orchestrator', slotId: 'orchestrator:lead' }, 'a');
    expect(retried.blockers![0].resolved).toBe(true);
    expect(retried.workUnits![0].state).toBe('READY');
    const again = await store.dispatchReady(record.id, { enforceRouting: false });
    expect(again.record.blockers).toHaveLength(2);
    expect(new Set(again.record.blockers!.map((blocker) => blocker.id)).size).toBe(2);
    service.dispose();
  }));

  describe('all-UNKNOWN enforced candidates', () => {
    // minimumLevel is a soft fact; the seeded slot has no level, so every candidate is UNKNOWN.
    const NEEDS_LEVEL = { id: 'a', routing: { version: 1 as const, minimumLevel: 'high' as never } };
    const T0 = 1_000;

    it('waits inside the bound, then escalates once with a plain-words question and the unit parks BLOCKED', async () => fixture(async (filePath) => {
      const clock = { t: T0 };
      const { store, service } = build(filePath, () => clock.t);
      const record = await seed(store, [NEEDS_LEVEL]);
      const first = await store.dispatchReady(record.id, { enforceRouting: true });
      expect(first.noRouteBlockerIds).toEqual([]);
      expect(first.record.workUnits![0]).toMatchObject({ state: 'READY', unknownSince: T0 });
      clock.t = T0 + ALL_UNKNOWN_ESCALATE_MS - 1;
      const edge = await store.dispatchReady(record.id, { enforceRouting: true });
      expect(edge.noRouteBlockerIds).toEqual([]);
      expect(edge.record.workUnits![0].unknownSince).toBe(T0);
      clock.t = T0 + ALL_UNKNOWN_ESCALATE_MS;
      const fired = await store.dispatchReady(record.id, { enforceRouting: true });
      expect(fired.noRouteBlockerIds).toHaveLength(1);
      const unit = fired.record.workUnits![0];
      expect(unit).toMatchObject({ state: 'BLOCKED' });
      expect(unit.unknownSince).toBeUndefined();
      expect(fired.record.blockers![0]).toMatchObject({ audience: 'coordinator', noRoute: true, resolved: false, workUnitId: 'a' });
      expect(fired.record.blockers![0].question).toContain('Step a');
      expect(fired.record.blockers![0].question).toContain('worker levels are unknown');
      clock.t += ALL_UNKNOWN_ESCALATE_MS * 5;
      const again = await store.dispatchReady(record.id, { enforceRouting: true });
      expect(again.noRouteBlockerIds).toEqual([]);
      expect(again.record.blockers).toHaveLength(1);
      service.dispose();
    }));

    it('never starts the clock for an advisory (non-enforced) run', async () => fixture(async (filePath) => {
      const clock = { t: T0 };
      const { store, service } = build(filePath, () => clock.t);
      const record = await seed(store, [NEEDS_LEVEL]);
      await store.dispatchReady(record.id, { enforceRouting: false });
      clock.t += ALL_UNKNOWN_ESCALATE_MS * 2;
      const result = await store.dispatchReady(record.id, { enforceRouting: false });
      expect(result.noRouteBlockerIds).toEqual([]);
      expect(result.record.workUnits![0].unknownSince).toBeUndefined();
      service.dispose();
    }));

    it('a reply to the unknown-level blocker fails the step as NO_QUALIFIED_ROUTE', async () => fixture(async (filePath) => {
      const clock = { t: T0 };
      const { store, service } = build(filePath, () => clock.t);
      const record = await seed(store, [NEEDS_LEVEL]);
      await store.dispatchReady(record.id, { enforceRouting: true });
      clock.t += ALL_UNKNOWN_ESCALATE_MS;
      const fired = await store.dispatchReady(record.id, { enforceRouting: true });
      await store.resolveNoRouteBlocker(record.id, undefined, fired.record.blockers![0].id, 'skip');
      expect((await store.get(record.id))!.workUnits![0]).toMatchObject({ state: 'FAILED', failureCode: 'NO_QUALIFIED_ROUTE' });
      service.dispose();
    }));

    it('resets the clock when a candidate becomes known, so a later UNKNOWN spell restarts the wait', async () => fixture(async (filePath) => {
      const clock = { t: T0 };
      const { store, service } = build(filePath, () => clock.t);
      let record = await seed(store, [NEEDS_LEVEL]);
      await store.dispatchReady(record.id, { enforceRouting: true });
      expect((await store.get(record.id))!.workUnits![0].unknownSince).toBe(T0);
      // The slot's level becomes known (fails the requirement is irrelevant: the point is it is no longer UNKNOWN).
      record = await store.replaceResolvedModels(record.id, [{ slotId: 'eng:0', personaId: 'engineer', provider: 'anthropic', model: 'm', label: 'Engineer', level: 'low' as never }]);
      clock.t = T0 + ALL_UNKNOWN_ESCALATE_MS * 3;
      const known = await store.dispatchReady(record.id, { enforceRouting: true });
      expect(known.record.workUnits![0].unknownSince).toBeUndefined();
      service.dispose();
    }));
  });
});
