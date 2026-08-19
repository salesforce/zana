import { describe, it, expect, vi, beforeEach } from 'vitest';

// goal-manager.ts -> goal-store.ts -> electron. Same mock pattern as the
// scheduler tests so import-time `app.getPath('home')` doesn't blow up.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/cc-test-home' }
}));

// Disk writes aren't under test; stub the store so the manager doesn't touch
// /tmp/cc-test-home. listAllGoals returns [] (loadAll isn't exercised here).
vi.mock('../goal-store.js', () => ({
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
} from '../goal-manager.js';
import type { PtyManager } from '../pty.js';
import type { Goal, GoalIteration, LlmRunResult, Project } from '../../shared/types.js';

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
  it('includes the statement and a criteria checklist', () => {
    const p = buildIterationPrompt(goalFixture({ successCriteria: ['a', 'b'] }));
    expect(p).toContain('Make the tests pass.');
    expect(p).toContain('- a');
    expect(p).toContain('- b');
    expect(p).toMatch(/schedule_report/);
  });

  it('appends prior evaluator feedback on a re-spawn', () => {
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

  it('omits the feedback block on the first iteration', () => {
    const p = buildIterationPrompt(goalFixture());
    expect(p).not.toMatch(/A previous attempt fell short/);
  });
});

describe('parseGoalVerdict — fail-if-uncertain', () => {
  it('parses a clean pass', () => {
    const r = parseGoalVerdict('{"verdict":"pass","rationale":"all green","confidence":0.9}');
    expect(r.verdict).toBe('pass');
    expect(r.confidence).toBe(0.9);
  });

  it('extracts JSON wrapped in prose / fences', () => {
    const r = parseGoalVerdict('Sure!\n```json\n{"verdict":"fail","rationale":"nope"}\n```\nThanks');
    expect(r.verdict).toBe('fail');
  });

  it('returns unknown for unparsable text', () => {
    expect(parseGoalVerdict('not json at all').verdict).toBe('unknown');
    expect(parseGoalVerdict('').verdict).toBe('unknown');
    expect(parseGoalVerdict('{ broken').verdict).toBe('unknown');
  });

  it('returns unknown for a missing / invalid verdict field', () => {
    expect(parseGoalVerdict('{"rationale":"x"}').verdict).toBe('unknown');
    expect(parseGoalVerdict('{"verdict":"maybe"}').verdict).toBe('unknown');
  });

  it('downgrades a low-confidence pass to partial', () => {
    const r = parseGoalVerdict('{"verdict":"pass","confidence":0.4}');
    expect(r.verdict).toBe('partial');
  });

  it('keeps a high-confidence pass', () => {
    const r = parseGoalVerdict('{"verdict":"pass","confidence":0.8}');
    expect(r.verdict).toBe('pass');
  });

  it('clamps confidence to 0..1 and truncates rationale', () => {
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

  it('counts the trailing run of non-progress verdicts (newest-first)', () => {
    expect(trailingStall([it_('fail'), it_('fail'), it_('partial')])).toBe(2);
  });

  it('resets on a pass/partial at the head', () => {
    expect(trailingStall([it_('partial'), it_('fail'), it_('fail')])).toBe(0);
    expect(trailingStall([it_('pass'), it_('fail')])).toBe(0);
  });

  it('treats unknown as non-progress', () => {
    expect(trailingStall([it_('unknown'), it_('fail')])).toBe(2);
  });

  it('skips not-yet-scored iterations', () => {
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
      id: `pty-${this.createCalls.length}`,
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
  it('creates a draft goal that does not spawn', () => {
    const { manager, ptys } = makeManager();
    const g = manager.create({
      projectId: 'proj-1',
      title: 'T',
      statement: 'do it',
      successCriteria: ['x']
    });
    expect(g.status).toBe('draft');
    expect(ptys.createCalls).toHaveLength(0);
  });

  it('an activated goal spawns a headless, scheduled, auto-close worker', () => {
    const { manager, ptys, principals } = makeManager();
    const goal = manager.create({
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

  it('runNow forces one iteration on a draft goal', () => {
    const { manager, ptys } = makeManager();
    const g = manager.create({
      projectId: 'proj-1',
      title: 'T',
      statement: 'do it',
      successCriteria: ['x']
    });
    manager.runNow(g.id);
    expect(ptys.createCalls).toHaveLength(1);
    expect(current(manager, g.id).status).toBe('active');
  });

  it('refuses a non-hook profile (cursor) instead of leaking an undriveable run', () => {
    // The goal loop is Stop-hook driven; a provider without hook support can never
    // signal turn-end, so spawning would leak a headless pty that never closes.
    // Escalate cleanly rather than spawn it. cursor has no hook bridge in v1.
    const { manager, ptys, inboxAppend } = makeManager();
    const g = manager.create({
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

  it('SPAWNS a codex goal worker — its -c Stop hook bridge signals turn-end', () => {
    // codex flipped supportsHooks ON (A6: `-c hooks.Stop=…` + bypass flag curls our
    // /hook/stop callback), so the goal loop can drive it — no longer refused.
    const { manager, ptys } = makeManager();
    const g = manager.create({
      projectId: 'proj-1',
      title: 'T',
      statement: 'do it',
      successCriteria: ['x'],
      assignment: { kind: 'profile', profile: 'codex' },
      activate: true
    });
    expect(ptys.createCalls).toHaveLength(1); // spawned a worker
    expect(ptys.createCalls[0].profile).toBe('codex');
    expect(current(manager, g.id).status).toBe('active'); // looping, not escalated
  });
});

describe('GoalManager — branch on verdict', () => {
  it('pass → achieved, pushes a loud inbox note, stops looping', async () => {
    const { manager, ptys, inboxAppend } = makeManager({
      verdicts: ['{"verdict":"pass","rationale":"all green","confidence":0.95}']
    });
    const g = manager.create({
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
    const g = manager.create({
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
    const g = manager.create({
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
    const g = manager.create({
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
    const g = manager.create({
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
    const g = manager.create({
      projectId: 'proj-1',
      title: 'T',
      statement: 'do it',
      successCriteria: ['x'],
      activate: true
    });
    const sid = ptys.sessions[0].id;
    ptys.simulateExit(sid);
    // Pause before the finish is processed.
    manager.setStatus(g.id, 'paused');
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

  it('stopAll clears pending start-time stamps', () => {
    const { manager } = makeManager();
    manager.create({
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

  it('onProjectRemoved prunes stamps for the removed project’s goals', () => {
    const { manager } = makeManager();
    manager.create({
      projectId: 'proj-1',
      title: 'T',
      statement: 'do it',
      successCriteria: ['x'],
      activate: true
    });
    expect(startMsSize(manager)).toBe(1);
    manager.onProjectRemoved('proj-1');
    expect(startMsSize(manager)).toBe(0);
  });

  it('a normal finish still clears its own stamp (cleanup path unbroken)', async () => {
    // A pass verdict → goal achieved, no re-spawn, so no new stamp is added and
    // the map should drain to empty after the finish.
    const { manager, ptys } = makeManager({
      verdicts: ['{"verdict":"pass","rationale":"all green","confidence":0.95}']
    });
    manager.create({
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

  it('caps simultaneous goal workers at MAX_CONCURRENT_GOAL_RUNS (3)', () => {
    const { manager, ptys } = makeManager();
    // Create 4 active goals; each create() arms immediately. The 4th must be
    // held back by the cap (it sets a retry timer instead of spawning).
    for (let i = 0; i < 4; i += 1) {
      manager.create({
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

  it('does not retry past noProgressLimit — escalates instead of looping forever', () => {
    vi.useFakeTimers();
    try {
      const { manager, ptys, inboxAppend, callCount } = makeFailingManager();
      const g = manager.create({
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

      vi.advanceTimersByTime(15_000);
      // Second failure: stall = 2 == limit → escalate, no further retry armed.
      expect(current(manager, g.id).status).toBe('escalated');
      expect(callCount()).toBe(2);
      expect(inboxAppend).toHaveBeenCalledTimes(1);
      expect(inboxAppend.mock.calls[0][0]).toMatchObject({ notify: 'loud' });

      // Escalation must actually stop the loop — no more launches even after
      // more time passes.
      vi.advanceTimersByTime(60_000);
      expect(callCount()).toBe(2);
      expect(ptys.createCalls).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a transient launch failure still retries and recovers once launch succeeds', () => {
    vi.useFakeTimers();
    try {
      const { manager, ptys, callCount } = makeFailingManager({ failTimes: 1 });
      const g = manager.create({
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

      vi.advanceTimersByTime(15_000);
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
  it('attaches a run report to the iteration owning the sessionId', () => {
    const { manager, ptys } = makeManager();
    const g = manager.create({
      projectId: 'proj-1',
      title: 'T',
      statement: 'do it',
      successCriteria: ['x'],
      activate: true
    });
    const sid = ptys.sessions[0].id;
    manager.attachReport(sid, '## summary\ndid the thing');
    const it = current(manager, g.id).history.iterations.find((x) => x.sessionId === sid)!;
    expect(it.report).toBe('## summary\ndid the thing');
  });

  it('is a no-op when no iteration matches', () => {
    const { manager } = makeManager();
    expect(() => manager.attachReport('nope', 'orphan')).not.toThrow();
  });
});
