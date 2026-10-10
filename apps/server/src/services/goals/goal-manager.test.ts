import { LaunchSpawnError } from '../launch/coordinator.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
const fs = vi.hoisted(() => ({ watch: vi.fn(), existsSync: vi.fn(() => true), mkdirSync: vi.fn() }));
vi.mock('node:fs', async original => ({ ...await original<typeof import('node:fs')>(), ...fs }));
beforeEach(() => { fs.watch.mockReset().mockReturnValue({ close: vi.fn(), on: vi.fn() }); fs.existsSync.mockReturnValue(true); fs.mkdirSync.mockClear(); });

// goal-manager.ts -> goal-store.ts -> electron. Same mock pattern as the
// scheduler tests so import-time `app.getPath('home')` doesn't blow up.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/cc-test-home' }
}));

// Disk writes aren't under test; stub the store so the manager doesn't touch
// /tmp/cc-test-home. listAllGoals returns [] (loadAll isn't exercised here).
vi.mock('./goal-store.js', () => ({
  saveGoal: vi.fn(),
  deleteGoal: vi.fn(),
  listAllGoals: vi.fn(() => []),
  globalDir: () => '/tmp/cc-test-home/.zcc/goals',
  projectDir: (p: { path: string }) => `${p.path}/.zcc/goals`,
  clampRetain: (n: number | undefined) =>
    typeof n === 'number' && Number.isFinite(n) ? Math.max(1, Math.min(100, Math.round(n))) : 20
}));

import { EventEmitter } from 'node:events';
import {
  GoalManager,
  buildIterationPrompt,
  parseGoalVerdict,
  trailingStall,
  type GoalEvalVars
} from './goal-manager.js';
import type { PtyManager } from '@zana-ai/zcc-host-daemon/pty';
import type { Goal, GoalIteration, LlmRunResult, Project } from '@zana-ai/zcc-domain/product';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function goalFixture(over?: Partial<Goal>): Goal {
  return {
    id: 'g1',
    projectId: 'proj-1',
    title: 'Green suite',
    statement: 'Make the tests pass.',
    successCriteria: ['npm test exits 0'],
    driver: 'native',
    assignment: { kind: 'profile', profile: 'claude-yolo' },
    cadence: { mode: 'continuous' },
    maxIterations: 5,
    iteration: 0,
    noProgressLimit: 2,
    status: 'active',
    history: { retain: 20, iterations: [] },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over
  };
}

describe('buildIterationPrompt', () => {
  it('includes the statement and a criteria checklist', async () => {
    const p = buildIterationPrompt(goalFixture({ successCriteria: ['a', 'b'] }));
    expect(p).toContain('Make the tests pass.');
    expect(p).toContain('- a');
    expect(p).toContain('- b');
    expect(p).toMatch(/schedule_report/);
  });

  it('appends prior evaluator feedback on a re-spawn', async () => {
    const feedback: GoalIteration = {
      id: 'it-1',
      at: '2026-01-01T00:00:00.000Z',
      verdict: 'partial',
      rationale: 'two tests still red'
    };
    const p = buildIterationPrompt(goalFixture(), feedback);
    expect(p).toContain('two tests still red');
    expect(p).toContain('verdict: partial');
  });

  it('omits the feedback block on the first iteration', async () => {
    const p = buildIterationPrompt(goalFixture());
    expect(p).not.toMatch(/A previous attempt fell short/);
  });
});

describe('parseGoalVerdict — fail-if-uncertain', () => {
  it('parses a clean pass', async () => {
    const r = parseGoalVerdict('{"verdict":"pass","rationale":"all green","confidence":0.9}');
    expect(r.verdict).toBe('pass');
    expect(r.confidence).toBe(0.9);
  });

  it('extracts JSON wrapped in prose / fences', async () => {
    const r = parseGoalVerdict('Sure!\n```json\n{"verdict":"fail","rationale":"nope"}\n```\nThanks');
    expect(r.verdict).toBe('fail');
  });

  it('returns unknown for unparsable text', async () => {
    expect(parseGoalVerdict('not json at all').verdict).toBe('unknown');
    expect(parseGoalVerdict('').verdict).toBe('unknown');
    expect(parseGoalVerdict('{ broken').verdict).toBe('unknown');
  });

  it('returns unknown for a missing / invalid verdict field', async () => {
    expect(parseGoalVerdict('{"rationale":"x"}').verdict).toBe('unknown');
    expect(parseGoalVerdict('{"verdict":"maybe"}').verdict).toBe('unknown');
  });

  it('downgrades a low-confidence pass to partial', async () => {
    const r = parseGoalVerdict('{"verdict":"pass","confidence":0.4}');
    expect(r.verdict).toBe('partial');
  });

  it('keeps a high-confidence pass', async () => {
    const r = parseGoalVerdict('{"verdict":"pass","confidence":0.8}');
    expect(r.verdict).toBe('pass');
  });

  it('clamps confidence to 0..1 and truncates rationale', async () => {
    const long = 'x'.repeat(300);
    const r = parseGoalVerdict(`{"verdict":"fail","confidence":9,"rationale":"${long}"}`);
    expect(r.confidence).toBe(1);
    expect(r.rationale.length).toBe(160);
  });
});

describe('trailingStall', () => {
  const it_ = (verdict?: GoalIteration['verdict']): GoalIteration => ({
    id: Math.random().toString(36),
    at: '2026-01-01T00:00:00.000Z',
    verdict
  });

  it('counts the trailing run of non-progress verdicts (newest-first)', async () => {
    expect(trailingStall([it_('fail'), it_('fail'), it_('partial')])).toBe(2);
  });

  it('resets on a pass/partial at the head', async () => {
    expect(trailingStall([it_('partial'), it_('fail'), it_('fail')])).toBe(0);
    expect(trailingStall([it_('pass'), it_('fail')])).toBe(0);
  });

  it('treats unknown as non-progress', async () => {
    expect(trailingStall([it_('unknown'), it_('fail')])).toBe(2);
  });

  it('skips not-yet-scored iterations', async () => {
    expect(trailingStall([it_(undefined), it_('fail'), it_('fail')])).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The loop — onAgentFinished → evaluate → branch
// ---------------------------------------------------------------------------

/**
 * Minimal PtyManager double. Records create() calls and tracks per-session
 * status so the manager's "live session" / concurrency checks resolve. Sessions
 * start `running`; tests flip them with simulateExit before re-spawning.
 */
class FakePtyManager extends EventEmitter {
  createCalls: Array<Record<string, unknown>> = [];
  sessions: Array<{
    id: string;
    projectId: string;
    status: 'running' | 'starting' | 'exited';
    cwd: string;
    claudeSessionId?: string;
  }> = [];

  list(projectId: string) {
    return this.sessions.filter((s) => s.projectId === projectId);
  }
  getSession(id: string) {
    return this.sessions.find((s) => s.id === id) ?? null;
  }
  create(opts: Record<string, unknown>) {
    this.createCalls.push(opts);
    const session = {
      id: (opts.preallocatedSessionId as string | undefined) ?? `pty-${this.createCalls.length}`,
      projectId: opts.projectId as string,
      status: 'running' as const,
      cwd: opts.cwd as string,
      claudeSessionId: `claude-${this.createCalls.length}`
    };
    this.sessions.push(session);
    return session;
  }
  simulateExit(id: string) {
    const s = this.sessions.find((x) => x.id === id);
    if (s) s.status = 'exited';
  }
}

const project: Project = {
  id: 'proj-1',
  name: 'P',
  path: '/tmp/proj',
  createdAt: 0,
  lastActiveAt: 0
};

function makeManager(opts?: {
  verdicts?: string[]; // evaluator JSON replies, consumed in order
  goalOver?: Partial<Goal>;
}) {
  const ptys = new FakePtyManager();
  const principals: Array<{ kind: string; id: string }> = [];
  const fakeStore = {
    listProjects: () => [project],
    getConfig: () => ({})
  };
  const inboxAppend = vi.fn(async (_input: Record<string, unknown>) => {});
  const verdicts = [...(opts?.verdicts ?? [])];
  const runEvaluator = vi.fn(
    async (_vars: GoalEvalVars, _key: string): Promise<LlmRunResult> => ({
      ok: true,
      text: verdicts.shift() ?? '{"verdict":"fail","rationale":"still red","confidence":0.9}',
      provider: 'anthropic' as never,
      ms: 1
    })
  );
  const manager = new GoalManager();
  manager.setDeps({
    ptys: ptys as unknown as PtyManager,
    launchTerminal: (launchOpts, principal) => {
      principals.push(principal);
      return ptys.create(launchOpts as unknown as Record<string, unknown>) as never;
    },
    store: fakeStore as unknown as Parameters<GoalManager['setDeps']>[0]['store'],
    inbox: { append: inboxAppend } as never,
    readLastTurn: async () => 'the worker says it is done',
    runEvaluator
  });
  return { manager, ptys, principals, inboxAppend, runEvaluator };
}

/** The current goal snapshot from the manager's list. */
const current = (manager: GoalManager, id: string) =>
  manager.list().find((g) => g.id === id)!;

describe('GoalManager — create / spawn', () => {
  it('creates a draft goal that does not spawn', async () => {
    const { manager, ptys } = makeManager();
    const g = await manager.create({
      projectId: 'proj-1',
      title: 'T',
      statement: 'do it',
      successCriteria: ['x']
    });
    expect(g.status).toBe('draft');
    expect(ptys.createCalls).toHaveLength(0);
  });

  it('an activated goal spawns a headless, scheduled, auto-close worker', async () => {
    const { manager, ptys, principals } = makeManager();
    const goal = await manager.create({
      projectId: 'proj-1',
      title: 'T',
      statement: 'do it',
      successCriteria: ['x'],
      activate: true
    });
    expect(ptys.createCalls).toHaveLength(1);
    const call = ptys.createCalls[0];
    expect(call.headless).toBe(true);
    expect(call.scheduled).toBe(true);
    expect(call.autoCloseOnFinish).toBe(true);
    expect(call.inboxLevel).toBe('silent');
    // The statement rides as a positional argv element for the claude profile.
    expect((call.extraArgs as string[])[0]).toContain('do it');
    expect(principals).toEqual([{ kind: 'automation', id: `goal:${goal.id}` }]);
  });

  it('runNow forces one iteration on a draft goal', async () => {
    const { manager, ptys } = makeManager();
    const g = await manager.create({
      projectId: 'proj-1',
      title: 'T',
      statement: 'do it',
      successCriteria: ['x']
    });
    await manager.runNow(g.id);
    expect(ptys.createCalls).toHaveLength(1);
    expect(current(manager, g.id).status).toBe('active');
  });

  it('refuses a non-hook profile (cursor) instead of leaking an undriveable run', async () => {
    // The goal loop is Stop-hook driven; a provider without hook support can never
    // signal turn-end, so spawning would leak a headless pty that never closes.
    // Escalate cleanly rather than spawn it. cursor has no hook bridge in v1.
    const { manager, ptys, inboxAppend } = makeManager();
    const g = await manager.create({
      projectId: 'proj-1',
      title: 'T',
      statement: 'do it',
      successCriteria: ['x'],
      assignment: { kind: 'profile', profile: 'cursor' },
      activate: true
    });
    expect(ptys.createCalls).toHaveLength(0); // never spawned
    expect(current(manager, g.id).status).toBe('escalated');
    expect(inboxAppend).toHaveBeenCalled(); // user is told why
  });

  it('SPAWNS a codex goal worker — its -c Stop hook bridge signals turn-end', async () => {
    // codex flipped supportsHooks ON (A6: `-c hooks.Stop=…` + bypass flag curls our
    // /hook/stop callback), so the goal loop can drive it — no longer refused.
    const { manager, ptys } = makeManager();
    const g = await manager.create({
      projectId: 'proj-1',
      title: 'T',
      statement: 'do it',
      successCriteria: ['x'],
      assignment: { kind: 'profile', profile: 'codex' },
      activate: true
    });
    expect(ptys.createCalls).toHaveLength(1); // spawned a worker
    expect(ptys.createCalls[0].profile).toBe('codex-yolo');
    expect(current(manager, g.id).status).toBe('active'); // looping, not escalated
  });
});

describe('GoalManager — branch on verdict', () => {
  it('pass → achieved, pushes a loud inbox note, stops looping', async () => {
    const { manager, ptys, inboxAppend } = makeManager({
      verdicts: ['{"verdict":"pass","rationale":"all green","confidence":0.95}']
    });
    const g = await manager.create({
      projectId: 'proj-1',
      title: 'T',
      statement: 'do it',
      successCriteria: ['x'],
      activate: true
    });
    const sid = ptys.sessions[0].id;
    ptys.simulateExit(sid);
    await manager.onAgentFinished(sid);

    expect(current(manager, g.id).status).toBe('achieved');
    expect(ptys.createCalls).toHaveLength(1); // no re-spawn
    expect(inboxAppend).toHaveBeenCalledTimes(1);
    expect(inboxAppend.mock.calls[0][0]).toMatchObject({ notify: 'loud' });
  });

  it('fail with budget + progress → re-spawns the next iteration', async () => {
    const { manager, ptys } = makeManager({
      // First a partial (progress, resets stall), then we just check the re-spawn.
      verdicts: ['{"verdict":"partial","rationale":"closer","confidence":0.8}']
    });
    const g = await manager.create({
      projectId: 'proj-1',
      title: 'T',
      statement: 'do it',
      successCriteria: ['x'],
      activate: true,
      maxIterations: 5
    });
    const sid = ptys.sessions[0].id;
    ptys.simulateExit(sid);
    await manager.onAgentFinished(sid);

    expect(current(manager, g.id).status).toBe('active');
    expect(ptys.createCalls).toHaveLength(2); // re-spawned
  });

  it('hitting maxIterations → exhausted', async () => {
    const { manager, ptys, inboxAppend } = makeManager({
      verdicts: ['{"verdict":"partial","rationale":"closer","confidence":0.8}']
    });
    const g = await manager.create({
      projectId: 'proj-1',
      title: 'T',
      statement: 'do it',
      successCriteria: ['x'],
      activate: true,
      maxIterations: 1 // the very first iteration is the last
    });
    const sid = ptys.sessions[0].id;
    ptys.simulateExit(sid);
    await manager.onAgentFinished(sid);

    expect(current(manager, g.id).status).toBe('exhausted');
    expect(ptys.createCalls).toHaveLength(1); // no re-spawn past the cap
    expect(inboxAppend).toHaveBeenCalledTimes(1);
  });

  it('repeated non-progress → escalated at the no-progress limit', async () => {
    const { manager, ptys, inboxAppend } = makeManager({
      verdicts: [
        '{"verdict":"fail","rationale":"red","confidence":0.9}',
        '{"verdict":"fail","rationale":"still red","confidence":0.9}'
      ]
    });
    const g = await manager.create({
      projectId: 'proj-1',
      title: 'T',
      statement: 'do it',
      successCriteria: ['x'],
      activate: true,
      maxIterations: 10,
      noProgressLimit: 2
    });

    // Iteration 1: fail (stall = 1) → re-spawn.
    let sid = ptys.sessions[0].id;
    ptys.simulateExit(sid);
    await manager.onAgentFinished(sid);
    expect(current(manager, g.id).status).toBe('active');
    expect(ptys.createCalls).toHaveLength(2);

    // Iteration 2: fail (stall = 2 == limit) → escalate, no re-spawn.
    sid = ptys.sessions[1].id;
    ptys.simulateExit(sid);
    await manager.onAgentFinished(sid);
    expect(current(manager, g.id).status).toBe('escalated');
    expect(ptys.createCalls).toHaveLength(2);
    expect(inboxAppend).toHaveBeenCalledTimes(1);
  });

  it('a failed evaluator call reads as unknown (not achieved)', async () => {
    const { manager, ptys, runEvaluator } = makeManager();
    runEvaluator.mockResolvedValueOnce({
      ok: false,
      text: '',
      error: 'timeout',
      provider: 'anthropic' as never,
      ms: 1
    });
    const g = await manager.create({
      projectId: 'proj-1',
      title: 'T',
      statement: 'do it',
      successCriteria: ['x'],
      activate: true,
      maxIterations: 5
    });
    const sid = ptys.sessions[0].id;
    ptys.simulateExit(sid);
    await manager.onAgentFinished(sid);

    const goal = current(manager, g.id);
    // Find the scored iteration by its session (a re-spawn unshifts a fresh,
    // unscored iteration to index 0, pushing this one down).
    const scored = goal.history.iterations.find((x) => x.sessionId === sid)!;
    expect(scored.verdict).toBe('unknown');
    // unknown is non-progress, budget remains → re-spawn (not achieved).
    expect(goal.status).toBe('active');
    expect(ptys.createCalls).toHaveLength(2);
  });
});

describe('GoalManager — pause stops the loop', () => {
  it('a paused goal whose worker finishes does not re-spawn', async () => {
    const { manager, ptys } = makeManager({
      verdicts: ['{"verdict":"fail","rationale":"red","confidence":0.9}']
    });
    const g = await manager.create({
      projectId: 'proj-1',
      title: 'T',
      statement: 'do it',
      successCriteria: ['x'],
      activate: true
    });
    const sid = ptys.sessions[0].id;
    ptys.simulateExit(sid);
    // Pause before the finish is processed.
    await manager.setStatus(g.id, 'paused');
    await manager.onAgentFinished(sid);

    expect(ptys.createCalls).toHaveLength(1); // evaluateAndBranch bails on !active
    expect(current(manager, g.id).status).toBe('paused');
  });
});

// Regression (QA low #9): startMsBySession stamps a start time on every spawn
// and only clears it in onAgentFinished. A goal torn down (stopAll) or whose
// project is removed before its worker finishes would never fire onAgentFinished,
// leaking one entry per orphaned session (Rule 3). stopAll now clears the map;
// onProjectRemoved prunes the removed goals' session ids.
describe('GoalManager — startMsBySession cleanup on teardown', () => {
  // The map is private; read its size through a narrow typed accessor (mirrors
  // the file's own `as unknown as` casting idiom for test doubles).
  const startMsSize = (m: GoalManager) =>
    (m as unknown as { startMsBySession: Map<string, number> }).startMsBySession.size;

  it('stopAll clears pending start-time stamps', async () => {
    const { manager } = makeManager();
    await manager.create({
      projectId: 'proj-1',
      title: 'T',
      statement: 'do it',
      successCriteria: ['x'],
      activate: true
    });
    // A spawned iteration stamped its start time (never finished).
    expect(startMsSize(manager)).toBe(1);
    manager.stopAll();
    expect(startMsSize(manager)).toBe(0);
  });

  it('onProjectRemoved prunes stamps for the removed project’s goals', async () => {
    const { manager } = makeManager();
    await manager.create({
      projectId: 'proj-1',
      title: 'T',
      statement: 'do it',
      successCriteria: ['x'],
      activate: true
    });
    expect(startMsSize(manager)).toBe(1);
    await manager.onProjectRemoved('proj-1');
    expect(startMsSize(manager)).toBe(0);
  });

  it('a normal finish still clears its own stamp (cleanup path unbroken)', async () => {
    // A pass verdict → goal achieved, no re-spawn, so no new stamp is added and
    // the map should drain to empty after the finish.
    const { manager, ptys } = makeManager({
      verdicts: ['{"verdict":"pass","rationale":"all green","confidence":0.95}']
    });
    await manager.create({
      projectId: 'proj-1',
      title: 'T',
      statement: 'do it',
      successCriteria: ['x'],
      activate: true
    });
    const sid = ptys.sessions[0].id;
    expect(startMsSize(manager)).toBe(1);
    ptys.simulateExit(sid);
    await manager.onAgentFinished(sid);
    expect(startMsSize(manager)).toBe(0);
  });
});

describe('GoalManager — concurrency cap', () => {
  beforeEach(() => {
    // No timers needed; arm() retry uses setTimeout but we only assert the
    // immediate cap behaviour (no spawn beyond the cap on boot-style arming).
  });

  it('caps simultaneous goal workers at MAX_CONCURRENT_GOAL_RUNS (3)', async () => {
    const { manager, ptys } = makeManager();
    // Create 4 active goals; each create() arms immediately. The 4th must be
    // held back by the cap (it sets a retry timer instead of spawning).
    for (let i = 0; i < 4; i += 1) {
      await manager.create({
        projectId: 'proj-1',
        title: `T${i}`,
        statement: 'do it',
        successCriteria: ['x'],
        activate: true
      });
    }
    expect(ptys.createCalls).toHaveLength(3);
  });
});

describe('GoalManager — launch failures respect the stall budget', () => {
  // A launch failure (e.g. a broken preflight/config) never reaches
  // evaluateAndBranch's budget checks on its own — recordLaunchFailure must
  // enforce noProgressLimit itself, or a persistently-broken launch retries
  // forever (the live-test bug: 20+ identical failures, iteration stuck at 0).
  function makeFailingManager(opts?: { failTimes?: number; goalOver?: Partial<Goal> }) {
    const ptys = new FakePtyManager();
    const fakeStore = {
      listProjects: () => [project],
      getConfig: () => ({})
    };
    const inboxAppend = vi.fn(async (_input: Record<string, unknown>) => {});
    let calls = 0;
    const failTimes = opts?.failTimes ?? Infinity;
    const manager = new GoalManager();
    manager.setDeps({
      ptys: ptys as unknown as PtyManager,
      launchTerminal: (launchOpts) => {
        calls += 1;
        if (calls <= failTimes) throw new Error('Structured execution unavailable: missing execution target');
        return ptys.create(launchOpts as unknown as Record<string, unknown>) as never;
      },
      store: fakeStore as unknown as Parameters<GoalManager['setDeps']>[0]['store'],
      inbox: { append: inboxAppend } as never,
      readLastTurn: async () => 'unused',
      runEvaluator: vi.fn()
    });
    return { manager, ptys, inboxAppend, callCount: () => calls };
  }

  it('does not retry past noProgressLimit — escalates instead of looping forever', async () => {
    vi.useFakeTimers();
    try {
      const { manager, ptys, inboxAppend, callCount } = makeFailingManager();
      const g = await manager.create({
        projectId: 'proj-1',
        title: 'T',
        statement: 'do it',
        successCriteria: ['x'],
        activate: true,
        maxIterations: 10,
        noProgressLimit: 2
      });
      // First failure: stall = 1 < limit → retry scheduled.
      expect(current(manager, g.id).status).toBe('active');
      expect(callCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(15_000);
      // Second failure: stall = 2 == limit → escalate, no further retry armed.
      expect(current(manager, g.id).status).toBe('escalated');
      expect(callCount()).toBe(2);
      expect(inboxAppend).toHaveBeenCalledTimes(1);
      expect(inboxAppend.mock.calls[0][0]).toMatchObject({ notify: 'loud' });

      // Escalation must actually stop the loop — no more launches even after
      // more time passes.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(callCount()).toBe(2);
      expect(ptys.createCalls).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a transient launch failure still retries and recovers once launch succeeds', async () => {
    vi.useFakeTimers();
    try {
      const { manager, ptys, callCount } = makeFailingManager({ failTimes: 1 });
      const g = await manager.create({
        projectId: 'proj-1',
        title: 'T',
        statement: 'do it',
        successCriteria: ['x'],
        activate: true,
        maxIterations: 10,
        noProgressLimit: 3
      });
      expect(current(manager, g.id).status).toBe('active');
      expect(callCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(15_000);
      // Second attempt succeeds — a real worker session is spawned.
      expect(callCount()).toBe(2);
      expect(ptys.createCalls).toHaveLength(1);
      expect(current(manager, g.id).status).toBe('active');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('GoalManager — attachReport', () => {
  it('attaches a run report to the iteration owning the sessionId', async () => {
    const { manager, ptys } = makeManager();
    const g = await manager.create({
      projectId: 'proj-1',
      title: 'T',
      statement: 'do it',
      successCriteria: ['x'],
      activate: true
    });
    const sid = ptys.sessions[0].id;
    await manager.attachReport(sid, '## summary\ndid the thing');
    const it = current(manager, g.id).history.iterations.find((x) => x.sessionId === sid)!;
    expect(it.report).toBe('## summary\ndid the thing');
  });

  it('is a no-op when no iteration matches', async () => {
    const { manager } = makeManager();
    await expect(manager.attachReport('nope', 'orphan')).resolves.toBeUndefined();
  });
});

function durableManager() {
  const manager = new GoalManager(), ptys = new FakePtyManager();
  const records = new Map<string, Goal>();
  const persistence = {
    load: vi.fn(async () => structuredClone([...records.values()])),
    save: vi.fn(async (goal: Goal) => { records.set(goal.id, structuredClone(goal)); }),
    remove: vi.fn(async (goal: Goal) => { records.delete(goal.id); }),
    localProjects: vi.fn(() => [])
  };
  const deps: Parameters<GoalManager['setDeps']>[0] = {
    ptys: ptys as unknown as PtyManager, persistence,
    launchTerminal: vi.fn(options => ptys.create(options as unknown as Record<string, unknown>) as never),
    store: { listProjects: () => [project], getConfig: () => ({}) } as never,
    logger: vi.fn(), readLastTurn: vi.fn(async () => 'done'),
    runEvaluator: vi.fn(async () => ({ ok: true, text: '{"verdict":"pass"}', provider: 'test', ms: 1 }) as LlmRunResult),
    inbox: { append: vi.fn(async () => {}) } as never
  };
  manager.setDeps(deps);
  const input = { projectId: project.id, title: 'Durable', statement: 'Complete work', scope: { projectId: project.id } };
  return { manager, persistence, records, ptys, deps, input };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('GoalManager original-owner durability', () => {
  it.each(['not-started', 'exited'] as const)('resolves a missing worker with durable %s evidence without launching', async evidence => {
    const { manager, deps, input, persistence } = durableManager();
    const inspect = vi.fn(async () => evidence); deps.inspectWorkerLaunch = inspect;
    const goal = await manager.create(input);
    deps.launchTerminal = vi.fn(async () => { throw new LaunchSpawnError('LAUNCH_UNCONFIRMED', 'lost'); });
    await expect(manager.runNow(goal.id)).rejects.toThrow('lost');
    const sessionId = current(manager, goal.id).history.iterations[0].sessionId;
    persistence.save.mockRejectedValueOnce(new Error('offline'));
    await expect(manager.reconcile(goal.id)).rejects.toThrow('offline');
    expect(current(manager, goal.id).history.iterations[0].launchState).toBe('pending');
    expect(await manager.reconcile(goal.id)).toBe(true);
    expect(inspect).toHaveBeenCalledWith(project.id, sessionId, { kind: 'automation', id: `goal:${goal.id}` });
    expect(current(manager, goal.id)).toMatchObject({ status: 'paused', iteration: evidence === 'exited' ? 1 : 0,
      history: { iterations: [expect.objectContaining({ sessionId, launchState: 'failed' })] } });
    expect(await manager.reconcile(goal.id)).toBe(true);
    expect(deps.launchTerminal).toHaveBeenCalledOnce(); manager.stopAll();
  });
  it('commits before publishing or launching, and serializes concurrent edits', async () => {
    const { manager, persistence, deps, input } = durableManager();
    const save = deferred<void>(); persistence.save.mockImplementationOnce(() => save.promise);
    const changed = vi.fn(); manager.on('changed', changed);
    const creating = manager.create(input);
    await vi.waitFor(() => expect(persistence.save).toHaveBeenCalledOnce());
    expect(manager.list()).toEqual([]); expect(changed).not.toHaveBeenCalled(); expect(deps.launchTerminal).not.toHaveBeenCalled();
    save.resolve(); const goal = await creating;
    await Promise.all([manager.update(goal.id, { title: 'Title' }), manager.update(goal.id, { statement: 'Statement' })]);
    expect(manager.list()[0]).toMatchObject({ title: 'Title', statement: 'Statement' });
    expect(persistence.save.mock.calls.at(-1)![0]).toMatchObject({ title: 'Title', statement: 'Statement' });
  });
  it('failed create, edit, status and delete leave the acknowledged state intact', async () => {
    const { manager, persistence, input } = durableManager();
    persistence.save.mockRejectedValueOnce(new Error('offline'));
    await expect(manager.create(input)).rejects.toThrow('offline'); expect(manager.list()).toEqual([]);
    const goal = await manager.create(input), before = structuredClone(manager.list());
    persistence.save.mockRejectedValue(new Error('conflict'));
    await expect(manager.update(goal.id, { title: 'Lost' })).rejects.toThrow('conflict');
    await expect(manager.setStatus(goal.id, 'paused')).rejects.toThrow('conflict');
    persistence.remove.mockRejectedValue(new Error('offline'));
    await expect(manager.remove(goal.id)).rejects.toThrow('offline'); expect(manager.list()).toEqual(before);
    persistence.remove.mockResolvedValue(); await manager.remove(goal.id); expect(manager.list()).toEqual([]);
    await manager.remove('missing'); expect(await manager.setStatus('missing', 'paused')).toBeNull();
    await expect(manager.update('missing', {})).rejects.toThrow('not found');
    await expect(manager.runNow('missing')).rejects.toThrow('not found');
  });
  it('never launches before the durable reservation, and does not replay a lost launch acknowledgement', async () => {
    const { manager, persistence, input, records, ptys } = durableManager();
    const goal = await manager.create(input);
    persistence.save.mockImplementation(async value => {
      if (value.history.iterations[0]?.launchState === 'running') throw new Error('owner disconnected');
      records.set(value.id, structuredClone(value));
    });
    await expect(manager.runNow(goal.id)).rejects.toThrow('owner disconnected');
    expect(ptys.createCalls).toHaveLength(1); expect(records.get(goal.id)?.history.iterations[0].launchState).toBe('pending');
    expect(records.get(goal.id)?.status).toBe('paused'); // Also safe when read by a pre-reservation app version.
    expect(current(manager, goal.id).history.iterations[0].launchState).toBe('pending');
    ptys.sessions.length = 0; // The execution host's inventory is unavailable on recovery.
    await expect(manager.runNow(goal.id)).rejects.toThrow('Unconfirmed');
    await expect(manager.setStatus(goal.id, 'active')).rejects.toThrow('Unconfirmed');
    manager.stopAll(); await manager.loadAll([project]);
    expect(current(manager, goal.id).status).toBe('paused'); expect(ptys.createCalls).toHaveLength(1);
    manager.stopAll();
  });
  it('failed reservation creates no worker and leaves no pending launch in memory', async () => {
    const { manager, persistence, input, ptys } = durableManager();
    const goal = await manager.create(input);
    persistence.save.mockImplementation(async value => { if (value.history.iterations.length) throw new Error('offline'); });
    await expect(manager.runNow(goal.id)).rejects.toThrow('offline');
    expect(ptys.createCalls).toHaveLength(0); expect(current(manager, goal.id).history.iterations).toEqual([]);
  });
  it('a pause while evaluation waits is preserved and duplicate finishes evaluate once', async () => {
    const { manager, input, ptys, deps } = durableManager();
    const evaluation = deferred<LlmRunResult>(); vi.mocked(deps.runEvaluator).mockReturnValue(evaluation.promise);
    const goal = await manager.create({ ...input, activate: true }); const sid = ptys.sessions[0].id; ptys.simulateExit(sid);
    const finishing = manager.onAgentFinished(sid);
    await vi.waitFor(() => expect(deps.runEvaluator).toHaveBeenCalledOnce());
    await manager.onAgentFinished(sid); await manager.setStatus(goal.id, 'paused');
    await manager.attachReport(sid, 'report during evaluation');
    await manager.update(goal.id, { title: 'Edited while evaluating' });
    evaluation.resolve({ ok: true, text: '{"verdict":"pass"}', provider: 'test', ms: 1 } as LlmRunResult); await finishing;
    expect(current(manager, goal.id)).toMatchObject({ status: 'paused', title: 'Edited while evaluating' });
    expect(current(manager, goal.id).history.iterations[0]).toMatchObject({ report: 'report during evaluation', verdict: 'pass' });
    expect(ptys.createCalls).toHaveLength(1); await manager.onAgentFinished(sid); expect(deps.runEvaluator).toHaveBeenCalledOnce();
  });
  it('delete during evaluation cannot resurrect or launch the goal', async () => {
    const { manager, input, ptys, deps } = durableManager();
    const evaluation = deferred<LlmRunResult>(); vi.mocked(deps.runEvaluator).mockReturnValue(evaluation.promise);
    const goal = await manager.create({ ...input, activate: true }); const sid = ptys.sessions[0].id; ptys.simulateExit(sid);
    const finishing = manager.onAgentFinished(sid); await vi.waitFor(() => expect(deps.runEvaluator).toHaveBeenCalledOnce());
    await manager.remove(goal.id); evaluation.resolve({ ok: true, text: '{"verdict":"partial"}', provider: 'test', ms: 1 } as LlmRunResult); await finishing;
    expect(manager.list()).toEqual([]); expect(ptys.createCalls).toHaveLength(1);
  });
  it('bounds queued requests and cancels stale work after stop', async () => {
    const { manager, persistence, input } = durableManager(); const save = deferred<void>();
    persistence.save.mockReturnValue(save.promise);
    const all = Array.from({ length: 100 }, () => manager.create(input));
    const settled = Promise.allSettled(all);
    await expect(manager.create(input)).rejects.toThrow('Too many pending');
    await vi.waitFor(() => expect(persistence.save).toHaveBeenCalledOnce()); manager.stopAll(); save.resolve();
    expect((await settled).every(result => result.status === 'rejected')).toBe(true); expect(manager.list()).toEqual([]);
  });
  it('failed refresh preserves current records and refresh never discards a live worker', async () => {
    const { manager, persistence, input, ptys } = durableManager(); const goal = await manager.create(input);
    persistence.load.mockRejectedValueOnce(new Error('offline'));
    await expect(manager.loadAll([project])).rejects.toThrow('offline'); expect(current(manager, goal.id)).toBeDefined();
    await manager.runNow(goal.id); await manager.loadAll([project]); expect(persistence.load).toHaveBeenCalledOnce();
    expect(ptys.createCalls).toHaveLength(1); manager.stopAll();
  });
  it('polls remote metadata without overlapping and releases its poll on shutdown', async () => {
    vi.useFakeTimers();
    const { manager, persistence } = durableManager();
    try {
      manager.startWatching(); manager.startWatching();
      await vi.advanceTimersByTimeAsync(15_000); expect(persistence.load).toHaveBeenCalledOnce();
      const load = deferred<Goal[]>(); persistence.load.mockReturnValue(load.promise);
      await vi.advanceTimersByTimeAsync(45_000); expect(persistence.load).toHaveBeenCalledTimes(2);
      manager.stopWatching(); load.resolve([]); await vi.advanceTimersByTimeAsync(60_000); expect(persistence.load).toHaveBeenCalledTimes(2);
    } finally { manager.stopWatching(); manager.stopAll(); vi.useRealTimers(); }
  });
  it('validates required create fields and persists supported edits', async () => {
    const { manager, input } = durableManager();
    for (const field of ['title', 'statement', 'projectId']) await expect(manager.create({ ...input, [field]: '' })).rejects.toThrow('required');
    const goal = await manager.create(input);
    const updated = await manager.update(goal.id, { title: ' T ', statement: ' S ', successCriteria: [' a ', ''], maxIterations: 1000, noProgressLimit: 3, retain: 1,
      assignment: { kind: 'profile', profile: 'codex' }, cadence: { mode: 'manual-approve' } });
    expect(updated).toMatchObject({ title: 'T', statement: 'S', successCriteria: ['a'], maxIterations: 100, noProgressLimit: 3, history: { retain: 1 } });
  });
});

describe('GoalManager metadata lifecycle failures', () => {
  it('rebinds only local watchers, reloads external edits and recovers watcher errors', async () => {
    vi.useFakeTimers(); const { manager, persistence } = durableManager();
    const callbacks: (() => void)[] = [], watchers: { close: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> }[] = [];
    persistence.localProjects.mockReturnValue([project]);
    fs.watch.mockImplementation((_dir, _opts, callback) => { callbacks.push(callback); const watcher = { close: vi.fn(), on: vi.fn() }; watchers.push(watcher); return watcher; });
    try {
      manager.startWatching(); expect(watchers).toHaveLength(2);
      manager.rebindWatchers(); expect(watchers[0].close).toHaveBeenCalledOnce();
      callbacks.at(-1)!(); await vi.advanceTimersByTimeAsync(250); expect(persistence.load).toHaveBeenCalledOnce();
      const watcher = watchers.at(-1)!; watcher.on.mock.calls[0][1](new Error('watch failed')); expect(watcher.close).toHaveBeenCalledOnce();
      manager.rebindWatchers(); watchers.at(-1)!.close.mockImplementation(() => { throw new Error('closed'); });
      callbacks.at(-1)!(); manager.stopWatching(); await vi.advanceTimersByTimeAsync(60_000); expect(persistence.load).toHaveBeenCalledOnce();
    } finally { manager.stopWatching(); manager.stopAll(); vi.useRealTimers(); }
  });
  it('ignores self writes and postpones external reload while a worker is live', async () => {
    vi.useFakeTimers(); const { manager, persistence, input, ptys } = durableManager();
    const callbacks: (() => void)[] = [];
    fs.watch.mockImplementation((_dir, _opts, callback) => { callbacks.push(callback); return { close: vi.fn(), on: vi.fn() }; });
    try {
      manager.startWatching(); await manager.create({ ...input, activate: true });
      callbacks[0](); await vi.advanceTimersByTimeAsync(250); expect(persistence.load).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1000); callbacks[0](); await vi.advanceTimersByTimeAsync(500); expect(persistence.load).not.toHaveBeenCalled();
      ptys.simulateExit(ptys.sessions[0].id); persistence.load.mockRejectedValue(new Error('offline'));
      await vi.advanceTimersByTimeAsync(250); expect(persistence.load).toHaveBeenCalledOnce();
    } finally { manager.stopWatching(); manager.stopAll(); vi.useRealTimers(); }
  });
  it('creates only the global watch directory and survives filesystem failures', async () => {
    const { manager, persistence } = durableManager(); persistence.localProjects.mockReturnValue([project]);
    fs.existsSync.mockReturnValue(false); fs.watch.mockImplementation(() => { throw new Error('unavailable'); });
    manager.startWatching(); expect(fs.mkdirSync).toHaveBeenCalledWith('/tmp/cc-test-home/.zcc/goals', { recursive: true });
    expect(fs.watch).toHaveBeenCalledTimes(1); manager.stopWatching(); manager.stopAll();
  });
  it('does not resume a spent iteration budget during reload', async () => {
    const { manager, records, ptys } = durableManager(); records.set('g1', goalFixture({ iteration: 5, maxIterations: 5 }));
    await manager.loadAll([project]); expect(current(manager, 'g1').status).toBe('exhausted'); expect(ptys.createCalls).toHaveLength(0); manager.stopAll();
  });
  it('one unavailable owner cannot prevent loading other goals', async () => {
    const { manager, records, persistence, ptys } = durableManager();
    records.set('g1', goalFixture()); records.set('g2', goalFixture({ id: 'g2', status: 'draft' }));
    persistence.save.mockRejectedValue(new Error('owner offline'));
    await manager.loadAll([project]); expect(manager.list()).toHaveLength(2); expect(ptys.createCalls).toHaveLength(0); manager.stopAll();
  });
  it('a late load response after shutdown never publishes or starts work', async () => {
    const { manager, persistence, ptys } = durableManager(); const loading = deferred<Goal[]>(); persistence.load.mockReturnValue(loading.promise);
    const done = manager.loadAll([project]); await vi.waitFor(() => expect(persistence.load).toHaveBeenCalledOnce());
    manager.stopAll(); loading.resolve([goalFixture()]); await done; expect(manager.list()).toEqual([]); expect(ptys.createCalls).toHaveLength(0);
  });
  it('ignores a late launch after teardown and leaves its durable reservation for reconciliation', async () => {
    const { manager, deps, persistence, input, records } = durableManager(); const launch = deferred<any>(); vi.mocked(deps.launchTerminal).mockReturnValue(launch.promise);
    const creating = manager.create({ ...input, activate: true }); await vi.waitFor(() => expect(deps.launchTerminal).toHaveBeenCalledOnce());
    manager.stopAll(); launch.resolve({ id: 'late' }); await creating;
    expect(manager.list()).toEqual([]); expect([...records.values()][0].history.iterations[0].launchState).toBe('pending'); expect(persistence.save).toHaveBeenCalledTimes(2);
  });
  it('load leaves unresolved reservations paused even if the owner rejects recovery writes', async () => {
    const { manager, records, persistence, ptys } = durableManager(); records.set('g1', goalFixture({ history: { retain: 20, iterations: [{ id: 'it', at: '', launchState: 'pending' }] } }));
    persistence.save.mockRejectedValue(new Error('offline')); await manager.loadAll([project]); expect(ptys.createCalls).toHaveLength(0);
    await expect(manager.runNow('g1')).rejects.toThrow('Unconfirmed'); manager.stopAll();
  });
  it('evaluating failures keep the goal and never start another worker', async () => {
    const { manager, deps, input, ptys } = durableManager(); vi.mocked(deps.readLastTurn).mockRejectedValue(new Error('transcript offline'));
    const goal = await manager.create({ ...input, activate: true }); ptys.simulateExit(ptys.sessions[0].id);
    await manager.onAgentFinished(ptys.sessions[0].id); expect(current(manager, goal.id).iteration).toBe(1); expect(ptys.createCalls).toHaveLength(1);
    expect(deps.logger).toHaveBeenCalledWith(expect.stringContaining('evaluate'), expect.any(Error)); manager.stopAll();
  });
  it('unknown sessions do not evaluate or persist and missing project errors remain visible', async () => {
    const { manager, deps, input, persistence, ptys } = durableManager(); await manager.onAgentFinished('absent'); expect(persistence.save).not.toHaveBeenCalled();
    deps.store = { ...deps.store, listProjects: () => [] }; manager.setDeps(deps);
    const goal = await manager.create({ ...input, activate: true }); expect(current(manager, goal.id).status).toBe('escalated'); expect(ptys.createCalls).toHaveLength(0);
  });
});

it('reconciles a reserved worker from the authoritative inventory without starting another one', async () => {
  const { manager, input, ptys, persistence, records } = durableManager();
  const goal = await manager.create(input);
  persistence.save.mockImplementation(async value => {
    if (value.history.iterations[0]?.launchState === 'running') throw new Error('reply lost');
    records.set(value.id, structuredClone(value));
  });
  await expect(manager.runNow(goal.id)).rejects.toThrow('reply lost');
  expect(records.get(goal.id)?.history.iterations[0].sessionId).toBe(ptys.sessions[0].id);
  persistence.save.mockImplementation(async value => { records.set(value.id, structuredClone(value)); });
  manager.stopAll(); await manager.loadAll([project]);
  expect(current(manager, goal.id)).toMatchObject({ iteration: 1, status: 'paused', history: { iterations: [expect.objectContaining({ launchState: 'running', sessionId: ptys.sessions[0].id })] } });
  await manager.runNow(goal.id); expect(ptys.createCalls).toHaveLength(1); manager.stopAll();
});
it('only reconciles a worker in the same project and pauses an already-finished reservation', async () => {
  const { manager, records, ptys } = durableManager();
  records.set('g1', goalFixture({ iteration: 0, history: { retain: 20, iterations: [{ id: 'it', at: '', sessionId: 'reserved', launchState: 'pending' }] } }));
  ptys.sessions.push({ id: 'reserved', projectId: 'different', status: 'running', cwd: '/elsewhere' });
  await manager.loadAll([project]); expect(current(manager, 'g1').history.iterations[0].launchState).toBe('pending');
  ptys.sessions[0].projectId = project.id; ptys.sessions[0].status = 'exited';
  await manager.loadAll([project]); expect(current(manager, 'g1')).toMatchObject({ status: 'paused', iteration: 1 });
  expect(current(manager, 'g1').history.iterations[0].launchState).toBe('running'); expect(ptys.createCalls).toHaveLength(0); manager.stopAll();
});

it('leaves a readiness failure paused when a worker may already have started', async () => {
  const { manager, input, deps, records } = durableManager();
  vi.mocked(deps.launchTerminal).mockRejectedValue(new LaunchSpawnError('LAUNCH_UNCONFIRMED', 'readiness acknowledgement lost'));
  const goal = await manager.create(input);
  await expect(manager.runNow(goal.id)).rejects.toThrow('readiness acknowledgement lost');
  expect(records.get(goal.id)).toMatchObject({ status: 'paused', history: { iterations: [expect.objectContaining({ launchState: 'pending' })] } });
  await expect(manager.runNow(goal.id)).rejects.toThrow('Unconfirmed');
  expect(deps.launchTerminal).toHaveBeenCalledOnce(); manager.stopAll();
});
it('checks an unknown reserved goal worker without launching or resuming it', async () => {
  const { manager, records, ptys, persistence } = durableManager();
  records.set('g1', goalFixture({ history: { retain: 20, iterations: [{ id: 'it', at: '', sessionId: 'reserved', launchState: 'pending' }] } }));
  await manager.loadAll([project]);
  expect(await manager.reconcile('g1')).toBe(false);
  ptys.sessions.push({ id: 'reserved', projectId: 'another', status: 'running', cwd: '/elsewhere' });
  expect(await manager.reconcile('g1')).toBe(false);
  ptys.sessions[0].projectId = project.id;
  const save = persistence.save.getMockImplementation()!; persistence.save.mockRejectedValueOnce(new Error('owner offline'));
  await expect(manager.reconcile('g1')).rejects.toThrow('owner offline');
  expect(current(manager, 'g1').history.iterations[0].launchState).toBe('pending');
  persistence.save.mockImplementation(save);
  expect(await manager.reconcile('g1')).toBe(true);
  expect(current(manager, 'g1')).toMatchObject({ status: 'paused', iteration: 1 });
  expect(await manager.reconcile('g1')).toBe(true); expect(current(manager, 'g1').iteration).toBe(1);
  expect(ptys.createCalls).toHaveLength(0);
  await expect(manager.reconcile('missing')).rejects.toThrow('not found'); manager.stopAll();
});

describe('GoalManager poll reloads emit only on content change', () => {
  it('emits once for two polls over unchanged persistence', async () => {
    const { manager } = durableManager(); const changed = vi.fn(); manager.on('changed', changed);
    await manager.loadAll([project]); await manager.loadAll([project]);
    expect(changed).toHaveBeenCalledTimes(1); manager.stopAll();
  });
  it('emits when a record changes externally', async () => {
    const { manager, records, input } = durableManager();
    const goal = await manager.create(input);
    const changed = vi.fn(); manager.on('changed', changed);
    await manager.loadAll([project]); expect(changed).not.toHaveBeenCalled();
    records.set(goal.id, { ...structuredClone(records.get(goal.id)!), title: 'Renamed' });
    await manager.loadAll([project]);
    expect(changed).toHaveBeenCalledTimes(1); expect(manager.list()[0].title).toBe('Renamed'); manager.stopAll();
  });
  it('does not re-emit after a mutation when the poll sees identical content', async () => {
    const { manager, input } = durableManager(); const changed = vi.fn(); manager.on('changed', changed);
    await manager.create(input);
    const afterCreate = changed.mock.calls.length; expect(afterCreate).toBeGreaterThan(0);
    await manager.loadAll([project]);
    expect(changed).toHaveBeenCalledTimes(afterCreate); manager.stopAll();
  });
});

it('GoalManager passes other events through without touching the change fingerprint', async () => {
  const { manager } = durableManager(); const other = vi.fn(); const changed = vi.fn();
  manager.on('other', other); manager.on('changed', changed);
  expect(manager.emit('other', 1)).toBe(true); expect(other).toHaveBeenCalledWith(1);
  await manager.loadAll([project]); expect(changed).toHaveBeenCalledTimes(1); manager.stopAll();
});
