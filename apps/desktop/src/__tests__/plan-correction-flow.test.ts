import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InboxEntry } from '@zana-ai/zcc-domain/product';
import { launchDigest } from '@zana-ai/zcc-server/services/launch/digest';
import { SquadExecutionService } from '@zana-ai/zcc-server/services/execution/service';
import { createExecutionStore } from '@zana-ai/zcc-server/services/execution/store';
import { createExecutionArtifactStore } from '@zana-ai/zcc-server/services/execution/artifact-store';
import { onOrchestratorIdle, type OrchestratorIdleSession } from '../coordinator-idle.js';
import {
  PLAN_CORRECTION_HELD_MESSAGE, PLAN_CORRECTION_MAX_RETRIES, PLAN_CORRECTION_STALL_IDLE_EDGES, PlanCorrectionService, runPlanCorrectionHostAction
} from '../plan-correction/service.js';
import { INFERRED_PLAN_NUDGE_BUDGET, createInferredPlanCorrection } from '../inferred-plan-correction.js';
import { resolveSquadPlan } from '../team-trigger-semantics.js';
import { PlanCorrectionLaunchBinding } from '../plan-correction/launch-binding.js';
import { planCorrectionSubmitter } from '../plan-correction/wiring.js';
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

type Script = 'valid' | 'nothing' | 'invalid' | 'recoverable' | 'fixes-after-feedback';

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
    if (script === 'fixes-after-feedback' && text.includes('is still invalid:')) {
      writeArtifact(correctedPlanRelPath(EXECUTION_ID), VALID_PLAN);
      return;
    }
    if (!text.includes('The supplied execution plan was rejected')) return;
    if (script === 'valid') writeArtifact(correctedPlanRelPath(EXECUTION_ID), VALID_PLAN);
    if (script === 'recoverable') writeArtifact(correctedPlanRelPath(EXECUTION_ID), VALID_PLAN.replace('### write:', '### U1:'));
    if (script === 'invalid' || script === 'fixes-after-feedback') writeArtifact(correctedPlanRelPath(EXECUTION_ID), '### broken <!-- executable-step -->\n- Work: nope\n');
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
    // Same wiring as host.ts: a bound coordinator submission may become the correction candidate.
    authorizePlanRegistration: (record, units, submitter) => correction.authorizeRegistration(
      record.id, units, planCorrectionSubmitter(record, submitter, (projectId) => (projectId === PROJECT_ID ? root : undefined))
    )
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
    reviewInvalid: (ctx) => correction.reviewInvalid(ctx),
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
      expect(ctx.inbox[0]!.comments).toContain('Plan requires revisions to proceed');
      expect(ctx.inbox[0]!.comments).toContain('Problem with the supplied plan: mutating work unit requires file scope');
      expect(ctx.inbox[0]!.comments).not.toContain('no plan file found');
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
      expect(ctx.inbox[1]!.comments).toContain('Proposed corrected plan: 1 step');
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

  describe('Modern coordinator: execution.plan.register is the correction offer trigger', () => {
    beforeEach(() => { ctx = setup('nothing'); });
    const coordinatorBinding = { role: 'orchestrator' as const, slotId: 'orchestrator', executionId: EXECUTION_ID, projectId: PROJECT_ID, principalId: COORDINATOR };
    const unit = (task: string) => [{ id: 'write', title: 'Write output', task, dependencies: [], files: ['output.txt'], verification: ['Read output.'] }];

    it('holds the refused register as one review card, requests changes, and registers only the approved digest', async () => {
      await ctx.launchParked();
      // No PTY idle edge on Modern. The coordinator's own register is the trigger.
      const first = await ctx.squad.registerPlan(coordinatorBinding, unit('Create output.'));
      expect(first).toMatchObject({ ok: false, message: expect.stringContaining(PLAN_CORRECTION_HELD_MESSAGE) });
      expect(await ctx.workUnits()).toHaveLength(0);
      expect(ctx.inbox).toHaveLength(1);
      expect(ctx.optionIds(0)).toEqual(['approve', 'changes', 'cancel']);
      expect(ctx.inbox[0]!.comments).toContain('Problem with the supplied plan: mutating work unit requires file scope');
      expect(ctx.inbox[0]!.comments).toContain('Proposed corrected plan: 1 step');
      // The candidate is a captured submission: no corrected-file paths on the card.
      expect(ctx.inbox[0]!.decisionGuidance).not.toHaveProperty('correctedPlanPath');
      expect(JSON.parse(ctx.bound.get('inbox-1')!.ref)).toMatchObject({ digest: launchDigest(unit('Create output.')) });

      // A duplicate (or different) register while the offer is open adds no card and keeps the offer.
      const duplicate = await ctx.squad.registerPlan(coordinatorBinding, unit('Something else.'));
      expect(duplicate).toMatchObject({ ok: false, message: expect.stringContaining(PLAN_CORRECTION_HELD_MESSAGE) });
      expect(ctx.inbox).toHaveLength(1);
      expect(ctx.records.get(EXECUTION_ID)?.offeredDigest).toBe(launchDigest(unit('Create output.')));
      // An inadmissible submission is refused by admission and never becomes a candidate.
      const inadmissible = await ctx.squad.registerPlan(coordinatorBinding, [{ id: 'write', title: 'Write output', task: 'x', dependencies: [], files: ['output.txt'] }]);
      expect(inadmissible).toMatchObject({ ok: false, message: expect.stringContaining('verification') });
      expect(ctx.inbox).toHaveLength(1);

      // Request changes wakes the coordinator with the register-channel instruction.
      await ctx.respond(0, 'changes');
      expect(ctx.coordinatorTexts).toHaveLength(1);
      expect(ctx.coordinatorTexts[0]).toContain('execution.plan.register');
      expect(ctx.coordinatorTexts[0]).not.toContain(correctedPlanRelPath(EXECUTION_ID));
      // The consumed first offer can no longer be approved.
      await expect(ctx.respond(0, 'approve')).rejects.toThrow(/rejected or superseded/);

      const revised = unit('Create output with a header.');
      await ctx.squad.registerPlan(coordinatorBinding, revised);
      expect(ctx.inbox).toHaveLength(2);
      expect(ctx.optionIds(1)).toEqual(['approve', 'changes', 'cancel']);
      expect(await ctx.workUnits()).toHaveLength(0);

      // Approve: no corrected file exists, the captured snapshot is registered host-side.
      await ctx.respond(1, 'approve');
      expect((await ctx.workUnits()).map((u) => [u.id, u.task])).toEqual([['write', 'Create output with a header.']]);
      expect(ctx.updateScheduledPrompt).toHaveBeenCalledWith(expect.objectContaining({ sessionId: COORDINATOR }), revised);
      // The coordinator's own register of the approved digest is authorized; another digest is not.
      await expect(ctx.correction.authorizeRegistration(EXECUTION_ID, revised)).resolves.toEqual({ ok: true });
      await expect(ctx.correction.authorizeRegistration(EXECUTION_ID, unit('Create output.'))).resolves.toMatchObject({ ok: false });
      expect(ctx.stopForPlanCorrection).not.toHaveBeenCalled();
      expectNoFallbackLaunch();
    });

    it('Cancel on the held offer stops the run; a later register stays refused without a new card', async () => {
      await ctx.launchParked();
      await ctx.squad.registerPlan(coordinatorBinding, unit('Create output.'));
      await ctx.respond(0, 'cancel');
      expect(ctx.stopForPlanCorrection).toHaveBeenCalledWith(EXECUTION_ID);
      const after = await ctx.squad.registerPlan(coordinatorBinding, unit('Create output.'));
      expect(after.ok).toBe(false);
      expect(ctx.inbox).toHaveLength(1);
      expect(await ctx.workUnits()).toHaveLength(0);
    });

    it('an unattended (retries exhausted) correction never publishes a card', async () => {
      await ctx.launchParked();
      await ctx.correction.begin(EXECUTION_ID, 'mutating work unit requires file scope', true);
      const held = await ctx.squad.registerPlan(coordinatorBinding, unit('Create output.'));
      expect(held).toMatchObject({ ok: false, message: expect.stringContaining('plan correction approval is pending') });
      expect(ctx.inbox).toHaveLength(0);
      expect(ctx.records.get(EXECUTION_ID)?.retries).toBe(PLAN_CORRECTION_MAX_RETRIES);
    });
  });

  describe('substantive vs recoverable provided plans', () => {
    beforeEach(() => { ctx = setup('valid'); });

    it('a provided plan missing Work still yields a planError and the unchanged gate card', async () => {
      const missingWork = '### write: Write output <!-- executable-step -->\n- Mode: Mutating\n- Verification: Read output.\n';
      const resolved = resolveSquadPlan('provided', [missingWork]);
      expect(resolved.coordinationMode).toBe('freeform');
      expect(resolved.workUnits).toBeUndefined();
      expect(resolved.planError).toContain('missing Work');
      expect(resolved).not.toHaveProperty('normalizations');

      await ctx.launchParked(resolved.planError, missingWork);
      await ctx.idleEdge();
      expect(ctx.inbox).toHaveLength(1);
      expect(ctx.optionIds(0)).toEqual(['changes', 'cancel']);
      expect(ctx.inbox[0]!.decisionGuidance).toMatchObject({ kind: 'plan-correction', diagnostic: resolved.planError });
      expect(await ctx.workUnits()).toHaveLength(0);
    });

    it('a recoverable-only provided plan yields structured units, no planError, and no correction card', async () => {
      const recoverable = VALID_PLAN.replace('### write:', '### U1:');
      const resolved = resolveSquadPlan('provided', [recoverable]);
      expect(resolved.planError).toBeUndefined();
      expect(resolved.coordinationMode).toBe('structured');
      expect(resolved.workUnits?.map((unit) => unit.id)).toEqual(['u1']);
      expect(resolved.normalizations).toEqual(['step "U1" id normalized to "u1"']);

      // Host does not begin the launch binding without a planError; start with the registered units.
      const started = await ctx.squad.start('owner', PROJECT_ID, {
        version: 1, teamId: 'team-1', launchRequestId: 'launch-request-1', summary: 'recoverable', objective: recoverable,
        coordinationMode: 'structured', slots: [{ initialTask: 'go' }], workUnits: resolved.workUnits
      } as never);
      expect(started.ok).toBe(true);
      expect((await ctx.workUnits()).map((unit) => unit.id)).toEqual(['u1']);
      await ctx.idleEdge();
      expect(ctx.inbox).toHaveLength(0);
    });
  });

  describe('corrected plan that needs automatic normalization', () => {
    beforeEach(() => { ctx = setup('recoverable'); });

    it('stays gated, lists the repair on the offer, and approves the exact normalized digest', async () => {
      await ctx.launchParked();
      await ctx.idleEdge();
      await ctx.respond(0, 'changes');
      await ctx.idleEdge();

      expect(ctx.inbox).toHaveLength(2);
      expect(ctx.inbox[1]!.hostActionRequired).toBe(true);
      expect(ctx.optionIds(1)).toEqual(['approve', 'changes', 'cancel']);
      expect(ctx.inbox[1]!.comments).toContain('Automatically normalized');
      expect(ctx.inbox[1]!.comments).toContain('step "U1" id normalized to "u1"');
      expect(await ctx.workUnits()).toHaveLength(0);

      const parsed = await readCorrectedPlan(ctx.root, EXECUTION_ID);
      if (parsed.status !== 'ok') throw new Error('expected an ok corrected plan');
      const offer = JSON.parse(ctx.bound.get('inbox-2')!.ref) as { digest: string };
      expect(offer.digest).toBe(launchDigest(parsed.units));
      expect(ctx.records.get(EXECUTION_ID)?.offeredDigest).toBe(launchDigest(parsed.units));

      await ctx.respond(1, 'approve');
      expect((await ctx.workUnits()).map((unit) => unit.id)).toEqual(['u1']);
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

    it('feeds the parser reason back to the coordinator, then escalates with it instead of "no plan written"', async () => {
      await ctx.launchParked();
      await ctx.idleEdge();
      await ctx.respond(0, 'changes');

      await ctx.idleEdge();
      expect(ctx.inbox).toHaveLength(1);
      // The wake queue delivers the feedback on the same idle edge it was queued.
      await ctx.idleEdge();
      const feedback = ctx.coordinatorTexts.find((text) => text.includes('is still invalid:'));
      expect(feedback).toContain(correctedPlanRelPath(EXECUTION_ID));
      expect(ctx.inbox).toHaveLength(2);
      expect(ctx.inbox[1]!.comments).toContain("The coordinator's corrected plan is still invalid:");
      expect(ctx.inbox[1]!.comments).not.toContain('without writing a corrected plan');
      expect(ctx.optionIds(1)).toEqual(['changes', 'cancel']);
      expect(await ctx.workUnits()).toHaveLength(0);
      expectNoFallbackLaunch();
    });
  });

  describe('coordinator fixes its invalid corrected plan after feedback', () => {
    beforeEach(() => { ctx = setup('fixes-after-feedback'); });

    it('offers the fixed plan for approval and registers it on approve', async () => {
      await ctx.launchParked();
      await ctx.idleEdge();
      await ctx.respond(0, 'changes');
      // Edge 1: corrected file is invalid -> feedback queued (no new card).
      await ctx.idleEdge();
      expect(ctx.inbox).toHaveLength(1);
      // Edge 2: feedback delivered; the coordinator rewrites the file.
      await ctx.idleEdge();
      // Edge 3 (if needed): the host rereads the fixed file and offers it.
      if (!ctx.inbox.some((entry) => entry.questions![0]!.options.some((option) => option.id === 'approve'))) await ctx.idleEdge();
      const offer = ctx.inbox.findIndex((entry) => entry.questions![0]!.options.some((option) => option.id === 'approve'));
      expect(offer).toBeGreaterThan(0);
      expect(ctx.inbox[offer]!.comments).not.toContain('still invalid');
      await ctx.respond(offer, 'approve');
      expect((await ctx.workUnits()).length).toBeGreaterThan(0);
      expectNoFallbackLaunch();
    });
  });
});
