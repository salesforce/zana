import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  ctorDeps: undefined as any,
  runAction: vi.fn(async () => undefined),
  updateScheduled: vi.fn(async () => undefined),
  readAuthoredPlan: vi.fn(async () => 'authored' as any),
  readHandoffArtifact: vi.fn(async () => 'artifact'),
  createStore: vi.fn((opts: any) => ({ opts })),
  createInferred: vi.fn()
}));

vi.mock('../plan-correction/service.js', () => ({
  PLAN_CORRECTION_ACTION: 'plan-correction',
  PlanCorrectionService: class { constructor(d: unknown) { m.ctorDeps = d; } },
  runPlanCorrectionHostAction: m.runAction
}));
vi.mock('../plan-correction/store.js', () => ({ createPlanCorrectionStore: m.createStore }));
vi.mock('../scheduled-plan-correction.js', () => ({ updateScheduledPromptFromCorrection: m.updateScheduled }));
vi.mock('../team-plan-handoff.js', () => ({
  correctedPlanRelPath: (id: string) => `.zana/${id}-corrected.md`,
  readAuthoredPlan: m.readAuthoredPlan,
  readCorrectedPlan: vi.fn(),
  readHandoffArtifact: m.readHandoffArtifact
}));
vi.mock('../inferred-plan-correction.js', () => ({
  INFERRED_PLAN_NUDGE_BUDGET: 7,
  createInferredPlanCorrection: m.createInferred
}));

import { createPlanCorrectionHandoff, createPlanCorrectionHost } from '../plan-correction/host.js';
import { PlanCorrectionLaunchBinding } from '../plan-correction/launch-binding.js';

function deps(over: any = {}) {
  return {
    userDataDir: '/ud',
    database: undefined,
    inboxStore: { appendOnce: vi.fn(async (i: any) => ({ id: 'i', ...i })) },
    inboxActionRegistry: { bind: vi.fn(() => true), register: vi.fn() },
    nudge: vi.fn(),
    wakeCoordinator: vi.fn(async () => undefined),
    stopExecution: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    executionStore: {
      get: vi.fn(async (): Promise<any> => ({ state: 'RUNNING', request: { objective: 'obj' } })),
      getInProject: vi.fn(async () => ({ id: 'e' }))
    },
    scheduler: { get: vi.fn(() => ({ id: 's' })), update: vi.fn() },
    goals: { list: vi.fn(() => [{ id: 'g1' }]), update: vi.fn() },
    logError: vi.fn(),
    ...over
  } as any;
}

describe('createPlanCorrectionHost', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('wires service deps, launch binding, and registers the host action', async () => {
    const d = deps();
    const host = createPlanCorrectionHost(d);
    expect(host.launchBinding).toBeInstanceOf(PlanCorrectionLaunchBinding);
    const c = m.ctorDeps;

    await c.appendInbox({ subject: 's' });
    expect(d.inboxStore.appendOnce).toHaveBeenCalledWith({ subject: 's' });
    expect(c.bindInboxAction({ id: 'i' }, { kind: 'k', ref: 'r' })).toBe(true);
    expect(d.inboxActionRegistry.bind).toHaveBeenCalledWith({ id: 'i' }, { kind: 'k', ref: 'r' });
    c.nudge('sess', 'txt');
    expect(d.nudge).toHaveBeenCalledWith('sess', 'txt');
    await c.wakeCoordinator('e', 'wake');
    expect(d.wakeCoordinator).toHaveBeenCalledWith('e', 'wake', undefined);
    await expect(c.readSourcePlan('e')).resolves.toBe('obj');
    d.executionStore.get.mockResolvedValueOnce(undefined);
    await expect(c.readSourcePlan('e')).resolves.toBeUndefined();
    await c.resume({ executionId: 'e' });
    expect(d.resume).toHaveBeenCalledWith({ executionId: 'e' });
    await c.stopExecution('e');
    expect(d.stopExecution).toHaveBeenCalledWith('e');
    expect(c.logWarning).toBeTypeOf('function');
    c.logWarning('e', 'msg', 'err');
    expect(d.logError).toHaveBeenCalledWith('planCorrection:e: msg', 'err');
  });

  it('wires the correction trace sink to the info log only when logInfo is provided', () => {
    createPlanCorrectionHost(deps());
    expect(m.ctorDeps.trace).toBeUndefined();
    const logInfo = vi.fn();
    createPlanCorrectionHost(deps({ logInfo }));
    const event = { executionId: 'e', sessionId: 's', slotId: 'o', stage: 'review', status: 'invalid', reason: 'r', match: false };
    m.ctorDeps.trace(event);
    expect(logInfo).toHaveBeenCalledWith('squad plan correction trace review', JSON.stringify(event));
  });

  it('configures the store with filePath, database and retired check', async () => {
    const d = deps();
    createPlanCorrectionHost(d);
    const opts = m.createStore.mock.calls[0][0] as any;
    expect(opts.filePath).toBe('/ud/plan-corrections.json');
    expect(opts.database).toBeUndefined();
    d.executionStore.get.mockResolvedValueOnce(undefined);
    await expect(opts.isExecutionRetired('e')).resolves.toBe(true);
    d.executionStore.get.mockResolvedValueOnce({ state: 'RUNNING' });
    await expect(opts.isExecutionRetired('e')).resolves.toBe(false);
  });

  it('updateScheduledPrompt delegates with wired getters/setters', async () => {
    const d = deps();
    createPlanCorrectionHost(d);
    const ctx = { executionId: 'e' };
    await m.ctorDeps.updateScheduledPrompt(ctx, ['u']);
    const [pd, pctx, punits] = m.updateScheduled.mock.calls[0] as any[];
    expect(pctx).toBe(ctx);
    expect(punits).toEqual(['u']);
    await pd.getExecution('p', 'e');
    expect(d.executionStore.getInProject).toHaveBeenCalledWith('p', 'e');
    pd.getSchedule('s');
    expect(d.scheduler.get).toHaveBeenCalledWith('s');
    await expect(pd.readCorrectedPlanText('/root', 'e')).resolves.toBe('artifact');
    expect(m.readHandoffArtifact).toHaveBeenCalledWith('/root', '.zana/e-corrected.md');
    pd.updateSchedule('s', { a: 1 });
    expect(d.scheduler.update).toHaveBeenCalledWith('s', { a: 1 });
    expect(pd.getGoal('g1')).toEqual({ id: 'g1' });
    expect(() => pd.getGoal('nope')).toThrow('goal not found: nope');
    pd.updateGoal('g1', { b: 2 });
    expect(d.goals.update).toHaveBeenCalledWith('g1', { b: 2 });
  });

  it('registers action handler that delegates to runPlanCorrectionHostAction', async () => {
    const d = deps();
    const host = createPlanCorrectionHost(d);
    const [kind, handler] = d.inboxActionRegistry.register.mock.calls[0];
    expect(kind).toBe('plan-correction');
    await handler({ ref: 'r', input: { optionId: 'approve' } });
    expect(m.runAction).toHaveBeenCalledWith(host.planCorrection, 'r', 'approve');
    await handler({ ref: 'r2' });
    expect(m.runAction).toHaveBeenLastCalledWith(host.planCorrection, 'r2', undefined);
  });
});

describe('createPlanCorrectionHandoff', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('builds hooks that defer to the service', async () => {
    const reviewInvalid = vi.fn(async () => 'wait');
    m.createInferred.mockReturnValue({ reviewInvalid });
    const pc: any = { approvedPlan: vi.fn(async () => undefined), review: vi.fn(async () => 'wait') };
    const { hooks, inferredPlanCorrection } = createPlanCorrectionHandoff(pc);
    expect(m.createInferred).toHaveBeenCalledWith(pc);
    expect(inferredPlanCorrection.reviewInvalid).toBe(reviewInvalid);
    expect(hooks.maxNudges).toBe(7);

    await expect(hooks.readAuthoredPlan('/r', 'e')).resolves.toBe('authored');
    expect(m.readAuthoredPlan).toHaveBeenCalledWith('/r', 'e');
    pc.approvedPlan.mockResolvedValueOnce({ status: 'ok', text: 'approved' });
    await expect(hooks.readAuthoredPlan('/r', 'e')).resolves.toEqual({ status: 'ok', text: 'approved' });

    const ctx = { executionId: 'e' } as never;
    await expect(hooks.review(ctx, { status: 'ok' } as never)).resolves.toBe('wait');
    expect(pc.review).toHaveBeenCalledWith(ctx, { status: 'ok' });
    await expect(hooks.reviewInvalid(ctx, 'why')).resolves.toBe('wait');
    expect(reviewInvalid).toHaveBeenCalledWith(ctx, 'why');
  });
});
