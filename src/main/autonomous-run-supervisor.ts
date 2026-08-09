/**
 * Autonomous Run Supervisor — drives a team toward a goal until the orchestrator
 * declares it met, then tears the run down.
 *
 * Sibling of HeartbeatService: same injected-deps, fake-clock-testable shape,
 * same "nudge an idle agent via reply()" primitive and consecutive-nudge cap.
 * Differs in that it is RUN-scoped (not per-agent opt-in), nudges regardless of
 * the global heartbeat switch, uses a GOAL-AWARE message, and owns run-level stop
 * conditions (goal-reached via orchestrator exit, manual, max-rounds, timeout).
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

/**
 * Max ENDED runs retained in memory (Rule 5 — the runs map would otherwise grow
 * unbounded as runs complete). On overflow the oldest ended run is evicted; the
 * just-finished run is always kept (it is the newest), so a caller reading it
 * back immediately after a stop still finds it. Running runs are never evicted.
 */
export const MAX_RETAINED_ENDED_RUNS = 20;

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
      if (st.nudge) {
        this.deps.clearTimer(st.nudge);
        st.nudge = null;
      }
      // Activity detected (transition to working/blocked) → reset the run timeout.
      this.resetTimeout(entry);
      return;
    }
    if (st.nudge) return;
    const ms = Math.max(1, Math.round(this.deps.nudgeDelaySeconds())) * 1000;
    st.nudge = this.deps.setTimer(() => this.fire(runId, sessionId), ms);
  }

  /**
   * The orchestrator declared the goal met (the `complete_autonomous_run` tool).
   * Records the summary, closes the WORKERS, and keeps the orchestrator tab OPEN
   * so its final summary stays on screen — the orchestrator id is passed as
   * `alreadyGone` to {@link finish}, which skips closing it. Returns the ended
   * run, or null if the session doesn't own a running run.
   */
  complete(orchestratorSessionId: string, summary?: string): AutonomousRun | null {
    const runId = this.sessionToRun.get(orchestratorSessionId);
    if (!runId) return null;
    const entry = this.runs.get(runId);
    if (!entry || entry.run.state !== 'running') return null;
    if (orchestratorSessionId !== entry.run.orchestratorSessionId) return null;
    if (summary && summary.trim()) entry.run.summary = summary.trim();
    // alreadyGone = the orchestrator → keep its tab open (the on-screen answer).
    return this.finish(entry, 'completed', 'goal-reached', orchestratorSessionId);
  }

  /**
   * A session's pty exited. Because completion is now an explicit action
   * ({@link complete}), an orchestrator exiting while the run is still `running`
   * means it went away WITHOUT declaring done — a failure (`orchestrator-gone`).
   * A worker exit just disarms its nudge; the run keeps going.
   */
  onSessionExit(sessionId: string): void {
    const runId = this.sessionToRun.get(sessionId);
    if (!runId) return;
    const entry = this.runs.get(runId);
    if (!entry || entry.run.state !== 'running') return;
    if (sessionId === entry.run.orchestratorSessionId) {
      this.finish(entry, 'failed', 'orchestrator-gone', sessionId);
      return;
    }
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

  /**
   * Reset the run's timeout timer when activity is detected. Converts the blunt
   * wall-clock cap into an idle/inactivity watchdog: legitimately long runs that
   * keep making progress (agent state transitions, nudges delivered) won't be
   * killed, but a genuinely stalled/runaway run still hits the backstop.
   */
  private resetTimeout(entry: RunEntry): void {
    if (entry.run.limits.timeoutMs <= 0) return; // timeout disabled
    if (entry.timeout) {
      this.deps.clearTimer(entry.timeout);
      entry.timeout = null;
    }
    entry.timeout = this.deps.setTimer(
      () => this.stop(entry.run.runId, 'timeout'),
      entry.run.limits.timeoutMs
    );
  }

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
    if (!sent) return;
    entry.run.rounds += 1;
    this.emit('nudge', runId, sessionId, entry.run.rounds);
    this.emit('changed', { ...entry.run });
    // Nudge delivered (agent still responding to idle) → reset the run timeout.
    this.resetTimeout(entry);

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
    this.evictEndedRuns();
    return { ...run };
  }

  /**
   * Enforce {@link MAX_RETAINED_ENDED_RUNS}: drop the oldest ENDED runs (by
   * endedAt) once the count of ended runs exceeds the cap. Running runs are
   * never touched. Keeps the map bounded without losing the freshest history.
   */
  private evictEndedRuns(): void {
    const ended = [...this.runs.values()]
      .filter((e) => e.run.state !== 'running')
      .sort((a, b) => (a.run.endedAt ?? 0) - (b.run.endedAt ?? 0));
    let over = ended.length - MAX_RETAINED_ENDED_RUNS;
    for (const e of ended) {
      if (over <= 0) break;
      this.runs.delete(e.run.runId);
      over -= 1;
    }
  }

  /**
   * The single consolidated overview written to the inbox when a run ends — the
   * one place to read "what the squad did" after the tabs are gone. Always
   * includes goal, outcome, and the run stats (agent count, nudges, duration);
   * the orchestrator's full summary is included whenever it was captured (every
   * goal-reached run; absent only when a backstop ended the run early).
   */
  private outcomeComment(run: AutonomousRun): string {
    const agentCount = 1 + run.workerSessionIds.length; // orchestrator + workers
    const mins =
      run.endedAt && run.startedAt
        ? Math.max(1, Math.round((run.endedAt - run.startedAt) / 60000))
        : null;
    const stats =
      `**Agents:** ${agentCount} · **Nudges:** ${run.rounds}` +
      (mins !== null ? ` · **Duration:** ~${mins}m` : '');

    if (run.state === 'completed') {
      return (
        `## ✅ Autonomous team finished — goal reached\n\n` +
        `**Goal:** ${run.goal}\n\n` +
        (run.summary
          ? `**Summary**\n\n${run.summary}\n\n`
          : `The orchestrator declared the goal met (no summary text provided).\n\n`) +
        stats +
        `\n\nThe orchestrator's tab was left open so you can review the full conversation.`
      );
    }
    const why: Record<AutonomousRunStopReason, string> = {
      'goal-reached': 'goal reached',
      'max-rounds': `hit the ${run.limits.maxRounds}-nudge cap without converging`,
      timeout: 'hit the wall-clock timeout',
      manual: 'stopped manually',
      'orchestrator-gone': 'the orchestrator exited before declaring the goal met'
    };
    return (
      `## ⏹ Autonomous team stopped — ${why[run.stopReason ?? 'manual']}\n\n` +
      `**Goal:** ${run.goal}\n\n` +
      (run.summary ? `**Last summary**\n\n${run.summary}\n\n` : '') +
      `The team did not declare the goal met.\n\n` +
      stats
    );
  }
}
