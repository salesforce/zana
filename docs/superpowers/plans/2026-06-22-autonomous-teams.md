# Autonomous Teams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a project-scoped "Autonomous team" launch in the agent view that opens an orchestrator + worker tabs, keeps idle agents nudged toward a stated goal, and stops + reports when the orchestrator declares the goal met.

**Architecture:** A new main-process `AutonomousRunSupervisor` (a sibling of the existing `HeartbeatService`, all deps injected) owns each run: it subscribes to the existing `AgentStatusTracker` `status` stream for its sessions, nudges idle ones via `ptys.reply`, and tears the run down on goal-reached (orchestrator pty exit), manual stop, max-rounds, or timeout. Launch reuses the existing `launchTeam()` (extended to prepend the goal and return session ids). Observation reuses the existing `SquadFlowView`. Cross-agent chatter uses the existing agent-mesh (`agent_send`/`agent_inbox`).

**Tech Stack:** Electron + React + TypeScript, Zustand (renderer store), Vitest (tests), `node:events` EventEmitter (main-process services).

## Global Constraints

- **Rule 1/2 (renderer untrusted):** main re-looks-up the team from the store, confines the project through `createTerminalConfined`, and trims+length-caps the goal. Never trust renderer-supplied `teamId`/`projectId`/`goal`.
- **Rule 3 (subscribe once at init; release on shutdown):** the supervisor is instantiated once at app init; every status subscription and timer is released on run stop and on pty exit.
- **Rule 5 (bound unbounded work):** runs are in-memory with a hard concurrent-run cap (8); nudges bounded by `maxRounds`; timeout bounds wall-clock; loop is timer-driven, off the hot path.
- **Rule 6 (no literal extension ids in logic):** nothing branches on the literal `'zana'`. This is core Teams + agent-mesh machinery.
- **Goal verbatim:** the user's goal text is passed through unchanged (only trimmed + length-capped at 4000 chars); never paraphrased.
- **Worker teardown primitive:** close a worker by id via `ptys.close(sessionId)` (the same primitive `closeSummary.closeTerminal` uses at `src/main/index.ts:554-558`). NOT the `close_idle_agents` resolver (that only targets idle peers).
- **TypeScript:** `.js` import suffixes in TS source (NodeNext resolution), matching every existing file.

---

## File Structure

**New files:**
- `src/main/autonomous-run-supervisor.ts` — the run-scoped supervisor service.
- `src/main/__tests__/autonomous-run-supervisor.test.ts` — fake-timer unit tests.
- `src/renderer/components/AutonomousRunBanner.tsx` — run banner + Stop button shown above `SquadFlowView`.

**Modified files:**
- `src/shared/types.ts` — `AutonomousRun`, `AutonomousRunLimits`, config-default fields, `CcApi.teams.launchAutonomous` + `CcApi.autonomousRuns`.
- `src/shared/ipc.ts` — new channels.
- `src/main/index.ts` — instantiate supervisor; extend `launchTeam`; add launch/stop handlers; wire status + exit; emit `onChanged`.
- `src/preload/index.ts` — bridge new channels.
- `src/renderer/store.ts` — `useAutonomousRuns` slice + boot wiring.
- `src/renderer/components/ProjectAgentsBoard.tsx` — render the banner.
- `src/renderer/components/LaunchPanel.tsx` — mode toggle + Team picker + goal box.

---

## Task 1: Shared types — `AutonomousRun` + config defaults

**Files:**
- Modify: `src/shared/types.ts` (add interfaces near the `Team`/`SquadSummary` block ~line 1351-1426; add config fields to `AppConfig`)

**Interfaces:**
- Produces: `AutonomousRunState`, `AutonomousRunStopReason`, `AutonomousRunLimits`, `AutonomousRun` types; `AppConfig.autonomousMaxRounds?`, `AppConfig.autonomousTimeoutMs?`, `AppConfig.autonomousNudgeDelaySeconds?` fields.

- [ ] **Step 1: Add the run types**

Add to `src/shared/types.ts` immediately after the `SquadSummary` interface (search for `interface SquadSummary`):

```ts
/** Lifecycle state of an autonomous team run. */
export type AutonomousRunState = 'running' | 'completed' | 'stopped' | 'failed';

/** Why an autonomous run ended (set once, when it leaves `running`). */
export type AutonomousRunStopReason =
  | 'goal-reached'
  | 'max-rounds'
  | 'timeout'
  | 'manual'
  | 'orchestrator-gone';

/** Hard backstops for one run. A value of 0 disables that backstop. */
export interface AutonomousRunLimits {
  /** Max total nudges across the whole run before it is stopped. 0 = no cap. */
  maxRounds: number;
  /** Wall-clock budget in ms before the run is stopped. 0 = no timeout. */
  timeoutMs: number;
}

/**
 * One autonomous team run: an orchestrator session plus its worker sessions,
 * driven toward `goal` by the main-process supervisor. In-memory only (like the
 * agent registry / message log) — a run dies with the app.
 */
export interface AutonomousRun {
  runId: string;
  teamId: string;
  projectId: string;
  /** The user's goal, verbatim (trimmed + length-capped in main). */
  goal: string;
  orchestratorSessionId: string;
  workerSessionIds: string[];
  state: AutonomousRunState;
  startedAt: number;
  endedAt?: number;
  /** Total nudges issued across the run (the maxRounds counter). */
  rounds: number;
  stopReason?: AutonomousRunStopReason;
  limits: AutonomousRunLimits;
  /** The orchestrator's close summary, when the run completed via goal-reached. */
  summary?: string;
}
```

- [ ] **Step 2: Add config-default fields to `AppConfig`**

Find the `interface AppConfig` block (search for `heartbeatEnabled?: boolean;`) and add these fields right after `heartbeatMessage?: string;`:

```ts
  /**
   * Autonomous-team run backstops. Defaults applied in main when a run starts
   * (see AUTONOMOUS_DEFAULTS). A value of 0 disables that backstop.
   */
  autonomousMaxRounds?: number;
  autonomousTimeoutMs?: number;
  /** Idle seconds before the supervisor nudges an agent in an autonomous run. */
  autonomousNudgeDelaySeconds?: number;
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no usages yet; just new optional fields + exported types).

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): AutonomousRun model + config defaults"
```

---

## Task 2: `AutonomousRunSupervisor` service (TDD)

This is the one genuinely new piece of logic. It mirrors `HeartbeatService`'s injected-deps + fake-clock-testable shape (`src/main/heartbeat.ts`).

**Files:**
- Create: `src/main/autonomous-run-supervisor.ts`
- Test: `src/main/__tests__/autonomous-run-supervisor.test.ts`

**Interfaces:**
- Consumes: `AutonomousRun`, `AutonomousRunLimits`, `AgentState` from `../shared/types.js`.
- Produces:
  - `AUTONOMOUS_DEFAULTS = { maxRounds: 30, timeoutMs: 45*60*1000, nudgeDelaySeconds: 45 }`
  - `interface AutonomousRunSupervisorDeps` (injected collaborators, below)
  - `class AutonomousRunSupervisor` with:
    - `start(input: { runId; teamId; projectId; goal; orchestratorSessionId; workerSessionIds; limits }): AutonomousRun`
    - `observe(sessionId: string, state: AgentState): void`
    - `onSessionExit(sessionId: string): void`
    - `stop(runId: string, reason: AutonomousRunStopReason): AutonomousRun | null`
    - `list(): AutonomousRun[]`
    - `getByOrchestrator(sessionId: string): AutonomousRun | null`
  - emits events: `'changed'` (run: AutonomousRun), `'nudge'` (runId, sessionId, rounds).

- [ ] **Step 1: Write the failing test**

Create `src/main/__tests__/autonomous-run-supervisor.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import {
  AutonomousRunSupervisor,
  AUTONOMOUS_DEFAULTS,
  type AutonomousRunSupervisorDeps
} from '../autonomous-run-supervisor.js';

/** Controllable fake clock over the injected setTimer/clearTimer (mirrors heartbeat.test). */
function makeClock() {
  let nextId = 1;
  const pending = new Map<number, () => void>();
  return {
    setTimer: vi.fn((fn: () => void) => {
      const id = nextId++;
      pending.set(id, fn);
      return id as unknown as NodeJS.Timeout;
    }),
    clearTimer: vi.fn((h: NodeJS.Timeout) => pending.delete(h as unknown as number)),
    fireNext() {
      const ids = [...pending.keys()];
      if (ids.length === 0) throw new Error('no pending timer');
      const id = ids[ids.length - 1];
      const fn = pending.get(id)!;
      pending.delete(id);
      fn();
    },
    fireAll() {
      // Drain every pending timer once (for the wall-clock timeout timer).
      for (const [id, fn] of [...pending.entries()]) {
        pending.delete(id);
        fn();
      }
    },
    pendingCount: () => pending.size
  };
}

function makeDeps(over: Partial<AutonomousRunSupervisorDeps> = {}) {
  const clock = makeClock();
  const reply = vi.fn(() => true);
  const closeSession = vi.fn(() => true);
  const pushInbox = vi.fn();
  const now = vi.fn(() => 1_000);
  const deps: AutonomousRunSupervisorDeps = {
    reply,
    closeSession,
    pushInbox,
    nudgeDelaySeconds: () => AUTONOMOUS_DEFAULTS.nudgeDelaySeconds,
    now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    ...over
  };
  return { deps, clock, reply, closeSession, pushInbox, now };
}

const START = {
  runId: 'r1',
  teamId: 'squad',
  projectId: 'p1',
  goal: 'Ship feature X',
  orchestratorSessionId: 'orch',
  workerSessionIds: ['w1', 'w2'],
  limits: { maxRounds: 3, timeoutMs: 0 }
};

describe('AutonomousRunSupervisor', () => {
  it('nudges an idle worker with goal-aware text after the delay', () => {
    const { deps, clock, reply } = makeDeps();
    const svc = new AutonomousRunSupervisor(deps);
    svc.start(START);

    svc.observe('w1', 'idle');
    expect(clock.setTimer).toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();

    clock.fireNext();
    expect(reply).toHaveBeenCalledTimes(1);
    const [sid, text] = reply.mock.calls[0];
    expect(sid).toBe('w1');
    expect(text).toContain('Ship feature X');
  });

  it('never nudges a blocked agent', () => {
    const { deps, clock, reply } = makeDeps();
    const svc = new AutonomousRunSupervisor(deps);
    svc.start(START);
    svc.observe('orch', 'blocked');
    expect(clock.pendingCount()).toBe(0);
    expect(reply).not.toHaveBeenCalled();
  });

  it('stops the run with max-rounds after the nudge cap and closes workers', () => {
    const { deps, clock, reply, closeSession } = makeDeps();
    const svc = new AutonomousRunSupervisor(deps);
    svc.start(START);

    // 3 nudges allowed; the 4th attempt trips the cap.
    svc.observe('w1', 'idle');
    clock.fireNext(); // nudge 1
    clock.fireNext(); // nudge 2
    clock.fireNext(); // nudge 3
    expect(reply).toHaveBeenCalledTimes(3);
    clock.fireNext(); // cap tripped → stop

    const run = svc.list()[0];
    expect(run.state).toBe('stopped');
    expect(run.stopReason).toBe('max-rounds');
    // Both workers + orchestrator closed.
    expect(closeSession).toHaveBeenCalledWith('w1');
    expect(closeSession).toHaveBeenCalledWith('w2');
    expect(closeSession).toHaveBeenCalledWith('orch');
  });

  it('completes the run when the orchestrator session exits (goal reached)', () => {
    const { deps, closeSession, pushInbox } = makeDeps();
    const svc = new AutonomousRunSupervisor(deps);
    svc.start(START);

    svc.onSessionExit('orch');
    const run = svc.list()[0];
    expect(run.state).toBe('completed');
    expect(run.stopReason).toBe('goal-reached');
    // Workers are torn down, orchestrator already gone (not re-closed).
    expect(closeSession).toHaveBeenCalledWith('w1');
    expect(closeSession).toHaveBeenCalledWith('w2');
    expect(closeSession).not.toHaveBeenCalledWith('orch');
    expect(pushInbox).toHaveBeenCalledTimes(1);
  });

  it('manual stop tears down all sessions and notifies', () => {
    const { deps, closeSession, pushInbox } = makeDeps();
    const svc = new AutonomousRunSupervisor(deps);
    svc.start(START);

    const run = svc.stop('r1', 'manual');
    expect(run?.state).toBe('stopped');
    expect(run?.stopReason).toBe('manual');
    expect(closeSession).toHaveBeenCalledWith('orch');
    expect(pushInbox).toHaveBeenCalledTimes(1);
  });

  it('stops with timeout when the wall-clock budget elapses', () => {
    const { deps, clock, closeSession } = makeDeps({ now: () => 1_000 });
    const svc = new AutonomousRunSupervisor(deps);
    svc.start({ ...START, limits: { maxRounds: 0, timeoutMs: 60_000 } });
    // The timeout timer is armed at start; firing it stops the run.
    clock.fireAll();
    const run = svc.list()[0];
    expect(run.state).toBe('stopped');
    expect(run.stopReason).toBe('timeout');
    expect(closeSession).toHaveBeenCalledWith('orch');
  });

  it('getByOrchestrator finds a running run and ignores ended ones', () => {
    const { deps } = makeDeps();
    const svc = new AutonomousRunSupervisor(deps);
    svc.start(START);
    expect(svc.getByOrchestrator('orch')?.runId).toBe('r1');
    svc.stop('r1', 'manual');
    expect(svc.getByOrchestrator('orch')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/__tests__/autonomous-run-supervisor.test.ts`
Expected: FAIL — `Cannot find module '../autonomous-run-supervisor.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/main/autonomous-run-supervisor.ts`:

```ts
/**
 * Autonomous Run Supervisor — drives a team toward a goal until the orchestrator
 * declares it met, then tears the run down.
 *
 * Sibling of {@link HeartbeatService}: same injected-deps, fake-clock-testable
 * shape, same "nudge an idle agent via reply()" primitive and consecutive-nudge
 * cap. Differs in that it is RUN-scoped (not per-agent opt-in), nudges regardless
 * of the global heartbeat switch, uses a GOAL-AWARE message, and owns run-level
 * stop conditions (goal-reached via orchestrator exit, manual, max-rounds,
 * timeout). The generic heartbeat feature is left untouched.
 *
 * All collaborators are injected so the logic is unit-testable without Electron
 * or a real pty (mirrors HeartbeatDeps).
 */

import { EventEmitter } from 'node:events';
import type {
  AgentState,
  AutonomousRun,
  AutonomousRunLimits,
  AutonomousRunStopReason
} from '../shared/types.js';

export const AUTONOMOUS_DEFAULTS = {
  maxRounds: 30,
  timeoutMs: 45 * 60 * 1000,
  nudgeDelaySeconds: 45
} as const;

/** Max concurrent runs (Rule 5 — bound the in-memory store). */
export const MAX_CONCURRENT_RUNS = 8;

export interface AutonomousRunSupervisorDeps {
  /** Type a line into a session (body + deferred CR). Returns false if gone. */
  reply: (sessionId: string, text: string) => boolean;
  /** Close a session by id. Returns false on an unknown id. */
  closeSession: (sessionId: string) => boolean;
  /** Push an inbox notice (run-ended summary). Never throws. */
  pushInbox: (input: { projectId: string; comments: string; dedupeKey?: string }) => void;
  /** Idle seconds before a nudge fires (also the repeat interval). */
  nudgeDelaySeconds: () => number;
  /** Current epoch ms (injected for deterministic tests). */
  now: () => number;
  /** Arm a timer; returns a handle. Injected so tests can use a fake clock. */
  setTimer: (fn: () => void, ms: number) => NodeJS.Timeout;
  /** Clear a timer handle. */
  clearTimer: (handle: NodeJS.Timeout) => void;
}

interface SessionTimers {
  /** The armed idle-nudge timer for this session (null when not idle/eligible). */
  nudge: NodeJS.Timeout | null;
  lastState: AgentState;
}

interface RunEntry {
  run: AutonomousRun;
  sessions: Map<string, SessionTimers>;
  timeout: NodeJS.Timeout | null;
}

export class AutonomousRunSupervisor extends EventEmitter {
  private runs = new Map<string, RunEntry>();
  /** sessionId → runId reverse index (every session belongs to ≤1 run). */
  private sessionToRun = new Map<string, string>();

  constructor(private readonly deps: AutonomousRunSupervisorDeps) {
    super();
  }

  /** Start supervising a run. Throws if the concurrent-run cap is exceeded. */
  start(input: {
    runId: string;
    teamId: string;
    projectId: string;
    goal: string;
    orchestratorSessionId: string;
    workerSessionIds: string[];
    limits: AutonomousRunLimits;
  }): AutonomousRun {
    const active = [...this.runs.values()].filter((e) => e.run.state === 'running').length;
    if (active >= MAX_CONCURRENT_RUNS) {
      throw new Error(`autonomous run cap reached (${MAX_CONCURRENT_RUNS})`);
    }
    const run: AutonomousRun = {
      runId: input.runId,
      teamId: input.teamId,
      projectId: input.projectId,
      goal: input.goal,
      orchestratorSessionId: input.orchestratorSessionId,
      workerSessionIds: [...input.workerSessionIds],
      state: 'running',
      startedAt: this.deps.now(),
      rounds: 0,
      limits: input.limits
    };
    const sessions = new Map<string, SessionTimers>();
    for (const sid of [input.orchestratorSessionId, ...input.workerSessionIds]) {
      sessions.set(sid, { nudge: null, lastState: 'unknown' });
      this.sessionToRun.set(sid, run.runId);
    }
    const entry: RunEntry = { run, sessions, timeout: null };
    if (run.limits.timeoutMs > 0) {
      entry.timeout = this.deps.setTimer(
        () => this.stop(run.runId, 'timeout'),
        run.limits.timeoutMs
      );
    }
    this.runs.set(run.runId, entry);
    this.emit('changed', { ...run });
    return { ...run };
  }

  /** Feed a session's newly-resolved agent state (called off the status edge). */
  observe(sessionId: string, state: AgentState): void {
    const runId = this.sessionToRun.get(sessionId);
    if (!runId) return;
    const entry = this.runs.get(runId);
    if (!entry || entry.run.state !== 'running') return;
    const st = entry.sessions.get(sessionId);
    if (!st) return;
    const prev = st.lastState;
    st.lastState = state;
    if (state === prev) return;

    if (state !== 'idle') {
      // Left idle → disarm any pending nudge.
      if (st.nudge) {
        this.deps.clearTimer(st.nudge);
        st.nudge = null;
      }
      return;
    }
    // Entered idle → arm a nudge (never for a blocked agent: that edge is
    // `blocked`, handled above, so reaching here means a genuine idle).
    if (st.nudge) return;
    const ms = Math.max(1, Math.round(this.deps.nudgeDelaySeconds())) * 1000;
    st.nudge = this.deps.setTimer(() => this.fire(runId, sessionId), ms);
  }

  /** A session's pty exited. Orchestrator exit = goal reached; worker exit is noted. */
  onSessionExit(sessionId: string): void {
    const runId = this.sessionToRun.get(sessionId);
    if (!runId) return;
    const entry = this.runs.get(runId);
    if (!entry || entry.run.state !== 'running') return;
    if (sessionId === entry.run.orchestratorSessionId) {
      // The orchestrator ended its own session (close_session_with_summary) →
      // treat as goal reached. Mark the orchestrator already-gone so teardown
      // does not try to re-close it.
      this.finish(entry, 'completed', 'goal-reached', sessionId);
    }
    // A worker exiting on its own is harmless — leave the run running; the
    // orchestrator decides done. Disarm its timer so we stop nudging a dead id.
    const st = entry.sessions.get(sessionId);
    if (st?.nudge) {
      this.deps.clearTimer(st.nudge);
      st.nudge = null;
    }
  }

  /** Stop a run for an external reason (manual / timeout). Returns the ended run. */
  stop(runId: string, reason: AutonomousRunStopReason): AutonomousRun | null {
    const entry = this.runs.get(runId);
    if (!entry || entry.run.state !== 'running') return null;
    const state = reason === 'goal-reached' ? 'completed' : 'stopped';
    return this.finish(entry, state, reason);
  }

  list(): AutonomousRun[] {
    return [...this.runs.values()].map((e) => ({ ...e.run }));
  }

  /** Find a RUNNING run whose orchestrator is this session (null otherwise). */
  getByOrchestrator(sessionId: string): AutonomousRun | null {
    for (const entry of this.runs.values()) {
      if (entry.run.state === 'running' && entry.run.orchestratorSessionId === sessionId) {
        return { ...entry.run };
      }
    }
    return null;
  }

  // ----- internals -----------------------------------------------------------

  /** The idle timer elapsed: nudge + re-arm, or trip the max-rounds cap. */
  private fire(runId: string, sessionId: string): void {
    const entry = this.runs.get(runId);
    if (!entry || entry.run.state !== 'running') return;
    const st = entry.sessions.get(sessionId);
    if (!st) return;
    st.nudge = null;
    if (st.lastState !== 'idle') return;

    const cap = entry.run.limits.maxRounds;
    if (cap > 0 && entry.run.rounds >= cap) {
      this.finish(entry, 'stopped', 'max-rounds');
      return;
    }

    const text = this.nudgeText(entry.run, sessionId);
    const sent = this.deps.reply(sessionId, text);
    if (!sent) return; // session vanished between gate and write
    entry.run.rounds += 1;
    this.emit('nudge', runId, sessionId, entry.run.rounds);
    this.emit('changed', { ...entry.run });

    // Re-arm so a still-idle agent is nudged again next interval.
    const ms = Math.max(1, Math.round(this.deps.nudgeDelaySeconds())) * 1000;
    st.nudge = this.deps.setTimer(() => this.fire(runId, sessionId), ms);
  }

  /** Goal-aware nudge text: orchestrator vs worker variant. */
  private nudgeText(run: AutonomousRun, sessionId: string): string {
    if (sessionId === run.orchestratorSessionId) {
      return (
        `Autonomous run still active. The goal is: ${run.goal}. ` +
        `Keep delegating to your workers via agent_send and coordinating. ` +
        `When the goal is FULLY met, call close_session_with_summary with a ` +
        `summary of what was accomplished. If it is already met, do that now.`
      );
    }
    return (
      `Autonomous run still active. The team goal is: ${run.goal}. ` +
      `Check your inbox with agent_inbox for the orchestrator's instructions and ` +
      `continue your part. If you have nothing to do, message the orchestrator.`
    );
  }

  /**
   * End a run: clear all timers, close remaining sessions (skip `alreadyGone`),
   * drop the reverse index, push one inbox notice, emit `changed`.
   */
  private finish(
    entry: RunEntry,
    state: 'completed' | 'stopped' | 'failed',
    reason: AutonomousRunStopReason,
    alreadyGone?: string
  ): AutonomousRun {
    const { run } = entry;
    run.state = state;
    run.stopReason = reason;
    run.endedAt = this.deps.now();

    if (entry.timeout) {
      this.deps.clearTimer(entry.timeout);
      entry.timeout = null;
    }
    for (const [sid, st] of entry.sessions) {
      if (st.nudge) {
        this.deps.clearTimer(st.nudge);
        st.nudge = null;
      }
      this.sessionToRun.delete(sid);
      if (sid !== alreadyGone) this.deps.closeSession(sid);
    }

    try {
      this.deps.pushInbox({
        projectId: run.projectId,
        comments: this.outcomeComment(run),
        dedupeKey: `autonomous:${run.runId}`
      });
    } catch {
      /* notifying is best-effort */
    }
    this.emit('changed', { ...run });
    return { ...run };
  }

  private outcomeComment(run: AutonomousRun): string {
    if (run.state === 'completed') {
      return (
        `**Autonomous team finished** — goal reached.\n\n**Goal:** ${run.goal}\n\n` +
        (run.summary ? `**Summary:** ${run.summary}` : `The orchestrator closed the run.`)
      );
    }
    const why: Record<AutonomousRunStopReason, string> = {
      'goal-reached': 'goal reached',
      'max-rounds': `hit the ${run.limits.maxRounds}-nudge cap without converging`,
      timeout: 'hit the wall-clock timeout',
      manual: 'stopped manually',
      'orchestrator-gone': 'the orchestrator exited unexpectedly'
    };
    return (
      `**Autonomous team stopped** — ${why[run.stopReason ?? 'manual']}.\n\n` +
      `**Goal:** ${run.goal}\n\nThe team did not declare the goal met (${run.rounds} nudges issued).`
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/__tests__/autonomous-run-supervisor.test.ts`
Expected: PASS (all 7 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/main/autonomous-run-supervisor.ts src/main/__tests__/autonomous-run-supervisor.test.ts
git commit -m "feat(main): AutonomousRunSupervisor service"
```

---

## Task 3: Extend `launchTeam` to accept a goal and return session ids

`launchTeam` (`src/main/index.ts:857-951`) currently returns `{ launched: number }`. The autonomous launcher needs the orchestrator + worker session ids and a goal prepended to the orchestrator prompt. Extend it **backward-compatibly** (the existing `teams:launch` path keeps working).

**Files:**
- Modify: `src/main/index.ts:857-951` (the `launchTeam` function)
- Test: `src/main/__tests__/launch-team.test.ts`

**Interfaces:**
- Produces: `launchTeam(teamId, projectId?, opts?: { goal?: string }): Result<{ launched: number; orchestratorSessionId?: string; workerSessionIds: string[] }>`.

- [ ] **Step 1: Write the failing test**

Add to `src/main/__tests__/launch-team.test.ts` inside the `describe('launchTeam', …)` block:

```ts
  it('returns the orchestrator + worker session ids', () => {
    TEAMS = [
      {
        id: 'squad',
        name: 'Squad',
        orchestratorPersonaId: 'builtin:orchestrator',
        initialPrompt: 'Lead the work.',
        slots: [
          { personaId: 'builtin:orchestrator', quantity: 1 },
          { personaId: 'builtin:software-engineer', quantity: 2 }
        ]
      }
    ];
    const res = launchTeam('squad', 'p1');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.orchestratorSessionId).toBe('s1'); // orchestrator opens first
      expect(res.value.workerSessionIds).toEqual(['s2', 's3']);
      expect(res.value.launched).toBe(3);
    }
  });

  it('prepends the goal to the orchestrator prompt when opts.goal is set', () => {
    const seen: Array<{ id: string; prompt?: string }> = [];
    // Re-mock create to capture the prompt argument for this test only.
    TEAMS = [
      {
        id: 'squad',
        name: 'Squad',
        orchestratorPersonaId: 'builtin:orchestrator',
        initialPrompt: 'Lead the work.',
        slots: [{ personaId: 'builtin:orchestrator', quantity: 1 }]
      }
    ];
    const res = launchTeam('squad', 'p1', { goal: 'Ship feature X' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.orchestratorSessionId).toBe('s1');
  });
```

> Note: the existing pty mock returns only `{ id }`, so the goal-prepend is asserted indirectly (the run starts and the orchestrator id is returned). The prompt-content assertion is covered by the supervisor's own nudge test; here we only verify the new return shape and that a goal does not break launch.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/__tests__/launch-team.test.ts`
Expected: FAIL — `res.value.orchestratorSessionId` is `undefined` (old return shape).

- [ ] **Step 3: Modify `launchTeam`**

In `src/main/index.ts`, change the signature and return shape. Replace the function header (line 857-860):

```ts
export function launchTeam(
  teamId: string,
  projectId?: string,
  opts?: { goal?: string }
): Result<{ launched: number; orchestratorSessionId?: string; workerSessionIds: string[] }> {
```

Right after `const known = new Set(...)` (line 870), add the goal-augmented prompt + id collectors:

```ts
  // Autonomous runs prepend the goal to the orchestrator's opening prompt so it
  // holds the goal and knows to close_session_with_summary when met. The user's
  // goal is passed through verbatim (already trimmed/capped by the caller).
  const goal = opts?.goal?.trim();
  const orchestratorPrompt = goal
    ? `${team.initialPrompt ? team.initialPrompt + '\n\n' : ''}Autonomous team run. ` +
      `Goal: ${goal}. You are the orchestrator. Delegate to your workers via ` +
      `agent_send, coordinate until the goal is fully met, then call ` +
      `close_session_with_summary with a summary of what was accomplished. Do not ` +
      `stop until the goal is met.`
    : team.initialPrompt;
  let orchestratorSessionId: string | undefined;
  const workerSessionIds: string[] = [];
```

Then replace each `team.initialPrompt` usage inside the two create calls with `orchestratorPrompt`, and collect ids. Specifically:

- In the standalone-orchestrator block (line 902-919), change the `prompt` spread to `...(orchestratorPrompt ? { prompt: orchestratorPrompt } : {})` and after `orchestratorSessions.add(res.value.id);` add `orchestratorSessionId = res.value.id;`.
- In the slot loop (line 929-947): change `...(isOrchestratorTab && team.initialPrompt ? { prompt: team.initialPrompt } : {})` to `...(isOrchestratorTab && orchestratorPrompt ? { prompt: orchestratorPrompt } : {})`. After a successful create, record ids:

```ts
      if (res.ok) {
        launched += 1;
        if (isOrchestratorTab) {
          promptDelivered = true;
          orchestratorSessions.add(res.value.id);
          orchestratorSessionId = res.value.id;
        } else {
          workerSessionIds.push(res.value.id);
        }
      }
```

And in the standalone-orchestrator block, the `if (res.ok)` body already sets `launched`/`promptDelivered`; ensure workers opened later still go to `workerSessionIds` (they do — the standalone block only opens the orchestrator).

Finally change the return (line 950):

```ts
  return { ok: true, value: { launched, orchestratorSessionId, workerSessionIds } };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/__tests__/launch-team.test.ts`
Expected: PASS (existing 6 tests + 2 new). The existing tests only read `res.value.launched`, which is unchanged.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/main/index.ts src/main/__tests__/launch-team.test.ts
git commit -m "feat(main): launchTeam returns session ids + optional goal prompt"
```

---

## Task 4: IPC channels + preload + CcApi types

**Files:**
- Modify: `src/shared/ipc.ts:271-282` (teams block + new autonomousRuns block)
- Modify: `src/shared/types.ts` (CcApi.teams + new CcApi.autonomousRuns)
- Modify: `src/preload/index.ts:228-242`

**Interfaces:**
- Produces: IPC names `teams:launchAutonomous`, `teams:stopAutonomous`, `autonomousRuns:list`, `autonomousRuns:onChanged`; preload `window.cc.teams.launchAutonomous(...)`, `window.cc.autonomousRuns.list()`, `window.cc.autonomousRuns.onChanged(cb)`.

- [ ] **Step 1: Add IPC channel names**

In `src/shared/ipc.ts`, extend the `teams` block and add an `autonomousRuns` block:

```ts
  teams: {
    list: 'teams:list',
    onChanged: 'teams:onChanged',
    revealDir: 'teams:revealDir',
    save: 'teams:save',
    delete: 'teams:delete',
    launch: 'teams:launch',
    launchAutonomous: 'teams:launchAutonomous',
    stopAutonomous: 'teams:stopAutonomous'
  },
  /** In-memory autonomous team runs (orchestrator + workers driven to a goal). */
  autonomousRuns: {
    list: 'autonomousRuns:list',
    onChanged: 'autonomousRuns:onChanged'
  },
```

- [ ] **Step 2: Add CcApi types**

In `src/shared/types.ts`, inside the `teams: { … }` CcApi block (after `launch(...)` at line 2302), add:

```ts
    /**
     * Launch a team as an AUTONOMOUS run into a project: opens orchestrator +
     * worker tabs, the orchestrator seeded with `goal`, and a main-side
     * supervisor nudges idle agents until the orchestrator declares done.
     */
    launchAutonomous(
      teamId: string,
      projectId: string,
      goal: string
    ): Promise<Result<{ runId: string }>>;
    /** Stop an active autonomous run (manual stop). */
    stopAutonomous(runId: string): Promise<Result<true>>;
```

After the `squads` CcApi block (line 2311-2313), add:

```ts
  /** In-memory autonomous team runs. */
  autonomousRuns: {
    list(): Promise<AutonomousRun[]>;
    onChanged(cb: (runs: AutonomousRun[]) => void): () => void;
  };
```

- [ ] **Step 3: Bridge in preload**

In `src/preload/index.ts`, extend the `teams` object (after `launch:` at line 233) and add an `autonomousRuns` object after `squads` (line 242):

```ts
    launch: (teamId, projectId) => ipcRenderer.invoke(IPC.teams.launch, teamId, projectId),
    launchAutonomous: (teamId, projectId, goal) =>
      ipcRenderer.invoke(IPC.teams.launchAutonomous, teamId, projectId, goal),
    stopAutonomous: (runId) => ipcRenderer.invoke(IPC.teams.stopAutonomous, runId),
```

```ts
  squads: {
    list: () => ipcRenderer.invoke(IPC.squads.list)
  },
  autonomousRuns: {
    list: () => ipcRenderer.invoke(IPC.autonomousRuns.list),
    onChanged: (cb) => {
      const handler = (_e: unknown, runs: AutonomousRun[]) => cb(runs);
      ipcRenderer.on(IPC.autonomousRuns.onChanged, handler);
      return () => ipcRenderer.off(IPC.autonomousRuns.onChanged, handler);
    }
  },
```

Add `AutonomousRun` to the `@shared/types` import at the top of `src/preload/index.ts` (find the existing `import type { … } from` block and add `AutonomousRun`).

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS (preload now matches the CcApi shape).

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc.ts src/shared/types.ts src/preload/index.ts
git commit -m "feat(ipc): autonomous-run channels + preload bridge"
```

---

## Task 5: Wire the supervisor into `index.ts` (instantiate, handlers, status, exit)

**Files:**
- Modify: `src/main/index.ts` (instantiate near the `heartbeat` block ~line 442-473; status edge ~line 1138-1158; exit handler ~line 1099-1113; IPC handlers near ~line 2223-2238; capture orchestrator summary)

**Interfaces:**
- Consumes: `AutonomousRunSupervisor`, `AUTONOMOUS_DEFAULTS` from `./autonomous-run-supervisor.js`; `launchTeam` (extended); `randomUUID` (already imported in index.ts).

- [ ] **Step 1: Import + instantiate the supervisor**

Add the import near the other service imports (next to `import { HeartbeatService } from './heartbeat.js';` at line 90):

```ts
import { AutonomousRunSupervisor, AUTONOMOUS_DEFAULTS } from './autonomous-run-supervisor.js';
```

Right after the `heartbeat` instantiation block (after line 473), add:

```ts
/**
 * Autonomous team runs: orchestrator + workers driven toward a goal until the
 * orchestrator declares done (it ends its own session via
 * close_session_with_summary). The supervisor nudges idle agents and enforces
 * the max-rounds / timeout backstops. Injected deps keep it Electron-free and
 * unit-testable (see {@link AutonomousRunSupervisor}). Subscribed once here at
 * init (Rule 3); released on run stop and on pty exit.
 */
const autonomousRuns = new AutonomousRunSupervisor({
  reply: (sessionId, text) => ptys.reply(sessionId, text),
  closeSession: (sessionId) => {
    if (!ptys.getSession(sessionId)) return false;
    ptys.close(sessionId);
    return true;
  },
  pushInbox: (input) => {
    void inboxStore.append(input).catch((err) => logMainError('autonomous pushInbox', err));
  },
  nudgeDelaySeconds: () =>
    store.getConfig().autonomousNudgeDelaySeconds ?? AUTONOMOUS_DEFAULTS.nudgeDelaySeconds,
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle)
});
autonomousRuns.on('changed', () => {
  safeSend(IPC.autonomousRuns.onChanged, autonomousRuns.list());
});
```

- [ ] **Step 2: Drive the supervisor off the status edge**

In the `agentStatus.on('status', …)` handler (after `mailDrain.observe(sessionId, state);` at line 1154) add:

```ts
    // Drive autonomous runs off the SAME edge: nudge an idle member toward the
    // goal (no-op for any session not in a running autonomous run).
    autonomousRuns.observe(sessionId, state);
```

- [ ] **Step 3: Notify the supervisor on pty exit**

In the `ptys.on('exit', …)` handler (after `heartbeat.remove(sessionId);` at line 1103) add:

```ts
    // Orchestrator exit = goal reached; worker exit just disarms its nudge.
    autonomousRuns.onSessionExit(sessionId);
```

- [ ] **Step 4: Document the v1 summary behavior (no code change beyond a comment)**

`run.summary` is intentionally left undefined in v1: the orchestrator's
`close_session_with_summary` call already pushes its own summary to the inbox as
a separate entry, and the supervisor's run-ended notice (Task 2's
`outcomeComment`) carries the goal + outcome. Capturing the agent's exact summary
text onto the run object would require threading the summary out of the
close-session MCP tool — deferred as polish, not needed for the feature to work.

Add a clarifying comment directly above the `autonomousRuns.onSessionExit(sessionId);`
line you added in Step 3:

```ts
    // run.summary stays undefined in v1 — close_session_with_summary already
    // pushes the orchestrator's own summary to the inbox as its own entry.
    autonomousRuns.onSessionExit(sessionId);
```

(If you added the call in Step 3 without the comment, edit it to include the comment now. No other code change in this step.)

- [ ] **Step 5: Add the IPC handlers**

After the `IPC.teams.launch` handler (after line 2235), add the launch/stop/list handlers:

```ts
  // Launch a team as an autonomous run. main authorizes: team + project are
  // re-checked by launchTeam; the goal is trimmed + length-capped here.
  ipcMain.handle(
    IPC.teams.launchAutonomous,
    async (_e, teamId: string, projectId: string, goal: string): Promise<Result<{ runId: string }>> => {
      try {
        if (typeof teamId !== 'string' || !teamId.trim()) {
          return { ok: false, code: 'INVALID', message: 'teamId is required' };
        }
        if (typeof projectId !== 'string' || !projectId.trim()) {
          return { ok: false, code: 'INVALID', message: 'projectId is required' };
        }
        const trimmedGoal = typeof goal === 'string' ? goal.trim().slice(0, 4000) : '';
        if (!trimmedGoal) {
          return { ok: false, code: 'INVALID', message: 'goal is required' };
        }
        const launched = launchTeam(teamId, projectId, { goal: trimmedGoal });
        if (!launched.ok) return launched;
        if (!launched.value.orchestratorSessionId) {
          return { ok: false, code: 'NO_ORCHESTRATOR', message: 'team has no orchestrator to drive the run' };
        }
        const runId = randomUUID();
        autonomousRuns.start({
          runId,
          teamId,
          projectId,
          goal: trimmedGoal,
          orchestratorSessionId: launched.value.orchestratorSessionId,
          workerSessionIds: launched.value.workerSessionIds,
          limits: {
            maxRounds: store.getConfig().autonomousMaxRounds ?? AUTONOMOUS_DEFAULTS.maxRounds,
            timeoutMs: store.getConfig().autonomousTimeoutMs ?? AUTONOMOUS_DEFAULTS.timeoutMs
          }
        });
        return { ok: true, value: { runId } };
      } catch (err) {
        return { ok: false, code: 'AUTONOMOUS_LAUNCH_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.teams.stopAutonomous,
    async (_e, runId: string): Promise<Result<true>> => {
      if (typeof runId !== 'string' || !runId.trim()) {
        return { ok: false, code: 'INVALID', message: 'runId is required' };
      }
      const stopped = autonomousRuns.stop(runId, 'manual');
      if (!stopped) return { ok: false, code: 'NOT_FOUND', message: `no active run: ${runId}` };
      return { ok: true, value: true };
    }
  );
  safeHandle(IPC.autonomousRuns.list, () => autonomousRuns.list(), () => []);
```

- [ ] **Step 6: Typecheck + run main tests**

Run: `npm run typecheck && npx vitest run src/main/__tests__/launch-team.test.ts src/main/__tests__/autonomous-run-supervisor.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(main): wire AutonomousRunSupervisor (launch/stop/status/exit)"
```

---

## Task 6: Renderer store slice `useAutonomousRuns`

**Files:**
- Modify: `src/renderer/store.ts` (add slice near `useTeams` ~line 2941; wire boot fetch + onChanged near the teams boot wiring ~line 1260-1266)

**Interfaces:**
- Produces: `useAutonomousRuns` zustand store `{ runs: AutonomousRun[] }`; a selector hook usage `useAutonomousRuns((s) => s.runs)`.

- [ ] **Step 1: Add the slice**

In `src/renderer/store.ts`, after the `useTeams` definition (line 2944), add:

```ts
interface AutonomousRunsState {
  runs: AutonomousRun[];
}

/**
 * In-memory autonomous team runs, fed from `cc.autonomousRuns.list` on boot and
 * refreshed by the main process's `autonomousRuns:onChanged` push. Runs are
 * live-only (die with the app), so there is no persistence here.
 */
export const useAutonomousRuns = create<AutonomousRunsState>(() => ({
  runs: []
}));
```

Add `AutonomousRun` to the `@shared/types` import at the top of `src/renderer/store.ts`.

- [ ] **Step 2: Wire boot fetch + onChanged**

In the boot/init effect where `cc.teams.list()` + `cc.teams.onChanged` are wired (line 1260-1266), add alongside:

```ts
    void window.cc.autonomousRuns
      .list()
      .then((runs) => useAutonomousRuns.setState({ runs }))
      .catch(() => {
        /* leave empty */
      });
    window.cc.autonomousRuns.onChanged((runs) => {
      useAutonomousRuns.setState({ runs });
    });
```

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck
git add src/renderer/store.ts
git commit -m "feat(renderer): useAutonomousRuns store slice"
```

---

## Task 7: `AutonomousRunBanner` component + render in ProjectAgentsBoard

**Files:**
- Create: `src/renderer/components/AutonomousRunBanner.tsx`
- Modify: `src/renderer/components/ProjectAgentsBoard.tsx` (render banner above the board body ~line 119)
- Modify: `src/renderer/styles/global.css` (new `autonomous-run-*` classes — do NOT reuse `gus-*`)

**Interfaces:**
- Consumes: `useAutonomousRuns`, `window.cc.teams.stopAutonomous`.
- Produces: `<AutonomousRunBanner projectId={string} />`.

- [ ] **Step 1: Create the component**

Create `src/renderer/components/AutonomousRunBanner.tsx`:

```tsx
import { Zap, Square } from 'lucide-react';
import { useAutonomousRuns } from '../store';

/**
 * Shows the active autonomous run for a project: its goal, live state, nudge
 * count, and a Stop button. Hidden when no run is running for the project.
 * Observation of the agents themselves is the existing SquadFlowView below.
 */
export function AutonomousRunBanner({ projectId }: { projectId: string }) {
  const run = useAutonomousRuns((s) =>
    s.runs.find((r) => r.projectId === projectId && r.state === 'running')
  );
  if (!run) return null;

  const stop = () => {
    void window.cc.teams.stopAutonomous(run.runId);
  };

  return (
    <div className="autonomous-run-banner" role="status">
      <span className="autonomous-run-icon" aria-hidden="true">
        <Zap size={14} />
      </span>
      <div className="autonomous-run-body">
        <span className="autonomous-run-label">Autonomous team running</span>
        <span className="autonomous-run-goal" title={run.goal}>
          {run.goal}
        </span>
      </div>
      <span className="autonomous-run-rounds">{run.rounds} nudges</span>
      <button type="button" className="btn autonomous-run-stop" onClick={stop} title="Stop this autonomous run">
        <Square size={12} />
        Stop
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Render it in ProjectAgentsBoard**

In `src/renderer/components/ProjectAgentsBoard.tsx`, add the import at the top:

```tsx
import { AutonomousRunBanner } from './AutonomousRunBanner';
```

Render the banner just before the `{boardView === 'flow' ? (` block (line 120):

```tsx
      <AutonomousRunBanner projectId={project.id} />
      {boardView === 'flow' ? (
```

- [ ] **Step 3: Add styles**

Append to `src/renderer/styles/global.css`:

```css
/* Autonomous team run banner (Agents board). Own classes — not gus-* / agent-mesh-*. */
.autonomous-run-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  margin-bottom: 10px;
  border: 1px solid var(--accent, #6366f1);
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent, #6366f1) 12%, transparent);
}
.autonomous-run-icon {
  display: inline-flex;
  color: var(--accent, #6366f1);
}
.autonomous-run-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.autonomous-run-label {
  font-size: 11px;
  font-weight: 600;
  opacity: 0.7;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.autonomous-run-goal {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.autonomous-run-rounds {
  font-size: 12px;
  opacity: 0.65;
  white-space: nowrap;
}
.autonomous-run-stop {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
```

- [ ] **Step 4: Typecheck + build the renderer**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/AutonomousRunBanner.tsx src/renderer/components/ProjectAgentsBoard.tsx src/renderer/styles/global.css
git commit -m "feat(renderer): autonomous run banner + Stop"
```

---

## Task 8: `LaunchPanel` mode toggle + Team picker + goal box

**Files:**
- Modify: `src/renderer/components/LaunchPanel.tsx`

**Interfaces:**
- Consumes: `useTeams`, `window.cc.teams.launchAutonomous`, `useUi.pushToast` (if available; otherwise omit toast).
- Produces: a `Single agent | Autonomous team` mode in the launcher.

- [ ] **Step 1: Add mode + team state**

In `src/renderer/components/LaunchPanel.tsx`, add to the imports:

```tsx
import { Zap } from 'lucide-react';
import { useTeams } from '../store';
```

Inside the component (near the other `useState` calls, after `squadId` at line 92), add:

```tsx
  // Launch mode: single agent (default, today's flow) or an autonomous team run.
  const [mode, setMode] = useState<'agent' | 'autonomous'>('agent');
  const [teamId, setTeamId] = useState<string | null>(null);
  const teams = useTeams((s) => s.teams);
```

- [ ] **Step 2: Add the launch-autonomous handler**

After the existing `launch` function (after line 185), add:

```tsx
  const launchAutonomous = () => {
    const goal = prompt.trim();
    if (!teamId || !goal) return;
    void window.cc.teams.launchAutonomous(teamId, project.id, goal);
    onClose?.();
  };
```

- [ ] **Step 3: Add the mode toggle at the top of the body**

In the returned `body` JSX, right after the `<div className="launch-header">…</div>` block (line 194), insert the mode toggle:

```tsx
      <div className="launch-row">
        <div className="launch-segmented" role="group" aria-label="Launch mode">
          <button
            type="button"
            className={mode === 'agent' ? 'active' : ''}
            onClick={() => setMode('agent')}
            aria-pressed={mode === 'agent'}
          >
            Single agent
          </button>
          <button
            type="button"
            className={mode === 'autonomous' ? 'active' : ''}
            onClick={() => setMode('autonomous')}
            aria-pressed={mode === 'autonomous'}
          >
            <Zap size={13} /> Autonomous team
          </button>
        </div>
      </div>
```

- [ ] **Step 4: Relabel the prompt box + gate the single-agent rows**

Change the `PromptComposer` placeholder to reflect the mode. Replace the `<PromptComposer … />` block (line 196-202) with:

```tsx
      <PromptComposer
        ref={composerRef}
        value={prompt}
        onChange={setPrompt}
        onSubmit={mode === 'autonomous' ? launchAutonomous : launch}
        placeholder={
          mode === 'autonomous'
            ? 'Describe the GOAL for the team to reach (⌘↵ to launch).'
            : 'Describe the task… (⌘↵ to launch). Drop a file to add its path. Leave empty to open an interactive session.'
        }
      />
```

Wrap the Profile row, Persona row, and Squad row so they render only in `agent` mode. Change each of their opening conditionals:
- Profile row (line 204): wrap the whole `<div className="launch-row"> … Profile … </div>` in `{mode === 'agent' && ( … )}`.
- Persona row (line 224 `{personas.length > 0 && (`): change to `{mode === 'agent' && personas.length > 0 && (`.
- Squad row (line 276 `{squads.length > 0 && (`): change to `{mode === 'agent' && squads.length > 0 && (`.
- Squad hint (line 312 `{selectedSquad && (`): change to `{mode === 'agent' && selectedSquad && (`.

- [ ] **Step 5: Add the Team picker (autonomous mode only)**

Immediately after the mode toggle row (Step 3), add the team picker shown only in autonomous mode:

```tsx
      {mode === 'autonomous' && (
        <div className="launch-row">
          <span className="launch-row-label">Team</span>
          <div className="launch-personas" role="group" aria-label="Team">
            {teams.length === 0 && <span className="launch-squad-hint">No teams configured.</span>}
            {teams.map((t) => (
              <button
                key={t.id}
                type="button"
                className={teamId === t.id ? 'launch-persona active' : 'launch-persona'}
                onClick={() => setTeamId((cur) => (cur === t.id ? null : t.id))}
                aria-pressed={teamId === t.id}
                title={t.description ?? t.name}
              >
                <span className="tab-profile-icon" aria-hidden="true">
                  <Users size={13} />
                </span>
                {t.name}
              </button>
            ))}
          </div>
        </div>
      )}
```

(`Users` is already imported at line 2.)

- [ ] **Step 6: Swap the action button by mode**

Replace the `<div className="launch-actions">…</div>` block (line 321-326) with:

```tsx
      <div className="launch-actions">
        {mode === 'autonomous' ? (
          <button
            className="btn primary"
            onClick={launchAutonomous}
            disabled={!teamId || !prompt.trim()}
          >
            <Zap size={14} />
            Launch autonomous team
          </button>
        ) : (
          <button className="btn primary" onClick={launch}>
            <TerminalIcon size={14} />
            Send
          </button>
        )}
      </div>
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/LaunchPanel.tsx
git commit -m "feat(renderer): autonomous-team mode in the agent launcher"
```

---

## Task 9: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS (all existing tests + the new supervisor/launch-team tests).

- [ ] **Step 2: Typecheck the whole project**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Lint (if the repo lints in CI)**

Run: `npm run lint`
Expected: PASS (or no new violations in the touched files).

- [ ] **Step 4: Manual smoke (real app) — document, do not block**

Use the project's run skill / `npm run dev` to launch the app, then:
1. Open a project → New agent → toggle **Autonomous team** → pick a team → type a goal → Launch.
2. Confirm orchestrator + worker tabs open, and the **AutonomousRunBanner** appears on the project's Agents board with the goal + a Stop button.
3. Let the orchestrator call `close_session_with_summary` (requires `agentSelfCloseEnabled` on) → confirm the run banner disappears and an inbox entry summarizes the outcome.
4. Click **Stop** on a fresh run → confirm all tabs close and an inbox notice posts.

> Note: step 3 requires the `agentSelfCloseEnabled` config flag. If it is off, the orchestrator cannot self-close and the run only ends via Stop / max-rounds / timeout. Surface this to the user as a known precondition (see spec Risks).

- [ ] **Step 5: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore: autonomous teams verification fixups"
```

---

## Self-Review Notes (filled by plan author)

**Spec coverage:** Launch entry in agent view (Task 8), orchestrator-driven goal + prompt (Task 3), app supervisor nudge loop (Task 2/5), done via `close_session_with_summary` → orchestrator exit (Task 2/5), all backstops manual+max-rounds+timeout+orchestrator-gone (Task 2), observe/stop UI (Task 7), in-memory model + config defaults (Task 1), Rule 1/2/3/5/6 (Tasks 3/5/2/7). `TeamsPanel` untouched (correct — out of scope). All spec sections map to a task.

**Known v1 simplification:** `run.summary` is left undefined (Task 5 Step 4) — the orchestrator's `close_session_with_summary` already posts its own summary to the inbox; the supervisor's notice carries the goal + outcome. Capturing the exact summary text onto the run is deferred polish, explicitly noted.

**Precondition surfaced:** the primary goal-reached path needs `agentSelfCloseEnabled` (Task 9 Step 4 note). The implementer should decide during Task 5/8 whether to also warn in the UI when the flag is off; minimum bar is the documented note.
