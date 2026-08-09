import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// scheduler.ts -> scheduler-store.ts -> electron. Same mock pattern as
// scheduler-store.test.ts so import-time `app.getPath('home')` doesn't blow up.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/cc-test-home' }
}));

// Save / delete to disk are not under test here — stub them out so the manager
// doesn't try to write to /tmp/cc-test-home.
vi.mock('../scheduler-store.js', () => ({
  saveSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  listAllSchedules: vi.fn(() => [])
}));

// claude.ts touches `app.getPath('home')` at import time; the electron mock
// above satisfies it. listClaudeSessions isn't called from scheduler.ts but
// keeping a stub here means the module's tree-shake doesn't bring electron
// into the test in unexpected ways.
vi.mock('../claude.js', () => ({
  listClaudeSessions: vi.fn(() => [])
}));

import {
  parseEvery,
  formatInterval,
  MIN_INTERVAL_MS,
  MAX_INTERVAL_MS
} from '../../shared/parse-every.js';
import { EventEmitter } from 'node:events';
import { SchedulerManager } from '../scheduler.js';
import type { PtyManager } from '../pty.js';
import type { Project } from '../../shared/types.js';

describe('parseEvery', () => {
  it('parses simple units', () => {
    expect(parseEvery('5m')).toBe(5 * 60_000);
    expect(parseEvery('1h')).toBe(3_600_000);
    expect(parseEvery('24h')).toBe(24 * 3_600_000);
  });

  it('parses mixed units', () => {
    expect(parseEvery('1h30m')).toBe(60 * 60_000 + 30 * 60_000);
    expect(parseEvery('  2h 0m  ')).toBeNull(); // whitespace inside isn't allowed
    expect(parseEvery('2h0m')).toBe(2 * 3_600_000);
  });

  it('floors below the minimum', () => {
    // "10s" is shorter than the floor — it gets rounded up rather than rejected
    // so a hand-edited typo doesn't fork-bomb the laptop.
    expect(parseEvery('10s')).toBe(MIN_INTERVAL_MS);
    expect(parseEvery('30s')).toBe(MIN_INTERVAL_MS);
  });

  it('caps at the 24-day maximum', () => {
    // Node's setTimeout clamps delays > ~24.85d to 1ms; cap defensively below that.
    expect(parseEvery('30d')).toBe(MAX_INTERVAL_MS);
    expect(parseEvery('100d')).toBe(MAX_INTERVAL_MS);
  });

  it('returns null for garbage', () => {
    expect(parseEvery('1 hour')).toBeNull();
    expect(parseEvery('1hr')).toBeNull();
    expect(parseEvery('60')).toBeNull();
    expect(parseEvery('')).toBeNull();
    expect(parseEvery('abc')).toBeNull();
  });
});

describe('formatInterval', () => {
  it('formats common values', () => {
    expect(formatInterval(5 * 60_000)).toBe('5m');
    expect(formatInterval(60 * 60_000)).toBe('1h');
    expect(formatInterval(60 * 60_000 + 30 * 60_000)).toBe('1h 30m');
    expect(formatInterval(24 * 60 * 60_000)).toBe('1d');
    expect(formatInterval(25 * 60 * 60_000)).toBe('1d 1h');
  });
});

/**
 * Minimal PtyManager double — only what `SchedulerManager.fire()` actually
 * touches. Records `create()` calls so tests can assert the argv that would
 * be handed to node-pty. Extends EventEmitter because the scheduler subscribes
 * to `data` / `exit` events on the manager.
 */
class FakePtyManager extends EventEmitter {
  createCalls: Array<Record<string, unknown>> = [];
  /** All sessions ever spawned; `status` flips on simulateExit. The overlap
   *  check in SchedulerManager filters by `status === 'running'`. */
  sessions: Array<{
    id: string;
    projectId: string;
    title: string;
    profile: string;
    cwd: string;
    status: 'running' | 'exited';
    createdAt: number;
  }> = [];
  list(projectId: string) {
    return this.sessions.filter((s) => s.projectId === projectId);
  }
  /** Reap sessions flagged dead via {@link killProcess} — emits `exit` and flips
   *  status, mirroring the real manager's pid-probe sweep. The scheduler calls
   *  this before its overlap/concurrency guards on every auto fire. */
  reapDeadSessions(): string[] {
    const reaped: string[] = [];
    for (const s of this.sessions) {
      if (s.status === 'running' && this.deadPids.has(s.id)) {
        s.status = 'exited';
        reaped.push(s.id);
        this.emit('exit', s.id, -1);
      }
    }
    return reaped;
  }
  /** Test hook: mark a session's underlying process as gone WITHOUT emitting
   *  exit — simulates the lost-onExit zombie that only reapDeadSessions clears. */
  deadPids = new Set<string>();
  killProcess(id: string) {
    this.deadPids.add(id);
  }
  create(opts: Record<string, unknown>) {
    this.createCalls.push(opts);
    const session = {
      id: `pty-${this.createCalls.length}`,
      projectId: opts.projectId as string,
      title: 'x',
      profile: opts.profile as string,
      cwd: opts.cwd as string,
      status: 'running' as 'running' | 'exited',
      createdAt: Date.now()
    };
    this.sessions.push(session);
    return session;
  }
  write() {
    /* no-op */
  }
  /** Ids passed to closeExpected — lets tests assert auto-close behavior. */
  closeExpectedCalls: string[] = [];
  closeExpected(id: string) {
    this.closeExpectedCalls.push(id);
    return true;
  }
  /** Mark a previously-spawned session as exited. */
  simulateExit(id: string, code = 0) {
    const session = this.sessions.find((s) => s.id === id);
    if (session) session.status = 'exited';
    this.emit('exit', id, code);
  }
}

function makeManager(extraTaskFields?: Record<string, unknown>): {
  manager: SchedulerManager;
  ptys: FakePtyManager;
  task: ReturnType<SchedulerManager['create']>;
} {
  const ptys = new FakePtyManager();
  const project: Project = {
    id: 'proj-1',
    name: 'P',
    path: '/tmp/proj',
    createdAt: 0,
    lastActiveAt: 0
  };
  const fakeStore = {
    listProjects: () => [project],
    getConfig: () => ({}),
    getProjectSettings: () => ({})
  };
  const manager = new SchedulerManager();
  // The Deps type wants the real PtyManager + Store shapes. The fakes have a
  // strict subset of methods that fire() needs; cast away the rest.
  manager.setDeps({
    ptys: ptys as unknown as PtyManager,
    launchTerminal: (opts) => ptys.create(opts as unknown as Record<string, unknown>) as never,
    store: fakeStore as unknown as Parameters<SchedulerManager['setDeps']>[0]['store']
  });
  const task = manager.create({
    name: 't',
    projectId: 'proj-1',
    profile: 'claude',
    every: '5m',
    enabled: false,
    ...extraTaskFields
  });
  return { manager, ptys, task };
}

describe('SchedulerManager.fire — headless spawn', () => {
  it('appends the prompt as a positional argv element for claude', () => {
    const { manager, ptys, task } = makeManager({ prompt: 'say hello' });
    manager.runNow(task.id);
    expect(ptys.createCalls).toHaveLength(1);
    const call = ptys.createCalls[0];
    expect(call.profile).toBe('claude');
    expect(call.extraArgs).toEqual(['say hello']);
  });

  it('stamps a stable schedule principal at the launch seam', () => {
    const ptys = new FakePtyManager();
    const principals: Array<{ kind: string; id: string }> = [];
    const manager = new SchedulerManager();
    manager.setDeps({
      ptys: ptys as unknown as PtyManager,
      launchTerminal: (opts, principal) => {
        principals.push(principal);
        return ptys.create(opts as unknown as Record<string, unknown>) as never;
      },
      store: {
        listProjects: () => [{ id: 'proj-1', name: 'P', path: '/tmp/proj', createdAt: 0, lastActiveAt: 0 }],
        getConfig: () => ({}),
        getProjectSettings: () => ({})
      } as unknown as Parameters<SchedulerManager['setDeps']>[0]['store']
    });
    const task = manager.create({ name: 't', projectId: 'proj-1', profile: 'claude', every: '5m', enabled: false });
    manager.runNow(task.id);
    expect(principals).toEqual([{ kind: 'schedule', id: `schedule:${task.id}` }]);
  });

  it('keeps the prompt after the user extraArgs', () => {
    const { manager, ptys, task } = makeManager({
      prompt: 'hi',
      extraArgs: ['--model', 'sonnet']
    });
    manager.runNow(task.id);
    expect(ptys.createCalls[0].extraArgs).toEqual(['--model', 'sonnet', 'hi']);
  });

  it('preserves multi-line prompts as one argv element', () => {
    const body = 'line one\nline two';
    const { manager, ptys, task } = makeManager({ prompt: body });
    manager.runNow(task.id);
    const args = ptys.createCalls[0].extraArgs as string[];
    expect(args[args.length - 1]).toBe(body);
  });

  it('omits the prompt arg when no prompt is set', () => {
    const { manager, ptys, task } = makeManager(/* no prompt */);
    manager.runNow(task.id);
    expect(ptys.createCalls[0].extraArgs).toEqual([]);
  });

  it('does not append the prompt for a shell profile (no positional prompt)', () => {
    const { manager, ptys, task } = makeManager({ profile: 'shell', prompt: 'hi' });
    manager.runNow(task.id);
    expect(ptys.createCalls[0].extraArgs).toEqual([]);
  });

  it('appends the prompt for codex + cursor (acceptsPromptArgv), not just claude', () => {
    // Regression: this gate used to be isClaudeProfile, silently dropping the
    // scheduled prompt for the two new agent CLIs that also take `[prompt]`.
    for (const profile of ['codex', 'cursor'] as const) {
      const { manager, ptys, task } = makeManager({ profile, prompt: 'hi' });
      manager.runNow(task.id);
      expect(ptys.createCalls[0].extraArgs, profile).toEqual(['hi']);
    }
  });

  it('delivers the prompt via --prompt for OpenCode (positional is a project dir)', () => {
    // Regression for the `Failed to change directory to …/<prompt>` bug: a bare
    // positional prompt makes OpenCode cd into a bogus path and exit.
    for (const profile of ['opencode', 'opencode-resume'] as const) {
      const { manager, ptys, task } = makeManager({ profile, prompt: 'hi' });
      manager.runNow(task.id);
      expect(ptys.createCalls[0].extraArgs, profile).toEqual(['--prompt', 'hi']);
    }
  });

  it('keeps the claude-resume profile (no print-mode normalisation)', () => {
    const { manager, ptys, task } = makeManager({ profile: 'claude-resume', prompt: 'hi' });
    manager.runNow(task.id);
    expect(ptys.createCalls[0].profile).toBe('claude-resume');
    expect(ptys.createCalls[0].extraArgs).toEqual(['hi']);
  });

  it('spawns headless — background run stays out of the tab strip', () => {
    // Scheduled fires are background work, surfaced via the inbox rather than
    // a tab the user opened. The pty still runs (and stays replyable); the
    // inbox "Open in session" deep-link promotes it to a visible tab on
    // demand. logPath remains unused — runs are tracked via run history.
    const { manager, ptys, task } = makeManager({ prompt: 'hi' });
    manager.runNow(task.id);
    const call = ptys.createCalls[0];
    expect(call.headless).toBe(true);
    expect(call.logPath).toBeUndefined();
  });

  it('does not register a data listener (no TUI keystroke driving)', () => {
    const { manager, ptys, task } = makeManager({ prompt: 'hi' });
    expect(ptys.listenerCount('data')).toBe(0);
    manager.runNow(task.id);
    expect(ptys.listenerCount('data')).toBe(0);
  });
});

/**
 * Trigger an *auto* fire by calling the private `fire(id, { manual: false })`
 * directly. `runNow` always passes `manual: true`, which bypasses the overlap
 * guard — exactly what the user wants for an explicit click, but not what we
 * need to exercise the timer-driven overlap path.
 */
function autoFire(manager: SchedulerManager, taskId: string) {
  (manager as unknown as {
    fire: (id: string, opts: { manual: boolean }) => void;
  }).fire(taskId, { manual: false });
}

describe('SchedulerManager.fire — overlap guard', () => {
  it('skips the next auto fire while a prior auto run is still alive', () => {
    const { manager, ptys, task } = makeManager({ prompt: 'work' });
    autoFire(manager, task.id);
    expect(ptys.createCalls).toHaveLength(1);
    autoFire(manager, task.id);
    expect(ptys.createCalls).toHaveLength(1);
    // The skipped run should be recorded with result 'skipped'.
    const runs = manager.list().find((t) => t.id === task.id)!.status.runs;
    expect(runs[0].result).toBe('skipped');
  });

  it('skips the next auto fire while a prior MANUAL run is still alive', () => {
    // Regression: previously the overlap check only consulted
    // lastAutoSessionId, so a long-running manual fire would let the next
    // interval-driven fire stack on top of it.
    const { manager, ptys, task } = makeManager({ prompt: 'work' });
    manager.runNow(task.id); // manual
    expect(ptys.createCalls).toHaveLength(1);
    autoFire(manager, task.id);
    expect(ptys.createCalls).toHaveLength(1);
    const runs = manager.list().find((t) => t.id === task.id)!.status.runs;
    expect(runs[0].result).toBe('skipped');
  });

  it('proceeds once the prior session has exited', () => {
    const { manager, ptys, task } = makeManager({ prompt: 'work' });
    autoFire(manager, task.id);
    const firstId = ptys.sessions[0].id;
    ptys.simulateExit(firstId, 0);
    autoFire(manager, task.id);
    expect(ptys.createCalls).toHaveLength(2);
  });

  it('manual "Run now" still spawns even when an auto run is alive', () => {
    // Manual fires are an explicit user choice — don't block them on
    // overlap.
    const { manager, ptys, task } = makeManager({ prompt: 'work' });
    autoFire(manager, task.id);
    manager.runNow(task.id);
    expect(ptys.createCalls).toHaveLength(2);
  });
});

/**
 * Build a manager with N independent schedules on one project, so we can drive
 * a global concurrency scenario (each schedule fires its own session — the
 * per-schedule overlap guard never trips, only the GLOBAL cap can). Returns the
 * manager, the shared fake pty, and the created tasks.
 */
function makeMultiScheduleManager(count: number): {
  manager: SchedulerManager;
  ptys: FakePtyManager;
  tasks: Array<ReturnType<SchedulerManager['create']>>;
} {
  const ptys = new FakePtyManager();
  const project: Project = {
    id: 'proj-1',
    name: 'P',
    path: '/tmp/proj',
    createdAt: 0,
    lastActiveAt: 0
  };
  const fakeStore = {
    listProjects: () => [project],
    getConfig: () => ({}),
    getProjectSettings: () => ({})
  };
  const manager = new SchedulerManager();
  manager.setDeps({
    ptys: ptys as unknown as PtyManager,
    launchTerminal: (opts) => ptys.create(opts as unknown as Record<string, unknown>) as never,
    store: fakeStore as unknown as Parameters<SchedulerManager['setDeps']>[0]['store']
  });
  const tasks = Array.from({ length: count }, (_, i) =>
    manager.create({
      name: `t${i}`,
      projectId: 'proj-1',
      profile: 'claude',
      every: '5m',
      enabled: false,
      prompt: 'work'
    })
  );
  return { manager, ptys, tasks };
}

describe('SchedulerManager.fire — global concurrency cap', () => {
  const CAP = 5; // mirrors MAX_CONCURRENT_SCHEDULED_RUNS in scheduler.ts

  it('skips the (cap+1)th simultaneous auto fire with the concurrency reason', () => {
    const { manager, ptys, tasks } = makeMultiScheduleManager(CAP + 1);

    // Fire CAP distinct schedules — each spawns one live session (overlap never
    // trips: different schedules, different sessions).
    for (let i = 0; i < CAP; i += 1) autoFire(manager, tasks[i].id);
    expect(ptys.createCalls).toHaveLength(CAP);

    // The (cap+1)th coincident fire must be skipped, NOT spawned.
    autoFire(manager, tasks[CAP].id);
    expect(ptys.createCalls).toHaveLength(CAP);

    // ...and recorded as skipped with the concurrency-cap reason (distinct from
    // the overlap "previous run still active" message).
    const runs = manager.list().find((t) => t.id === tasks[CAP].id)!.status.runs;
    expect(runs[0].result).toBe('skipped');
    expect(runs[0].message).toMatch(/concurrency-cap/);
  });

  it('lets a capped fire proceed once a live run exits and frees a slot', () => {
    const { manager, ptys, tasks } = makeMultiScheduleManager(CAP + 1);
    for (let i = 0; i < CAP; i += 1) autoFire(manager, tasks[i].id);

    // At the cap → skipped.
    autoFire(manager, tasks[CAP].id);
    expect(ptys.createCalls).toHaveLength(CAP);

    // One running session exits, freeing a global slot.
    ptys.simulateExit(ptys.sessions[0].id, 0);

    // Now the previously-capped schedule fires for real.
    autoFire(manager, tasks[CAP].id);
    expect(ptys.createCalls).toHaveLength(CAP + 1);
  });

  it('manual "Run now" bypasses the concurrency cap (explicit user action)', () => {
    // Consistent with how runNow bypasses the overlap guard — a deliberate
    // click is the user overriding the cap, same as overlap today.
    const { manager, ptys, tasks } = makeMultiScheduleManager(CAP + 1);
    for (let i = 0; i < CAP; i += 1) autoFire(manager, tasks[i].id);
    expect(ptys.createCalls).toHaveLength(CAP);

    manager.runNow(tasks[CAP].id);
    expect(ptys.createCalls).toHaveLength(CAP + 1);
  });
});

describe('SchedulerManager.fire — zombie-session recovery', () => {
  const CAP = 5; // mirrors MAX_CONCURRENT_SCHEDULED_RUNS in scheduler.ts

  it('reaps a zombie whose process died without an exit event, freeing the slot', () => {
    // Regression: a run whose pty never delivered onExit (machine slept/woke)
    // stayed pinned `running` and held a concurrency slot forever. Enough of
    // them deadlocked every schedule with concurrency-cap skips until an app
    // restart. The fire-time reap must clear them so a poll self-heals.
    const { manager, ptys, tasks } = makeMultiScheduleManager(CAP + 1);
    for (let i = 0; i < CAP; i += 1) autoFire(manager, tasks[i].id);
    expect(ptys.createCalls).toHaveLength(CAP);

    // All CAP processes die WITHOUT emitting exit — classic lost-onExit zombies.
    for (let i = 0; i < CAP; i += 1) ptys.killProcess(ptys.sessions[i].id);

    // The next auto fire reaps them up front, sees the cap is clear, and runs.
    autoFire(manager, tasks[CAP].id);
    expect(ptys.createCalls).toHaveLength(CAP + 1);
  });

  it('clears a self-overlap zombie so the same schedule can fire again', () => {
    const { manager, ptys, task } = makeManager({ prompt: 'work' });
    autoFire(manager, task.id);
    expect(ptys.createCalls).toHaveLength(1);

    // Its process vanishes with no exit event → overlap guard would otherwise
    // skip forever with "previous run still active".
    ptys.killProcess(ptys.sessions[0].id);

    autoFire(manager, task.id);
    expect(ptys.createCalls).toHaveLength(2);
  });

  it('records the interrupted (reaped) run as an error, not a success', () => {
    // The optimistic fire-time record is `success`; a reaped run must be
    // corrected to error so the failure is visible and the run isn't trusted
    // by a downstream `--needs` freshness check.
    const { manager, ptys, task } = makeManager({ prompt: 'work' });
    autoFire(manager, task.id);
    const sessionId = ptys.sessions[0].id;
    ptys.killProcess(sessionId);

    autoFire(manager, task.id); // triggers the reap of the prior run

    const runs = manager.list().find((t) => t.id === task.id)!.status.runs;
    const reaped = runs.find((r) => r.sessionId === sessionId)!;
    expect(reaped.result).toBe('error');
  });
});

describe('SchedulerManager.attachReport', () => {
  const runsOf = (manager: SchedulerManager, id: string) =>
    manager.list().find((t) => t.id === id)!.status.runs;

  it('attaches a report to the run owning the sessionId', () => {
    const { manager, ptys, task } = makeManager({ prompt: 'work' });
    autoFire(manager, task.id);
    const sid = ptys.sessions[0].id;

    manager.attachReport(sid, '## done\nall good', 'success');

    const run = runsOf(manager, task.id).find((r) => r.sessionId === sid)!;
    expect(run.report).toBe('## done\nall good');
    expect(run.reportStatus).toBe('success');
    expect(run.reportedAt).toBeTruthy();
  });

  it('report survives the exit-time recordRun merge (report BEFORE exit)', () => {
    const { manager, ptys, task } = makeManager({ prompt: 'work' });
    autoFire(manager, task.id);
    const sid = ptys.sessions[0].id;

    // Report arrives while the session is still alive (optimistic run).
    manager.attachReport(sid, 'early report', 'partial');
    // Then the pty exits → recordRun overwrites result/duration.
    ptys.simulateExit(sid, 0);

    const run = runsOf(manager, task.id).find((r) => r.sessionId === sid)!;
    expect(run.result).toBe('success'); // exit code 0 finalized
    expect(run.durationMs).toBeDefined();
    expect(run.report).toBe('early report'); // NOT clobbered by the exit merge
    expect(run.reportStatus).toBe('partial');
  });

  it('report attaches to an already-finalized run (report AFTER exit)', () => {
    const { manager, ptys, task } = makeManager({ prompt: 'work' });
    autoFire(manager, task.id);
    const sid = ptys.sessions[0].id;

    ptys.simulateExit(sid, 0); // finalize first
    manager.attachReport(sid, 'late report', 'success'); // then report

    const run = runsOf(manager, task.id).find((r) => r.sessionId === sid)!;
    expect(run.result).toBe('success');
    expect(run.report).toBe('late report');
  });

  it('is a no-op (no throw) when no run matches the sessionId', () => {
    const { manager, task } = makeManager({ prompt: 'work' });
    autoFire(manager, task.id);
    expect(() => manager.attachReport('no-such-session', 'orphan')).not.toThrow();
  });
});

describe('SchedulerManager.recordRun — eviction of a long-lived run', () => {
  const statusOf = (manager: SchedulerManager, id: string) =>
    manager.list().find((t) => t.id === id)!.status;

  it('does not double-count or duplicate when an evicted run finally exits', () => {
    // Regression (QA high-sev #3): with retain=1, run #1 fires and stays alive.
    // A second (manual) fire unshifts run #2 and the slice(0,1) EVICTS run #1
    // from status.runs. When run #1's pty finally exits, its exit-time
    // recordRun must recognize it as the tail of an already-counted run — NOT
    // unshift a fresh entry (which would double-count the fire and list the run
    // twice). `runNow` (manual) bypasses the overlap guard so both fires spawn.
    const { manager, ptys, task } = makeManager({ prompt: 'work', retain: 1 });

    manager.runNow(task.id); // run #1 — stays alive
    const sid1 = ptys.sessions[0].id;
    manager.runNow(task.id); // run #2 — evicts run #1 from the retain=1 buffer
    const sid2 = ptys.sessions[1].id;

    // Snapshot BEFORE run #1's late exit (statusOf returns the live object, so
    // read the values we care about now rather than aliasing it).
    const runCountBefore = statusOf(manager, task.id).runCount;
    expect(statusOf(manager, task.id).runs).toHaveLength(1); // retain cap
    expect(runCountBefore).toBe(2); // two genuine fires counted
    expect(statusOf(manager, task.id).runs[0].sessionId).toBe(sid2); // newest on top

    // Run #1 (evicted) exits late — its tail must be recognized and dropped.
    ptys.simulateExit(sid1, 0);

    const after = statusOf(manager, task.id);
    // runCount stays at 2 — the exit is neither a new fire nor a re-insert.
    expect(after.runCount).toBe(2);
    // The evicted run does NOT resurface, and no run.id is duplicated.
    expect(after.runs).toHaveLength(1);
    expect(after.runs[0].sessionId).toBe(sid2); // still the newest run
    const ids = after.runs.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    // The aged-out run must not clobber the "last run" summary.
    expect(after.lastRunSessionId).toBe(sid2);
  });
});

describe('SchedulerManager.onAgentFinished', () => {
  const runsOf = (manager: SchedulerManager, id: string) =>
    manager.list().find((t) => t.id === id)!.status.runs;

  it('stamps finishedAt + duration on the run while the pty stays alive', () => {
    // Explicitly opt OUT of auto-close — the create default is now `true`, and
    // this case is specifically the "finished but left open at the prompt" path.
    const { manager, ptys, task } = makeManager({
      prompt: 'work',
      autoCloseOnFinish: false
    });
    autoFire(manager, task.id);
    const sid = ptys.sessions[0].id;

    manager.onAgentFinished(sid);

    const run = runsOf(manager, task.id).find((r) => r.sessionId === sid)!;
    expect(run.finishedAt).toBeTruthy();
    expect(run.durationMs).toBeDefined();
    // The session is NOT killed for a non-auto-close task — it stays open.
    expect(ptys.closeExpectedCalls).toEqual([]);
    expect(ptys.sessions[0].status).toBe('running');
  });

  it('closes the pty (expected) for an auto-close task', () => {
    const { manager, ptys, task } = makeManager({
      prompt: 'work',
      autoCloseOnFinish: true
    });
    autoFire(manager, task.id);
    const sid = ptys.sessions[0].id;

    manager.onAgentFinished(sid);

    const run = runsOf(manager, task.id).find((r) => r.sessionId === sid)!;
    expect(run.finishedAt).toBeTruthy();
    expect(ptys.closeExpectedCalls).toEqual([sid]);
  });

  it('finishedAt survives the exit-time recordRun merge', () => {
    const { manager, ptys, task } = makeManager({ prompt: 'work' });
    autoFire(manager, task.id);
    const sid = ptys.sessions[0].id;

    manager.onAgentFinished(sid); // turn ends, pty still alive
    ptys.simulateExit(sid, 0); // later the pty actually exits

    const run = runsOf(manager, task.id).find((r) => r.sessionId === sid)!;
    expect(run.result).toBe('success');
    expect(run.finishedAt).toBeTruthy(); // not clobbered by the exit merge
  });

  it('falls back to an expected close when no scheduled run matches', () => {
    const { manager, ptys, task } = makeManager({ prompt: 'work' });
    autoFire(manager, task.id);

    manager.onAgentFinished('no-such-session');

    expect(ptys.closeExpectedCalls).toEqual(['no-such-session']);
  });
});

/**
 * Fallback max-runtime watchdog for a scheduled `autoCloseOnFinish` run on a
 * provider that can't signal turn-end (`canAutoCloseOnFinish` false). Claude
 * self-reaps via the Stop hook + `onAgentFinished`, and codex now ALSO self-reaps
 * (A6: its `-c hooks.Stop=…` bridge curls the same callback), so neither arms the
 * watchdog. cursor has no hook bridge in v1, so it's the profile that still needs
 * the coarse ceiling — without it a headless cursor autoClose run would leak one
 * replyable pty per fire. Uses fake timers to advance past the 30-min ceiling
 * deterministically.
 */
describe('SchedulerManager.fire — non-hook fallback watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const WATCHDOG_MS = 30 * 60 * 1000;

  it('force-closes a cursor autoClose run after the ceiling (no Stop hook)', () => {
    const { manager, ptys, task } = makeManager({
      profile: 'cursor',
      prompt: 'work',
      autoCloseOnFinish: true
    });
    autoFire(manager, task.id);
    const sid = ptys.sessions[0].id;

    // Before the ceiling: still alive, not closed.
    vi.advanceTimersByTime(WATCHDOG_MS - 1000);
    expect(ptys.closeExpectedCalls).toEqual([]);

    // Past the ceiling: the watchdog reaps the session it can't hear finish.
    vi.advanceTimersByTime(2000);
    expect(ptys.closeExpectedCalls).toEqual([sid]);
  });

  it('does NOT arm the watchdog for a claude run (Stop hook self-reaps)', () => {
    const { manager, ptys, task } = makeManager({
      profile: 'claude',
      prompt: 'work',
      autoCloseOnFinish: true
    });
    autoFire(manager, task.id);

    vi.advanceTimersByTime(WATCHDOG_MS + 5000);
    // Claude reaps via onAgentFinished, never the coarse watchdog.
    expect(ptys.closeExpectedCalls).toEqual([]);
  });

  it('does NOT arm the watchdog for a codex run (its -c Stop hook bridge self-reaps)', () => {
    const { manager, ptys, task } = makeManager({
      profile: 'codex',
      prompt: 'work',
      autoCloseOnFinish: true
    });
    autoFire(manager, task.id);

    vi.advanceTimersByTime(WATCHDOG_MS + 5000);
    // codex now flips canAutoCloseOnFinish ON (A6), so it self-reaps via
    // onAgentFinished like claude — the coarse watchdog must not arm.
    expect(ptys.closeExpectedCalls).toEqual([]);
  });

  it('does NOT arm the watchdog when autoCloseOnFinish is off', () => {
    const { manager, ptys, task } = makeManager({
      profile: 'cursor',
      prompt: 'work',
      autoCloseOnFinish: false
    });
    autoFire(manager, task.id);

    vi.advanceTimersByTime(WATCHDOG_MS + 5000);
    expect(ptys.closeExpectedCalls).toEqual([]);
  });

  it('clears the watchdog when the session exits before the ceiling', () => {
    const { manager, ptys, task } = makeManager({
      profile: 'cursor',
      prompt: 'work',
      autoCloseOnFinish: true
    });
    autoFire(manager, task.id);
    const sid = ptys.sessions[0].id;

    // The pty exits on its own well before the ceiling.
    ptys.simulateExit(sid, 0);
    vi.advanceTimersByTime(WATCHDOG_MS + 5000);
    // No force-close — the watchdog was cleared on exit (no double-reap).
    expect(ptys.closeExpectedCalls).toEqual([]);
  });

  it('stopAll clears pending watchdogs without force-closing sessions', () => {
    const { manager, ptys, task } = makeManager({
      profile: 'cursor',
      prompt: 'work',
      autoCloseOnFinish: true
    });
    autoFire(manager, task.id);

    manager.stopAll();
    vi.advanceTimersByTime(WATCHDOG_MS + 5000);
    // stopAll releases the timer (Rule 3); it does not itself reap the pty.
    expect(ptys.closeExpectedCalls).toEqual([]);
  });
});

/**
 * Pausing a schedule == `setEnabled(id, false)` (the panel's "Pause all" maps
 * each enabled task through this). These lock the safety contract the user
 * relies on: a paused schedule MUST NOT fire by itself — not when its timer
 * would have elapsed, not on a re-arm, and not after an app restart. The only
 * thing that may still spawn it is an explicit manual "Run now".
 *
 * Uses fake timers so an enabled task's real `setTimeout(arm)` can be advanced
 * deterministically without waiting out the (minimum 60s) interval.
 */
describe('SchedulerManager — paused schedules do not auto-fire', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('disabling clears the armed timer so the elapsed interval never fires', () => {
    // Enabled task → create() arms a setTimeout. Disable it, then advance well
    // past the interval: a cleared timer means zero spawns.
    const { manager, ptys, task } = makeManager({ prompt: 'work', enabled: true });

    manager.setEnabled(task.id, false);
    vi.advanceTimersByTime(60 * 60_000); // an hour — far past the 5m interval

    expect(ptys.createCalls).toHaveLength(0);
  });

  it('an enabled task DOES auto-fire when its interval elapses (control)', () => {
    // Guards against a false-negative: prove the harness actually fires when
    // NOT paused, so the disabled-case assertion above is meaningful. The
    // `every: '5m'` default plus the arm() 5s grace floor → advance one full
    // interval to cross the scheduled delay.
    const { manager, ptys, task } = makeManager({ prompt: 'work', enabled: true });

    vi.advanceTimersByTime(5 * 60_000 + 5_000);

    expect(ptys.createCalls).toHaveLength(1);
    // And it self-re-armed for the next interval — still enabled.
    expect(manager.list().find((t) => t.id === task.id)?.enabled).toBe(true);
  });

  it('re-arming a disabled task schedules no timer (arm() early-returns)', () => {
    // arm() bails on !enabled, so no setTimeout is registered — advancing well
    // past any interval produces zero spawns. (nextRunAt is a display hint set
    // at create() regardless of enabled, so we assert on firing, not that field.)
    const { manager, ptys, task } = makeManager({ prompt: 'work', enabled: false });

    (manager as unknown as { arm: (id: string) => void }).arm(task.id);
    vi.advanceTimersByTime(60 * 60_000); // an hour — far past the 5m interval

    expect(ptys.createCalls).toHaveLength(0);
  });

  it('persists enabled:false so a restart (loadAll) does not re-arm it', () => {
    // The boot path only arms tasks whose persisted `enabled` is true. Assert
    // the disabled state is what would be read back, locking restart-safety.
    const { manager, task } = makeManager({ prompt: 'work', enabled: true });

    manager.setEnabled(task.id, false);

    expect(manager.list().find((t) => t.id === task.id)?.enabled).toBe(false);
  });

  it('manual "Run now" still fires a paused schedule (explicit user action)', () => {
    // The one sanctioned bypass: pausing stops AUTOMATIC fires, not a
    // deliberate click. Documents that runNow is intentionally exempt.
    const { manager, ptys, task } = makeManager({ prompt: 'work', enabled: false });

    manager.runNow(task.id);

    expect(ptys.createCalls).toHaveLength(1);
  });
});

/**
 * Cron cadence: create/validate, wall-clock-aligned arming, the >24d chunked
 * re-arm, and the single boot catch-up for a slot missed while the app was down.
 * Uses fake timers pinned to a fixed wall-clock so cron math is deterministic.
 */
describe('SchedulerManager — cron cadence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a cron schedule and computes nextRunAt at the wall-clock slot', () => {
    // Wednesday 2026-07-15 08:00 UTC → weekdays-at-09:00 fires same day 09:00.
    vi.setSystemTime(new Date('2026-07-15T08:00:00Z'));
    const { manager, task } = makeManager({
      every: undefined,
      cron: '0 9 * * 1-5',
      tz: 'UTC',
      enabled: true
    });
    const live = manager.list().find((t) => t.id === task.id)!;
    expect(live.schedule).toEqual({ cron: '0 9 * * 1-5', tz: 'UTC' });
    expect(live.status.nextRunAt).toBe('2026-07-15T09:00:00.000Z');
  });

  it('rejects a schedule that sets both every and cron', () => {
    expect(() =>
      makeManager({ cron: '0 9 * * *', enabled: false })
    ).toThrow(/exactly one/i);
  });

  it('rejects an invalid cron expression', () => {
    expect(() =>
      makeManager({ every: undefined, cron: 'not a cron', enabled: false })
    ).toThrow(/invalid cron/i);
  });

  it('fires when the cron slot elapses, then re-arms for the next slot', () => {
    vi.setSystemTime(new Date('2026-07-15T08:59:00Z')); // 1 min before 09:00
    const { manager, ptys, task } = makeManager({
      every: undefined,
      cron: '0 9 * * 1-5',
      tz: 'UTC',
      prompt: 'work',
      enabled: true
    });

    // Cross the 09:00 slot (60s away; grace floor is 5s so it doesn't interfere).
    vi.advanceTimersByTime(61_000);
    expect(ptys.createCalls).toHaveLength(1);

    // Re-armed for the NEXT weekday slot: Thursday 2026-07-16 09:00.
    const live = manager.list().find((t) => t.id === task.id)!;
    expect(live.status.nextRunAt).toBe('2026-07-16T09:00:00.000Z');
  });

  it('boot catch-up: a slot missed while down fires once, soon (grace floor)', () => {
    // lastRunAt was yesterday 09:00; "now" is well past today's 09:00 slot (the
    // app was closed across it). arm() should schedule a single near-immediate
    // fire (clamped to the 5s grace floor), not replay every missed slot.
    vi.setSystemTime(new Date('2026-07-15T14:00:00Z'));
    const { manager, ptys, task } = makeManager({
      every: undefined,
      cron: '0 9 * * 1-5',
      tz: 'UTC',
      prompt: 'work',
      enabled: false
    });
    // Simulate a persisted lastRunAt from the previous day's fire, then arm.
    const live = manager.list().find((t) => t.id === task.id)!;
    live.status.lastRunAt = '2026-07-14T09:00:00.000Z';
    live.enabled = true;
    (manager as unknown as { arm: (id: string) => void }).arm(task.id);

    // Nothing fires before the grace floor…
    vi.advanceTimersByTime(4_000);
    expect(ptys.createCalls).toHaveLength(0);
    // …then the single catch-up fire lands just after 5s.
    vi.advanceTimersByTime(2_000);
    expect(ptys.createCalls).toHaveLength(1);
  });

  it('chunked re-arm: a far-future slot sleeps the cap and does NOT fire', () => {
    // A yearly cron (next slot > 24d out) must not fire immediately. arm()
    // schedules a MAX_INTERVAL_MS re-arm hop instead; advancing a normal
    // interval produces zero spawns while nextRunAt still points at the slot.
    vi.setSystemTime(new Date('2026-03-01T00:00:00Z'));
    const { manager, ptys, task } = makeManager({
      every: undefined,
      cron: '0 0 1 1 *', // Jan 1 — ~10 months away
      tz: 'UTC',
      prompt: 'work',
      enabled: true
    });

    vi.advanceTimersByTime(MAX_INTERVAL_MS - 1);
    expect(ptys.createCalls).toHaveLength(0);
    const live = manager.list().find((t) => t.id === task.id)!;
    expect(live.status.nextRunAt).toBe('2027-01-01T00:00:00.000Z');
  });
});
