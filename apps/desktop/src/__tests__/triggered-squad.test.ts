import { describe, expect, it, vi } from 'vitest';
import {
  createSquadObservers, createTriggeredSquadLauncher, goalSquadInput, goalSquadTrigger, scheduledSquadInput, scheduledSquadTrigger,
  type TriggeredSquadInput
} from '../triggered-squad.js';
import { teamHostProblem } from '../ipc/cli-host-guard.js';

const PLAN = [
  '### write: Write output <!-- executable-step -->', '', '- **Depends on:** None', '- **Mode:** Mutating',
  '- **Write scope:** `output.txt`', '- **Work:** Create output.', '- **Verification:** Read output.'
].join('\n');
const input = (over: Partial<TriggeredSquadInput> = {}): TriggeredSquadInput => ({
  projectId: 'p1', callerPrincipalId: 'schedule:p1', teamId: 't1', launchRequestId: 'lr1', objective: 'obj', title: 'T',
  planSource: 'infer', origin: 'scheduled', ...over
});

function setup(over: Record<string, unknown> = {}) {
  const start = vi.fn(async () => ({ ok: true as const, value: { id: 'exec1' } }));
  const binding = { beginLaunch: vi.fn(), forgetLaunch: vi.fn() };
  const deps = {
    projects: { listProjects: () => [{ id: 'p1' }] as never },
    teams: { list: () => [{ id: 't1', orchestratorPersonaId: 'o1' }] as never },
    personas: { list: () => [{ id: 'o1' }] as never },
    teamHostProblem: vi.fn(() => undefined),
    expandTeamSlots: vi.fn(() => [{ role: 'orchestrator' as const }, { role: 'worker' as const }]),
    squadExecutionService: { start } as never,
    planCorrectionLaunchBinding: binding,
    ...over
  };
  return { deps, start, binding, launch: createTriggeredSquadLauncher(deps as never) };
}

describe('createTriggeredSquadLauncher', () => {
  it('starts an inferred squad with freeform mode and no policy', async () => {
    const { launch, start } = setup();
    await expect(launch(input())).resolves.toEqual({ executionId: 'exec1' });
    const body = (start.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    expect(start.mock.calls[0][0]).toBe('schedule:p1');
    expect(body.coordinationMode).toBe('freeform');
    expect(body).not.toHaveProperty('policy');
    expect(body).not.toHaveProperty('workUnits');
    expect((body.slots as Array<{ initialTask: string }>)[0].initialTask).toContain('Coordinate workers');
  });

  it('applies deadline policy for positive maxDurationMinutes only', async () => {
    const a = setup();
    await a.launch(input({ maxDurationMinutes: 2 }));
    expect(((a.start.mock.calls[0] as unknown[])[2] as { policy: unknown }).policy).toEqual({ deadlineMs: 120000 });
    const b = setup();
    await b.launch(input({ maxDurationMinutes: 0 }));
    expect(((b.start.mock.calls[0] as unknown[])[2] as object)).not.toHaveProperty('policy');
  });

  it('seeds structured work units from a valid provided plan', async () => {
    const { launch, start, binding } = setup();
    await launch(input({ planSource: 'provided', objective: PLAN }));
    const body = (start.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    expect(body.coordinationMode).toBe('structured');
    expect(body.workUnits).toBeTruthy();
    expect(binding.beginLaunch).not.toHaveBeenCalled();
  });

  it('parks an invalid provided plan via launch binding', async () => {
    const { launch, binding, start } = setup();
    await launch(input({ planSource: 'provided', objective: 'just prose' }));
    expect(binding.beginLaunch).toHaveBeenCalledWith('lr1', expect.any(String));
    const slots = ((start.mock.calls[0] as unknown[])[2] as { slots: Array<{ initialTask: string }> }).slots;
    expect(slots[0].initialTask).toContain('invalid');
  });

  it('starts a bound SSH remote and rejects a secondary checkout through the trigger host gate', async () => {
    const project = { id: 'p1', hostId: 'secondary', remote: { host: 'ssh-box' } };
    const hostGate = (candidate: typeof project) => teamHostProblem(candidate, 'primary');
    const { launch, start } = setup({ projects: { listProjects: () => [project] }, teamHostProblem: hostGate });
    await expect(launch(input())).resolves.toEqual({ executionId: 'exec1' });
    expect(start).toHaveBeenCalledOnce();
    const secondary = setup({
      projects: { listProjects: () => [{ id: 'p1', hostId: 'secondary' }] },
      teamHostProblem: (candidate: { hostId?: string; remote?: unknown }) => teamHostProblem(candidate, 'primary')
    });
    await expect(secondary.launch(input())).rejects.toThrow('team host is unavailable');
    expect(secondary.start).not.toHaveBeenCalled();
  });

  it('forgets launch binding when start fails', async () => {
    const { launch, binding, start } = setup();
    start.mockResolvedValueOnce({ ok: false, message: 'nope' } as never);
    await expect(launch(input())).rejects.toThrow('nope');
    expect(binding.forgetLaunch).toHaveBeenCalledWith('lr1');
  });

  it.each([
    ['project not found', { projects: { listProjects: () => [] } }],
    ['team not found', { teams: { list: () => [] } }],
    ['team host is unavailable', { teamHostProblem: () => 'down' }],
    ['team requires an available orchestrator', { teams: { list: () => [{ id: 't1' }] } }],
    ['team requires an available orchestrator', { personas: { list: () => [] } }],
    ['team has no launchable slots', { expandTeamSlots: () => [] }],
    ['team has no launchable slots', { expandTeamSlots: () => Array.from({ length: 33 }, () => ({ role: 'worker' })) }]
  ])('rejects: %s', async (message, over) => {
    const { launch, start } = setup(over);
    await expect(launch(input())).rejects.toThrow(message);
    expect(start).not.toHaveBeenCalled();
  });
});

describe('input builders', () => {
  it('scheduledSquadInput defaults planSource to infer', () => {
    const base = { schedule: { id: 's', name: 'N', teamId: 't' }, project: { id: 'p' }, runId: 'r', objective: 'o' };
    expect(scheduledSquadInput(base)).toMatchObject({
      callerPrincipalId: 'schedule:p', launchRequestId: 'schedule:s:r', title: 'Scheduled: N', planSource: 'infer', origin: 'scheduled', teamId: 't'
    });
    expect(scheduledSquadInput({ ...base, schedule: { ...base.schedule, planSource: 'provided', maxDurationMinutes: 5 } }))
      .toMatchObject({ planSource: 'provided', maxDurationMinutes: 5 });
  });

  it('goalSquadInput defaults planSource to infer', () => {
    const base = { goal: { id: 'g', title: 'GT', statement: 'st', assignment: { teamId: 't' } }, project: { id: 'p' }, iterationId: 'i' };
    expect(goalSquadInput(base)).toMatchObject({ callerPrincipalId: 'goal:p', launchRequestId: 'goal:g:i', objective: 'st', title: 'Goal: GT', planSource: 'infer', origin: 'goal' });
    expect(goalSquadInput({ ...base, goal: { ...base.goal, planSource: 'provided' } }).planSource).toBe('provided');
  });
});

describe('observers and trigger bundles', () => {
  const rec = { id: 'e1', state: 'RUNNING', finalSummary: 'sum', launchRequestId: 'lr' };
  const store = () => ({ getInProject: vi.fn(async () => rec), list: vi.fn(async () => [rec]) });

  it('getSquadExecution returns state or undefined', async () => {
    const s = store();
    const o = createSquadObservers(s, 'goal');
    await expect(o.getSquadExecution('p', 'e1')).resolves.toEqual({ state: 'RUNNING', finalSummary: 'sum' });
    s.getInProject.mockResolvedValueOnce(undefined as never);
    await expect(o.getSquadExecution('p', 'e2')).resolves.toBeUndefined();
  });

  it('findSquadExecution scopes by owner principal', async () => {
    const s = store();
    const o = createSquadObservers(s, 'schedule');
    await expect(o.findSquadExecution('p', 'lr')).resolves.toEqual({ executionId: 'e1', state: 'RUNNING', finalSummary: 'sum' });
    expect(s.list).toHaveBeenCalledWith('schedule:p', 'p');
    await expect(o.findSquadExecution('p', 'other')).resolves.toBeUndefined();
  });

  it('scheduledSquadTrigger and goalSquadTrigger launch via builders', async () => {
    const startFn = vi.fn(async () => ({ executionId: 'x' }));
    const sched = scheduledSquadTrigger(startFn, store());
    await sched.launchSquad({ schedule: { id: 's', name: 'N', teamId: 't' }, project: { id: 'p' }, runId: 'r', objective: 'o' });
    expect(startFn).toHaveBeenLastCalledWith(expect.objectContaining({ origin: 'scheduled' }));
    const s2 = store();
    const goal = goalSquadTrigger(startFn, s2);
    await goal.launchSquad({ goal: { id: 'g', title: 't', statement: 's', assignment: { teamId: 't' } }, project: { id: 'p' }, iterationId: 'i' });
    expect(startFn).toHaveBeenLastCalledWith(expect.objectContaining({ origin: 'goal' }));
    await goal.findSquadExecution('p', 'lr');
    expect(s2.list).toHaveBeenCalledWith('goal:p', 'p');
  });
});
