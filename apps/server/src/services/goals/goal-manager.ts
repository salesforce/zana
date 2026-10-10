import { LaunchSpawnError } from '../launch/coordinator.js';
import type { InspectWorkerLaunch } from '../launch/worker-recovery.js';
import type { MetadataPersistence } from '../projects/project-record-store.js';
import { createHash, randomUUID } from 'node:crypto';
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
} from '@zana-ai/zcc-domain/product';
import { providerCapabilities, seedPromptArgs } from '@zana-ai/zcc-domain/launch-provider';
import type { PtyManager } from '@zana-ai/zcc-host-daemon/pty';
import { applyUnattendedScheduledLaunch } from '@zana-ai/zcc-host-daemon/harness/unattended-launch';
import type { LaunchTerminal } from '../launch/terminal-launcher.js';
import type { TranscriptRef } from '../followups/idle-triage.js';
import type { IInboxStore } from '../inbox/inbox-store.js';
import { deleteGoal, globalDir, listAllGoals, projectDir, saveGoal } from './goal-store.js';
import type { store as Store } from '../projects/store.js';

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
  inspectWorkerLaunch?: InspectWorkerLaunch;
  persistence?: MetadataPersistence<Goal>;
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
  private remotePoll: NodeJS.Timeout | null = null;

  private lastChangedFingerprint: string | null = null;

  private fingerprint(): string {
    return createHash('sha1').update(JSON.stringify(this.list())).digest('hex');
  }

  /** Every 'changed' emit records what subscribers were last told, so polls can skip no-op reloads. */
  override emit(event: string | symbol, ...args: unknown[]): boolean {
    if (event === 'changed') this.lastChangedFingerprint = this.fingerprint();
    return super.emit(event, ...args);
  }

  /** Poll/reload paths only: announce the list when it differs from the last announced snapshot. */
  private emitChangedIfDifferent() {
    if (this.fingerprint() !== this.lastChangedFingerprint) this.emit('changed');
  }
  private serialTail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private epoch = 0;
  private evaluating = new Set<string>();

  private serial<T>(work: () => Promise<T>): Promise<T> {
    if (this.pending >= 100) return Promise.reject(new Error('Too many pending goal operations'));
    const epoch = this.epoch;
    this.pending++;
    const result = this.serialTail.then(() => {
      if (epoch !== this.epoch) throw new Error('Goal manager stopped');
      return work();
    });
    this.serialTail = result.then(() => { this.pending--; }, () => { this.pending--; });
    return result;
  }

  create(input: GoalCreateInput): Promise<Goal> { return this.serial(() => this.createNow(input)); }
  update(id: string, patch: GoalUpdateInput): Promise<Goal> { return this.serial(() => this.updateNow(id, patch)); }
  setStatus(id: string, status: GoalStatus): Promise<Goal | null> { return this.serial(() => this.setStatusNow(id, status)); }
  remove(id: string): Promise<void> { return this.serial(() => this.removeNow(id)); }
  runNow(id: string): Promise<Goal> { return this.serial(() => this.runNowInternal(id)); }
  /** Inspect only the reserved identities. This never starts or resumes work. */
  reconcile(id: string): Promise<boolean> { return this.serial(async () => {
    const live = this.live.get(id);
    if (!live) throw new Error('Goal not found');
    if (!live.goal.history.iterations.some(it => it.launchState === 'pending')) return true;
    if (live.goal.status !== 'paused') await this.commit(live, { ...live.goal, status: 'paused', updatedAt: new Date().toISOString() });
    return this.recoverPending(live);
  }); }
  loadAll(projects: Project[]): Promise<void> { return this.serial(() => this.loadAllNow(projects)); }
  onProjectRemoved(projectId: string): Promise<void> { return this.serial(async () => this.onProjectRemovedNow(projectId)); }
  attachReport(sessionId: string, summary: string): Promise<void> { return this.serial(() => this.attachReportNow(sessionId, summary)); }
  private retry(id: string): void {
    void this.serial(() => this.arm(id)).catch(error => this.log(`resume ${id}`, error));
  }

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
  private async loadAllNow(projects: Project[]) {
    // A refresh must not discard an in-flight launch or evaluator's ownership.
    if (this.hasAnyLiveSession() || this.evaluating.size) return;
    const epoch = this.epoch;
    const goals = this.deps?.persistence ? await this.deps.persistence.load() : listAllGoals(projects, (path, reason) =>
      this.log(`load ${path}`, `invalid goal file dropped: ${reason}`)
    );
    if (epoch !== this.epoch) return;
    for (const live of this.live.values()) this.clearRetry(live);
    this.live.clear(); this.startMsBySession.clear();
    for (const goal of goals) this.live.set(goal.id, this.makeLive(goal));
    for (const goal of goals) {
      // The process may have stopped after launch but before the acknowledgement
      // reached the metadata owner. Never replay that ambiguous side effect.
      if (goal.history.iterations.some(iteration => iteration.launchState === 'pending')) {
        try {
          if (await this.recoverPending(this.live.get(goal.id)!)) continue;
          if (goal.status !== 'paused') await this.finish(goal.id, 'paused', `Goal **${goal.title}** has an unconfirmed worker launch. Check its sessions before running it again.`);
        }
        catch (error) { this.log(`recover ${goal.id}`, error); }
        continue;
      }
      if (goal.status === 'active' && !this.hasLiveSessionFor(goal.id)) {
        try { await this.arm(goal.id); } catch (error) { this.log(`resume ${goal.id}`, error); }
      }
    }
    this.emitChangedIfDifferent();
  }

  private async createNow(input: GoalCreateInput): Promise<Goal> {
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
    await this.persist(goal);
    this.live.set(goal.id, this.makeLive(goal));
    if (goal.status === 'active') await this.arm(goal.id);
    this.emit('changed');
    return goal;
  }

  private async updateNow(id: string, patch: GoalUpdateInput): Promise<Goal> {
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
    await this.persist(next);
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
  private async setStatusNow(id: string, status: GoalStatus): Promise<Goal | null> {
    const live = this.live.get(id);
    if (!live) return null;
    if (status === 'active' && !(await this.recoverPending(live))) throw new Error('Unconfirmed worker launch; reconcile its session before resuming');
    await this.commit(live, { ...live.goal, status, updatedAt: new Date().toISOString() });
    if (status === 'active') {
      if (!this.hasLiveSessionFor(id)) await this.arm(id);
    } else {
      this.clearRetry(live);
    }
    this.emit('changed');
    return live.goal;
  }

  private async removeNow(id: string) {
    const live = this.live.get(id);
    if (!live) return;
    if (this.deps) {
      this.suppressWatchUntil = Date.now() + 1_000;
      if (this.deps.persistence) await this.deps.persistence.remove(live.goal);
      else if (!deleteGoal(id, this.deps.store.listProjects())) throw new Error('Goal could not be removed');
    }
    this.clearRetry(live); this.live.delete(id);
    for (const iteration of live.goal.history.iterations) if (iteration.sessionId) this.startMsBySession.delete(iteration.sessionId);
    this.emit('changed');
  }

  /** Force one iteration now (if none is live and the goal isn't terminal). */
  private async runNowInternal(id: string): Promise<Goal> {
    const live = this.live.get(id);
    if (!live) throw new Error(`goal not found: ${id}`);
    if (!(await this.recoverPending(live))) throw new Error('Unconfirmed worker launch; reconcile its session before resuming');
    if (live.goal.status !== 'active') {
      await this.commit(live, { ...live.goal, status: 'active', updatedAt: new Date().toISOString() });
    }
    if (!this.hasLiveSessionFor(id)) await this.arm(id);
    return live.goal;
  }

  stopAll() {
    this.epoch++;
    for (const live of this.live.values()) this.clearRetry(live);
    this.live.clear();
    // Every live goal is gone, so no session's finish will ever consume its
    // start-time entry — drop them all so the map can't leak across a stop/start
    // (Rule 3). A finish stamp only matters while its goal is live.
    this.startMsBySession.clear();
  }

  private onProjectRemovedNow(projectId: string) {
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
    if (this.deps?.persistence && !this.remotePoll) {
      this.remotePoll = setInterval(() => {
        if (!this.deps || this.pending || this.hasAnyLiveSession() || this.evaluating.size) return;
        void this.loadAll(this.deps.store.listProjects()).catch(error => this.log('metadata refresh', error));
      }, 15_000);
      this.remotePoll.unref();
    }
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
    if (this.deps) for (const p of this.deps.persistence?.localProjects() ?? this.deps.store.listProjects()) dirs.push(projectDir(p));
    for (const dir of dirs) this.attachWatcher(dir);
  }

  stopWatching() {
    if (this.remotePoll) { clearInterval(this.remotePoll); this.remotePoll = null; }
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
      void this.loadAll(this.deps.store.listProjects()).catch(error => this.log('reload', error));
    }, 250);
  }

  // ----- the loop -------------------------------------------------------------

  private makeLive(goal: Goal): Live {
    return { goal, iterIndexBySession: new Map(), retryTimer: null };
  }

  private async persist(goal: Goal) {
    if (!this.deps) return;
    this.suppressWatchUntil = Date.now() + 1_000;
    const epoch = this.epoch;
    if (this.deps.persistence) await this.deps.persistence.save(goal);
    else saveGoal(goal, this.deps.store.listProjects());
    if (epoch !== this.epoch) throw new Error('Goal manager stopped');
  }

  private async commit(live: Live, next: Goal) {
    await this.persist(next);
    if (this.live.get(next.id) !== live) throw new Error('Goal changed during save');
    live.goal = next;
  }

  /** Only the main-owned PTY inventory can confirm a reserved worker. A missing
   * session is ambiguous (host offline/restart), never authority to replay it. */
  private async recoverPending(live: Live): Promise<boolean> {
    const pending = live.goal.history.iterations.filter(it => it.launchState === 'pending');
    if (!pending.length) return true;
    const sessions = pending.map(it => it.sessionId ? this.deps?.ptys.getSession(it.sessionId) : null);
    const evidence = await Promise.all(pending.map((it, index) => {
      const session = sessions[index];
      if (session) return session.projectId === live.goal.projectId ? 'present' as const : 'unknown' as const;
      return it.sessionId ? this.deps?.inspectWorkerLaunch?.(live.goal.projectId, it.sessionId, { kind: 'automation', id: `goal:${live.goal.id}` }) ?? 'unknown' as const : 'unknown' as const;
    }));
    if (evidence.includes('unknown')) return false;
    const finished = evidence.some((value, index) => value !== 'present' || (sessions[index]!.status !== 'starting' && sessions[index]!.status !== 'running'));
    const recovered = new Map(pending.map((it, index) => [it, evidence[index]]));
    await this.commit(live, { ...live.goal, iteration: live.goal.iteration + evidence.filter(value => value !== 'not-started').length,
      status: finished ? 'paused' : live.goal.status, updatedAt: new Date().toISOString(),
      history: { ...live.goal.history, iterations: live.goal.history.iterations.map(it => !recovered.has(it) ? it
        : recovered.get(it) === 'present' ? { ...it, launchState: 'running' as const }
          : { ...it, launchState: 'failed' as const, finishedAt: new Date().toISOString(),
            ...(recovered.get(it) === 'exited' ? { verdict: 'unknown' as const } : {}),
            error: recovered.get(it) === 'not-started' ? 'Recovery confirmed the worker never started.' : 'Recovery confirmed the worker exited; its outcome was not evaluated.' }) } });
    this.reindex(live); this.emit('changed');
    return true;
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
    for (const [id, live] of this.live) {
      if (!live.goal.history.iterations.some(it => it.launchState === 'pending') && this.hasLiveSessionFor(id)) return true;
    }
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
  private async arm(id: string): Promise<void> {
    const live = this.live.get(id);
    if (!live || live.goal.status !== 'active' || this.hasLiveSessionFor(id) || this.evaluating.has(id)) return;
    if (live.goal.history.iterations.some(it => it.launchState === 'pending')) return;
    this.clearRetry(live);
    if (live.goal.iteration >= live.goal.maxIterations) {
      await this.finish(id, 'exhausted', `Goal **${live.goal.title}** reached its ${live.goal.maxIterations}-iteration limit.`);
      return;
    }
    if (this.countLiveGoalRuns() + this.pendingLaunches >= MAX_CONCURRENT_GOAL_RUNS) {
      live.retryTimer = setTimeout(() => this.retry(id), CAP_RETRY_MS);
      return;
    }
    await this.spawnIteration(id);
  }

  /**
   * Spawn one worker session for a goal: a headless, scheduled (so it files a
   * report and is never user-nudged), auto-closing claude session whose opening
   * prompt is the goal statement + criteria + last evaluator feedback. Records a
   * fresh {@link GoalIteration} carrying the session id.
   */
  private async spawnIteration(id: string) {
    const live = this.live.get(id);
    if (!live || !this.deps) return;
    const goal = live.goal;

    const project = this.deps.store.listProjects().find((p) => p.id === goal.projectId);
    if (!project) {
      await this.recordIteration(id, {
        id: randomUUID(),
        at: new Date().toISOString(),
        verdict: 'fail',
        error: `project ${goal.projectId} not found`
      });
      await this.finish(id, 'escalated', `Project not found for goal "${goal.title}".`);
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
      await this.recordIteration(id, {
        id: randomUUID(),
        at: new Date().toISOString(),
        verdict: 'fail',
        error: `profile "${effectiveProfile}" has no Stop-hook support; goal loops require a hook-capable provider (claude family) to signal turn completion`
      });
      await this.finish(
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
    const sessionId = randomUUID();
    const startedAt = new Date().toISOString();
    const startMs = Date.now();

    const launchOptions = {
      preallocatedSessionId: sessionId,
      projectId: project.id,
      profile,
      persona,
      cwd: project.path,
      cols: 80,
      rows: 24,
      config: this.deps.store.getConfig(),
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
    const unattendedLaunch = applyUnattendedScheduledLaunch(launchOptions);
    // Commit a launch reservation before external execution. A lost post-launch
    // acknowledgement remains pending and is paused on reload, never replayed.
    // Older app versions ignore launchState but understand paused. Persist that
    // safe status during the uncertain interval so downgrade cannot replay it.
    await this.recordIteration(id, { id: iterId, at: startedAt, sessionId, launchState: 'pending' }, 'paused');
    this.pendingLaunches++;
    let session: ReturnType<PtyManager['create']>;
    try {
      session = await this.deps.launchTerminal(unattendedLaunch, { kind: 'automation', id: `goal:${goal.id}` });
    } catch (error) {
      if (error instanceof LaunchSpawnError && error.code === 'LAUNCH_UNCONFIRMED') throw error;
      await this.recordLaunchFailure(id, iterId, startedAt, live, error);
      return;
    } finally { this.pendingLaunches--; }
    if (this.live.get(id) !== live) return;
    const next: Goal = { ...live.goal, status: goal.status, iteration: live.goal.iteration + 1, updatedAt: startedAt,
      history: { ...live.goal.history, iterations: live.goal.history.iterations.map(it => it.id === iterId ? { ...it, sessionId: session.id, launchState: 'running' as const } : it) } };
    // If this save fails, leave the durable reservation. Never treat an already
    // spawned worker as a failed launch or retry it automatically.
    await this.commit(live, next);
    this.reindex(live);
    this.startMsBySession.set(session.id, startMs);
    this.emit('changed');
  }

  private async recordLaunchFailure(id: string, iterId: string, startedAt: string, live: Live, err: unknown) {
    if (this.live.get(id) !== live) return;
    this.log(`spawn ${id}`, err);
    const message = err instanceof Error ? err.message : String(err);
    await this.recordIteration(id, { id: iterId, at: startedAt, verdict: 'fail', launchState: 'failed', error: message }, 'active');

    const cur = this.live.get(id);
    if (!cur || cur.goal.status !== 'active') return;
    // A launch failure counts as a non-progress round like a `fail` evaluator
    // verdict — a persistently broken launch (bad config, missing execution
    // target) must not retry forever just because it never reaches the
    // evaluator's budget check. Escalate once the stall limit is hit instead.
    if (trailingStall(cur.goal.history.iterations) >= cur.goal.noProgressLimit) {
      await this.finish(
        id,
        'escalated',
        `Goal **${cur.goal.title}** couldn't launch its worker (${cur.goal.noProgressLimit} attempt${cur.goal.noProgressLimit === 1 ? '' : 's'} failed to start) — needs you. Last error: ${message}`
      );
      return;
    }
    // Otherwise, a spawn failure (e.g. session cap) isn't the goal's fault —
    // retry later rather than burning the iteration budget.
    live.retryTimer = setTimeout(() => this.retry(id), CAP_RETRY_MS);
  }

  private startMsBySession = new Map<string, number>();

  /**
   * A goal worker finished its turn (Stop hook). Stamp the iteration, then run
   * the evaluator and branch. Returns the evaluation promise so callers/tests can
   * await it; the production caller ignores it (fire-and-forget).
   */
  async onAgentFinished(sessionId: string): Promise<void> {
    const id = await this.serial(async () => {
      const match = this.findBySession(sessionId);
      if (!match || this.evaluating.has(match.id)) return null;
      const live = this.live.get(match.id)!;
      if (!(await this.recoverPending(live))) return null;
      const it = live.goal.history.iterations[match.idx];
      if (it.verdict !== undefined) return null;
      const startMs = this.startMsBySession.get(sessionId);
      const durationMs = it.durationMs ?? (startMs !== undefined ? Math.max(0, Date.now() - startMs) : undefined);
      await this.commit(live, { ...live.goal, history: { ...live.goal.history, iterations: live.goal.history.iterations.map((entry, idx) =>
        idx === match.idx ? { ...it, finishedAt: new Date().toISOString(), ...(durationMs !== undefined ? { durationMs } : {}) } : entry) } });
      this.startMsBySession.delete(sessionId);
      this.evaluating.add(match.id); this.emit('changed');
      return match.id;
    });
    if (!id) return;
    try { await this.evaluateAndBranch(id, sessionId); }
    catch (error) { this.log(`evaluate ${id}`, error); }
    finally { this.evaluating.delete(id); }
  }

  /**
   * Attach an agent-authored run report to the iteration owning `sessionId`
   * (via the `schedule_report` MCP tool). Best-effort; merges so it's commutative
   * with the finish-time stamp.
   */
  private async attachReportNow(sessionId: string, summary: string): Promise<void> {
    const match = this.findBySession(sessionId);
    if (!match) return;
    const live = this.live.get(match.id)!;
    await this.commit(live, { ...live.goal, history: { ...live.goal.history,
      iterations: live.goal.history.iterations.map((it, idx) => idx === match.idx ? { ...it, report: summary } : it) } });
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

    // Evaluation runs outside the mutation queue so pause/delete remain usable.
    // Commit only to the same live goal, merging any report/edit made meanwhile.
    await this.serial(async () => {
      const cur = this.live.get(id);
      if (cur !== live) return;
      const index = cur.goal.history.iterations.findIndex(it => it.id === iteration.id);
      if (index < 0 || cur.goal.history.iterations[index].verdict !== undefined) return;
      await this.commit(cur, { ...cur.goal, updatedAt: new Date().toISOString(), history: { ...cur.goal.history,
        iterations: cur.goal.history.iterations.map((it, idx) => idx === index ? { ...it, ...parsed } : it) } });
      this.emit('changed');
      this.evaluating.delete(id);
      if (cur.goal.status !== 'active') return;
      if (parsed.verdict === 'pass') {
        await this.finish(id, 'achieved', `✅ Goal achieved: **${cur.goal.title}** (in ${cur.goal.iteration} iteration${cur.goal.iteration === 1 ? '' : 's'}). ${parsed.rationale}`.trim());
      } else if (cur.goal.iteration >= cur.goal.maxIterations) {
        await this.finish(id, 'exhausted', `Goal **${cur.goal.title}** hit its ${cur.goal.maxIterations}-iteration limit without passing. Last verdict: ${parsed.verdict} — ${parsed.rationale}`);
      } else if (trailingStall(cur.goal.history.iterations) >= cur.goal.noProgressLimit) {
        await this.finish(id, 'escalated', `Goal **${cur.goal.title}** stalled (${cur.goal.noProgressLimit} rounds without progress) — needs you. Last: ${parsed.rationale}`);
      } else { await this.arm(id); }
    });
  }

  /** Land a goal on a terminal status and push a one-line note to the inbox. */
  private async finish(id: string, status: GoalStatus, message: string) {
    const live = this.live.get(id);
    if (!live) return;
    this.clearRetry(live);
    await this.commit(live, { ...live.goal, status, updatedAt: new Date().toISOString() });
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

  private async recordIteration(id: string, iteration: GoalIteration, status?: GoalStatus) {
    const live = this.live.get(id);
    if (!live) return;
    const history = live.goal.history;
    await this.commit(live, { ...live.goal, status: status ?? live.goal.status, history: { ...history,
      iterations: [iteration, ...history.iterations.filter(it => it.id !== iteration.id)].slice(0, history.retain) } });
    this.reindex(live);
  }

  private reindex(live: Live) {
    live.iterIndexBySession.clear();
    live.goal.history.iterations.forEach((it, index) => {
      if (it.sessionId) live.iterIndexBySession.set(it.sessionId, index);
    });
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
