import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InboxEntry } from '@zana-ai/zcc-domain/product';
import { SquadExecutionService } from '@zana-ai/zcc-server/services/execution/service';
import { createExecutionStore } from '@zana-ai/zcc-server/services/execution/store';
import { createExecutionArtifactStore } from '@zana-ai/zcc-server/services/execution/artifact-store';
import { onOrchestratorIdle, type OrchestratorIdleSession } from '../coordinator-idle.js';
import { PLAN_CORRECTION_STALL_IDLE_EDGES, PlanCorrectionService, runPlanCorrectionHostAction } from '../plan-correction/service.js';
import { INFERRED_PLAN_NUDGE_BUDGET, createInferredPlanCorrection } from '../inferred-plan-correction.js';
import { resolveSquadPlan } from '../team-trigger-semantics.js';
import { PlanCorrectionLaunchBinding } from '../plan-correction/launch-binding.js';
import type { PlanCorrectionRecord } from '../plan-correction/store.js';
import {
  TeamPlanHandoff, authoredPlanRelPath, cleanupHandoffFiles, correctedPlanRelPath, readAuthoredPlan, readCorrectedPlan, readHandoffArtifact
} from '../team-plan-handoff.js';

/**
 * Seam test for the MT-6 Squad plan-correction flow. Everything between the
 * Inbox card and the execution store is REAL (SquadExecutionService on a real
 * execution store, PlanCorrectionService, PlanCorrectionLaunchBinding,
 * TeamPlanHandoff, the real wake queue, the real handoff files on a temp dir,
 * onOrchestratorIdle). Faked seams (no Electron here): the Inbox (collects
 * entries and bound actions), PTY `replyToSession` (records text and drives the
 * scripted FakeCoordinator), agent state (idle edges are driven by calling
 * onOrchestratorIdle), the plan-correction persistence (in-memory Map, same
 * contract as the store) and Team launch/cancel (record calls only).
 */

const EXECUTION_ID = 'execution-1';
const PROJECT_ID = 'project-1';
const COORDINATOR = 'coord-1';

const DEFECTIVE_PLAN = [
  '### write: Write output <!-- executable-step -->',
  '- Mode: Mutating',
  '- Work: Create output.',
  '- Verification: Read output.',
  ''
].join('\n');

const VALID_PLAN = [
  '### write: Write output <!-- executable-step -->',
  '- Mode: Mutating',
  '- Work: Create output.',
  '- Write scope: `output.txt`',
  '- Verification: Read output.',
  ''
].join('\n');

type Script = 'valid' | 'nothing' | 'invalid';

function setup(script: Script) {
  // Infer mode: coordinator-authored plan, no provided plan, so no launch binding.
  const root = mkdtempSync(join(tmpdir(), 'zcc-plan-correction-flow-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'zcc-plan-correction-flow-data-'));
  const inbox: InboxEntry[] = [];
  const bound = new Map<string, { kind: string; ref: string }>();
  const coordinatorTexts: string[] = [];
  const errors: Array<[string, unknown]> = [];
  const nudges: Array<[string, string]> = [];
  const records = new Map<string, PlanCorrectionRecord>();
  let coordinatorState: 'idle' | 'working' = 'idle';
  const launches: unknown[] = [];

  const writeArtifact = (rel: string, text: string) => {
    mkdirSync(join(root, '.zana'), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  // FakeCoordinator: reacts to delivered correction text, like the model would.
  const coordinatorReceives = (text: string) => {
    coordinatorTexts.push(text);
    if (!text.includes('The supplied execution plan was rejected')) return;
    if (script === 'valid') writeArtifact(correctedPlanRelPath(EXECUTION_ID), VALID_PLAN);
    if (script === 'invalid') writeArtifact(correctedPlanRelPath(EXECUTION_ID), '### broken <!-- executable-step -->\n- Work: nope\n');
  };

  const store = createExecutionStore({ filePath: join(dataDir, 'executions.json'), id: () => EXECUTION_ID });
  const launchBinding = new PlanCorrectionLaunchBinding();
  const stopForPlanCorrection = vi.fn();
  const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: [COORDINATOR], pendingSessionIds: [] } }));
  const launchTeam = vi.fn(async (_teamId: string, _projectId: string, request: { launchRequestId: string; executionId?: string }) => {
    launches.push(request);
    // Mirrors host launch: bind the durable execution id before any coordinator can hand off.
    await launchBinding.bindExecution(request.launchRequestId, request.executionId!, correction);
    return { ok: true };
  });
  const replyToSession = vi.fn((sessionId: string, text: string) => {
    if (sessionId === COORDINATOR) coordinatorReceives(text);
    return true;
  });
  const squad = new SquadExecutionService({
    store,
    artifacts: createExecutionArtifactStore({ filePath: join(dataDir, 'artifacts.json'), id: () => 'artifact-1' }),
    authorizeTeamLaunch: () => ({ ok: true as const, value: {
      teamId: 'team-1', projectId: PROJECT_ID, slots: [],
      context: { version: 1 as const, principalId: 'owner', authorizedAt: 10, expiresAt: 20, slots: [] }
    } }),
    launchTeam,
    getTeamLaunch: async () => ({
      orchestratorSessionId: COORDINATOR,
      workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: PROJECT_ID, task: 'unknown' }]
    }),
    cancelTeamLaunch,
    replyToSession,
    getAgentState: (sessionId: string) => (sessionId === COORDINATOR ? coordinatorState : 'idle') as never,
    resolveExactNativeRecoverySnapshots: () => [],
    logError: (message, error) => errors.push([message, error]),
    authorizePlanRegistration: (record, units) => correction.authorizeRegistration(record.id, units)
  } as never);
  const originalStop = squad.stopForPlanCorrection.bind(squad);
  vi.spyOn(squad, 'stopForPlanCorrection').mockImplementation(async (id: string) => {
    stopForPlanCorrection(id);
    return originalStop(id);
  });

  const updateScheduledPrompt = vi.fn(async () => {});
  const correction: PlanCorrectionService = new PlanCorrectionService({
    appendInbox: async (input) => {
      const entry = { ...input, id: `inbox-${inbox.length + 1}`, ts: inbox.length + 1 } as InboxEntry;
      inbox.push(entry);
      return entry;
    },
    bindInboxAction: (entry, action) => { bound.set(entry.id, action); return true; },
    nudge: (sessionId, text) => { nudges.push([sessionId, text]); },
    wakeCoordinator: (executionId, text) => squad.wakeCoordinatorForPlanCorrection(executionId, text),
    readSourcePlan: async () => DEFECTIVE_PLAN,
    readCorrectedPlan,
    store: {
      get: async (id) => records.get(id),
      put: async (record) => {
        const existing = records.get(record.executionId);
        // Same contract as the durable store: cancellation is final.
        if (existing?.status === 'cancelled' && record.status !== 'cancelled') return existing;
        records.set(record.executionId, structuredClone(record));
        return record;
      }
    },
    updateScheduledPrompt,
    resume: async (ctx) => { await handoff.onCoordinatorIdle(ctx); },
    stopExecution: async (executionId) => { await squad.stopForPlanCorrection(executionId); }
  });

  const inferred = createInferredPlanCorrection({
    reviewInvalid: (ctx, reason) => correction.reviewInvalid(ctx, reason),
    begin: (executionId, reason, unattended) => correction.begin(executionId, reason, unattended)
  });
  const handoff: TeamPlanHandoff = new TeamPlanHandoff({
    isPlanless: async (projectId, executionId) => ((await store.getInProject(projectId, executionId))?.workUnits?.length ?? 0) === 0,
    readAuthoredPlan: async (projectRoot, executionId) => await correction.approvedPlan(executionId) ?? readAuthoredPlan(projectRoot, executionId),
    review: (ctx, read) => correction.review(ctx, read),
    reviewInvalid: (ctx, reason) => inferred.reviewInvalid(ctx, reason),
    maxNudges: INFERRED_PLAN_NUDGE_BUDGET,
    register: async (ctx, units) => {
      const result = await squad.registerPlan(
        { role: 'orchestrator', slotId: ctx.slotId, executionId: ctx.executionId, projectId: ctx.projectId, principalId: ctx.sessionId },
        units
      );
      return result.ok ? { ok: true } : { ok: false, message: result.message };
    },
    nudge: (sessionId, text) => { nudges.push([sessionId, text]); },
    cleanup: (projectRoot, executionId) => cleanupHandoffFiles(projectRoot, executionId),
    logError: (message, error) => errors.push([message, error])
  });

  const session: OrchestratorIdleSession = { projectId: PROJECT_ID, cohort: { executionId: EXECUTION_ID, slotId: 'orchestrator', role: 'orchestrator' } };
  const idleDeps = {
    drainCoordinatorWake: (projectId: string, executionId: string, sessionId: string) => squad.drainCoordinatorWake(projectId, executionId, sessionId),
    getExecution: (projectId: string, executionId: string) => store.getInProject(projectId, executionId),
    projectPath: (projectId: string) => (projectId === PROJECT_ID ? root : undefined),
    onCoordinatorIdle: (ctx: Parameters<TeamPlanHandoff['onCoordinatorIdle']>[0]) => handoff.onCoordinatorIdle(ctx),
    logError: (context: string, error: unknown) => errors.push([context, error])
  };
  /** One coordinator idle edge; awaits both fire-and-forget branches. */
  const idleEdge = async () => {
    const pending = onOrchestratorIdle(idleDeps, COORDINATOR, session);
    await pending?.wake;
    await pending?.handoff;
  };

  /** Launch a structured Squad whose supplied plan is defective (host: beginLaunch then start). */
  const launchParked = async (reason = 'mutating work unit requires file scope', objective = DEFECTIVE_PLAN) => {
    launchBinding.beginLaunch('launch-request-1', reason);
    const started = await squad.start('owner', PROJECT_ID, {
      version: 1, teamId: 'team-1', launchRequestId: 'launch-request-1', summary: 'MT-6', objective,
      coordinationMode: 'structured', slots: [{ initialTask: 'hold' }]
    } as never);
    if (!started.ok) throw new Error(started.message);
    writeArtifact(authoredPlanRelPath(EXECUTION_ID), objective);
    return started.value;
  };
  /** Launch a freeform (infer) Squad whose coordinator then authors an invalid plan. */
  const launchInferred = async () => {
    const started = await squad.start('owner', PROJECT_ID, {
      version: 1, teamId: 'team-1', launchRequestId: 'launch-request-1', summary: 'infer', objective: 'Ship the fix.',
      coordinationMode: 'freeform', slots: [{ initialTask: 'plan' }]
    } as never);
    if (!started.ok) throw new Error(started.message);
    writeArtifact(authoredPlanRelPath(EXECUTION_ID), DEFECTIVE_PLAN);
    return started.value;
  };
  const respond = (card: number, optionId: string) => {
    const action = bound.get(inbox[card]!.id)!;
    return runPlanCorrectionHostAction(correction, action.ref, optionId);
  };
  const optionIds = (card: number) => inbox[card]!.questions![0]!.options.map((option) => option.id);
  const workUnits = async () => (await store.getInProject(PROJECT_ID, EXECUTION_ID))?.workUnits ?? [];

  return {
    root, dataDir, inbox, bound, coordinatorTexts, errors, nudges, records, launches, launchTeam, replyToSession, stopForPlanCorrection,
    updateScheduledPrompt, correction, squad, store, idleEdge, launchParked, launchInferred, respond, optionIds, workUnits,
    setState: (state: 'idle' | 'working') => { coordinatorState = state; }
  };
}

describe('Squad plan-correction flow (real service, wake queue, handoff and execution store)', () => {
  let ctx: ReturnType<typeof setup>;
  afterEach(() => {
    rmSync(ctx.root, { recursive: true, force: true });
    rmSync(ctx.dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });
  /** Never launches a fallback agent: exactly the one Team launch, and nothing nudged outside the coordinator. */
  const expectNoFallbackLaunch = () => {
    expect(ctx.launchTeam).toHaveBeenCalledTimes(1);
    expect(ctx.replyToSession.mock.calls.every(([sessionId]) => sessionId === COORDINATOR)).toBe(true);
    expect(ctx.errors).toEqual([]);
  };

  describe('valid correction', () => {
    beforeEach(() => { ctx = setup('valid'); });

    it('parks with no work, asks for changes, wakes the coordinator, offers the corrected plan and registers it on approve', async () => {
      await ctx.launchParked();
      expect(await ctx.workUnits()).toHaveLength(0);

      // First idle edge: parked run, defective supplied plan -> first card without a digest.
      await ctx.idleEdge();
      expect(ctx.inbox).toHaveLength(1);
      expect(ctx.optionIds(0)).toEqual(['changes', 'cancel']);
      expect(ctx.inbox[0]!.comments).toContain('No valid revised plan is ready to review');
      expect(JSON.parse(ctx.bound.get('inbox-1')!.ref)).toMatchObject({ executionId: EXECUTION_ID, digest: '' });
      expect(await ctx.workUnits()).toHaveLength(0);

      // Request changes -> real wake queue delivers the rejection reason + source plan to the coordinator.
      await expect(ctx.respond(0, 'changes')).resolves.toBeUndefined();
      expect(ctx.coordinatorTexts).toHaveLength(1);
      expect(ctx.coordinatorTexts[0]).toContain('mutating work unit requires file scope');
      expect(ctx.coordinatorTexts[0]).toContain(DEFECTIVE_PLAN.trim());
      expect(ctx.coordinatorTexts[0]).toContain(correctedPlanRelPath(EXECUTION_ID));
      expect((await ctx.store.get(EXECUTION_ID))?.coordinatorWakes ?? []).toHaveLength(0);

      // Coordinator wrote the corrected plan and went idle -> second card with Approve.
      await ctx.idleEdge();
      expect(ctx.inbox).toHaveLength(2);
      expect(ctx.optionIds(1)).toEqual(['approve', 'changes', 'cancel']);
      expect(ctx.inbox[1]!.comments).toContain('Proposed plan: 1 step');
      expect(await ctx.workUnits()).toHaveLength(0);

      // Approve -> schedule persisted, resume re-enters the handoff, plan registered.
      await ctx.respond(1, 'approve');
      expect(ctx.updateScheduledPrompt).toHaveBeenCalledWith(
        expect.objectContaining({ executionId: EXECUTION_ID }),
        [expect.objectContaining({ id: 'write', files: ['output.txt'] })]
      );
      const units = await ctx.workUnits();
      expect(units.map((unit) => unit.id)).toEqual(['write']);
      expect(await readHandoffArtifact(ctx.root, correctedPlanRelPath(EXECUTION_ID))).toBeUndefined(); // cleaned up after register
      expect(ctx.stopForPlanCorrection).not.toHaveBeenCalled();
      expectNoFallbackLaunch();
    });

    it('holds the wake while the coordinator is working and delivers it only after idle', async () => {
      await ctx.launchParked();
      await ctx.idleEdge();
      ctx.setState('working');

      await ctx.respond(0, 'changes');
      expect(ctx.coordinatorTexts).toHaveLength(0);
      expect((await ctx.store.get(EXECUTION_ID))?.coordinatorWakes).toHaveLength(1);

      // Still working: an idle-edge retry must not deliver either.
      await ctx.idleEdge();
      expect(ctx.coordinatorTexts).toHaveLength(0);

      ctx.setState('idle');
      await ctx.idleEdge();
      expect(ctx.coordinatorTexts).toHaveLength(1);
      expect(ctx.coordinatorTexts[0]).toContain('mutating work unit requires file scope');
      expect((await ctx.store.get(EXECUTION_ID))?.coordinatorWakes ?? []).toHaveLength(0);
      expectNoFallbackLaunch();
    });

    it('Cancel is terminal: stops the execution and never registers work', async () => {
      await ctx.launchParked();
      await ctx.idleEdge();
      await ctx.respond(0, 'cancel');

      expect(ctx.stopForPlanCorrection).toHaveBeenCalledWith(EXECUTION_ID);
      expect(await ctx.store.get(EXECUTION_ID)).toMatchObject({ state: 'STOPPED', timeoutReason: 'plan-correction-cancelled' });
      // Even a valid corrected plan on disk cannot revive the run.
      mkdirSync(join(ctx.root, '.zana'), { recursive: true });
      writeFileSync(join(ctx.root, correctedPlanRelPath(EXECUTION_ID)), VALID_PLAN);
      await ctx.idleEdge();
      expect(await ctx.workUnits()).toHaveLength(0);
      expect(ctx.inbox).toHaveLength(1);
      expect(ctx.coordinatorTexts).toHaveLength(0);
      expectNoFallbackLaunch();
    });
  });

  describe('interactive provided plan that is prose', () => {
    beforeEach(() => { ctx = setup('valid'); });

    it('resolves to a planError, parks with no work, and raises the correction card', async () => {
      const prose = 'Please tidy up the logging module and add tests.';
      const resolved = resolveSquadPlan('provided', [prose]);
      expect(resolved.workUnits).toBeUndefined();
      expect(resolved.planError).toBe('no executable steps found');
      // Host: begin the launch binding with the resolver's error, then start the structured Squad.
      await ctx.launchParked(resolved.planError, prose);
      expect(await ctx.workUnits()).toHaveLength(0);

      await ctx.idleEdge();
      expect(ctx.inbox).toHaveLength(1);
      expect(ctx.optionIds(0)).toEqual(['changes', 'cancel']);
      expect(ctx.inbox[0]!.decisionGuidance).toMatchObject({ kind: 'plan-correction', diagnostic: 'no executable steps found' });
      expectNoFallbackLaunch();
    });
  });

  describe('infer: coordinator-authored plan stays invalid', () => {
    beforeEach(() => { ctx = setup('valid'); });

    it('nudges within budget, then parks into the same Inbox correction flow instead of failing', async () => {
      await ctx.launchInferred();
      for (let edge = 0; edge < INFERRED_PLAN_NUDGE_BUDGET; edge += 1) await ctx.idleEdge();
      expect(ctx.inbox).toHaveLength(0);
      expect(ctx.nudges).toHaveLength(INFERRED_PLAN_NUDGE_BUDGET);

      await ctx.idleEdge();
      expect(ctx.inbox).toHaveLength(1);
      expect(ctx.optionIds(0)).toEqual(['changes', 'cancel']);
      expect(await ctx.workUnits()).toHaveLength(0);

      // Request changes -> coordinator writes a valid plan -> Approve registers it.
      await ctx.respond(0, 'changes');
      await ctx.idleEdge();
      expect(ctx.optionIds(1)).toEqual(['approve', 'changes', 'cancel']);
      await ctx.respond(1, 'approve');
      expect((await ctx.workUnits()).map((unit) => unit.id)).toEqual(['write']);
      expectNoFallbackLaunch();
    });
  });

  describe('coordinator writes nothing', () => {
    beforeEach(() => { ctx = setup('nothing'); });

    it(`stays quiet until ${PLAN_CORRECTION_STALL_IDLE_EDGES} idle edges, then publishes a stalled card`, async () => {
      await ctx.launchParked();
      await ctx.idleEdge();
      await ctx.respond(0, 'changes');
      expect(ctx.coordinatorTexts).toHaveLength(1);
      expect(ctx.inbox).toHaveLength(1);

      for (let edge = 1; edge < PLAN_CORRECTION_STALL_IDLE_EDGES; edge += 1) {
        await ctx.idleEdge();
        expect(ctx.inbox).toHaveLength(1); // no empty duplicate card yet
      }
      await ctx.idleEdge();
      expect(ctx.inbox).toHaveLength(2);
      expect(ctx.inbox[1]!.comments).toContain('finished its turn without writing a corrected plan');
      expect(ctx.optionIds(1)).toEqual(['changes', 'cancel']);
      expect(await ctx.workUnits()).toHaveLength(0);
      expectNoFallbackLaunch();
    });
  });

  describe('coordinator writes an invalid plan', () => {
    beforeEach(() => { ctx = setup('invalid'); });

    it('does not offer approval or register work', async () => {
      await ctx.launchParked();
      await ctx.idleEdge();
      await ctx.respond(0, 'changes');
      expect(ctx.coordinatorTexts).toHaveLength(1);

      await ctx.idleEdge();
      expect(await ctx.workUnits()).toHaveLength(0);
      expect(ctx.inbox.every((entry) => !entry.questions![0]!.options.some((option) => option.id === 'approve'))).toBe(true);
      expect(ctx.updateScheduledPrompt).not.toHaveBeenCalled();
      expectNoFallbackLaunch();
    });
  });
});
