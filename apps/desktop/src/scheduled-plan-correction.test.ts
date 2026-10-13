import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InboxEntry } from '@zana-ai/zcc-domain/product';
import {
  parseScheduledLaunchRequestId,
  startTriggeredSquadExecution,
  triggeredSquadSlotTasks,
  updateScheduledPromptFromCorrection,
  type ScheduledPromptDeps
} from './scheduled-plan-correction.js';
import { InboxActionOperatorError } from './inbox-actions/registry.js';
import { PlanCorrectionLaunchBinding } from './plan-correction/launch-binding.js';
import { PLAN_CORRECTION_MAX_RETRIES, PlanCorrectionService, runPlanCorrectionHostAction } from './plan-correction/service.js';
import type { PlanCorrectionRecord } from './plan-correction/store.js';
import { correctedPlanRelPath, readCorrectedPlan, readHandoffArtifact, type CoordinatorHandoffContext } from './team-plan-handoff.js';
import { parsePortablePlan } from '@zana-ai/zcc-server/services/execution/portable-plan';
import { normalizeExecutionPlan } from '@zana-ai/zcc-server/services/launch/preflight';
import type { ExecutionWorkUnitInput } from '@zana-ai/zcc-server/services/execution/store';
import { invalidProvidedPlanHold, resolveTriggeredSquadPlan } from './team-trigger-semantics.js';

const VALID_PLAN = [
  '### write: Write output <!-- executable-step -->',
  '- Mode: Mutating',
  '- Work: Create output.',
  '- Write scope: `output.txt`',
  '- Verification: Read output.',
  ''
].join('\n');
const DEFECTIVE_PLAN = VALID_PLAN.replace('- Write scope: `output.txt`\n', '');

const OBJECTIVE = 'scheduled prompt v1';
const unitsOf = (text: string): ExecutionWorkUnitInput[] => {
  const parsed = parsePortablePlan(text);
  if (!parsed.ok) throw new Error(parsed.reason);
  return normalizeExecutionPlan(parsed.units, true) as ExecutionWorkUnitInput[];
};
const APPROVED = unitsOf(VALID_PLAN);

const ctxFor = (root: string): CoordinatorHandoffContext => ({
  sessionId: 'coord', projectId: 'p1', projectRoot: root, executionId: 'exec-1', slotId: 'orchestrator'
});

describe('parseScheduledLaunchRequestId', () => {
  it('extracts the schedule id from schedule:<schedule-id>:<run-id>', () => {
    expect(parseScheduledLaunchRequestId('schedule:sched-1:run-9')).toBe('sched-1');
  });
  it('keeps colons inside the schedule id (splits on the last separator)', () => {
    expect(parseScheduledLaunchRequestId('schedule:a:b:run-9')).toBe('a:b');
  });
  it.each([undefined, '', 'ui:abc', 'goal:x:y', 'Schedule:x:y', 'xschedule:a:b'])('is a no-op for non-schedule id %s', (id) => {
    expect(parseScheduledLaunchRequestId(id)).toBeUndefined();
  });
  it.each(['schedule:', 'schedule:run-only', 'schedule::run'])('rejects malformed scheduled id %s', (id) => {
    expect(() => parseScheduledLaunchRequestId(id)).toThrow('invalid scheduled Squad launch request');
  });
  it('current behavior: an empty run id after the final colon is accepted', () => {
    expect(parseScheduledLaunchRequestId('schedule:sched-1:')).toBe('sched-1');
  });
});

describe('updateScheduledPromptFromCorrection (stubbed deps)', () => {
  const ctx = ctxFor('/proj');
  function deps(over: Partial<ScheduledPromptDeps> = {}) {
    const d = {
      getExecution: vi.fn(async (): Promise<{ launchRequestId?: string; request?: { objective?: string } } | undefined> => ({ launchRequestId: 'schedule:sched-1:run-1', request: { objective: OBJECTIVE } })),
      getSchedule: vi.fn(() => ({ projectId: 'p1', kind: 'team', prompt: OBJECTIVE })),
      readCorrectedPlanText: vi.fn(async () => VALID_PLAN),
      updateSchedule: vi.fn(async () => ({})),
      ...over
    } satisfies ScheduledPromptDeps;
    return d;
  }

  it('updates the schedule prompt with the reread corrected artifact', async () => {
    const d = deps();
    await updateScheduledPromptFromCorrection(d, ctx, APPROVED);
    expect(d.getExecution).toHaveBeenCalledWith('p1', 'exec-1');
    expect(d.getSchedule).toHaveBeenCalledWith('sched-1');
    expect(d.readCorrectedPlanText).toHaveBeenCalledWith('/proj', 'exec-1');
    expect(d.updateSchedule).toHaveBeenCalledWith('sched-1', { prompt: VALID_PLAN });
  });

  it.each(['ui:abc', 'goal:g1:iter', undefined])('does nothing for non-scheduled launch %s', async (launchRequestId) => {
    const d = deps({ getExecution: vi.fn(async () => ({ launchRequestId })) });
    await updateScheduledPromptFromCorrection(d, ctx, APPROVED);
    expect(d.getSchedule).not.toHaveBeenCalled();
    expect(d.updateSchedule).not.toHaveBeenCalled();
  });

  it('throws when the execution is missing (approval must not silently skip the schedule)', async () => {
    const d = deps({ getExecution: vi.fn(async () => undefined) });
    await expect(updateScheduledPromptFromCorrection(d, ctx, APPROVED)).rejects.toThrow('execution not found');
    expect(d.getSchedule).not.toHaveBeenCalled();
    expect(d.updateSchedule).not.toHaveBeenCalled();
  });

  it('throws when the artifact no longer matches the approved units (TOCTOU)', async () => {
    const d = deps({ readCorrectedPlanText: vi.fn(async () => VALID_PLAN.replace('Create output.', 'Create output and delete everything.')) });
    await expect(updateScheduledPromptFromCorrection(d, ctx, APPROVED)).rejects.toThrow('changed after approval');
    expect(d.updateSchedule).not.toHaveBeenCalled();
  });

  it('throws when the artifact is no longer a valid plan', async () => {
    const d = deps({ readCorrectedPlanText: vi.fn(async () => DEFECTIVE_PLAN) });
    await expect(updateScheduledPromptFromCorrection(d, ctx, APPROVED)).rejects.toThrow('changed after approval');
    expect(d.updateSchedule).not.toHaveBeenCalled();
  });

  it('throws when the schedule prompt was edited since launch (concurrent edit fence)', async () => {
    const d = deps({ getSchedule: vi.fn(() => ({ projectId: 'p1', kind: 'team', prompt: 'user edit' })) });
    await expect(updateScheduledPromptFromCorrection(d, ctx, APPROVED)).rejects.toThrow('edited since this run launched');
    expect(d.updateSchedule).not.toHaveBeenCalled();
  });

  it('fence compares trimmed text (launch objective is trimmed)', async () => {
    const d = deps({ getSchedule: vi.fn(() => ({ projectId: 'p1', kind: 'team', prompt: `  ${OBJECTIVE}\n` })) });
    await updateScheduledPromptFromCorrection(d, ctx, APPROVED);
    expect(d.updateSchedule).toHaveBeenCalledOnce();
  });

  it('throws when the launch objective is unknown', async () => {
    const d = deps({ getExecution: vi.fn(async () => ({ launchRequestId: 'schedule:sched-1:run-1' })) });
    await expect(updateScheduledPromptFromCorrection(d, ctx, APPROVED)).rejects.toThrow('edited since this run launched');
    expect(d.updateSchedule).not.toHaveBeenCalled();
  });

  it('throws for a malformed scheduled launch id without touching the schedule', async () => {
    const d = deps({ getExecution: vi.fn(async () => ({ launchRequestId: 'schedule:only' })) });
    await expect(updateScheduledPromptFromCorrection(d, ctx, APPROVED)).rejects.toThrow('invalid scheduled Squad launch request');
    expect(d.updateSchedule).not.toHaveBeenCalled();
  });

  it('propagates a deleted schedule', async () => {
    const d = deps({ getSchedule: vi.fn(() => { throw new Error('schedule not found: sched-1'); }) });
    await expect(updateScheduledPromptFromCorrection(d, ctx, APPROVED)).rejects.toThrow('schedule not found');
    expect(d.updateSchedule).not.toHaveBeenCalled();
  });

  it('refuses a schedule that moved to a different project', async () => {
    const d = deps({ getSchedule: vi.fn(() => ({ projectId: 'other', kind: 'team' })) });
    await expect(updateScheduledPromptFromCorrection(d, ctx, APPROVED)).rejects.toThrow('no longer matches');
    expect(d.readCorrectedPlanText).not.toHaveBeenCalled();
    expect(d.updateSchedule).not.toHaveBeenCalled();
  });

  it('refuses a schedule that is no longer kind=team', async () => {
    const d = deps({ getSchedule: vi.fn(() => ({ projectId: 'p1', kind: 'terminal' })) });
    await expect(updateScheduledPromptFromCorrection(d, ctx, APPROVED)).rejects.toThrow('no longer matches');
    expect(d.updateSchedule).not.toHaveBeenCalled();
  });

  it.each([undefined, '', '   \n'])('refuses an unavailable/blank artifact (%j)', async (text) => {
    const d = deps({ readCorrectedPlanText: vi.fn(async () => text) });
    await expect(updateScheduledPromptFromCorrection(d, ctx, APPROVED)).rejects.toThrow('corrected plan artifact is unavailable');
    expect(d.updateSchedule).not.toHaveBeenCalled();
  });

  it('propagates a schedule update failure', async () => {
    const d = deps({ updateSchedule: vi.fn(async () => { throw new Error('disk full'); }) });
    await expect(updateScheduledPromptFromCorrection(d, ctx, APPROVED)).rejects.toThrow('disk full');
  });
});

describe('updateScheduledPromptFromCorrection (real confined artifact read)', () => {
  let root: string;
  let outside: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'zcc-sched-corr-'));
    outside = mkdtempSync(join(tmpdir(), 'zcc-sched-corr-out-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
  const realDeps = (updateSchedule = vi.fn(async () => ({}))) => ({
    getExecution: async () => ({ launchRequestId: 'schedule:sched-1:run-1', request: { objective: OBJECTIVE } }),
    getSchedule: () => ({ projectId: 'p1', kind: 'team', prompt: OBJECTIVE }),
    readCorrectedPlanText: (projectRoot: string, executionId: string) => readHandoffArtifact(projectRoot, correctedPlanRelPath(executionId)),
    updateSchedule
  });

  it('reads the exact artifact under the project root', async () => {
    mkdirSync(join(root, '.zana'), { recursive: true });
    writeFileSync(join(root, correctedPlanRelPath('exec-1')), VALID_PLAN);
    const update = vi.fn(async () => ({}));
    await updateScheduledPromptFromCorrection(realDeps(update), ctxFor(root), APPROVED);
    expect(update).toHaveBeenCalledWith('sched-1', { prompt: VALID_PLAN });
  });

  it('rejects when the artifact is missing', async () => {
    const update = vi.fn(async () => ({}));
    await expect(updateScheduledPromptFromCorrection(realDeps(update), ctxFor(root), APPROVED)).rejects.toThrow('unavailable');
    expect(update).not.toHaveBeenCalled();
  });

  it('does not follow a symlinked artifact that escapes the project', async () => {
    writeFileSync(join(outside, 'secret.md'), 'SECRET PLAN');
    mkdirSync(join(root, '.zana'), { recursive: true });
    symlinkSync(join(outside, 'secret.md'), join(root, correctedPlanRelPath('exec-1')));
    const update = vi.fn(async () => ({}));
    await expect(updateScheduledPromptFromCorrection(realDeps(update), ctxFor(root), APPROVED)).rejects.toThrow('unavailable');
    expect(update).not.toHaveBeenCalled();
  });

  it('does not follow a symlinked .zana directory that escapes the project', async () => {
    mkdirSync(join(outside, 'dir'), { recursive: true });
    writeFileSync(join(outside, 'dir', correctedPlanRelPath('exec-1').split('/').pop()!), 'SECRET PLAN');
    symlinkSync(join(outside, 'dir'), join(root, '.zana'));
    const update = vi.fn(async () => ({}));
    await expect(updateScheduledPromptFromCorrection(realDeps(update), ctxFor(root), APPROVED)).rejects.toThrow('unavailable');
    expect(update).not.toHaveBeenCalled();
  });
});

describe('PlanCorrectionService + updateScheduledPrompt closure', () => {
  function build(opts: { updateSchedule?: () => Promise<unknown>; getSchedule?: () => { projectId: string; kind: string; prompt?: string }; reread?: () => Promise<string | undefined> }) {
    const inbox: InboxEntry[] = [];
    const bound = new Map<string, { kind: string; ref: string }>();
    const records = new Map<string, PlanCorrectionRecord>();
    const resume = vi.fn(async () => {});
    const updateSchedule = vi.fn(opts.updateSchedule ?? (async () => ({})));
    const wake = vi.fn(async () => {});
    const root = mkdtempSync(join(tmpdir(), 'zcc-sched-svc-'));
    mkdirSync(join(root, '.zana'), { recursive: true });
    writeFileSync(join(root, correctedPlanRelPath('exec-1')), VALID_PLAN);
    const service: PlanCorrectionService = new PlanCorrectionService({
      appendInbox: async (input) => { const e = { ...input, id: `i${inbox.length}`, ts: 1 } as InboxEntry; inbox.push(e); return e; },
      bindInboxAction: (entry, action) => { bound.set(entry.id, action); return true; },
      nudge: vi.fn(),
      wakeCoordinator: wake,
      readCorrectedPlan,
      store: {
        get: async (id) => records.get(id),
        put: async (r) => { records.set(r.executionId, structuredClone(r)); return r; }
      },
      updateScheduledPrompt: (_ctx, units) => updateScheduledPromptFromCorrection({
        getExecution: async () => ({ launchRequestId: 'schedule:sched-1:run-1', request: { objective: OBJECTIVE } }),
        getSchedule: opts.getSchedule ?? (() => ({ projectId: 'p1', kind: 'team', prompt: OBJECTIVE })),
        readCorrectedPlanText: opts.reread ?? ((projectRoot, executionId) => readHandoffArtifact(projectRoot, correctedPlanRelPath(executionId))),
        updateSchedule
      }, ctxFor(root), units),
      resume,
      stopExecution: vi.fn(async () => {})
    });
    const offer = async () => {
      await service.begin('exec-1', 'mutating work unit requires file scope', false);
      const read = await readCorrectedPlan(root, 'exec-1');
      if (read.status !== 'ok') throw new Error('fixture plan invalid');
      expect(await service.review(ctxFor(root), read)).toBe('wait');
      const card = inbox.at(-1)!;
      expect(card.questions![0]!.options.map(o => o.id)).toContain('approve');
      return bound.get(card.id)!.ref;
    };
    return { service, resume, updateSchedule, offer, root, records };
  }

  it('approve persists the schedule prompt before resuming', async () => {
    const t = build({});
    const ref = await t.offer();
    await runPlanCorrectionHostAction(t.service, ref, 'approve');
    expect(t.updateSchedule).toHaveBeenCalledWith('sched-1', { prompt: VALID_PLAN });
    expect(t.resume).toHaveBeenCalledOnce();
    expect(t.updateSchedule.mock.invocationCallOrder[0]).toBeLessThan(t.resume.mock.invocationCallOrder[0]!);
    expect(await t.service.hasApproval('exec-1')).toBe(true);
    rmSync(t.root, { recursive: true, force: true });
  });

  it.each([
    ['schedule update fails', { updateSchedule: async () => { throw new Error('disk full'); } }],
    ['schedule deleted', { getSchedule: () => { throw new Error('schedule not found'); } }],
    ['schedule moved project', { getSchedule: () => ({ projectId: 'other', kind: 'team', prompt: OBJECTIVE }) }],
    ['schedule no longer team', { getSchedule: () => ({ projectId: 'p1', kind: 'terminal', prompt: OBJECTIVE }) }],
    ['artifact unreadable', { reread: async () => undefined }],
    ['artifact edited after the digest check', { reread: async () => VALID_PLAN.replace('Create output.', 'Create output and delete everything.') }],
    ['schedule prompt edited during review', { getSchedule: () => ({ projectId: 'p1', kind: 'team', prompt: 'user edited prompt v2 during review' }) }]
  ])('approve is rejected and never resumes when %s', async (_name, opts) => {
    const t = build(opts);
    const ref = await t.offer();
    await expect(runPlanCorrectionHostAction(t.service, ref, 'approve')).rejects.toThrow('rejected or superseded');
    expect(t.resume).not.toHaveBeenCalled();
    expect(await t.service.hasApproval('exec-1')).toBe(false);
    // The offer stays pending, so the operator can retry after fixing the schedule.
    expect(t.records.get('exec-1')?.status).toBe('pending');
    rmSync(t.root, { recursive: true, force: true });
  });

  it.each([
    ['schedule prompt edited during review', { getSchedule: () => ({ projectId: 'p1', kind: 'team', prompt: 'user edit' }) }, 'edited since this run launched'],
    ['artifact edited after the digest check', { reread: async () => VALID_PLAN.replace('Create output.', 'Create output and more.') }, 'changed after approval'],
    ['schedule moved project', { getSchedule: () => ({ projectId: 'other', kind: 'team', prompt: OBJECTIVE }) }, 'no longer matches'],
    ['artifact unreadable', { reread: async () => undefined }, 'unavailable']
  ])('the %s cause is shown to the operator, not hidden behind the generic message', async (_name, opts, text) => {
    const t = build(opts);
    const ref = await t.offer();
    const error = await runPlanCorrectionHostAction(t.service, ref, 'approve').then(() => undefined, (e: unknown) => e);
    // The Inbox registry only shows InboxActionOperatorError text; anything else
    // becomes "Could not complete this decision. Try again."
    expect(error).toBeInstanceOf(InboxActionOperatorError);
    expect((error as Error).message).toContain(text);
    rmSync(t.root, { recursive: true, force: true });
  });

  it('an incidental failure (disk full) stays hidden behind the generic message', async () => {
    const t = build({ updateSchedule: async () => { throw new Error('ENOSPC: /Users/x/secret/path'); } });
    const ref = await t.offer();
    const error = await runPlanCorrectionHostAction(t.service, ref, 'approve').then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(InboxActionOperatorError);
    expect((error as Error).message).not.toContain('ENOSPC');
    expect((error as Error).message).not.toContain('/Users/x');
    rmSync(t.root, { recursive: true, force: true });
  });

  it('rejection surfaces the cause to the Inbox action error', async () => {
    const t = build({ getSchedule: () => ({ projectId: 'p1', kind: 'team', prompt: 'user edit' }) });
    const ref = await t.offer();
    await expect(runPlanCorrectionHostAction(t.service, ref, 'approve')).rejects.toThrow('edited since this run launched');
    rmSync(t.root, { recursive: true, force: true });
  });

  it('approve writes the exact approved plan text and never an edited reread', async () => {
    const t = build({});
    const ref = await t.offer();
    await runPlanCorrectionHostAction(t.service, ref, 'approve');
    expect(t.updateSchedule).toHaveBeenCalledOnce();
    expect(t.updateSchedule).toHaveBeenCalledWith('sched-1', { prompt: VALID_PLAN });
    rmSync(t.root, { recursive: true, force: true });
  });
});

describe('PlanCorrectionService.begin unattended', () => {
  function svc() {
    const records = new Map<string, PlanCorrectionRecord>();
    const appendInbox = vi.fn(async (i) => ({ ...i, id: 'x', ts: 1 }) as InboxEntry);
    const service = new PlanCorrectionService({
      appendInbox, bindInboxAction: () => true, nudge: vi.fn(),
      readCorrectedPlan: async () => ({ status: 'missing' as const }),
      store: { get: async (id) => records.get(id), put: async (r) => { records.set(r.executionId, structuredClone(r)); return r; } },
      resume: vi.fn(), stopExecution: vi.fn()
    });
    return { service, records, appendInbox };
  }
  const okRead = { status: 'ok' as const, units: [], realPath: 'x' };

  it('presets retries to the max so no human-review attempt is left', async () => {
    const { service, records } = svc();
    await service.begin('e', 'bad', true);
    expect(records.get('e')).toMatchObject({ retries: PLAN_CORRECTION_MAX_RETRIES, status: 'correction-required' });
  });

  it('interactive begin starts at zero retries', async () => {
    const { service, records } = svc();
    await service.begin('e', 'bad', false);
    expect(records.get('e')!.retries).toBe(0);
  });

  it('unattended with no artifact waits then rejects without ever opening an Inbox card', async () => {
    const { service, appendInbox } = svc();
    await service.begin('e', 'bad', true);
    const ctx = ctxFor('/nowhere');
    const results = [await service.review({ ...ctx, executionId: 'e' }, okRead), await service.review({ ...ctx, executionId: 'e' }, okRead)];
    expect(results).toEqual(['wait', 'reject']);
    expect(appendInbox).not.toHaveBeenCalled();
  });
});

describe('startTriggeredSquadExecution', () => {
  it('returns the execution id on success without forgetting the launch', async () => {
    const forgetLaunch = vi.fn();
    await expect(startTriggeredSquadExecution('l1', async () => ({ ok: true, value: { id: 'e1' } }), { forgetLaunch })).resolves.toEqual({ executionId: 'e1' });
    expect(forgetLaunch).not.toHaveBeenCalled();
  });
  it('forgets the launch binding and throws when start returns not ok', async () => {
    const forgetLaunch = vi.fn();
    await expect(startTriggeredSquadExecution('l1', async () => ({ ok: false, message: 'nope' }), { forgetLaunch })).rejects.toThrow('nope');
    expect(forgetLaunch).toHaveBeenCalledWith('l1');
  });
  it('forgets the launch binding and rethrows when start throws', async () => {
    const forgetLaunch = vi.fn();
    await expect(startTriggeredSquadExecution('l1', async () => { throw new Error('boom'); }, { forgetLaunch })).rejects.toThrow('boom');
    expect(forgetLaunch).toHaveBeenCalledWith('l1');
  });
});

describe('triggeredSquadSlotTasks (scheduled invalid plan)', () => {
  const invalid = resolveTriggeredSquadPlan('provided', DEFECTIVE_PLAN);
  const slots = [{ role: 'orchestrator' as const }, { role: 'worker' as const }, { role: 'worker' as const }];

  it('valid plan: no binding, normal coordination text', () => {
    const beginLaunch = vi.fn();
    const tasks = triggeredSquadSlotTasks({ launchRequestId: 'schedule:s:r', objective: 'OBJ' }, slots, undefined, invalidProvidedPlanHold, { beginLaunch });
    expect(beginLaunch).not.toHaveBeenCalled();
    expect(tasks[0]!.initialTask).toContain('Coordinate workers and report durable execution completion.');
    expect(tasks[1]!.initialTask).toContain('Follow orchestrator assignments');
  });

  it('invalid plan: parked, orchestrator and worker hold text, objective not exposed as work', () => {
    expect(invalid.planError).toEqual(expect.any(String));
    expect(invalid.workUnits).toBeUndefined();
    const beginLaunch = vi.fn();
    const tasks = triggeredSquadSlotTasks({ launchRequestId: 'schedule:s:r', objective: DEFECTIVE_PLAN }, slots, invalid.planError, invalidProvidedPlanHold, { beginLaunch });
    expect(beginLaunch).toHaveBeenCalledWith('schedule:s:r', invalid.planError);
    expect(tasks.map(t => t.initialTask)).toEqual([
      invalidProvidedPlanHold('orchestrator'), invalidProvidedPlanHold('worker'), invalidProvidedPlanHold('worker')
    ]);
    for (const t of tasks) {
      expect(t.initialTask).toContain('awaiting host-managed correction');
      expect(t.initialTask).not.toContain('executable-step');
    }
  });

  it('no inferred fallback: invalid provided plan stays freeform-without-units and parks instead of inferring', () => {
    // freeform mode + no workUnits is only safe because every slot is held.
    expect(invalid.coordinationMode).toBe('freeform');
    const tasks = triggeredSquadSlotTasks({ launchRequestId: 'l', objective: DEFECTIVE_PLAN }, slots, invalid.planError, invalidProvidedPlanHold, { beginLaunch: vi.fn() });
    expect(tasks.every(t => !t.initialTask.includes('Coordinate workers and report'))).toBe(true);
  });

  it('binding yields a parked, interactive correction record for the durable execution (retries 0, not unattended)', async () => {
    const binding = new PlanCorrectionLaunchBinding();
    const records = new Map<string, PlanCorrectionRecord>();
    const service = new PlanCorrectionService({
      appendInbox: vi.fn(), bindInboxAction: () => true, nudge: vi.fn(),
      readCorrectedPlan: async () => ({ status: 'missing' as const }),
      store: { get: async (id) => records.get(id), put: async (r) => { records.set(r.executionId, structuredClone(r)); return r; } },
      resume: vi.fn(), stopExecution: vi.fn()
    });
    triggeredSquadSlotTasks({ launchRequestId: 'schedule:s:r', objective: DEFECTIVE_PLAN }, slots, invalid.planError, invalidProvidedPlanHold, binding);
    await expect(binding.bindExecution('schedule:s:r', 'exec-1', service)).resolves.toBe(true);
    expect(records.get('exec-1')).toMatchObject({ status: 'correction-required', retries: 0, reason: invalid.planError });
    expect(await service.isPending('exec-1')).toBe(true);
  });
});
