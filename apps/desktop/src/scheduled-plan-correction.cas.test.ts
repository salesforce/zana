import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Project, ScheduledTask } from '@zana-ai/zcc-domain/product';
import { SchedulerManager } from '@zana-ai/zcc-server/services/scheduler/scheduler';
import { parsePortablePlan } from '@zana-ai/zcc-server/services/execution/portable-plan';
import { normalizeExecutionPlan } from '@zana-ai/zcc-server/services/launch/preflight';
import type { ExecutionWorkUnitInput } from '@zana-ai/zcc-server/services/execution/store';
import { updateScheduledPromptFromCorrection } from './scheduled-plan-correction.js';
import { InboxActionOperatorError } from './inbox-actions/registry.js';
import type { CoordinatorHandoffContext } from './team-plan-handoff.js';

// End-to-end through the real SchedulerManager: an edit that lands on the
// owner's record after the fence check (while the corrected artifact is read)
// must be rejected by the compare-and-swap, not overwritten.
const VALID_PLAN = [
  '### write: Write output <!-- executable-step -->',
  '- Mode: Mutating',
  '- Work: Create output.',
  '- Write scope: `output.txt`',
  '- Verification: Read output.',
  ''
].join('\n');
const OBJECTIVE = 'scheduled prompt v1';
const parsed = parsePortablePlan(VALID_PLAN);
if (!parsed.ok) throw new Error(parsed.reason);
const APPROVED = normalizeExecutionPlan(parsed.units, true) as ExecutionWorkUnitInput[];
const project: Project = { id: 'p1', name: 'Owner', path: '/owner/project', createdAt: 0, lastActiveAt: 0 };

async function setup() {
  const records = new Map<string, ScheduledTask>();
  const persistence = {
    read: vi.fn(async (task: ScheduledTask) => structuredClone(records.get(task.id)!)),
    load: vi.fn(async () => structuredClone([...records.values()])),
    save: vi.fn(async (task: ScheduledTask, patch?: Partial<ScheduledTask>) => {
      const disk = records.get(task.id);
      records.set(task.id, structuredClone(disk && patch ? { ...disk, ...patch, status: task.status } : task));
    }),
    remove: vi.fn(async (task: ScheduledTask) => { records.delete(task.id); }),
    localProjects: vi.fn(() => [] as Project[])
  };
  const manager = new SchedulerManager();
  manager.setDeps({
    persistence,
    ptys: Object.assign(new EventEmitter(), { list: vi.fn(() => []), reapDeadSessions: vi.fn(), closeExpected: vi.fn() }) as never,
    launchTerminal: vi.fn() as never,
    store: { listProjects: () => [project], getConfig: () => ({}) } as never,
    logger: vi.fn(), inbox: { append: vi.fn(async () => undefined) } as never
  } as never);
  const task = await manager.create({ name: 'Squad', projectId: project.id, scope: { projectId: project.id }, profile: 'claude',
    every: '5m', enabled: false, kind: 'team', teamId: 'squad', prompt: OBJECTIVE } as never);
  const ctx = { projectId: project.id, projectRoot: project.path, executionId: 'exec-1' } as CoordinatorHandoffContext;
  return { manager, records, persistence, task, ctx };
}

describe('scheduled plan correction compare-and-swap (real SchedulerManager)', () => {
  it('rejects a correction when the schedule is edited during the artifact read', async () => {
    const { manager, records, persistence, task, ctx } = await setup();
    persistence.save.mockClear();
    const err = await updateScheduledPromptFromCorrection({
      getExecution: async () => ({ launchRequestId: `schedule:${task.id}:run-1`, request: { objective: OBJECTIVE } }),
      getSchedule: id => manager.get(id),
      readCorrectedPlanText: async () => {
        records.set(task.id, { ...records.get(task.id)!, prompt: 'operator hand edit' });
        return VALID_PLAN;
      },
      updateSchedule: (id, patch) => manager.update(id, patch)
    }, ctx, APPROVED).catch(e => e);
    expect(err).toBeInstanceOf(InboxActionOperatorError);
    expect(err.message).toContain('edited since this run launched');
    expect(persistence.save).not.toHaveBeenCalled();
    expect(records.get(task.id)!.prompt).toBe('operator hand edit');
    manager.stopAll();
  });

  it('writes the corrected plan when nothing changed', async () => {
    const { manager, records, task, ctx } = await setup();
    await updateScheduledPromptFromCorrection({
      getExecution: async () => ({ launchRequestId: `schedule:${task.id}:run-1`, request: { objective: OBJECTIVE } }),
      getSchedule: id => manager.get(id),
      readCorrectedPlanText: async () => VALID_PLAN,
      updateSchedule: (id, patch) => manager.update(id, patch)
    }, ctx, APPROVED);
    expect(records.get(task.id)!.prompt).toBe(VALID_PLAN);
    expect(records.get(task.id)).not.toHaveProperty('expectedPrompt');
    manager.stopAll();
  });
});
