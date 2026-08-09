import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { watch, existsSync, mkdirSync, type FSWatcher } from 'node:fs';
import type {
  Goal,
  GoalCreateInput,
  GoalIteration,
  GoalStatus,
  GoalUpdateInput,
  GoalVerdict,
  LaunchProfileId,
  LlmRunResult,
  Persona,
  Project
} from '../shared/types.js';
import { providerCapabilities, seedPromptArgs } from '../shared/launch-provider.js';
import type { PtyManager } from './pty.js';
import type { LaunchTerminal } from './launch/terminal-launcher.js';
import type { TranscriptRef } from './idle-triage.js';
import type { IInboxStore } from './inbox-store.js';
import { deleteGoal, globalDir, listAllGoals, projectDir, saveGoal } from './goal-store.js';
import type { store as Store } from './store.js';

/**
 * Global ceiling on concurrently-running goal-worker sessions across ALL goals.
 * A single goal never stacks on itself (it only re-spawns after its own session
 * finishes), but N `active` goals all auto-resuming on boot would fire N workers
 * at once — a thundering herd that races git trees and spikes the machine. This
 * caps the herd; goals over the cap wait on a short retry timer. Sits well under
 * the scheduler's own cap and the pty MAX_LIVE_SESSIONS so the three don't fight.
 */
const MAX_CONCURRENT_GOAL_RUNS = 3;

/** How long to wait before retrying a spawn that was blocked by the cap. */
const CAP_RETRY_MS = 15_000;

/** Verdicts that count as "real progress" — they reset the no-progress stall counter. */
const PROGRESS_VERDICTS: ReadonlySet<GoalVerdict> = new Set<GoalVerdict>(['pass', 'partial']);

type Logger = (context: string, err: unknown) => void;

/** Input the evaluator micro-call needs; mirrors the `builtin:goal-evaluator` template vars. */
export interface GoalEvalVars {
  statement: string;
  criteria: string;
  lastTurn: string;
  report: string;
}

type Deps = {
  ptys: PtyManager;
  launchTerminal: LaunchTerminal;
  store: typeof Store;
  inbox?: IInboxStore;
  logger?: Logger;
  /** Resolve a persona id at spawn time (used by persona-bound goals; MVP uses profiles). */
  resolvePersona?: (id: string) => Persona | undefined;
  /** Read a finished session's last assistant prose (injected like idle-triage).
   *  Takes a session ref (not just cwd/claudeSessionId) so a provider whose
   *  transcript is located by other means — Codex resolves its rollout by
   *  `id` + `createdAt` — can be dispatched behind this one callback. */
  readLastTurn: (ref: TranscriptRef) => Promise<string>;
  /** Run the goal-evaluator prompt with the given vars; never throws. */
  runEvaluator: (vars: GoalEvalVars, dedupeKey: string) => Promise<LlmRunResult>;
};

interface Live {
  goal: Goal;
  /** Maps a spawned session id → its iteration index in `history.iterations`. */
  iterIndexBySession: Map<string, number>;
  /** Retry timer set when a spawn was blocked by the concurrency cap. */
  retryTimer: NodeJS.Timeout | null;
}

/**
 * Build the opening prompt handed to a goal-worker each iteration: the
 * objective, its success criteria as a checklist, and — on a re-spawn — the
 * evaluator's feedback from the previous attempt so the worker doesn't repeat
 * it. Pure; exported for tests.
 */
export function buildIterationPrompt(goal: Goal, lastFeedback?: GoalIteration): string {
  const lines: string[] = [];
  lines.push(`You are working toward this goal:\n\n${goal.statement.trim()}`);
  if (goal.successCriteria.length) {
    lines.push(
      'Success criteria (ALL must be met):\n' +
        goal.successCriteria.map((c) => `- ${c}`).join('\n')
    );
  }
  if (lastFeedback?.rationale) {
    const prog = lastFeedback.verdict ? `verdict: ${lastFeedback.verdict}. ` : '';
    lines.push(
      `A previous attempt fell short — ${prog}${lastFeedback.rationale}\n` +
        'Build on what exists; focus on the unmet criteria.'
    );
  }
  lines.push(
    'When done, summarize what you changed and which criteria you believe are now met, ' +
      'then file a run report via the schedule_report tool.'
  );
  return lines.join('\n\n');
}

/**
 * Parse the goal-evaluator's JSON reply into a verdict. Tolerant of stray prose
 * / code fences (extracts the first {...}). Defaults to **fail-if-uncertain**:
 * unparsable output, a missing/invalid verdict, or a `pass` with low confidence
 * never reads as achieved — a wrong "pass" silently ends the loop, which is far
 * worse than one extra iteration. Pure; exported for tests.
 */
export function parseGoalVerdict(
  text: string
): { verdict: GoalVerdict; rationale: string; confidence?: number } {
  const fallback = { verdict: 'unknown' as GoalVerdict, rationale: '' };
  if (!text.trim()) return fallback;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return fallback;
  let obj: unknown;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return fallback;
  }
  if (!obj || typeof obj !== 'object') return fallback;
  const raw = obj as Record<string, unknown>;
  const valid: GoalVerdict[] = ['pass', 'partial', 'fail'];
  if (typeof raw.verdict !== 'string' || !valid.includes(raw.verdict as GoalVerdict)) {
    return fallback;
  }
  let verdict = raw.verdict as GoalVerdict;
  const rationale = typeof raw.rationale === 'string' ? raw.rationale.trim().slice(0, 160) : '';
  let confidence: number | undefined;
  if (typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)) {
    confidence = Math.max(0, Math.min(1, raw.confidence));
  }
  // Fail-if-uncertain: a low-confidence "pass" is downgraded so the loop keeps
  // working rather than declaring victory on a shaky judgement.
  if (verdict === 'pass' && confidence !== undefined && confidence < 0.6) {
    verdict = 'partial';
  }
  return { verdict, rationale, confidence };
}

/**
 * Count the trailing run of non-progress verdicts (fail/unknown) in newest-first
 * history — the stall length. A `pass`/`partial` resets it. Pure; exported for tests.
 */
export function trailingStall(iterations: GoalIteration[]): number {
  let n = 0;
  for (const it of iterations) {
    if (it.verdict === undefined) continue; // not yet scored — ignore
    if (PROGRESS_VERDICTS.has(it.verdict)) break;
    n += 1;
  }
  return n;
}

/**
 * Event-driven goal loop. For each `active` goal it spawns a headless worker
 * session, waits for the Stop hook ({@link onAgentFinished}), runs the evaluator,
 * and branches: achieved → done; not-yet → re-spawn with feedback; capped or
 * stalled → escalate to the inbox.
 *
 * Lifetime contract matches the scheduler: runs only while the Electron main
 * process is alive (no daemon). On boot, `loadAll()` re-reads goals from disk and
 * auto-resumes any that were `active`.
 */
export class GoalManager extends EventEmitter {
  /** Coordinator commits are async; count in-flight workers before PTY appears. */
  private pendingLaunches = 0;
  private live = new Map<string, Live>();
  private deps: Deps | null = null;

  private watchers = new Map<string, FSWatcher>();
  private watchDebounce: NodeJS.Timeout | null = null;
  private suppressWatchUntil = 0;

  setDeps(deps: Deps) {
    this.deps = deps;
  }

  private log(context: string, err: unknown) {
    if (this.deps?.logger) this.deps.logger(context, err);
    // eslint-disable-next-line no-console
    else console.error(`[goals] ${context}:`, err);
  }

  list(): Goal[] {
    return [...this.live.values()].map((l) => l.goal);
  }

  /** Read every goal from disk and auto-resume `active` ones. Called on boot. */
  loadAll(projects: Project[]) {
    this.stopAll();
    const goals = listAllGoals(projects, (path, reason) =>
      this.log(`load ${path}`, `invalid goal file dropped: ${reason}`)
    );
    for (const goal of goals) {
      this.live.set(goal.id, this.makeLive(goal));
    }
    // Auto-resume after seeding the whole map, so the concurrency cap sees all
    // active goals at once rather than letting the first few race ahead.
    for (const goal of goals) {
      if (goal.status === 'active' && !this.hasLiveSessionFor(goal.id)) this.arm(goal.id);
    }
    this.emit('changed');
  }

  create(input: GoalCreateInput): Goal {
    if (!input.title?.trim()) throw new Error('title is required');
    if (!input.projectId) throw new Error('projectId is required');
    if (!input.statement?.trim()) throw new Error('statement is required');
    const now = new Date().toISOString();
    const goal: Goal = {
      id: randomUUID(),
      projectId: input.projectId,
      title: input.title.trim(),
      statement: input.statement.trim(),
      successCriteria: (input.successCriteria ?? [])
        .map((s) => s.trim())
        .filter(Boolean),
      driver: input.driver ?? 'native',
      assignment: input.assignment ?? { kind: 'profile', profile: 'claude-yolo' },
      cadence: input.cadence ?? { mode: 'continuous' },
      maxIterations:
        typeof input.maxIterations === 'number' && input.maxIterations > 0
          ? Math.min(100, Math.round(input.maxIterations))
          : 10,
      iteration: 0,
      noProgressLimit:
        typeof input.noProgressLimit === 'number' && input.noProgressLimit > 0
          ? Math.round(input.noProgressLimit)
          : 2,
      status: input.activate ? 'active' : 'draft',
      history: { retain: clampRetain(input.retain), iterations: [] },
      createdAt: now,
      updatedAt: now,
      source: input.scope ?? 'global'
    };
    this.persist(goal);
    this.live.set(goal.id, this.makeLive(goal));
    if (goal.status === 'active') this.arm(goal.id);
    this.emit('changed');
    return goal;
  }

  update(id: string, patch: GoalUpdateInput): Goal {
    const live = this.live.get(id);
    if (!live) throw new Error(`goal not found: ${id}`);
    const next: Goal = { ...live.goal };
    if (patch.title !== undefined) next.title = patch.title.trim();
    if (patch.statement !== undefined) next.statement = patch.statement.trim();
    if (patch.successCriteria !== undefined) {
      next.successCriteria = patch.successCriteria.map((s) => s.trim()).filter(Boolean);
    }
    if (patch.assignment !== undefined) next.assignment = patch.assignment;
    if (patch.cadence !== undefined) next.cadence = patch.cadence;
    if (patch.maxIterations !== undefined && patch.maxIterations > 0) {
      next.maxIterations = Math.min(100, Math.round(patch.maxIterations));
    }
    if (patch.noProgressLimit !== undefined && patch.noProgressLimit > 0) {
      next.noProgressLimit = Math.round(patch.noProgressLimit);
    }
    if (patch.retain !== undefined) next.history = { ...next.history, retain: clampRetain(patch.retain) };
    next.updatedAt = new Date().toISOString();
    this.persist(next);
    live.goal = next;
    this.emit('changed');
    return next;
  }

  /**
   * Arm (`active`), suspend (`paused`), or abandon (`cancelled`) a goal. Arming
   * spawns a worker if none is live; pausing/cancelling lets any in-flight worker
   * finish but does not re-spawn. A terminal goal (achieved/exhausted/escalated)
   * can be re-armed to `active` to take another run.
   */
  setStatus(id: string, status: GoalStatus): Goal | null {
    const live = this.live.get(id);
    if (!live) return null;
    live.goal = { ...live.goal, status, updatedAt: new Date().toISOString() };
    this.persist(live.goal);
    if (status === 'active') {
      if (!this.hasLiveSessionFor(id)) this.arm(id);
    } else {
      this.clearRetry(live);
    }
    this.emit('changed');
    return live.goal;
  }

  remove(id: string) {
    const live = this.live.get(id);
    if (live) this.clearRetry(live);
    this.live.delete(id);
    if (this.deps) {
      this.suppressWatchUntil = Date.now() + 1_000;
      deleteGoal(id, this.deps.store.listProjects());
    }
    this.emit('changed');
  }

  /** Force one iteration now (if none is live and the goal isn't terminal). */
  runNow(id: string): Goal {
    const live = this.live.get(id);
    if (!live) throw new Error(`goal not found: ${id}`);
    if (live.goal.status !== 'active') {
      live.goal = { ...live.goal, status: 'active', updatedAt: new Date().toISOString() };
      this.persist(live.goal);
    }
    if (!this.hasLiveSessionFor(id)) this.spawnIteration(id);
    return live.goal;
  }

  stopAll() {
    for (const live of this.live.values()) this.clearRetry(live);
    this.live.clear();
    // Every live goal is gone, so no session's finish will ever consume its
    // start-time entry — drop them all so the map can't leak across a stop/start
    // (Rule 3). A finish stamp only matters while its goal is live.
    this.startMsBySession.clear();
  }

  onProjectRemoved(projectId: string) {
    let dropped = 0;
    for (const id of [...this.live.keys()]) {
      const live = this.live.get(id);
      if (live?.goal.projectId === projectId) {
        this.clearRetry(live);
        // Drop any pending start-time stamps for this goal's sessions — with the
        // goal gone, onAgentFinished will never fire to clean them up (Rule 3).
        for (const it of live.goal.history.iterations) {
          if (it.sessionId) this.startMsBySession.delete(it.sessionId);
        }
        this.live.delete(id);
        dropped += 1;
      }
    }
    if (dropped > 0) this.emit('changed');
  }

  // ----- fs watching (external edits go live without restart) -----------------

  startWatching() {
    this.rebindWatchers();
  }

  rebindWatchers() {
    for (const w of this.watchers.values()) {
      try {
        w.close();
      } catch {
        /* already closed */
      }
    }
    this.watchers.clear();
    const dirs = [globalDir()];
    if (this.deps) for (const p of this.deps.store.listProjects()) dirs.push(projectDir(p));
    for (const dir of dirs) this.attachWatcher(dir);
  }

  stopWatching() {
    for (const w of this.watchers.values()) {
      try {
        w.close();
      } catch {
        /* already closed */
      }
    }
    this.watchers.clear();
    if (this.watchDebounce) {
      clearTimeout(this.watchDebounce);
      this.watchDebounce = null;
    }
  }

  private attachWatcher(dir: string) {
    if (this.watchers.has(dir)) return;
    try {
      if (!existsSync(dir)) {
        if (dir === globalDir()) mkdirSync(dir, { recursive: true });
        else return;
      }
      const w = watch(dir, { persistent: false }, () => this.scheduleReload());
      w.on('error', (err) => {
        this.log(`watch ${dir}`, err);
        try {
          w.close();
        } catch {
          /* already closed */
        }
        if (this.watchers.get(dir) === w) this.watchers.delete(dir);
      });
      this.watchers.set(dir, w);
    } catch (err) {
      this.log(`watch ${dir}`, err);
    }
  }

  private scheduleReload() {
    if (this.watchDebounce) clearTimeout(this.watchDebounce);
    this.watchDebounce = setTimeout(() => {
      this.watchDebounce = null;
      if (Date.now() < this.suppressWatchUntil) return;
      if (!this.deps) return;
      // Don't yank state from under an in-flight iteration — loadAll() clears the
      // session→iteration maps. Defer until no goal has a live worker.
      if (this.hasAnyLiveSession()) {
        this.scheduleReload();
        return;
      }
      this.loadAll(this.deps.store.listProjects());
    }, 250);
  }

  // ----- the loop -------------------------------------------------------------

  private makeLive(goal: Goal): Live {
    return { goal, iterIndexBySession: new Map(), retryTimer: null };
  }

  private persist(goal: Goal) {
    if (!this.deps) return;
    this.suppressWatchUntil = Date.now() + 1_000;
    saveGoal(goal, this.deps.store.listProjects());
  }

  private clearRetry(live: Live) {
    if (live.retryTimer) {
      clearTimeout(live.retryTimer);
      live.retryTimer = null;
    }
  }

  /** True if this goal has a spawned worker still running/starting. */
  private hasLiveSessionFor(id: string): boolean {
    const live = this.live.get(id);
    if (!live || !this.deps) return false;
    const aliveIds = new Set(
      this.deps.ptys
        .list(live.goal.projectId)
        .filter((s) => s.status === 'running' || s.status === 'starting')
        .map((s) => s.id)
    );
    return live.goal.history.iterations.some((it) => it.sessionId && aliveIds.has(it.sessionId));
  }

  private hasAnyLiveSession(): boolean {
    for (const id of this.live.keys()) if (this.hasLiveSessionFor(id)) return true;
    return false;
  }

  /** Count goal-worker sessions alive across ALL goals (backs the concurrency cap). */
  private countLiveGoalRuns(): number {
    if (!this.deps) return 0;
    const aliveByProject = new Map<string, Set<string>>();
    const aliveFor = (projectId: string) => {
      let set = aliveByProject.get(projectId);
      if (!set) {
        set = new Set(
          this.deps!.ptys
            .list(projectId)
            .filter((s) => s.status === 'running' || s.status === 'starting')
            .map((s) => s.id)
        );
        aliveByProject.set(projectId, set);
      }
      return set;
    };
    const counted = new Set<string>();
    for (const live of this.live.values()) {
      const alive = aliveFor(live.goal.projectId);
      for (const it of live.goal.history.iterations) {
        if (it.sessionId && alive.has(it.sessionId)) counted.add(it.sessionId);
      }
    }
    return counted.size;
  }

  /** Try to spawn the next iteration; if the cap is hit, retry shortly. */
  private arm(id: string) {
    const live = this.live.get(id);
    if (!live || live.goal.status !== 'active') return;
    this.clearRetry(live);
    if (this.countLiveGoalRuns() + this.pendingLaunches >= MAX_CONCURRENT_GOAL_RUNS) {
      live.retryTimer = setTimeout(() => this.arm(id), CAP_RETRY_MS);
      return;
    }
    this.spawnIteration(id);
  }

  /**
   * Spawn one worker session for a goal: a headless, scheduled (so it files a
   * report and is never user-nudged), auto-closing claude session whose opening
   * prompt is the goal statement + criteria + last evaluator feedback. Records a
   * fresh {@link GoalIteration} carrying the session id.
   */
  private spawnIteration(id: string) {
    const live = this.live.get(id);
    if (!live || !this.deps) return;
    const goal = live.goal;

    const project = this.deps.store.listProjects().find((p) => p.id === goal.projectId);
    if (!project) {
      this.recordIteration(id, {
        id: randomUUID(),
        at: new Date().toISOString(),
        verdict: 'fail',
        error: `project ${goal.projectId} not found`
      });
      this.finish(id, 'escalated', `Project not found for goal "${goal.title}".`);
      return;
    }

    // MVP: only profile assignments are wired. Persona/team binding lands later;
    // until then fall back to the profile (or claude-yolo) so the loop still runs.
    const profile: LaunchProfileId = goal.assignment.profile ?? 'claude-yolo';
    const persona =
      goal.assignment.kind === 'persona' && goal.assignment.personaId
        ? this.deps.resolvePersona?.(goal.assignment.personaId)
        : undefined;
    const effectiveProfile = persona?.baseProfile ?? profile;

    // The goal loop is STRUCTURALLY driven by the Stop hook ({@link onAgentFinished}):
    // it spawns a headless worker and waits for the hook to fire before scoring and
    // re-spawning. A provider without hook support (`supportsHooks` false — cursor
    // in v1) can never signal turn-end, so the loop would wait forever AND the
    // auto-closing pty would leak (headless runs are also excluded from the idle
    // reaper). Refuse the assignment honestly rather than spawn a run that can't be
    // driven or reclaimed. codex IS hook-capable now (its `-c hooks.Stop=…` bridge
    // fires the same callback), so it passes this gate. (Interactive/scheduled
    // non-hook runs are fine — only the goal loop hard-depends on the finish signal.)
    if (!providerCapabilities(effectiveProfile).supportsHooks) {
      this.recordIteration(id, {
        id: randomUUID(),
        at: new Date().toISOString(),
        verdict: 'fail',
        error: `profile "${effectiveProfile}" has no Stop-hook support; goal loops require a hook-capable provider (claude family) to signal turn completion`
      });
      this.finish(
        id,
        'escalated',
        `Goal "${goal.title}" is assigned to "${effectiveProfile}", which can't signal turn completion (no Stop hook). Reassign to a Claude profile to run this goal.`
      );
      return;
    }

    const lastScored = goal.history.iterations.find((it) => it.verdict !== undefined);
    const prompt = buildIterationPrompt(goal, lastScored);
    // Goal loops require a hook-capable (claude-family) profile — the gate above
    // escalates anything else — so this is always the positional path today; route
    // through the shared helper anyway so per-harness delivery stays in one place.
    const promptArgs = seedPromptArgs(effectiveProfile, prompt);

    const iterId = randomUUID();
    const startedAt = new Date().toISOString();
    const startMs = Date.now();

    const launchOptions = {
      projectId: project.id,
      profile,
      persona,
      cwd: project.path,
      cols: 80,
      rows: 24,
      config: this.deps.store.getConfig(),
      projectSettings: this.deps.store.getProjectSettings(project.id),
      extraArgs: promptArgs,
      title: `Goal: ${goal.title}`,
      remote: project.remote,
      autoCloseOnFinish: true,
      headless: true,
      scheduled: true,
      // The manager owns goal messaging (it pushes on terminal states), so the
      // per-iteration sessions stay silent rather than each spamming the inbox.
      inboxLevel: 'silent'
    } as const;
    let launched;
    try {
      launched = this.deps.launchTerminal(launchOptions, { kind: 'automation', id: `goal:${goal.id}` });
    } catch (err) {
      this.recordLaunchFailure(id, iterId, startedAt, live, err);
      return;
    }

    if (launched instanceof Promise) {
      this.pendingLaunches += 1;
      void launched.then(
        (session) => {
          this.pendingLaunches -= 1;
          this.finishLaunch(id, goal, iterId, startedAt, startMs, live, session);
        },
        (err) => {
          this.pendingLaunches -= 1;
          this.recordLaunchFailure(id, iterId, startedAt, live, err);
        }
      );
      return;
    }
    this.finishLaunch(id, goal, iterId, startedAt, startMs, live, launched);
  }

  private recordLaunchFailure(id: string, iterId: string, startedAt: string, live: Live, err: unknown) {
    this.log(`spawn ${id}`, err);
    const message = err instanceof Error ? err.message : String(err);
    this.recordIteration(id, { id: iterId, at: startedAt, verdict: 'fail', error: message });

    const cur = this.live.get(id);
    if (!cur || cur.goal.status !== 'active') return;
    // A launch failure counts as a non-progress round like a `fail` evaluator
    // verdict — a persistently broken launch (bad config, missing execution
    // target) must not retry forever just because it never reaches the
    // evaluator's budget check. Escalate once the stall limit is hit instead.
    if (trailingStall(cur.goal.history.iterations) >= cur.goal.noProgressLimit) {
      this.finish(
        id,
        'escalated',
        `Goal **${cur.goal.title}** couldn't launch its worker (${cur.goal.noProgressLimit} attempt${cur.goal.noProgressLimit === 1 ? '' : 's'} failed to start) — needs you. Last error: ${message}`
      );
      return;
    }
    // Otherwise, a spawn failure (e.g. session cap) isn't the goal's fault —
    // retry later rather than burning the iteration budget.
    live.retryTimer = setTimeout(() => this.arm(id), CAP_RETRY_MS);
  }

  private finishLaunch(
    id: string,
    goal: Goal,
    iterId: string,
    startedAt: string,
    startMs: number,
    live: Live,
    session: ReturnType<PtyManager['create']>
  ) {
    // Goal may be stopped/reloaded while durable coordinator commit is in
    // flight. Session remains valid, but stale loop state must not mutate.
    if (this.live.get(id) !== live) return;

    live.goal = { ...goal, iteration: goal.iteration + 1, updatedAt: startedAt };
    this.recordIteration(id, { id: iterId, at: startedAt, sessionId: session.id });
    // Stamp start time for duration accounting on finish.
    this.startMsBySession.set(session.id, startMs);
    this.emit('changed');
  }

  private startMsBySession = new Map<string, number>();

  /**
   * A goal worker finished its turn (Stop hook). Stamp the iteration, then run
   * the evaluator and branch. Returns the evaluation promise so callers/tests can
   * await it; the production caller ignores it (fire-and-forget).
   */
  onAgentFinished(sessionId: string): Promise<void> {
    const match = this.findBySession(sessionId);
    if (!match) return Promise.resolve();
    const { id, idx } = match;
    const live = this.live.get(id)!;
    const it = live.goal.history.iterations[idx];
    const startMs = this.startMsBySession.get(sessionId);
    this.startMsBySession.delete(sessionId);
    const finishedAt = new Date().toISOString();
    const durationMs =
      it.durationMs ?? (startMs !== undefined ? Math.max(0, Date.now() - startMs) : undefined);
    live.goal.history.iterations[idx] = { ...it, finishedAt, ...(durationMs !== undefined ? { durationMs } : {}) };
    this.persist(live.goal);
    this.emit('changed');
    return this.evaluateAndBranch(id, sessionId).catch((err) => {
      this.log(`evaluate ${id}`, err);
    });
  }

  /**
   * Attach an agent-authored run report to the iteration owning `sessionId`
   * (via the `schedule_report` MCP tool). Best-effort; merges so it's commutative
   * with the finish-time stamp.
   */
  attachReport(sessionId: string, summary: string): void {
    const match = this.findBySession(sessionId);
    if (!match) return;
    const live = this.live.get(match.id)!;
    const it = live.goal.history.iterations[match.idx];
    live.goal.history.iterations[match.idx] = {
      ...it,
      report: summary
    };
    this.persist(live.goal);
    this.emit('changed');
  }

  // ----- evaluation -----------------------------------------------------------

  private async evaluateAndBranch(id: string, sessionId: string): Promise<void> {
    const live = this.live.get(id);
    if (!live || !this.deps) return;
    // A paused/cancelled goal that still had a worker in flight must not re-spawn.
    if (live.goal.status !== 'active') return;

    const idx = live.goal.history.iterations.findIndex((it) => it.sessionId === sessionId);
    if (idx < 0) return;
    const iteration = live.goal.history.iterations[idx];

    const session = this.deps.ptys.getSession(sessionId);
    const lastTurn = await this.deps.readLastTurn({
      id: sessionId,
      profile: session?.profile ?? 'claude',
      cwd: session?.cwd ?? this.cwdForGoal(live.goal),
      claudeSessionId: session?.claudeSessionId,
      openCodeSessionId: session?.openCodeSessionId,
      createdAt: session?.createdAt
    });

    const result = await this.deps.runEvaluator(
      {
        statement: live.goal.statement,
        criteria: live.goal.successCriteria.map((c) => `- ${c}`).join('\n') || '(none specified)',
        lastTurn: lastTurn || '(the worker left no closing message)',
        report: iteration.report || '(no run report filed)'
      },
      `goal:${id}:${iteration.id}`
    );

    const parsed = result.ok
      ? parseGoalVerdict(result.text)
      : { verdict: 'unknown' as GoalVerdict, rationale: 'evaluator call failed' };

    // Stamp the verdict onto the iteration.
    const cur = this.live.get(id);
    if (!cur) return;
    const liveIdx = cur.goal.history.iterations.findIndex((it) => it.id === iteration.id);
    if (liveIdx >= 0) {
      cur.goal.history.iterations[liveIdx] = {
        ...cur.goal.history.iterations[liveIdx],
        verdict: parsed.verdict,
        rationale: parsed.rationale,
        confidence: parsed.confidence
      };
    }
    cur.goal.updatedAt = new Date().toISOString();
    this.persist(cur.goal);
    this.emit('changed');

    // Branch.
    if (parsed.verdict === 'pass') {
      this.finish(
        id,
        'achieved',
        `✅ Goal achieved: **${cur.goal.title}** (in ${cur.goal.iteration} iteration${cur.goal.iteration === 1 ? '' : 's'}). ${parsed.rationale}`.trim()
      );
      return;
    }
    if (cur.goal.iteration >= cur.goal.maxIterations) {
      this.finish(
        id,
        'exhausted',
        `Goal **${cur.goal.title}** hit its ${cur.goal.maxIterations}-iteration limit without passing. Last verdict: ${parsed.verdict} — ${parsed.rationale}`
      );
      return;
    }
    if (trailingStall(cur.goal.history.iterations) >= cur.goal.noProgressLimit) {
      this.finish(
        id,
        'escalated',
        `Goal **${cur.goal.title}** stalled (${cur.goal.noProgressLimit} rounds without progress) — needs you. Last: ${parsed.rationale}`
      );
      return;
    }
    // Not done, budget remains, still making progress → take another swing.
    this.arm(id);
  }

  /** Land a goal on a terminal status and push a one-line note to the inbox. */
  private finish(id: string, status: GoalStatus, message: string) {
    const live = this.live.get(id);
    if (!live) return;
    this.clearRetry(live);
    live.goal = { ...live.goal, status, updatedAt: new Date().toISOString() };
    this.persist(live.goal);
    this.emit('changed');
    void this.notifyInbox(live.goal, message);
  }

  private async notifyInbox(goal: Goal, message: string) {
    if (!this.deps?.inbox) return;
    const project = this.deps.store.listProjects().find((p) => p.id === goal.projectId);
    if (!project) return;
    try {
      await this.deps.inbox.append({
        projectId: project.id,
        projectLabel: project.name,
        // Stable heading for the goal's self-refreshing row — the goal title —
        // rather than the first line of the latest outcome message.
        subject: `Goal: ${goal.title}`,
        comments: message,
        // One self-refreshing row per goal rather than one per terminal event.
        dedupeKey: `goal:${project.id}:${goal.id}`,
        // Goal outcomes are something the user should see — surface inline + badge.
        notify: 'loud'
      });
    } catch (err) {
      this.log(`notifyInbox ${goal.id}`, err);
    }
  }

  // ----- helpers --------------------------------------------------------------

  private recordIteration(id: string, iteration: GoalIteration) {
    const live = this.live.get(id);
    if (!live) return;
    const h = live.goal.history;
    h.iterations = [iteration, ...h.iterations].slice(0, h.retain);
    // Rebuild the session→index map: an unshift shifts every entry right by one.
    live.iterIndexBySession.clear();
    h.iterations.forEach((it, i) => {
      if (it.sessionId) live.iterIndexBySession.set(it.sessionId, i);
    });
    this.persist(live.goal);
  }

  private findBySession(sessionId: string): { id: string; idx: number } | null {
    for (const [id, live] of this.live) {
      const mapped = live.iterIndexBySession.get(sessionId);
      if (mapped !== undefined && live.goal.history.iterations[mapped]?.sessionId === sessionId) {
        return { id, idx: mapped };
      }
      const idx = live.goal.history.iterations.findIndex((it) => it.sessionId === sessionId);
      if (idx >= 0) return { id, idx };
    }
    return null;
  }

  private cwdForGoal(goal: Goal): string {
    const project = this.deps?.store.listProjects().find((p) => p.id === goal.projectId);
    return project?.path ?? '';
  }
}

function clampRetain(n: number | undefined): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 20;
  return Math.max(1, Math.min(100, Math.round(n)));
}
