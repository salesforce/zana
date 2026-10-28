import { LaunchSpawnError } from '../launch/coordinator.js';
import type { InspectWorkerLaunch } from '../launch/worker-recovery.js';
import type { MetadataPersistence } from '../projects/project-record-store.js';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { isDeepStrictEqual } from 'node:util';
import { watch, existsSync, mkdirSync, type FSWatcher } from 'node:fs';
import type {
  Persona,
  Project,
  ScheduleCreateInput,
  ScheduledTask,
  ScheduleRun,
  ScheduleReloadResult,
  ScheduleRetryResult,
  ScheduleRunQuery,
  ScheduleRunQueryResult,
  ScheduleRunReasonCode,
  ScheduleRunRef,
  ScheduleRunConversation,
  ScheduleRunTrigger,
  ScheduleUpdateInput
} from '@zana-ai/zcc-domain/product';
import { MAX_INTERVAL_MS, MIN_INTERVAL_MS, parseEvery as parseEveryShared } from '@zana-ai/zcc-domain/parse-every';
import { nextCronRunAt } from '@zana-ai/zcc-domain/parse-cron';
import { isCronCadence, previousCronSlots, slotsBetween, validateCadence } from '@zana-ai/zcc-domain/schedule-spec';
import { collectRunRows, isOpenProblem, isProblemRun, isRecoveryMode, isValidConversationId, runReason, SCHEDULE_REASONS } from '@zana-ai/zcc-domain/schedule-health';
import { normalizeCatchUp, normalizeRetry } from './schedule-validation.js';
import { providerCapabilities, seedPromptArgs } from '@zana-ai/zcc-domain/launch-provider';
import { applyUnattendedScheduledLaunch } from '@zana-ai/zcc-host-daemon/harness/unattended-launch';
import { registrationFor } from '@zana-ai/zcc-host-daemon/harness/registry';
import type { PtyManager } from '@zana-ai/zcc-host-daemon/pty';
import type { LaunchTerminal } from '../launch/terminal-launcher.js';
import type { IInboxStore } from '../inbox/inbox-store.js';
import {
  deleteSchedule,
  globalDir,
  listAllSchedules,
  projectDir,
  readSchedule,
  saveSchedule
} from './scheduler-store.js';
import type { store as Store } from '../projects/store.js';

/** History buffer cap. Hand-editing `retain` higher in the JSON works, but
 *  we won't surface a bigger value than this in the UI. */
const MAX_RETAIN = 100;

/**
 * Default global ceiling on concurrently-running scheduled sessions across ALL
 * schedules (override: `AppConfig.scheduledRunConcurrency`, 1-20). Per-schedule `overlap:'skip'` stops a single schedule stacking on
 * itself, but says nothing across schedules: N schedules sharing an interval
 * (e.g. five "every 1h" jobs) all come due in the same tick and would fire N
 * `claude` processes at once — a thundering herd that spikes CPU/memory and
 * races the same git working tree. This caps the herd.
 *
 * 5 is a conservative cockpit value: a handful of background agents can run in
 * parallel without the machine noticing, while a sixth coincident fire waits
 * (queued, or skipped for its next interval) rather than piling on. It sits well under the pty
 * MAX_LIVE_SESSIONS (50) so the two caps don't fight — the scheduler self-limits
 * long before it could exhaust the pty manager's slots, leaving headroom for
 * the user's own interactive tabs.
 */
const DEFAULT_SCHEDULED_RUN_LIMIT = 5;
const MIN_SCHEDULED_RUN_LIMIT = 1;
const MAX_SCHEDULED_RUN_LIMIT = 20;

/**
 * Fallback max-runtime for a scheduled `autoCloseOnFinish` run whose provider
 * CANNOT signal turn-end (`canAutoCloseOnFinish` is false — cursor in v1). Claude
 * runs self-reap the instant the Stop hook fires, and codex now ALSO self-reaps
 * (its `-c hooks.Stop=…` bridge curls the same callback), so neither hits this;
 * but a headless cursor run with `autoCloseOnFinish` would otherwise sit alive
 * forever (the flag safely no-ops in `pty.ts` for want of a hook), leaking one
 * replyable pty per fire. This watchdog force-closes such a run after a generous
 * ceiling so a fleet of scheduled cursor jobs can't accumulate stuck sessions.
 * It's a COARSE timeout, not a finish detector — the run may still be working when
 * it fires — so the ceiling is deliberately high; a hook-capable provider (claude,
 * codex) is the way to get precise turn-end reaping.
 */
const SCHEDULED_NONHOOK_MAX_RUNTIME_MS = 30 * 60 * 1000; // 30 min

/** Bound a hook-capable parent that never receives its matching SubagentStop. */
const SCHEDULED_SUBAGENT_WAIT_TIMEOUT_MS = 10 * 60 * 1000; // 10 min

/** Squad executions have no PTY exit event. Poll durable terminal state while
 * any scheduled Squad run remains active, even when its cadence is paused. */
const SQUAD_OBSERVATION_INTERVAL_MS = 5_000;

export { parseEveryShared as parseEvery };

interface Live {
  task: ScheduledTask;
  timer: NodeJS.Timeout | null;
  /** Maps a fired session id → its index in `status.runs`, so the exit-time
   *  recordRun can update the right entry even when interleaved with other
   *  schedules' fires. */
  runIndexBySession: Map<string, number>;
  /** run.ids that have already been unshifted + counted. A long-lived run can
   *  be evicted from `status.runs` (past `retain`) by newer fires before its
   *  exit-time `recordRun` arrives; without this the exit tail would look like
   *  a brand-new run and get unshifted again — double-counting the fire and
   *  showing the run twice. Insertion-ordered + bounded so it can't grow
   *  unboundedly over the app's lifetime. */
  countedRunIds: Set<string>;
  /** True when a fire operation is actively launching and we haven't finished
   *  launching yet. Prevents simultaneous duplicate fires due to TOCTOU. */
  firing?: boolean;
  /** Runtime-only third term of the timing anchor: the newest slot already
   *  handed to the run queue. Unset until a queue exists; never persisted. */
  queuedThroughMs?: number;
  /** Runtime-only: a late gap handled without a marker (or whose marker write
   *  failed). Advances the timing anchor so the gap isn't re-fired; never
   *  persisted, so a restart re-detects the gap. */
  handledThroughMs?: number;
  /** The un-floored slot (epoch ms) the armed timer is for; the slot a scheduled
   *  fire covers. Set by `arm`. */
  targetAt?: number;
  /** Set by `arm` for a Classic interval schedule found long overdue (epoch ms of the
   *  arm): its gap is recorded as a marker at the next timer fire, never at load. */
  staleSince?: number;
}

function scheduledSquadObjective(task: ScheduledTask): string {
  return [task.prompt, task.description, task.name]
    .map(value => value?.trim())
    .find((value): value is string => Boolean(value))
    ?? '';
}

/** A run waiting for a free slot under the concurrency limit (design 6.4). */
interface QueueEntry {
  taskId: string;
  trigger: 'schedule' | 'catch-up' | 'retry';
  /** Epoch ms of the slot this entry covers. */
  slotAt?: number;
  retryOf?: string;
  attempt?: number;
  enqueuedAt: number;
  /** Run id reserved at enqueue so a marker can already point at the run. */
  runId?: string;
  /** Set when the slot was found late; the launched run gets a "ran late" chip. */
  lateCause?: 'asleep' | 'app-closed';
  /** An automatic retry (policy-driven): dropped on disable and on a later success. */
  auto?: true;
}

/** Run-queue bounds (Rule 5). */
const MAX_QUEUE_TOTAL = 200;
const MAX_QUEUE_CATCH_UP_PER_TASK = 10;
/** An auto-retry timer never fires sooner than this after (re)arming. */
const RETRY_MIN_DELAY_MS = 5_000;
/** How long `retryRuns` waits for its launches before answering "queued" (CLI control timeout is 10 s). */
const RETRY_REPORT_WAIT_MS = 4_000;
/** A stored timing anchor later than now by more than this (clock skew, a crafted file) is ignored. */
const FUTURE_ANCHOR_TOLERANCE_MS = 60_000;
const MAX_SLOT_ITERATIONS = 1000;

type DeferredClose = {
  taskId: string;
  runId?: string;
  timeout: NodeJS.Timeout;
};

/** Cap on {@link Live.countedRunIds}. Comfortably above any real `retain` so an
 *  in-flight run's id survives long enough to be recognized on exit, but bounded
 *  so the set can't leak. */
const COUNTED_RUN_IDS_CAP = 512;

type Logger = (context: string, err: unknown) => void;

/**
 * Compare-and-swap guard for a main-owned write-back (plan correction). Never
 * persisted: `expectedPrompt` is the trimmed prompt the caller observed; the
 * update is rejected with {@link ScheduleConflictError} unless the current
 * definition on disk still has that prompt.
 */
export type ScheduleUpdatePatch = ScheduleUpdateInput & { expectedPrompt?: string };

/** Thrown when a guarded update finds the definition edited since it was observed. */
export class ScheduleConflictError extends Error {
  readonly code = 'DEFINITION_CONFLICT' as const;
  constructor(readonly scheduleId: string) {
    super(`schedule ${scheduleId} prompt was edited since this run launched`);
    this.name = 'ScheduleConflictError';
  }
}

/** Options of the private `fire`. */
interface FireOptions {
  manual: boolean;
  /** Absent = the timer (`schedule`); `manual` is derived from `manual`. */
  trigger?: ScheduleRunTrigger;
  /** Epoch ms of the slot this fire covers. */
  slotAt?: number;
  /** Root run id of a retry chain. */
  retryOf?: string;
  attempt?: number;
  /** Reserved run id (queue entries carry the id a marker already references). */
  runId?: string;
  /** Launched from the run queue: never re-enqueues, and skips late assessment. */
  fromQueue?: boolean;
  /** Carried from the queue entry: the slot was found late for this cause. */
  lateCause?: 'asleep' | 'app-closed';
  /** Epoch ms the timer callback ran: lateness is measured here, not after the serial-queue wait. */
  firedAt?: number;
  /** An automatic (policy-driven) retry, carried from its queue entry. */
  auto?: true;
}

/** What a timer fire found out about the gap since the last handled slot. */
interface LateInfo {
  late: boolean;
  /** Epoch ms of the newest slot. */
  last: number;
  /** Epoch ms of the oldest slot in the gap. */
  first: number;
  /** The accounting floor the gap started from (epoch ms). */
  floor: number;
  count: number;
  lateByMs: number;
  cause: 'asleep' | 'app-closed';
  /** Interval cadences: the slot spacing (ms); slots sit on the anchor's grid. */
  intervalMs?: number;
}

/** A fire starting more than this after its slot is "late". */
const LATE_THRESHOLD_MS = 60_000;
/** Longest `message` we keep on a run. */
const MAX_RUN_MESSAGE = 500;
/** Older open problems kept beyond `retain`, and the absolute history ceiling. */
const MAX_KEPT_PROBLEMS = 20;
const MAX_REF_RETRY = 50;
const MAX_REF_DISMISS = 200;

/** `trigger` / `attempt` / slot bookkeeping stamped on every run record a fire writes. */
function runMeta(opts: FireOptions): Pick<ScheduleRun, 'trigger' | 'attempt' | 'slotAt' | 'retryOf'> {
  return {
    trigger: opts.manual ? 'manual' : opts.trigger ?? 'schedule',
    attempt: opts.attempt ?? 1,
    ...(opts.slotAt !== undefined && Number.isFinite(opts.slotAt) ? { slotAt: new Date(opts.slotAt).toISOString() } : {}),
    ...(opts.retryOf ? { retryOf: opts.retryOf } : {})
  };
}

/** "Ran late" fields for a fire's reservation: from this fire's own assessment, or carried from its queue entry. */
function lateFields(opts: FireOptions, late: LateInfo | undefined): Pick<ScheduleRun, 'lateByMs' | 'lateCause'> {
  if (late?.late) return { lateByMs: late.lateByMs, lateCause: late.cause };
  if (opts.lateCause && opts.slotAt !== undefined) return { lateByMs: Math.max(0, Date.now() - opts.slotAt), lateCause: opts.lateCause };
  return {};
}

/**
 * Bound a run history (newest first). Unresolved records (a pending launch
 * reservation, a live Squad run) are ownership state and always kept; their
 * own bound lives in the loader. Finished records keep the newest `retain`,
 * plus up to 20 older open problems, never more than 100 in total.
 */
export function trimRuns(
  runs: ScheduleRun[],
  retain: number,
  nowMs: number,
  isUnresolved: (run: ScheduleRun) => boolean = run => run.launchState === 'pending'
): ScheduleRun[] {
  const kept: ScheduleRun[] = [];
  const cap = Math.min(retain, MAX_RETAIN);
  let terminal = 0;
  let extra = 0;
  for (const run of runs) {
    if (isUnresolved(run)) kept.push(run);
    else if (terminal < cap) { kept.push(run); terminal++; }
    else if (extra < MAX_KEPT_PROBLEMS && terminal + extra < MAX_RETAIN && isOpenProblem(run, nowMs)) { kept.push(run); extra++; }
  }
  return kept;
}

type Deps = {
  inspectWorkerLaunch?: InspectWorkerLaunch;
  persistence?: MetadataPersistence<ScheduledTask>;
  ptys: PtyManager;
  launchTerminal: LaunchTerminal;
  store: typeof Store;
  inbox?: IInboxStore;
  logger?: Logger;
  /**
   * Resolve a persona id to its merged {@link Persona} at fire time, or
   * undefined if unknown. Injected (rather than importing the store directly)
   * so the scheduler stays decoupled — same pattern as `store`/`inbox`. Absent
   * resolver = personas unavailable; a task's `personaId` is then ignored.
   */
  resolvePersona?: (id: string) => Persona | undefined;
  /** Main-owned Task lifecycle state. Never accept this count from a hook request. */
  getPendingSubagentCount?: (sessionId: string) => number;
  /** Main-authorized durable squad launch. Scheduler never expands teams or trusts renderer input. */
  launchSquad?: (input: { schedule: ScheduledTask; project: Project; runId: string; objective: string }) => Promise<{ executionId: string }>;
  getSquadExecution?: (projectId: string, executionId: string) => Promise<{ state: string; finalSummary?: string } | undefined>;
  findSquadExecution?: (projectId: string, launchRequestId: string) => Promise<{ executionId: string; state: string; finalSummary?: string } | undefined>;
};

/**
 * In-process scheduler. Holds a setTimeout per enabled task and recomputes
 * `nextRunAt` after every fire so wall-clock drift doesn't accumulate.
 *
 * Lifetime contract: scheduler runs only while the Electron main process is
 * alive. There is no daemon and no OS cron — closing the app stops fires.
 * On boot, `loadAll()` re-reads all schedules from disk and computes the
 * next fire as `max(now + 5s, lastRunAt + every)`. The 5s grace prevents
 * a fire-storm on relaunch when many overdue schedules pile up.
 */
export class SchedulerManager extends EventEmitter {
  private live = new Map<string, Live>();
  /**
   * Fallback max-runtime watchdogs, keyed by the fired session id. Only armed
   * for a scheduled `autoCloseOnFinish` run on a provider that can't signal
   * turn-end (codex/cursor); cleared on that session's exit and on teardown
   * (Rule 3). See {@link SCHEDULED_NONHOOK_MAX_RUNTIME_MS}.
   */
  private nonHookWatchdogs = new Map<string, NodeJS.Timeout>();
  /** Hook-capable auto-close sessions waiting for background Task completion. */
  private deferredCloses = new Map<string, DeferredClose>();
  /** Custom run-duration watchdogs, keyed by the fired session id. */
  private maxDurationWatchdogs = new Map<string, NodeJS.Timeout>();
  /** Sessions that timed out, so onExit can record the proper error message. */
  private timedOutSessions = new Set<string>();
  /** Coordinator commits are async; count in-flight launches before PTY appears. */
  private pendingLaunches = 0;
  /** Runs waiting for a free slot, FIFO. In-memory only (design 6.4). */
  private queue: QueueEntry[] = [];
  private draining = false;
  /** Why a queue entry's launch threw, for `retryRuns` to report. */
  private launchErrors = new WeakMap<QueueEntry, string>();
  /** One auto-retry timer per task (design 6.5). */
  private retryTimers = new Map<string, NodeJS.Timeout>();
  /** Lazily set after the window opens. We don't fire before then. */
  private deps: Deps | null = null;
  /** When this scheduler first loaded; a slot older than this was missed while
   *  Zana was closed, a newer one while the machine slept. Set once. */
  private startedAtMs = Date.now();
  private started = false;

  /** fs.watch handles, keyed by the watched directory path. */
  private watchers = new Map<string, FSWatcher>();
  private watchDebounce: NodeJS.Timeout | null = null;
  private deferredReloads = new Set<string>();
  /** Delay watcher reads after writes; events are postponed, never discarded. */
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
  private exitListeners = new Map<string, () => void>();
  /** One shared terminal-state observer for all active scheduled Squad runs. */
  private squadObservationTimer: NodeJS.Timeout | null = null;

  private serial<T>(work: () => Promise<T>): Promise<T> {
    if (this.pending >= 100) return Promise.reject(new Error('Too many pending scheduler operations'));
    const epoch = this.epoch;
    this.pending++;
    const result = this.serialTail.then(() => {
      if (epoch !== this.epoch) throw new Error('Scheduler stopped');
      return work();
    });
    this.serialTail = result.then(() => { this.pending--; }, () => { this.pending--; });
    return result;
  }

  create(input: ScheduleCreateInput): Promise<ScheduledTask> { return this.serial(() => this.createNow(input)); }
  update(id: string, patch: ScheduleUpdatePatch): Promise<ScheduledTask> { return this.serial(() => this.updateNow(id, patch)); }
  setEnabled(id: string, enabled: boolean): Promise<ScheduledTask | null> { return this.serial(() => this.setEnabledNow(id, enabled)); }
  remove(id: string): Promise<void> { return this.serial(() => this.removeNow(id)); }
  runNow(id: string): Promise<ScheduledTask> { return this.serial(() => this.runNowInternal(id)); }
  get(id: string): ScheduledTask {
    const live = this.live.get(id);
    if (!live) throw new Error(`schedule not found: ${id}`);
    return structuredClone(live.task);
  }
  reload(id: string): Promise<ScheduleReloadResult> {
    return this.serial(async () => {
      const live = this.live.get(id);
      if (!live) throw new Error(`schedule not found: ${id}`);
      this.deps?.ptys.reapDeadSessions();
      const sessionIds = this.liveSessions(live);
      if (this.hasUnresolvedRun(live)) {
        this.deferredReloads.add(id);
        this.scheduleReload();
        return { reloaded: false, schedule: this.get(id), reason: sessionIds.length ? `run ${sessionIds.join(', ')} is live` : 'run is unresolved', sessionIds };
      }
      const task = await this.readCurrent(live.task);
      await this.replaceDefinition(live, task);
      this.deferredReloads.delete(id);
      this.emit('changed');
      return { reloaded: true, schedule: this.get(id) };
    });
  }
  /** A recovery check never fires a schedule or enables its timer. */
  reconcile(id: string): Promise<boolean> { return this.serial(async () => {
    const live = this.live.get(id);
    if (!live) throw new Error('Schedule not found');
    if (!live.task.status.runs.some(run => run.launchState === 'pending')) return true;
    if (live.task.enabled) await this.updateNow(id, { enabled: false });
    return this.recoverPending(live, false);
  }); }
  loadAll(projects: Project[]): Promise<void> { return this.serial(() => this.loadAllNow(projects)); }
  onProjectRemoved(projectId: string): Promise<void> { return this.serial(async () => this.onProjectRemovedNow(projectId)); }
  attachReport(sessionId: string, summary: string, status?: 'success' | 'partial' | 'failure'): Promise<void> {
    return this.serial(() => this.attachReportNow(sessionId, summary, status));
  }
  onAgentFinished(sessionId: string): Promise<void> { return this.serial(() => this.onAgentFinishedNow(sessionId)); }

  setDeps(deps: Deps) {
    this.deps = deps;
  }

  private log(context: string, err: unknown) {
    if (this.deps?.logger) {
      this.deps.logger(context, err);
    } else {
      // eslint-disable-next-line no-console
      console.error(`[scheduler] ${context}:`, err);
    }
  }

  list(): ScheduledTask[] {
    return [...this.live.values()].map((l) => l.task);
  }

  /** Read every schedule from disk and (re)arm enabled ones. Called on boot. */
  private async loadAllNow(projects: Project[]) {
    if (!this.started) { this.started = true; this.startedAtMs = Date.now(); }
    this.deps?.ptys.reapDeadSessions();
    const epoch = this.epoch;
    const tasks = this.deps?.persistence ? await this.deps.persistence.load() : listAllSchedules(projects, (path, reason) =>
      this.log(`load ${path}`, `invalid schedule file dropped: ${reason}`)
    );
    if (epoch !== this.epoch) throw new Error('Scheduler stopped');
    const ids = new Set(tasks.map(task => task.id));
    let deferred = false;
    for (const [id, live] of this.live) {
      if (this.hasUnresolvedRun(live)) {
        if (!ids.has(id)) this.deferredReloads.add(id);
        deferred ||= !ids.has(id) || this.deferredReloads.has(id);
        continue;
      }
      if (!ids.has(id)) {
        this.disarm(id);
        this.forgetTask(id);
        for (const run of live.task.status.runs) if (run.sessionId) this.releaseSession(run.sessionId);
        this.live.delete(id);
        this.deferredReloads.delete(id);
      }
    }
    for (const task of tasks) {
      const existing = this.live.get(task.id);
      if (existing) {
        const differs = !isDeepStrictEqual(this.snapshotSignature(existing.task), this.snapshotSignature(task));
        if (this.hasUnresolvedRun(existing)) {
          if (differs) this.deferredReloads.add(task.id);
          deferred ||= this.deferredReloads.has(task.id);
        }
        else {
          if (differs || this.deferredReloads.has(task.id)) await this.replaceDefinition(existing, task);
          this.deferredReloads.delete(task.id);
        }
        continue;
      }
      // A pending launch is durably disabled, including for older app versions.
      if (task.status.runs.some(run => run.launchState === 'pending')) task.enabled = false;
      const live = this.makeLive(task);
      this.live.set(task.id, live);
      const project = projects.find(candidate => candidate.id === task.projectId);
      if (project) for (const run of [...task.status.runs]) {
        if (!run.sessionId || run.launchState === 'failed') continue;
        const session = this.deps?.ptys.list(task.projectId).find(candidate => candidate.id === run.sessionId && candidate.projectId === task.projectId);
        if (!session || (session.status === 'exited' && run.launchState !== 'pending')) continue;
        try {
          await this.finishLaunch(task.id, run.id, live, { manual: false }, project, session.profile, session, task.enabled);
        } catch (error) { this.log(`recover ${task.id}`, error); }
      }
      if (task.enabled) this.arm(task.id);
      this.armRetry(task.id);
    }
    await this.drainSafely();
    this.emitChangedIfDifferent();
    // `loadAll` can restore active Squad executions without a cadence timer,
    // including disabled Run now schedules after restart.
    this.scheduleSquadObservation();
    if (deferred) this.scheduleReload();
  }

  private async createNow(input: ScheduleCreateInput): Promise<ScheduledTask> {
    if (!input.name?.trim()) throw new Error('name is required');
    if (!input.projectId) throw new Error('projectId is required');
    const cadence = {
      every: input.every,
      cron: input.cron,
      tz: input.tz ?? undefined
    };
    const cadenceError = validateCadence(cadence);
    if (cadenceError) throw new Error(cadenceError);
    const schedule = cadence.cron
      ? { cron: cadence.cron, ...(cadence.tz ? { tz: cadence.tz } : {}) }
      : { every: cadence.every! };

    const now = new Date().toISOString();
    const task: ScheduledTask = {
      id: randomUUID(),
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      enabled: input.enabled ?? true,
      projectId: input.projectId,
      profile: input.profile,
      kind: input.kind ?? 'agent',
      teamId: input.kind === 'team' ? input.teamId?.trim() || undefined : undefined,
      planSource: input.kind === 'team' ? input.planSource ?? 'infer' : undefined,
      extraArgs: input.extraArgs,
      prompt: input.prompt,
      schedule,
      overlap: 'skip',
      history: { retain: clampRetain(input.retain ?? 10) },
      status: {
        runCount: 0,
        runs: [],
        nextRunAt: new Date(this.nextTargetFireMs({ schedule, status: {} }, Date.now())).toISOString()
      },
      createdAt: now,
      updatedAt: now,
      source: input.scope ?? 'global',
      // Group only applies to global schedules; project schedules live under
      // their project tab regardless. Drop it for project scope so the field
      // never lingers on a task it can't surface.
      group:
        (input.scope ?? 'global') === 'global' && input.group?.trim()
          ? input.group.trim()
          : undefined,
      inboxLevel: input.inboxLevel ?? 'quiet',
      // Default ON: a scheduled run is background work; close its session once
      // the agent finishes so sessions don't pile up at the prompt. The form
      // always sends an explicit value; this default only applies to callers
      // (e.g. the skill-authored create path) that omit it.
      autoCloseOnFinish: input.autoCloseOnFinish ?? true,
      maxDurationMinutes: input.maxDurationMinutes
    };
    if (task.kind === 'team' && !task.teamId) throw new Error('teamId is required for team schedules');
    // New schedules start in Recovery; an explicit `catchUp: null` keeps Classic.
    if (input.catchUp !== null) task.catchUp = normalizeCatchUp(input.catchUp) ?? { mode: 'once' };
    const retry = normalizeRetry(input.retry);
    if (retry) task.retry = retry;
    await this.persist(task, task);
    this.live.set(task.id, this.makeLive(task));
    if (task.enabled) this.arm(task.id);
    this.emit('changed');
    return task;
  }

  private async updateNow(id: string, input: ScheduleUpdatePatch): Promise<ScheduledTask> {
    const { expectedPrompt, ...patch } = input;
    // CAS against the definition actually being overwritten (disk), not the
    // possibly-stale in-memory snapshot the caller fenced against.
    const guard = expectedPrompt === undefined ? undefined : (current: ScheduledTask) => {
      if ((current.prompt ?? '').trim() !== expectedPrompt.trim()) throw new ScheduleConflictError(id);
    };
    const live = this.live.get(id);
    if (!live) throw new Error(`schedule not found: ${id}`);
    if (patch.projectId && patch.projectId !== live.task.projectId && live.task.source !== 'global') throw new Error('Project schedules cannot change their metadata owner');
    if (patch.kind !== undefined && patch.kind !== live.task.kind && this.hasUnresolvedRun(live)) {
      throw new Error('Cannot change schedule mode while an existing run or launch is unresolved');
    }
    if (patch.enabled && live.task.status.runs.some(run => run.launchState === 'pending')) {
      await this.recoverPending(live);
    }
    const current = await this.readCurrent(live.task);
    guard?.(current);
    if (current.kind !== live.task.kind && this.hasUnresolvedRun(live)) {
      throw new Error('Cannot change schedule mode while an existing run or launch is unresolved');
    }
    const next: ScheduledTask = { ...current, status: structuredClone(live.task.status) };
    const wasEnabled = live.task.enabled;
    const priorSchedule = live.task.schedule;
    if (patch.name !== undefined) next.name = patch.name.trim();
    if (patch.description !== undefined) next.description = patch.description.trim() || undefined;
    if (patch.enabled !== undefined) next.enabled = patch.enabled;
    if (patch.projectId !== undefined) next.projectId = patch.projectId;
    if (patch.profile !== undefined) next.profile = patch.profile;
    if (patch.kind !== undefined) next.kind = patch.kind;
    if (patch.teamId !== undefined) next.teamId = patch.teamId?.trim() || undefined;
    if (patch.planSource !== undefined) next.planSource = patch.planSource ?? undefined;
    if (next.kind === 'team' && !next.teamId) throw new Error('teamId is required for team schedules');
    if (next.kind !== 'team') { next.teamId = undefined; next.planSource = undefined; }
    if (patch.extraArgs !== undefined) next.extraArgs = patch.extraArgs;
    if (patch.prompt !== undefined) next.prompt = patch.prompt;
    // Cadence edits. `every` and `cron` are mutually exclusive: setting one
    // clears the other so a schedule never carries both. `tz` alone (with an
    // existing cron) just re-times. All routed through validateCadence.
    if (patch.every !== undefined || patch.cron !== undefined || patch.tz !== undefined) {
      let cadence: { every?: string; cron?: string; tz?: string };
      if (patch.every !== undefined) {
        cadence = { every: patch.every };
      } else if (patch.cron !== undefined) {
        cadence = {
          cron: patch.cron,
          tz: patch.tz === null ? undefined : patch.tz ?? next.schedule.tz
        };
      } else {
        // tz-only edit: keep the existing cron, retime (or clear tz).
        cadence = {
          cron: next.schedule.cron,
          every: next.schedule.every,
          tz: patch.tz === null ? undefined : patch.tz ?? next.schedule.tz
        };
      }
      const cadenceError = validateCadence(cadence);
      if (cadenceError) throw new Error(cadenceError);
      next.schedule = cadence.cron
        ? { cron: cadence.cron, ...(cadence.tz ? { tz: cadence.tz } : {}) }
        : { every: cadence.every! };
    }
    if (patch.retain !== undefined) next.history = { retain: clampRetain(patch.retain) };
    if (patch.catchUp !== undefined) {
      const catchUp = patch.catchUp === null ? undefined : normalizeCatchUp(patch.catchUp);
      if (catchUp) next.catchUp = catchUp; else delete next.catchUp;
    }
    if (patch.retry !== undefined) {
      const retry = patch.retry === null ? undefined : normalizeRetry(patch.retry);
      if (retry) next.retry = retry; else delete next.retry;
      if (!retry || retry.attempts < 1) delete next.status.pendingRetry;
    }
    if (patch.inboxLevel !== undefined) next.inboxLevel = patch.inboxLevel;
    if (patch.autoCloseOnFinish !== undefined) next.autoCloseOnFinish = patch.autoCloseOnFinish;
    if (patch.maxDurationMinutes !== undefined) {
      next.maxDurationMinutes = patch.maxDurationMinutes || undefined;
    }
    // `null` clears the group (→ Ungrouped); a string sets it; undefined leaves
    // it unchanged. Only meaningful for global schedules.
    if (patch.group !== undefined) {
      next.group = patch.group?.trim() ? patch.group.trim() : undefined;
    }
    next.updatedAt = new Date().toISOString();
    // Disabling cancels an auto-retry that was waiting (design 6.5).
    if (wasEnabled && !next.enabled) delete next.status.pendingRetry;
    // Pause/resume and cadence edits are never reported as missed; Recovery also
    // moves the timing anchor so the paused slot isn't fired (design D10).
    if ((!wasEnabled && next.enabled) || !isDeepStrictEqual(priorSchedule, next.schedule)) this.markDiscontinuity(next);
    const definitionPatch: Partial<ScheduledTask> = { updatedAt: next.updatedAt };
    for (const key of Object.keys(patch) as (keyof ScheduleUpdateInput)[]) {
      const field = key === 'every' || key === 'cron' || key === 'tz' ? 'schedule' : key === 'retain' ? 'history' : key;
      Object.assign(definitionPatch, { [field]: next[field as keyof ScheduledTask] });
    }
    await this.persist(next, definitionPatch, guard);
    live.task = next;
    this.disarm(id);
    // Only once the write succeeded: a failed update leaves the retry chain as it was.
    if (patch.retry !== undefined && !(next.retry && next.retry.attempts >= 1)) this.cancelAutoRetries(id);
    if (wasEnabled && !next.enabled) this.dropQueued(id, false);
    if (next.enabled) this.arm(id);
    this.armRetry(id);
    this.syncQueuedAt(id);
    this.emit('changed');
    return next;
  }

  private async setEnabledNow(id: string, enabled: boolean): Promise<ScheduledTask | null> {
    const live = this.live.get(id);
    if (!live) return null;
    const task = await this.updateNow(id, { enabled });
    await this.drainSafely();
    return task;
  }

  private async removeNow(id: string) {
    const live = this.live.get(id);
    if (!live) return;
    if (this.deps) {
      this.suppressWatchUntil = Date.now() + 1_000;
      const epoch = this.epoch;
      if (this.deps.persistence) await this.deps.persistence.remove(live.task);
      else if (!deleteSchedule(id, this.deps.store.listProjects())) throw new Error('Schedule could not be removed');
      if (epoch !== this.epoch) throw new Error('Scheduler stopped');
    }
    this.disarm(id);
    this.forgetTask(id);
    this.clearDeferredClosesForTask(id);
    for (const run of live.task.status.runs) if (run.sessionId) this.releaseSession(run.sessionId);
    this.live.delete(id);
    if (!this.hasLiveSquadExecutions()) this.clearSquadObservation();
    this.emit('changed');
  }

  private async runNowInternal(id: string): Promise<ScheduledTask> {
    const live = this.live.get(id);
    if (!live) throw new Error(`schedule not found: ${id}`);
    if (live.task.status.runs.some(run => run.launchState === 'pending')) {
      await this.recoverPending(live);
      return live.task; // Recovering a known worker never spawns a second one.
    }
    await this.fire(id, { manual: true });
    return live.task;
  }

  private async recoverPending(live: Live, strict = true): Promise<boolean> {
    const pending = live.task.status.runs.filter(run => run.launchState === 'pending');
    if (pending.some(run => this.runLaunchKind(live.task, run) === 'team')) return this.recoverPendingSquad(live, strict);
    const sessions = this.deps?.ptys.list(live.task.projectId) ?? [];
    const evidence = await Promise.all(pending.map(run => {
      if (sessions.some(session => session.id === run.sessionId && session.projectId === live.task.projectId)) return 'present' as const;
      return run.sessionId ? this.deps?.inspectWorkerLaunch?.(live.task.projectId, run.sessionId, { kind: 'schedule', id: `schedule:${live.task.id}` }) ?? 'unknown' as const : 'unknown' as const;
    }));
    if (evidence.includes('unknown')) {
      if (!strict) return false;
      throw new Error('Unconfirmed worker launch; reconcile the reserved session before enabling or running this schedule');
    }
    const project = this.deps?.store.listProjects().find(candidate => candidate.id === live.task.projectId);
    if (!project) throw new Error('Schedule project not found');
    for (const [index, run] of pending.entries()) {
      if (evidence[index] !== 'present') {
        await this.recordRun(live.task.id, { ...run, launchState: 'failed', result: evidence[index] === 'not-started' ? 'skipped' : 'error',
          finishedAt: new Date().toISOString(),
          reasonCode: evidence[index] === 'not-started' ? 'worker-not-started' : 'outcome-unknown',
          message: evidence[index] === 'not-started'
            ? 'Recovery confirmed the worker never started.' : 'Recovery confirmed the worker exited; its outcome was not recorded.' }, false);
        continue;
      }
      const session = sessions.find(candidate => candidate.id === run.sessionId)!;
      this.releaseSession(session.id);
      await this.finishLaunch(live.task.id, run.id, live, { manual: false }, project, session.profile, session, false);
    }
    await this.drainSafely();
    return true;
  }

  private async recoverPendingSquad(live: Live, strict: boolean): Promise<boolean> {
    const pending = live.task.status.runs.filter(run => run.launchState === 'pending');
    if (!pending.length) return true;
    if (!this.deps?.getSquadExecution) {
      if (!strict) return false;
      throw new Error('Unconfirmed squad launch; reconcile its execution before enabling or running this schedule');
    }
    const records = await Promise.all(pending.map(async run => run.executionId
      ? this.deps!.getSquadExecution!(live.task.projectId, run.executionId)
      : run.launchRequestId ? this.deps!.findSquadExecution?.(live.task.projectId, run.launchRequestId) : undefined));
    if (records.some(record => !record)) {
      if (!strict) return false;
      throw new Error('Unconfirmed squad launch; reconcile its execution before enabling or running this schedule');
    }
    for (const [index, run] of pending.entries()) {
      const record = records[index]!;
      await this.recordRun(live.task.id, {
        ...run,
        ...(run.executionId ? {} : { executionId: (record as { executionId?: string }).executionId }),
        launchState: 'running',
        result: record.state === 'FAILED' ? 'error' : record.state === 'COMPLETED' ? 'success' : 'skipped',
        ...(record.state === 'FAILED' ? { reasonCode: 'squad-failed' as const } : {}),
        ...(record.finalSummary ? { message: record.finalSummary } : {})
      }, false);
    }
    this.scheduleSquadObservation();
    return true;
  }

  stopAll() {
    if (this.watchDebounce) clearTimeout(this.watchDebounce);
    this.watchDebounce = null;
    this.deferredReloads.clear();
    this.epoch++;
    this.clearLive();
  }

  private clearLive() {
    for (const id of [...this.live.keys()]) this.disarm(id);
    this.live.clear();
    this.queue = [];
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    // Release every fallback watchdog timer (Rule 3). We do NOT force-close the
    // sessions here — stopAll is a scheduler-state reset (boot reload / project
    // change), not an app shutdown; the ptys have their own teardown (killAll).
    for (const watchdog of this.nonHookWatchdogs.values()) clearTimeout(watchdog);
    this.nonHookWatchdogs.clear();
    for (const deferred of this.deferredCloses.values()) clearTimeout(deferred.timeout);
    this.deferredCloses.clear();
    for (const watchdog of this.maxDurationWatchdogs.values()) clearTimeout(watchdog);
    this.maxDurationWatchdogs.clear();
    this.timedOutSessions.clear();
    for (const release of this.exitListeners.values()) release();
    this.exitListeners.clear();
    this.clearSquadObservation();
  }

  /**
   * Watch the global + per-project schedule directories so externally-authored
   * schedule files (e.g. the `zcc-center` skill writing one, or a hand-edit)
   * go live without an app restart. Reloading preserves active run ownership.
   *
   * Call once after `loadAll` at boot, and again via `rebindWatchers` when the
   * project list changes (so new projects' dirs get watched).
   */
  startWatching() {
    this.rebindWatchers();
    if (!this.remotePoll && this.deps?.persistence) {
      this.remotePoll = setInterval(() => {
        // 'polled' lets owners of merged views (e.g. Claude /loop rows) re-check
        // state this manager doesn't track, without an unconditional 'changed'.
        // Never after stopWatching, and a throwing listener is logged, not left unhandled.
        if (!this.pending && this.deps) void this.loadAll(this.deps.store.listProjects())
          .then(() => { if (this.remotePoll) this.emit('polled'); })
          .catch(error => this.log('refresh', error));
      }, 15_000);
      this.remotePoll.unref?.();
    }
  }

  /** (Re)attach watchers to the current set of schedule directories. */
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
    if (this.deps) {
      for (const p of this.deps.persistence?.localProjects() ?? this.deps.store.listProjects()) dirs.push(projectDir(p));
    }
    for (const dir of dirs) this.attachWatcher(dir);
  }

  stopWatching() {
    if (this.remotePoll) clearInterval(this.remotePoll);
    this.remotePoll = null;
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
        // Create the global dir so we can watch it from boot; skip per-project
        // dirs that don't exist yet (rebindWatchers re-runs when projects change,
        // and most projects won't have a schedules dir).
        if (dir === globalDir()) {
          mkdirSync(dir, { recursive: true });
        } else {
          return;
        }
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
      // Watching is best-effort — some filesystems (network mounts) don't
      // support it. The schedule still loads on next boot / project-add.
      this.log(`watch ${dir}`, err);
    }
  }

  /** Coalesce burst events (an editor/agent save = create+rename+modify). */
  private scheduleReload() {
    if (this.watchDebounce) clearTimeout(this.watchDebounce);
    const epoch = this.epoch;
    this.watchDebounce = setTimeout(() => {
      this.watchDebounce = null;
      if (Date.now() < this.suppressWatchUntil) { this.scheduleReload(); return; }
      if (!this.deps) return;
      void this.loadAll(this.deps.store.listProjects()).catch(error => {
        this.log('reload', error);
        if (epoch === this.epoch && this.deferredReloads.size) this.scheduleReload();
      });
    }, 250);
  }

  /**
   * Count scheduled sessions still alive across EVERY schedule. Walks each
   * schedule's run history for `sessionId`s and checks them against the live
   * ptys for that project — the same `ptys.list(...).status` mechanism the
   * overlap guard uses, just aggregated globally instead of per-schedule. Dedup
   * by session id so an optimistic + exit-time record of the same run counts
   * once. Backs the concurrency limit ({@link runLimit}) in `fire` and `drainNow`.
   */
  private countLiveScheduledRuns(): number {
    if (!this.deps) return 0;
    const aliveByProject = new Map<string, Set<string>>();
    const aliveIdsFor = (projectId: string): Set<string> => {
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
      const aliveIds = aliveIdsFor(live.task.projectId);
      for (const r of live.task.status.runs) {
        if (this.runLaunchKind(live.task, r) === 'team') {
          if (this.isLiveSquadRun(r)) counted.add(`squad:${live.task.id}:${r.id ?? r.executionId}`);
        } else if (r.sessionId && aliveIds.has(r.sessionId)) {
          counted.add(r.sessionId);
        }
      }
    }
    return counted.size;
  }

  private isLiveSquadRun(run: ScheduleRun): boolean {
    return run.launchState === 'running' && !!run.executionId && !run.finishedAt;
  }

  /** Older records predate `launchKind`; infer their mode once from definition. */
  private runLaunchKind(task: ScheduledTask, run: ScheduleRun): 'agent' | 'team' {
    return run.launchKind ?? task.kind ?? 'agent';
  }

  /**
   * An unresolved launch fences definition mode changes until lifecycle work is
   * complete. Each new run also persists its own mode for durable ownership.
   */
  private hasUnresolvedRun(live: Live): boolean {
    return this.liveSessions(live).length > 0 || live.task.status.runs.some(run =>
      run.launchState === 'pending' ||
      (this.runLaunchKind(live.task, run) === 'team' && this.isLiveSquadRun(run))
    );
  }

  private retainRuns(task: ScheduledTask, runs: ScheduleRun[]): ScheduleRun[] {
    // Squad runs are scheduler-owned overlap state until their durable
    // execution reaches a terminal state, so they sit outside display history.
    return trimRuns(runs, task.history.retain, Date.now(), run =>
      run.launchState === 'pending' || (this.runLaunchKind(task, run) === 'team' && this.isLiveSquadRun(run)));
  }

  private async observeSquadExecutions() {
    if (!this.deps?.getSquadExecution) return;
    for (const live of this.live.values()) {
      const project = this.deps.store.listProjects().find(candidate => candidate.id === live.task.projectId);
      if (!project) continue;
      for (const run of live.task.status.runs.filter(run => this.runLaunchKind(live.task, run) === 'team' && this.isLiveSquadRun(run))) {
        // Isolate each run: one unreadable execution or failed finalization
        // write must not block other runs or every schedule's automatic fire.
        try {
          const execution = await this.deps.getSquadExecution(live.task.projectId, run.executionId!);
          if (!execution || !['COMPLETED', 'FAILED', 'STOPPED'].includes(execution.state)) continue;
          const finishedAt = new Date().toISOString();
          const startedAt = Date.parse(run.at);
          const finalRun: ScheduleRun = {
            ...run,
            result: execution.state === 'COMPLETED' ? 'success' : 'error',
            ...(execution.state === 'FAILED' ? { reasonCode: 'squad-failed' as const } : execution.state === 'STOPPED' ? { reasonCode: 'squad-stopped' as const } : {}),
            finishedAt,
            ...(Number.isFinite(startedAt) ? { durationMs: Math.max(0, Date.now() - startedAt) } : {}),
            ...(execution.finalSummary ? { message: execution.finalSummary } : {})
          };
          await this.recordRun(live.task.id, finalRun);
          if (finalRun.result === 'success') await this.onFinishedSuccess(live.task.id, run.id);
          if ((live.task.inboxLevel ?? 'quiet') !== 'silent') {
            void this.notifyInboxOnExit(live.task, finalRun, project, finalRun.result === 'error');
          }
        } catch (error) {
          this.log(`observe squad ${live.task.id} ${run.executionId}`, error);
        }
      }
    }
    if (!this.hasLiveSquadExecutions()) this.clearSquadObservation();
  }

  private hasLiveSquadExecutions(): boolean {
    return [...this.live.values()].some(live =>
      live.task.status.runs.some(run => this.runLaunchKind(live.task, run) === 'team' && this.isLiveSquadRun(run))
    );
  }

  /**
   * Cadence ticks already observe Squad completion, but a manual run on a
   * disabled schedule has no future tick. Keep one independent observer alive
   * until every durable Squad execution reaches a terminal state.
   */
  private scheduleSquadObservation() {
    if (this.squadObservationTimer || !this.deps?.getSquadExecution || !this.hasLiveSquadExecutions()) return;
    const epoch = this.epoch;
    this.squadObservationTimer = setTimeout(() => {
      this.squadObservationTimer = null;
      void this.serial(async () => {
        try {
          await this.observeSquadExecutions();
        } catch (error) {
          // Keep observing after transient durable-store failures. A completed
          // Squad must not remain pinned solely because one poll failed.
          this.log('observe squads', error);
        }
        // A finished Squad frees a slot: start what was queued behind it.
        await this.drainSafely();
        if (epoch === this.epoch) this.scheduleSquadObservation();
      }).catch(error => this.log('observe squads', error));
    }, SQUAD_OBSERVATION_INTERVAL_MS);
    this.squadObservationTimer.unref?.();
  }

  private clearSquadObservation() {
    if (this.squadObservationTimer) clearTimeout(this.squadObservationTimer);
    this.squadObservationTimer = null;
  }

  private liveSessions(live: Live): string[] {
    const sessions = this.deps?.ptys.list(live.task.projectId) ?? [];
    return [...new Set(live.task.status.runs.flatMap(run => run.sessionId && sessions.some(session => session.id === run.sessionId && session.status !== 'exited') ? [run.sessionId] : []))];
  }

  /** Stamp the accounting floor (and, in Recovery, the timing anchor) at now. */
  private markDiscontinuity(task: ScheduledTask, nowMs = Date.now()) {
    const iso = new Date(nowMs).toISOString();
    task.status.missedFloorAt = iso;
    if (isRecoveryMode(task)) task.status.slotCursorAt = iso;
  }

  private async replaceDefinition(live: Live, task: ScheduledTask) {
    this.disarm(task.id);
    const cadenceChanged = !isDeepStrictEqual(live.task.schedule, task.schedule);
    if (cadenceChanged) this.markDiscontinuity(task);
    live.task = task;
    live.runIndexBySession = this.makeLive(task).runIndexBySession;
    for (const run of task.status.runs) if (run.id) live.countedRunIds.add(run.id);
    while (live.countedRunIds.size > COUNTED_RUN_IDS_CAP) live.countedRunIds.delete(live.countedRunIds.values().next().value!);
    if (cadenceChanged && task.enabled) {
      // Persist the floor so the next poll doesn't see a difference and re-arm.
      // A disabled schedule isn't rewritten (e.g. a teammate's cadence edit
      // pulled from git): re-enabling sets its own floor.
      try { await this.persist(task); } catch (error) { this.log(`persist ${task.id}`, error); }
    }
    if (task.enabled) this.arm(task.id);
    this.scheduleSquadObservation();
    this.armRetry(task.id);
    this.syncQueuedAt(task.id);
  }

  private publishRuntime(live: Live, task: ScheduledTask) {
    const retime = live.task.enabled !== task.enabled || !isDeepStrictEqual(live.task.schedule, task.schedule);
    live.task = task;
    if (retime) {
      this.disarm(task.id);
      if (task.enabled) this.arm(task.id);
    }
  }

  private snapshotSignature(task: ScheduledTask) {
    // File validation supplies optional undefined keys; ignore those as well as
    // the timer's derived nextRunAt and the runtime-only queuedAt so our own
    // writes never postpone cadence.
    return JSON.parse(JSON.stringify({ ...task, status: { ...task.status, nextRunAt: undefined, queuedAt: undefined } }));
  }

  private async readCurrent(task: ScheduledTask): Promise<ScheduledTask> {
    if (!this.deps) return structuredClone(task);
    if (this.deps.persistence) {
      const epoch = this.epoch;
      const current = this.deps.persistence.read ? await this.deps.persistence.read(task) : structuredClone(task);
      if (epoch !== this.epoch) throw new Error('Scheduler stopped');
      return current;
    }
    return readSchedule(task, this.deps.store.listProjects());
  }

  /**
   * Disarm and drop every live schedule referencing the removed project.
   * Called from the projects.remove IPC handler. The on-disk JSON files
   * (under `<project.path>/.zcc/schedules/`) are not deleted — if the
   * project is re-added later, `loadAll` will rediscover them.
   */
  private onProjectRemovedNow(projectId: string) {
    let dropped = 0;
    for (const id of [...this.live.keys()]) {
      const live = this.live.get(id);
      if (!live) continue;
      if (live.task.projectId === projectId) {
        this.disarm(id);
        this.forgetTask(id);
        this.clearDeferredClosesForTask(id);
        for (const run of live.task.status.runs) if (run.sessionId) this.releaseSession(run.sessionId);
        this.live.delete(id);
        dropped += 1;
      }
    }
    if (!this.hasLiveSquadExecutions()) this.clearSquadObservation();
    if (dropped > 0) this.emit('changed');
  }

  // ----- internals -----------------------------------------------------------

  private makeLive(task: ScheduledTask): Live {
    return {
      task,
      timer: null,
      runIndexBySession: new Map(task.status.runs.flatMap((run, index) => run.sessionId ? [[run.sessionId, index] as const] : [])),
      countedRunIds: new Set(task.status.runs.flatMap(run => run.id ? [run.id] : []))
    };
  }

  private async persist(task: ScheduledTask, definitionPatch: Partial<ScheduledTask> = {}, guard?: (current: ScheduledTask) => void) {
    if (!this.deps) return;
    // Delay the watcher until the write is settled; its event stays queued.
    this.suppressWatchUntil = Date.now() + 1_000;
    const epoch = this.epoch;
    let record = task;
    if (definitionPatch.id !== task.id) {
      const current = await this.readCurrent(task);
      // Re-check at the write boundary: this is the record the save merges onto.
      guard?.(current);
      if (this.deferredReloads.has(task.id)) {
        // The disk definition must not be adopted in memory until the
        // unresolved run settles, but the written record is always the
        // owner's: only the patch and runtime status are layered onto it, so
        // a full-record save never restores the stale live definition.
        Object.assign(task, { ...definitionPatch, status: task.status });
        record = { ...current, ...definitionPatch, status: task.status };
      } else {
        Object.assign(task, { ...current, ...definitionPatch, status: task.status });
      }
    }
    // `queuedAt` is runtime-only: it never reaches disk.
    const { queuedAt: _queuedAt, ...durableStatus } = record.status;
    const durable = record.status.queuedAt === undefined ? record : { ...record, status: durableStatus };
    if (this.deps.persistence) await this.deps.persistence.save(durable, definitionPatch);
    else saveSchedule(durable, this.deps.store.listProjects(), definitionPatch);
    if (epoch !== this.epoch) throw new Error('Scheduler stopped');
  }

  /**
   * Timing anchor (epoch ms): slots at or before it are handled. It's the latest
   * of the last run, the slot cursor a missed marker advanced, and the newest
   * queued slot. With none of the newer terms it is exactly the last run.
   */
  private anchorMs(live: Live): number {
    return anchorOf(live.task.status, Math.max(live.queuedThroughMs ?? 0, live.handledThroughMs ?? 0));
  }

  /** Accounting floor: slots at or before it are never reported missed or late. */
  private floorMs(live: Live): number {
    const floor = live.task.status.missedFloorAt ? Date.parse(live.task.status.missedFloorAt) : 0;
    return Math.max(this.anchorMs(live), Number.isFinite(floor) ? floor : 0);
  }

  /**
   * Epoch-ms of the next intended slot, given the timing anchor (0 if none) and now.
   * Shared by `arm` and `create`'s initial `nextRunAt`.
   *
   *  - interval: `anchor + interval`, or `now + interval` with no anchor.
   *  - cron: the first slot strictly after the anchor (or after `now` with no
   *    anchor). A slot that has already passed (the app was closed across it)
   *    yields a time in the past; the grace floor in `arm` fires it soon, and
   *    `fire` decides what to do about the gap (see {@link fire}).
   *
   * The Classic "very stale interval" rule is NOT here; see {@link classicStale}.
   */
  private nextTargetFireMs(
    task: Pick<ScheduledTask, 'schedule'> & { status: Pick<ScheduledTask['status'], 'lastRunAt' | 'slotCursorAt'> },
    now: number,
    queuedThroughMs = 0
  ): number {
    const anchor = anchorOf(task.status, queuedThroughMs);
    const schedule = task.schedule;
    if (isCronCadence(schedule)) {
      const from = anchor > 0 ? new Date(anchor) : new Date(now);
      const next = nextCronRunAt(schedule.cron!, schedule.tz, from);
      // Validated on create/load, so `next` should exist; degrade to a
      // far-future no-op rather than a tight loop if it somehow doesn't.
      return next ? next.getTime() : now + MAX_INTERVAL_MS;
    }
    const intervalMs = parseEveryShared(schedule.every ?? '') ?? MIN_INTERVAL_MS;
    return anchor > 0 ? anchor + intervalMs : now + intervalMs;
  }

  /**
   * Classic interval policy: more than one full interval overdue (the schedule
   * sat disabled for days, or Zana was closed) re-arms fresh at `now + interval`
   * instead of replaying, which prevents drift compounding and resume stampedes.
   * Judged on `lastRunAt` alone, exactly as before self-healing.
   */
  private classicStale(task: ScheduledTask, now: number): boolean {
    if (isRecoveryMode(task) || isCronCadence(task.schedule)) return false;
    const lastRun = task.status.lastRunAt ? Date.parse(task.status.lastRunAt) : 0;
    const intervalMs = parseEveryShared(task.schedule.every ?? '') ?? MIN_INTERVAL_MS;
    return lastRun > 0 && lastRun + intervalMs < now - intervalMs;
  }

  private arm(id: string) {
    const live = this.live.get(id);
    if (!live || !live.task.enabled) return;
    this.disarm(id);
    const now = Date.now();
    const stale = this.classicStale(live.task, now);
    const targetAt = stale
      ? now + (parseEveryShared(live.task.schedule.every ?? '') ?? MIN_INTERVAL_MS)
      : this.nextTargetFireMs(live.task, now, Math.max(live.queuedThroughMs ?? 0, live.handledThroughMs ?? 0));
    live.targetAt = targetAt;
    live.staleSince = stale ? now : undefined;
    const rawDelay = targetAt - now;
    // Chunked re-arm: Node's setTimeout clamps delays > ~24.85d to 1ms, so a
    // monthly/yearly cron would otherwise fire immediately in a tight loop.
    // Sleep the cap and recompute+re-arm (do NOT fire) when the next slot is
    // farther out than we can safely time in one hop.
    if (rawDelay > MAX_INTERVAL_MS) {
      live.task.status.nextRunAt = new Date(targetAt).toISOString();
      live.timer = setTimeout(() => this.arm(id), MAX_INTERVAL_MS);
      return;
    }
    // 5-second grace floor so a backlog of overdue schedules (or a cron
    // catch-up) doesn't fire all at once on app launch.
    const delay = Math.max(rawDelay, 5_000);
    live.task.status.nextRunAt = new Date(now + delay).toISOString();
    live.timer = setTimeout(() => {
      const firedAt = Date.now();
      void this.serial(async () => { await this.fire(id, { manual: false, firedAt }); await this.drainNow(); }).catch(error => this.log(`fire ${id}`, error));
    }, delay);
  }

  private disarm(id: string) {
    const live = this.live.get(id);
    if (!live) return;
    if (live.timer) {
      clearTimeout(live.timer);
      live.timer = null;
    }
  }

  /**
   * Fire a schedule. `manual` is "Run now" (bypasses overlap and the limit). An
   * automatic fire carries a `trigger`: absent means the timer (`schedule`);
   * `retry` / `catch-up` come from {@link retryRuns} and never get late/missed
   * assessment (only timer fires do).
   */
  private async fire(id: string, opts: FireOptions): Promise<'raced' | void> {
    const live = this.live.get(id);
    if (!live || !this.deps) return;
    // The caller's trigger, before a late gap turns a timer fire into a catch-up:
    // the overflow policy is judged on this one so Classic stays as before.
    const originalTrigger = opts.trigger;
    const enabledBeforeRefresh = live.task.enabled;
    const priorCadence = live.task.schedule;
    const current = await this.readCurrent(live.task);
    if (this.hasUnresolvedRun(live) && current.kind !== live.task.kind) {
      this.deferredReloads.add(id);
    } else {
      live.task = { ...current, status: live.task.status };
    }
    this.disarm(id);
    if (!opts.manual && enabledBeforeRefresh && !live.task.enabled) { this.emit('changed'); return; }
    // Compare against the definition actually adopted. A deferred reload keeps
    // the prior cadence live, so comparing to `current` would re-arm forever.
    if (!opts.manual && !isDeepStrictEqual(priorCadence, live.task.schedule)) {
      this.markDiscontinuity(live.task);
      try { await this.persist(live.task); } catch (error) { this.log(`persist ${id}`, error); }
      this.arm(id);
      // A drained retry entry that doesn't start here returns through its timer.
      if (opts.trigger === 'retry') this.armRetry(id);
      this.emit('changed'); return;
    }
    if (live.task.status.runs.some(run => run.launchState === 'pending')) throw new Error('Unconfirmed worker launch');

    // Late / missed assessment: timer fires only (not Run now, not retry).
    const timerFire = !opts.manual && !opts.fromQueue && (opts.trigger === undefined || opts.trigger === 'schedule');
    if (timerFire && live.staleSince !== undefined) {
      const since = live.staleSince;
      live.staleSince = undefined;
      // While a previous run is alive it covers the gap; a marker written here
      // (before the overlap guard) could also push that live record out of history.
      // Late fires follow a wake, when zombies still look alive: reap first.
      this.deps.ptys.reapDeadSessions();
      if (!this.hasUnresolvedRun(live)) {
        try { await this.recordStaleInterval(id, since); } catch (error) { this.log(`stale ${id}`, error); }
      }
    }
    const late = timerFire ? this.assessLate(live, opts.firedAt ?? Date.now()) : undefined;
    const plan = late?.late ? this.applyCatchUp(live.task, late) : undefined;
    if (late && plan && !plan.run) {
      // Recovery `skip`: record the gap, run nothing, re-arm from the cursor. Not
      // while a previous run is alive: it covers the gap (see the stale case above).
      // Whether or not a marker is written, the gap is handled: the runtime-only
      // anchor makes the re-arm below target the next future slot, never this
      // one again. (Not `slotCursorAt`: an in-memory status edit would differ from
      // disk and keep a deferred reload spinning while the run lives.)
      const handled = () => { live.handledThroughMs = Math.max(live.handledThroughMs ?? 0, late.last); };
      this.deps.ptys.reapDeadSessions();
      if (!this.hasUnresolvedRun(live)) {
        try { await this.writeMissedMarker(id, late, plan.markerCount, late.first); }
        catch (error) { this.log(`missed marker ${id}`, error); handled(); }
      } else {
        handled();
      }
      if (live.task.enabled) this.arm(id);
      return;
    }
    const fireOpts: FireOptions = late
      ? { ...opts, slotAt: opts.slotAt ?? late.last, trigger: opts.trigger ?? (plan && plan.markerCount > 0 ? 'catch-up' : undefined) }
      : opts;
    opts = fireOpts;

    // Concurrent-duplicate guard: a fire whose launch is async (remote/coordinator
    // commit) hasn't returned yet when the next tick (or a watcher-driven reload's
    // re-arm) calls fire again. `firing` marks an in-flight launch so the second
    // fire records a skip instead of spawning a duplicate session. Manual "Run
    // now" bypasses it — an explicit click is the user's deliberate override.
    if (!opts.manual && opts.fromQueue && live.firing) { if (live.task.enabled) this.arm(id); return 'raced'; }
    if (!opts.manual && live.firing) {
      this.log(`fire ${id}`, 'skipped: previous fire/launch is already in progress');
      await this.recordRun(id, {
        id: randomUUID(),
        at: new Date().toISOString(),
        result: 'skipped',
        reasonCode: 'in-flight',
        ...runMeta(opts),
        message: 'previous fire/launch is already in progress'
      });
      if (live.task.enabled) this.arm(id);
      return;
    }
    if (!opts.manual) live.firing = true;

    // Squad executions have no PTY exit event. Every automatic tick observes
    // durable state first so terminal squads free overlap and global slots even
    // when a different schedule owns this tick.
    if (!opts.manual) {
      try {
        await this.observeSquadExecutions();
      } catch (error) {
        // Observation is best-effort and isolated per run. Never let it block
        // this tick: the guards below still see any unresolved run and skip.
        this.log(`observe squads ${id}`, error);
      }
    }

    const project = this.deps.store.listProjects().find((p) => p.id === live.task.projectId);
    if (!project) {
      if (!opts.manual) live.firing = false;
      this.log(
        `fire ${id}`,
        `project ${live.task.projectId} not found for schedule "${live.task.name}"`
      );
      await this.recordRun(id, {
        id: randomUUID(),
        at: new Date().toISOString(),
        result: 'error',
        reasonCode: 'project-missing',
        ...runMeta(opts),
        message: `project ${live.task.projectId} not found`
      });
      if (live.task.enabled) this.arm(id);
      return;
    }

    // Recovery `all` with more than one slot to replay: every slot goes through
    // the queue and runs one after another.
    if (late?.late && plan?.run && plan.slots && plan.slots.length > 1) {
      live.firing = false;
      await this.queueCatchUps(live, late, plan.markerCount, plan.slots);
      if (live.task.enabled) this.arm(id);
      return;
    }

    // Overlap check: skip an auto fire if *any* session this schedule
    // previously spawned (auto or manual) is still alive. Walking the run
    // history rather than a single `lastAutoSessionId` catches the case
    // where the user kicked off a long-running task with "Run now" and the
    // next interval-driven fire would otherwise stack on top of it.
    // Manual "Run now" still overrides — clicking the button is an explicit
    // user choice to spawn another tab regardless.
    if (!opts.manual) {
      // Reap zombie sessions first: a run whose process died without node-pty
      // delivering an exit (seen after the machine sleeps/wakes) stays pinned
      // `running` and permanently holds both its overlap slot and a global
      // concurrency slot — enough of them deadlock every schedule. Sweeping
      // here, before the guards below read liveness, lets a frequent poll
      // self-heal the deadlock on the next fire instead of needing an app
      // restart. reapDeadSessions emits `exit`, so each reaped run's own
      // onExit handler records it (as an error: an interrupted run is not a
      // success) and frees the slot.
      this.deps.ptys.reapDeadSessions();

      const aliveIds = new Set(
        this.deps.ptys
          .list(live.task.projectId)
          .filter((s) => s.status === 'running' || s.status === 'starting')
          .map((s) => s.id)
      );
      const squad = live.task.kind === 'team';
      const aliveRunSessionId = squad ? undefined : live.task.status.runs
        .map((r) => r.sessionId)
        .find((sid): sid is string => !!sid && aliveIds.has(sid));
      const liveSquadRun = squad && live.task.status.runs.some(run => this.isLiveSquadRun(run));
      if (aliveRunSessionId || liveSquadRun) {
        if (!opts.manual) live.firing = false;
        if (opts.fromQueue) { if (live.task.enabled) this.arm(id); return 'raced'; }
        this.log(
          `fire ${id}`,
          `skipped: previous ${squad ? 'squad run' : `run ${aliveRunSessionId}`} still active`
        );
        await this.recordRun(id, {
          id: randomUUID(),
          at: new Date().toISOString(),
          result: 'skipped',
          ...(aliveRunSessionId ? { sessionId: aliveRunSessionId } : {}),
          reasonCode: 'overlap',
          ...runMeta(opts),
          message: squad ? 'previous squad run still active' : 'previous run still active'
        });
        if (live.task.enabled) this.arm(id);
        return;
      }

      // Global concurrency cap: count scheduled runs alive across ALL schedules
      // (not just this one — overlap above already covered self-stacking) and
      // skip or queue this fire if firing would exceed the configured limit.
      // The skip reuses the exact record path as overlap, with a distinct reason
      // so the history (and logs) tell the two apart. Manual "Run now" never
      // reaches here — it bypasses this whole block, matching how it bypasses
      // overlap: an explicit click is the user's deliberate override.
      const limit = this.runLimit();
      const liveScheduledRuns = this.countLiveScheduledRuns() + this.pendingLaunches;
      if (liveScheduledRuns >= limit) {
        live.firing = false;
        // A queued entry that lost a race for the last slot goes back to the head.
        if (opts.fromQueue) { if (live.task.enabled) this.arm(id); return 'raced'; }
        if (this.effectiveOverflow(live.task, isRecoveryMode(live.task) ? opts.trigger ?? originalTrigger : originalTrigger) === 'queue') {
          await this.queueFire(live, opts, late, plan);
          if (live.task.enabled) this.arm(id);
          return;
        }
        this.log(
          `fire ${id}`,
          `skipped: concurrency cap (${liveScheduledRuns}/${limit} scheduled runs active)`
        );
        await this.recordRun(id, {
          id: randomUUID(),
          at: new Date().toISOString(),
          result: 'skipped',
          reasonCode: 'concurrency-cap',
          ...runMeta(opts),
          message: `concurrency-cap: ${liveScheduledRuns}/${limit} scheduled runs active`
        });
        if (live.task.enabled) this.arm(id);
        return;
      }
    }

    const runId = opts.runId ?? randomUUID();
    const wasEnabled = live.task.enabled;
    // This retry is starting: the persisted `pendingRetry` it came from is consumed
    // (the reservation below writes the task without it).
    if (opts.trigger === 'retry' && live.task.status.pendingRetry) {
      delete live.task.status.pendingRetry;
      const timer = this.retryTimers.get(id);
      if (timer) clearTimeout(timer);
      this.retryTimers.delete(id);
    }
    // Older missed slots covered by this catch-up run: one marker, closed by it.
    if (late && plan?.run && plan.markerCount > 0) {
      try {
        await this.writeMissedMarker(id, late, plan.markerCount, late.first, runId);
      } catch (error) { this.log(`missed marker ${id}`, error); }
    }
    if (live.task.kind === 'team') {
      await this.fireSquad(live, project, opts, late, runId, wasEnabled);
      return;
    }
    const reservedSessionId = randomUUID();
    const profile = live.task.profile;
    // Resolve the persona (if the task names one and a resolver is wired). Its
    // `baseProfile` overrides the task's profile for prompt-as-positional-argv
    // detection below — a persona built on `shell` must not get a stray prompt.
    const persona = live.task.personaId
      ? this.deps.resolvePersona?.(live.task.personaId)
      : undefined;
    const effectiveProfile = persona?.baseProfile ?? profile;

    // Build extraArgs. The shared `seedPromptArgs` helper delivers the seed
    // prompt the way each harness expects: a positional `[prompt]` for the
    // claude/cursor/codex/pi families (`claude [options] [prompt]` picks it up as
    // the first turn), `--prompt <text>` for OpenCode (whose positional is a
    // project DIR), and nothing for shell (it would be parsed as a command).
    // Note the prompt is delivered here on argv (non-interactive scheduled run),
    // NOT via the persona's pty-write path — the persona's own `initialPrompt`,
    // if any, is suppressed for scheduled fires by pty.create (claude-family
    // interactive only).
    const userExtraArgs = live.task.extraArgs ?? [];
    const promptArgs = live.task.prompt ? seedPromptArgs(effectiveProfile, live.task.prompt) : [];
    const extraArgs = [...userExtraArgs, ...promptArgs];

    const launchOptions = {
      preallocatedSessionId: reservedSessionId,
      projectId: project.id,
      profile,
      persona,
      cwd: project.path,
      cols: 80,
      rows: 24,
      config: this.deps.store.getConfig(),
      extraArgs,
      title: `Scheduled: ${live.task.name}`,
      remote: project.remote,
      autoCloseOnFinish: live.task.autoCloseOnFinish,
      // Scheduled fires run headless — they're background work, not a tab the
      // user opened. The pty stays alive and replyable; if the agent pushes a
      // question to the inbox, the "Open in session" deep-link promotes it to
      // a visible tab on demand. Keeps the tab strip clean for fleets of runs.
      headless: true,
      // Marks this as a scheduled run so pty appends the schedule_report
      // system-prompt guidance (and only for scheduled spawns). Unattended:
      // default-posture profiles remap onto the adapter's yolo sibling, and
      // inherited interactive/plan/accept-edits execution is replaced so the
      // fire cannot stall asking the user.
      scheduled: true,
      // Bake the schedule's loudness into the session so an agent-initiated
      // inbox_push during this run is stamped (or dropped, when silent) with
      // the right level — independent of later edits to the schedule.
      inboxLevel: live.task.inboxLevel ?? 'quiet'
    } as const;
    const unattendedLaunch = applyUnattendedScheduledLaunch(launchOptions);
    // Reserve before any process can start. Persist disabled so a downgrade
    // cannot replay a launch whose acknowledgement was lost.
    await this.recordRun(id, { id: runId, at: new Date().toISOString(), result: 'skipped', sessionId: reservedSessionId, launchKind: 'agent',
      launchState: 'pending', message: 'Worker launch pending confirmation', ...runMeta(opts), ...lateFields(opts, late) }, false);
    this.pendingLaunches++;
    let session: Awaited<ReturnType<LaunchTerminal>>;
    try {
      session = await this.deps.launchTerminal(unattendedLaunch, { kind: 'schedule', id: `schedule:${live.task.id}` });
    } catch (err) {
      if (err instanceof LaunchSpawnError && err.code === 'LAUNCH_UNCONFIRMED') throw err;
      await this.recordLaunchFailure(id, runId, live, opts, err, wasEnabled);
      return;
    } finally { this.pendingLaunches--; }
    // A failed acknowledgement write must retain the pending reservation and
    // must never be mistaken for a failed spawn that is safe to retry.
    await this.finishLaunch(id, runId, live, opts, project, effectiveProfile, session, wasEnabled);
  }

  private async fireSquad(live: Live, project: Project, opts: FireOptions, late: LateInfo | undefined, runId: string, wasEnabled: boolean) {
    if (!this.deps?.launchSquad) throw new Error('Squad execution service unavailable');
    const launchRequestId = `schedule:${live.task.id}:${runId}`;
    const meta = { ...runMeta(opts), ...lateFields(opts, late) };
    await this.recordRun(live.task.id, {
      id: runId, at: new Date().toISOString(), result: 'skipped', launchKind: 'team', launchState: 'pending',
      launchRequestId, message: 'Squad launch pending confirmation', ...meta
    }, false);
    this.pendingLaunches++;
    let launched: { executionId: string };
    try {
      launched = await this.deps.launchSquad({
        schedule: live.task,
        project,
        runId,
        objective: scheduledSquadObjective(live.task)
      });
    } catch (error) {
      await this.recordLaunchFailure(live.task.id, runId, live, opts, error, wasEnabled);
      return;
    } finally { this.pendingLaunches--; }
    if (!opts.manual) live.firing = false;
    if (this.live.get(live.task.id) !== live) return;
    await this.recordRun(live.task.id, {
      id: runId, at: new Date().toISOString(), result: 'success', executionId: launched.executionId, launchRequestId, launchKind: 'team', launchState: 'running', ...meta
    }, wasEnabled);
    this.scheduleSquadObservation();
    if (live.task.enabled) this.arm(live.task.id);
  }

  private async recordLaunchFailure(id: string, runId: string, live: Live, opts: FireOptions, err: unknown, wasEnabled: boolean) {
    if (this.live.get(id) !== live) return;
    if (!opts.manual) live.firing = false;
    this.log(`fire ${id} launch`, err);
    await this.recordRun(id, {
      id: runId,
      at: new Date().toISOString(),
      result: 'error',
      launchState: 'failed',
      reasonCode: 'launch-failed',
      message: err instanceof Error ? err.message : String(err)
    }, wasEnabled);
    const retryScheduled = await this.scheduleRetryIfDue(id, runId);
    // The exit path held this chain's notice back (D9). When a retry attempt
    // can't even start and no further retry follows, the chain ends here: send it.
    if (!retryScheduled && opts.auto && (live.task.inboxLevel ?? 'quiet') !== 'silent') {
      const project = this.deps?.store.listProjects().find(candidate => candidate.id === live.task.projectId);
      const run = live.task.status.runs.find(candidate => candidate.id === runId);
      if (project && run) void this.notifyInboxOnExit(live.task, run, project, true);
    }
    if (live.task.enabled) this.arm(id);
  }

  private async finishLaunch(
    id: string,
    runId: string | undefined,
    live: Live,
    opts: FireOptions,
    project: Project,
    effectiveProfile: Parameters<typeof providerCapabilities>[0],
    session: ReturnType<PtyManager['create']>,
    wasEnabled: boolean
  ) {
    if (!opts.manual) live.firing = false;

    // A reload can replace this Live while durable coordinator commit is in
    // flight. Session remains valid, but stale scheduler state must not mutate.
    if (this.live.get(id) !== live) return;

    const existing = live.task.status.runs.find(run => (runId !== undefined && run.id === runId) || run.sessionId === session.id);
    const runStartedAt = existing?.at ?? new Date().toISOString();
    const runStartMs = Number.isFinite(Date.parse(runStartedAt)) ? Date.parse(runStartedAt) : Date.now();

    // Fallback watchdog: a scheduled `autoCloseOnFinish` run on a provider that
    // can't signal turn-end (cursor in v1 — no Stop hook) would never self-reap.
    // Arm a coarse max-runtime timer that force-closes such a run so headless
    // sessions can't accumulate. Hook-capable runs (canAutoCloseOnFinish — claude
    // + codex's `-c hooks.Stop=…` bridge) self-reap via the Stop hook long before
    // this, so they never arm it. Confined to scheduled+autoClose runs; cleared on
    // exit (below) and teardown (Rule 3).
    if (
      live.task.autoCloseOnFinish &&
      !providerCapabilities(effectiveProfile).canAutoCloseOnFinish
    ) {
      const watchdog = setTimeout(() => {
        this.nonHookWatchdogs.delete(session.id);
        // closeExpected marks the kill as expected so the exit logs cleanly (code
        // 0), not as an error — the run did its work, we're just reaping a session
        // that can't tell us it finished. No-op if already gone.
        this.deps?.ptys.closeExpected(session.id);
        this.log(
          `watchdog ${id}`,
          `force-closed non-hook scheduled run ${session.id} after ${SCHEDULED_NONHOOK_MAX_RUNTIME_MS}ms (provider "${effectiveProfile}" can't signal turn-end)`
        );
      }, Math.max(0, SCHEDULED_NONHOOK_MAX_RUNTIME_MS - (Date.now() - runStartMs)));
      // Don't let the watchdog keep the process alive (mirrors node's timer
      // semantics for background timers).
      watchdog.unref?.();
      this.nonHookWatchdogs.set(session.id, watchdog);
    }

    // Custom max-duration watchdog: independent of the non-hook fallback above,
    // this force-closes ANY scheduled run (hook-capable or not) that exceeds the
    // user-configured `maxDurationMinutes`. The run is marked timed-out so onExit
    // records an `error` with a duration-exceeded message rather than success.
    if (live.task.maxDurationMinutes && live.task.maxDurationMinutes > 0) {
      const maxMs = live.task.maxDurationMinutes * 60 * 1000;
      const watchdog = setTimeout(() => {
        this.maxDurationWatchdogs.delete(session.id);
        this.timedOutSessions.add(session.id);
        this.deps?.ptys.closeExpected(session.id);
        this.log(
          `watchdog ${id}`,
          `force-closed scheduled run ${session.id} after exceeding max duration of ${live.task.maxDurationMinutes} minutes`
        );
      }, Math.max(0, maxMs - (Date.now() - runStartMs)));
      watchdog.unref?.();
      this.maxDurationWatchdogs.set(session.id, watchdog);
    }

    let exitObserved = false;
    const onExit = (sessionId: string, exitCode: number) => {
      if (sessionId !== session.id || exitObserved) return;
      exitObserved = true;
      this.exitListeners.get(sessionId)?.();
      this.exitListeners.delete(sessionId);
      void this.serial(async () => {
      if (this.live.get(id) !== live) return;
      const watchdog = this.nonHookWatchdogs.get(session.id);
      if (watchdog) {
        clearTimeout(watchdog);
        this.nonHookWatchdogs.delete(session.id);
      }
      const maxWatchdog = this.maxDurationWatchdogs.get(session.id);
      if (maxWatchdog) {
        clearTimeout(maxWatchdog);
        this.maxDurationWatchdogs.delete(session.id);
      }
      const timedOut = this.timedOutSessions.has(session.id);
      if (timedOut) this.timedOutSessions.delete(session.id);
      this.clearDeferredClose(session.id);
      const exitMs = Date.now();

      // Exit code 0 alone doesn't mean the run actually completed: a severed
      // stream (e.g. the known Zscaler SSE idle-drop) can still leave the CLI
      // exiting 0 after the agent never reached its work. `schedule_report` is
      // the run's own signal that it got to the end, so for a report-capable
      // profile (only `claude` currently wires the `schedule_report` MCP tool —
      // `injectsClaudeMcpConfig`) on a non-`silent` schedule, an exit-0 run that
      // never filed one is stamped `incomplete` rather than `success` — silence
      // must never look like success. `silent` schedules are exempt: nothing
      // reads their report either way. A finished turn (`finishedAt`) does not
      // change that: skipping `schedule_report` still means we have no record of
      // what the run did, so it stays `incomplete` and still notifies.
      const expectsReport =
        (live.task.inboxLevel ?? 'quiet') !== 'silent' &&
        providerCapabilities(effectiveProfile).injectsClaudeMcpConfig;
      const existingRun = live.task.status.runs.find(
        (r) => (runId !== undefined && r.id === runId) || r.sessionId === session.id
      );
      const hasReport = !!existingRun?.report || !!existingRun?.reportStatus;
      const terminalError = existingRun?.result === 'error';
      const result: ScheduleRun['result'] =
        timedOut || terminalError
          ? 'error'
          : exitCode !== 0
          ? 'error'
          : expectsReport && !hasReport
          ? 'incomplete'
          : 'success';

      const finalRun: ScheduleRun = {
        id: runId,
        at: runStartedAt,
        result,
        sessionId: session.id,
        durationMs: exitMs - runStartMs,
        reasonCode: timedOut
          ? 'timeout'
          : terminalError
          ? existingRun?.reasonCode ?? 'subagent-timeout'
          : exitCode !== 0
          ? 'exit-nonzero'
          : result === 'incomplete'
          ? 'no-report'
          : undefined,
        message: timedOut
          ? `exceeded maximum duration of ${live.task.maxDurationMinutes} minutes`
          : terminalError
          ? existingRun?.message
          : exitCode !== 0
          ? `exit ${exitCode}`
          : result === 'incomplete'
          ? 'exited without filing a schedule_report — possible silent failure'
          : undefined
      };
      // A detected-id harness (Codex, OpenCode) has stamped its id on the live
      // session by now; `recordRun` merges, so the rest of `conversation` is kept.
      if (existingRun?.conversation && !existingRun.conversation.id) {
        const detectedId = registrationFor(effectiveProfile)?.nativeConversationId?.(session);
        if (isValidConversationId(detectedId)) finalRun.conversation = { ...existingRun.conversation, id: detectedId };
      }
      await this.recordRun(id, finalRun);
      if (result === 'success') await this.onFinishedSuccess(id, runId);
      // A failure that just scheduled an auto-retry is not final: one notice per chain.
      const retryScheduled = result === 'success' ? false : await this.scheduleRetryIfDue(id, runId);
      const attempt = live.task.status.runs.find(candidate => candidate.id === runId)?.attempt;
      // `silent` schedules never write a completion summary; `quiet`/`loud`
      // both write one, stamped with the level so the renderer can decide
      // badge counting and inline-vs-grouped placement. An `incomplete` run
      // always escalates the notice to `loud` regardless of the schedule's
      // configured level, so a quiet schedule's silent failure still surfaces.
      if ((live.task.inboxLevel ?? 'quiet') !== 'silent' && !retryScheduled) {
        void this.notifyInboxOnExit(
          live.task,
          { ...finalRun, ...(attempt !== undefined ? { attempt } : {}) },
          project,
          result === 'incomplete' || result === 'error'
        );
      }
      await this.drainSafely();
      }).catch(error => this.log(`exit ${sessionId}`, error));
    };
    this.deps?.ptys.on('exit', onExit);
    const owner = this.deps?.ptys;
    this.exitListeners.set(session.id, () => owner?.off('exit', onExit));

    // Optimistically record the run as success at fire time so the UI shows the
    // schedule advanced, even if the session is long-lived. The exit handler
    // above will overwrite the entry once the pty closes.
    // Record the conversation this run started so it can be reopened after its
    // tab closes. Only for harnesses that can resume one; Squad runs never get here.
    const registration = registrationFor(effectiveProfile);
    const launchId = registration?.nativeConversationId?.(session);
    // Offer a resume only when the id is known now or the harness can detect it later; one that
    // does neither (no mint, no transcript adapter) would record a conversation nothing can fill.
    const conversation: ScheduleRunConversation | undefined = registration?.nativeConversationResume && (launchId || registration.createTranscriptAdapter)
      ? {
          profile: effectiveProfile,
          id: launchId,
          cwd: session.cwd,
          startedAt: Number.isFinite(session.createdAt) ? new Date(session.createdAt).toISOString() : runStartedAt
        }
      : undefined;
    await this.recordRun(id, {
      id: runId,
      at: runStartedAt,
      result: existing?.launchState === 'pending' ? 'success' : existing?.result ?? 'success',
      sessionId: session.id,
      launchState: 'running',
      message: undefined,
      ...(conversation ? { conversation } : {})
    }, wasEnabled);
    const actual = this.deps?.ptys.list(project.id).find(candidate => candidate.id === session.id);
    if (actual?.status === 'exited') onExit(session.id, actual.exitCode ?? -1);

    if (live.task.enabled) this.arm(id);
  }

  /**
   * Append a one-line summary InboxEntry for a finished run. Best-effort.
   * The user can scroll back through the schedule's tab in the project for
   * the full output — we no longer mirror the log into the inbox body.
   */
  private async notifyInboxOnExit(
    task: ScheduledTask,
    run: ScheduleRun,
    project: Project,
    forceLoud = false
  ) {
    if (!this.deps?.inbox) return;
    try {
      const durationStr =
        run.durationMs !== undefined ? ` in ${formatDuration(run.durationMs)}` : '';
      const resultLabel = run.result === 'incomplete' ? '⚠️ incomplete' : run.result;
      const afterAttempts = run.result === 'success' && (run.attempt ?? 1) > 1 ? ` · after ${run.attempt} attempts` : '';
      const body = `**${task.name}** — ${resultLabel}${durationStr}${afterAttempts}`;
      await this.deps.inbox.append({
        projectId: project.id,
        projectLabel: project.name,
        // Stable heading for the coalesced row — the schedule's name — so the
        // row reads as the task, not the first line of the latest run result.
        subject: task.name,
        comments: body,
        sessionId: run.sessionId,
        // Coalesce successive run-complete notices for the SAME task into one
        // self-refreshing row (a 5-min schedule would otherwise push ~288/day).
        // Keyed on task, not run, so each fire folds into the prior one.
        dedupeKey: `sched:${project.id}:${task.id}`,
        // This is the scheduler's own run-complete notice — always a
        // scheduled (background) entry, so the sidebar groups it.
        scheduled: true,
        // `loud` schedules count toward the unread badge and render inline;
        // `quiet` (the default) stay collapsed and badge-free. `silent` never
        // reaches here (gated by the caller). `forceLoud` (an `incomplete`
        // run) overrides the schedule's own level — a silent failure must
        // surface even on a `quiet` schedule.
        notify: forceLoud ? 'loud' : task.inboxLevel ?? 'quiet'
      });
    } catch (err) {
      this.log(`notifyInbox ${task.id}`, err);
    }
  }

  private async recordRun(id: string, run: ScheduleRun, enabled?: boolean, options: { marker?: boolean } = {}) {
    const live = this.live.get(id);
    if (!live) return;
    if (run.message && run.message.length > MAX_RUN_MESSAGE) run = { ...run, message: run.message.slice(0, MAX_RUN_MESSAGE) };
    const next = structuredClone(live.task);
    if (enabled !== undefined) next.enabled = enabled;
    const status = next.status;
    const countedRunIds = new Set(live.countedRunIds);
    const runIndexBySession = new Map(live.runIndexBySession);
    // Prefer matching by run.id (stable per fire) and fall back to sessionId
    // for older paths. Same goal: update the existing entry rather than push
    // a new one when this is the exit-time tail of a previously optimistic
    // record.
    const knownIdxById = run.id
      ? status.runs.findIndex((r) => r.id === run.id)
      : -1;
    const knownIdx =
      knownIdxById >= 0
        ? knownIdxById
        : run.sessionId
        ? runIndexBySession.get(run.sessionId)
        : undefined;
    if (knownIdx !== undefined && knownIdx >= 0 && status.runs[knownIdx]) {
      status.runs[knownIdx] = { ...status.runs[knownIdx], ...run };
    } else if (run.id && countedRunIds.has(run.id)) {
      // This run was already counted at fire time but has since scrolled past
      // `retain` and been evicted by newer fires. This is its exit-time tail,
      // NOT a new run: re-inserting it would double-count the fire and list the
      // run twice, and overwriting the lastRun* summary would make an aged-out
      // run masquerade as the most recent. History is deliberately bounded by
      // `retain`, so an evicted run's late completion is simply dropped — log
      // an error result for observability, then bail before any mutation.
      if (run.result === 'error') {
        this.log(`run ${id}`, run.message ?? 'error (no message)');
      }
      return;
    } else {
      status.runs = this.retainRuns(live.task, [run, ...status.runs]);
      // A marker is bookkeeping, not a fire: it must not move runCount.
      if (!options.marker) status.runCount += 1;
      if (run.id) {
        countedRunIds.add(run.id);
        // Bound the set: drop oldest ids once over cap (insertion-ordered).
        while (countedRunIds.size > COUNTED_RUN_IDS_CAP) {
          const oldest = countedRunIds.values().next().value;
          if (oldest === undefined) break;
          countedRunIds.delete(oldest);
        }
      }
    }
    // Terminal records obey the configured history cap even when this was an
    // update to a formerly-active squad run. Rebuild indexes from survivors.
    status.runs = this.retainRuns(live.task, status.runs);
    runIndexBySession.clear();
    status.runs.forEach((r, idx) => {
      if (r.sessionId) runIndexBySession.set(r.sessionId, idx);
    });
    if (run.result === 'error') {
      this.log(`run ${id}`, run.message ?? 'error (no message)');
    }
    if (options.marker) {
      // Never touch lastRunAt / lastRunResult / runCount (an older version's
      // timing maths reads them); advance the slot cursor instead.
      const to = run.missed ? Date.parse(run.missed.to) : NaN;
      if (Number.isFinite(to) && to > anchorOf({ slotCursorAt: status.slotCursorAt })) status.slotCursorAt = run.missed!.to;
    } else {
      status.lastRunAt = run.at;
      status.lastRunResult = run.result;
      status.lastRunSessionId = run.sessionId;
    }
    await this.persist(next, enabled === undefined ? {} : { enabled });
    this.publishRuntime(live, next);
    live.countedRunIds = countedRunIds;
    live.runIndexBySession = runIndexBySession;
    this.emit('changed');
  }

  // ----- late / missed handling ----------------------------------------------

  /**
   * Compare the slot this timer was armed for with the accounting floor and the
   * clock (design 6.3). Slots at or before the floor are normal fires (a paused
   * slot a Classic schedule still runs, a cadence edit): no marker, no chip.
   */
  private assessLate(live: Live, now: number): LateInfo | undefined {
    const slotAt = live.targetAt;
    if (slotAt === undefined) return undefined;
    let floor = this.floorMs(live);
    if (slotAt <= floor || now - slotAt <= LATE_THRESHOLD_MS) return undefined;
    const cron = isCronCadence(live.task.schedule);
    const intervalMs = cron ? undefined : parseEveryShared(live.task.schedule.every ?? '') ?? MIN_INTERVAL_MS;
    // A schedule that never ran has no anchor: its gap starts at its own first slot.
    if (floor === 0) floor = cron ? slotAt - 1 : slotAt - intervalMs!;
    let first: number;
    let last: number;
    let count: number;
    if (intervalMs !== undefined) {
      // Interval slots sit on the anchor's grid (anchor + k*interval); count the
      // ones after the floor, which a re-enable or cadence edit can move off-grid.
      const anchor = this.anchorMs(live) || floor;
      const kFloor = Math.max(0, Math.floor((floor - anchor) / intervalMs));
      const kNow = Math.floor((now - anchor) / intervalMs);
      count = Math.max(1, kNow - kFloor);
      first = anchor + (kFloor + 1) * intervalMs;
      last = Math.max(first, anchor + kNow * intervalMs);
    } else {
      const slots = slotsBetween(live.task.schedule, floor, now);
      first = slots.first ?? slotAt;
      // The true newest slot even past the 1000-slot count cap.
      last = slots.last ?? slotAt;
      count = Math.max(1, slots.count);
    }
    return {
      late: true,
      first,
      floor,
      last,
      count,
      lateByMs: Math.max(0, now - last),
      cause: slotAt < this.startedAtMs ? 'app-closed' : 'asleep',
      ...(intervalMs !== undefined ? { intervalMs } : {})
    };
  }

  /**
   * What to do about a late gap (design 6.3): whether a run follows and how many
   * of the oldest slots a marker covers.
   *  - Recovery `skip`: marker for the whole gap, no run.
   *  - Recovery `once` and Classic cron: marker for the k-1 older slots (when
   *    k > 1) and one run for the newest. Classic interval: one run, no marker.
   *  - Recovery `all`: `n = min(k, max ?? 3)` newest slots each get a run (in
   *    order, through the queue); a marker covers the k-n older ones.
   */
  private applyCatchUp(task: ScheduledTask, late: LateInfo): { run: boolean; markerCount: number; slots?: number[] } {
    if (task.catchUp?.mode === 'skip') return { run: false, markerCount: late.count };
    if (task.catchUp?.mode === 'all') {
      const n = Math.max(1, Math.min(late.count, task.catchUp.max ?? 3));
      const slots = newestSlots(task.schedule, late, n);
      const used = slots.length || 1;
      return { run: true, markerCount: Math.max(0, late.count - used), slots: slots.length ? slots : [late.last] };
    }
    const records = isRecoveryMode(task) || isCronCadence(task.schedule);
    return { run: true, markerCount: records && late.count > 1 ? late.count - 1 : 0 };
  }

  /**
   * Write a missed-slots marker (not a fire: runCount and lastRun* are untouched).
   * `count` oldest slots are covered, ending at the slot before the newest when
   * a catch-up run follows (`resolvedBy`).
   */
  private async writeMissedMarker(id: string, late: LateInfo, count: number, firstMs: number, resolvedBy?: string, beforeMs = late.last) {
    const live = this.live.get(id);
    if (!live) return;
    // The marker ends at the (count)th slot of the gap: the newest slot when the
    // whole gap is recorded, else the slot just before the newest.
    const toMs = count >= late.count
      ? late.last
      : late.intervalMs !== undefined
        ? Math.max(firstMs, beforeMs - late.intervalMs)
        : slotsBetween(live.task.schedule, late.floor, beforeMs - 1).last ?? firstMs;
    await this.recordRun(id, {
      id: randomUUID(),
      at: new Date().toISOString(),
      result: 'skipped',
      reasonCode: late.cause === 'app-closed' ? 'missed-app-closed' : 'missed-asleep',
      marker: true,
      trigger: 'schedule',
      slotAt: new Date(toMs).toISOString(),
      missed: { count, from: new Date(firstMs).toISOString(), to: new Date(toMs).toISOString() },
      ...(resolvedBy ? { resolvedBy } : {}),
      message: `${count} scheduled ${count === 1 ? 'run was' : 'runs were'} missed`
    }, undefined, { marker: true });
  }

  /**
   * Classic interval policy at `arm`: more than an interval overdue re-arms at
   * `now + interval` (see {@link classicStale}) and runs nothing at once. The gap
   * is recorded as an open marker at the next timer fire (`sinceMs` = the arm),
   * so merely loading a legacy file never writes.
   */
  private async recordStaleInterval(id: string, sinceMs: number) {
    const live = this.live.get(id);
    if (!live || !live.task.enabled) return;
    const now = sinceMs;
    const slots = slotsBetween(live.task.schedule, this.floorMs(live), now);
    if (!slots.count || slots.first === undefined || slots.last === undefined) return;
    await this.writeMissedMarker(id, {
      late: true,
      first: slots.first,
      floor: this.floorMs(live),
      last: slots.last,
      count: slots.count,
      lateByMs: Math.max(0, now - slots.last),
      cause: slots.first < this.startedAtMs ? 'app-closed' : 'asleep'
    }, slots.count, slots.first);
  }

  /** A finished success closes the schedule's earlier open problems (D8). One persist. */
  /**
   * A finished success (D8): close the schedule's earlier open problems and end
   * any automatic retry chain, pending or already queued. Manual retries the
   * user asked for still run.
   */
  private async onFinishedSuccess(id: string, runId: string | undefined) {
    await this.resolveOpenProblems(id, runId);
    await this.clearPendingRetry(id);
    const before = this.queue.length;
    this.queue = this.queue.filter(entry => entry.taskId !== id || entry.trigger !== 'retry' || !entry.auto);
    if (this.queue.length !== before) { this.syncQueuedAt(id); this.emit('changed'); }
  }

  private async resolveOpenProblems(id: string, resolvedBy: string | undefined) {
    const live = this.live.get(id);
    if (!live || !resolvedBy) return;
    const now = Date.now();
    if (!live.task.status.runs.some(run => run.id !== resolvedBy && isOpenProblem(run, now))) return;
    const next = structuredClone(live.task);
    next.status.runs = next.status.runs.map(run => run.id !== resolvedBy && isOpenProblem(run, now) ? { ...run, resolvedBy } : run);
    await this.persist(next);
    this.publishRuntime(live, next);
    this.emit('changed');
  }

  // ----- limit, queue and drain ------------------------------------------------

  /** The configured ceiling on concurrent scheduled runs, read fresh at each check. */
  private runLimit(): number {
    let configured: unknown;
    try { configured = this.deps?.store.getConfig().scheduledRunConcurrency; } catch { configured = undefined; }
    const n = typeof configured === 'number' && Number.isFinite(configured) ? Math.round(configured) : DEFAULT_SCHEDULED_RUN_LIMIT;
    return Math.max(MIN_SCHEDULED_RUN_LIMIT, Math.min(MAX_SCHEDULED_RUN_LIMIT, n));
  }

  /**
   * What a fire over the limit does. Retries and catch-up always queue; otherwise
   * the configured `queue` / `skip`, or for `auto` (absent) queue for Recovery
   * schedules and skip for Classic ones.
   */
  private effectiveOverflow(task: ScheduledTask, trigger?: ScheduleRunTrigger): 'queue' | 'skip' {
    if (trigger === 'retry' || trigger === 'catch-up') return 'queue';
    let configured: unknown;
    try { configured = this.deps?.store.getConfig().scheduledRunOverflow; } catch { configured = undefined; }
    if (configured === 'queue' || configured === 'skip') return configured;
    return isRecoveryMode(task) ? 'queue' : 'skip';
  }

  /** Keep the runtime-only `status.queuedAt` in step with the task's queue entries. */
  private syncQueuedAt(taskId: string) {
    const live = this.live.get(taskId);
    if (!live) return;
    const oldest = this.queue.find(entry => entry.taskId === taskId);
    if (oldest) live.task.status.queuedAt = new Date(oldest.enqueuedAt).toISOString();
    else delete live.task.status.queuedAt;
  }

  /**
   * Add an entry within the queue bounds: 200 total; per schedule one `schedule`
   * entry (a newer slot replaces the older), up to 10 `catch-up`, one `retry`
   * (newer replaces older). Sets the queued-through anchor for slot entries.
   */
  private enqueue(entry: QueueEntry): { ok: true; entry: QueueEntry; replaced?: QueueEntry } | { ok: false } {
    const sameTask = this.queue.filter(candidate => candidate.taskId === entry.taskId);
    let stored = entry;
    let replaced: QueueEntry | undefined;
    const existing = entry.trigger === 'catch-up' ? undefined : sameTask.find(candidate => candidate.trigger === entry.trigger);
    if (existing && entry.trigger === 'schedule') {
      // Coalesce: keep the entry (and its reserved run id), move it to the newer slot.
      existing.slotAt = Math.max(existing.slotAt ?? 0, entry.slotAt ?? 0) || undefined;
      if (entry.lateCause) existing.lateCause = entry.lateCause;
      stored = existing;
    } else if (existing) {
      this.queue[this.queue.indexOf(existing)] = entry;
      replaced = existing;
    } else {
      if (entry.trigger === 'catch-up' && sameTask.filter(candidate => candidate.trigger === 'catch-up').length >= MAX_QUEUE_CATCH_UP_PER_TASK) return { ok: false };
      if (this.queue.length >= MAX_QUEUE_TOTAL) return { ok: false };
      this.queue.push(entry);
    }
    if (entry.trigger !== 'retry' && entry.slotAt !== undefined) {
      const live = this.live.get(entry.taskId);
      if (live && entry.slotAt > (live.queuedThroughMs ?? 0)) live.queuedThroughMs = entry.slotAt;
    }
    this.syncQueuedAt(entry.taskId);
    return { ok: true, entry: stored, ...(replaced ? { replaced } : {}) };
  }

  /** Drop a task's entries (all, or all but retries when it was only disabled). */
  private dropQueued(taskId: string, includeRetries: boolean) {
    const live = this.live.get(taskId);
    // A disable keeps manual retries the user asked for; automatic ones go with the schedule.
    this.queue = this.queue.filter(entry => entry.taskId !== taskId || (!includeRetries && entry.trigger === 'retry' && !entry.auto));
    // The slots we gave up on were never run: let the timing anchor forget them.
    if (live && !this.queue.some(entry => entry.taskId === taskId && entry.trigger !== 'retry')) delete live.queuedThroughMs;
    this.syncQueuedAt(taskId);
  }

  /** A schedule left the manager: release its queue entries and retry timer (Rule 3). */
  private forgetTask(taskId: string) {
    this.queue = this.queue.filter(entry => entry.taskId !== taskId);
    const timer = this.retryTimers.get(taskId);
    if (timer) clearTimeout(timer);
    this.retryTimers.delete(taskId);
  }

  private async recordQueueFull(id: string, opts: FireOptions) {
    await this.recordRun(id, {
      id: randomUUID(),
      at: new Date().toISOString(),
      result: 'skipped',
      reasonCode: 'queue-full',
      ...runMeta(opts),
      message: `queue-full: ${this.queue.length} runs are waiting`
    });
  }

  /** Over the limit with overflow `queue`: enqueue this fire (and its older-slot marker). */
  private async queueFire(live: Live, opts: FireOptions, late: LateInfo | undefined, plan: { run: boolean; markerCount: number } | undefined) {
    const id = live.task.id;
    const runId = opts.runId ?? randomUUID();
    if (late?.late && plan?.run && plan.markerCount > 0) {
      // No `resolvedBy`: a queued run may never start. Its success closes the marker (D8).
      try { await this.writeMissedMarker(id, late, plan.markerCount, late.first); }
      catch (error) { this.log(`missed marker ${id}`, error); }
    }
    const trigger = opts.trigger === 'retry' || opts.trigger === 'catch-up' ? opts.trigger : 'schedule';
    const queued = this.enqueue({
      taskId: id,
      trigger,
      slotAt: opts.slotAt ?? live.targetAt,
      retryOf: opts.retryOf,
      attempt: opts.attempt,
      enqueuedAt: Date.now(),
      runId,
      ...(late?.late ? { lateCause: late.cause } : {})
    });
    if (!queued.ok) await this.recordQueueFull(id, opts);
    this.emit('changed');
  }

  /** Recovery `all`: one `catch-up` entry per slot, oldest first, plus a marker for older gaps. */
  private async queueCatchUps(live: Live, late: LateInfo, markerCount: number, slots: number[]) {
    const id = live.task.id;
    const runIds = slots.map(() => randomUUID());
    if (markerCount > 0) {
      try { await this.writeMissedMarker(id, late, markerCount, late.first, undefined, slots[0]); }
      catch (error) { this.log(`missed marker ${id}`, error); }
    }
    for (const [index, slotAt] of slots.entries()) {
      const queued = this.enqueue({ taskId: id, trigger: 'catch-up', slotAt, enqueuedAt: Date.now(), runId: runIds[index], lateCause: late.cause });
      if (!queued.ok) {
        await this.recordQueueFull(id, { manual: false, trigger: 'catch-up', slotAt });
        break;
      }
    }
    this.emit('changed');
  }

  private isEligible(entry: QueueEntry): boolean {
    const live = this.live.get(entry.taskId);
    if (!live || live.task.external || live.firing) return false;
    if (!live.task.enabled && entry.trigger !== 'retry') return false;
    if (!this.deps?.store.listProjects().some(project => project.id === live.task.projectId)) return false;
    // Covers a live PTY session, a pending launch, and a live Squad run.
    return !this.hasUnresolvedRun(live);
  }

  /**
   * Start queued runs while there is room, FIFO. An entry that cannot start yet
   * never blocks the ones behind it; entries of removed or disabled schedules
   * (retries excepted) are dropped. Call inside `serial()`.
   */
  private async drainNow() {
    if (this.draining || !this.deps) return;
    this.draining = true;
    let touched = false;
    try {
      for (let guard = 0; guard < MAX_QUEUE_TOTAL * 2; guard++) {
        const stale = this.queue.filter(entry => {
          const live = this.live.get(entry.taskId);
          return !live || !!live.task.external || (!live.task.enabled && (entry.trigger !== 'retry' || !!entry.auto));
        });
        if (stale.length) {
          const tasks = new Set(stale.map(entry => entry.taskId));
          this.queue = this.queue.filter(entry => !stale.includes(entry));
          touched = true;
          for (const taskId of tasks) this.dropQueued(taskId, false);
        }
        if (!this.queue.length) break;
        this.deps.ptys.reapDeadSessions();
        if (this.countLiveScheduledRuns() + this.pendingLaunches >= this.runLimit()) break;
        const entry = this.queue.find(candidate => this.isEligible(candidate));
        if (!entry) break;
        this.queue.splice(this.queue.indexOf(entry), 1);
        this.syncQueuedAt(entry.taskId);
        touched = true;
        let outcome: 'raced' | void;
        try {
          outcome = await this.fire(entry.taskId, {
            manual: false,
            trigger: entry.trigger,
            slotAt: entry.slotAt,
            retryOf: entry.retryOf,
            attempt: entry.attempt,
            runId: entry.runId,
            lateCause: entry.lateCause,
            ...(entry.auto ? { auto: true as const } : {}),
            fromQueue: true
          });
        } catch (error) {
          this.log(`drain ${entry.taskId}`, error);
          this.launchErrors.set(entry, error instanceof Error ? error.message : String(error));
          continue;
        }
        if (outcome === 'raced') {
          this.queue.unshift(entry);
          this.syncQueuedAt(entry.taskId);
          break;
        }
      }
    } finally {
      this.draining = false;
      if (touched) this.emit('changed');
    }
  }

  private async drainSafely() {
    try { await this.drainNow(); } catch (error) { this.log('drain', error); }
  }

  // ----- auto-retry --------------------------------------------------------------

  /**
   * After a FINAL failed record whose reason allows it, schedule the next attempt
   * (linear backoff: attempt n+1 is due `delayMinutes * n` after attempt n). The
   * pending retry is persisted. Returns true when a retry is now pending.
   */
  private async scheduleRetryIfDue(id: string, runId: string | undefined): Promise<boolean> {
    const live = this.live.get(id);
    if (!live || !runId || !live.task.enabled) return false;
    const policy = live.task.retry;
    if (!policy || policy.attempts < 1) return false;
    const run = live.task.status.runs.find(candidate => candidate.id === runId);
    if (!run || run.marker) return false;
    const reason = runReason(run);
    if (!reason || !SCHEDULE_REASONS[reason].autoRetry) return false;
    const attempt = Number.isInteger(run.attempt) && run.attempt! >= 1 ? run.attempt! : 1;
    if (!(policy.attempts > attempt - 1)) return false;
    const next = structuredClone(live.task);
    next.status.pendingRetry = {
      rootRunId: run.retryOf ?? runId,
      attempt: attempt + 1,
      dueAt: new Date(Date.now() + policy.delayMinutes * attempt * 60_000).toISOString()
    };
    try {
      await this.persist(next);
    } catch (error) {
      this.log(`persist retry ${id}`, error);
      return false;
    }
    this.publishRuntime(live, next);
    this.armRetry(id);
    this.emit('changed');
    return true;
  }

  /** (Re)arm the one retry timer for a task from its persisted `pendingRetry`. */
  private armRetry(id: string) {
    const existing = this.retryTimers.get(id);
    if (existing) clearTimeout(existing);
    this.retryTimers.delete(id);
    const live = this.live.get(id);
    const pending = live?.task.status.pendingRetry;
    if (!live || !pending || !live.task.enabled || !(live.task.retry && live.task.retry.attempts >= 1)) return;
    const due = Date.parse(pending.dueAt);
    const delay = Math.max(RETRY_MIN_DELAY_MS, (Number.isFinite(due) ? due : 0) - Date.now());
    const timer: NodeJS.Timeout = setTimeout(() => {
      void this.serial(async () => {
        // A newer armRetry replaced this timer while it waited for the serial queue.
        if (this.retryTimers.get(id) !== timer) return;
        this.retryTimers.delete(id);
        await this.retryDue(id);
        await this.drainNow();
      }).catch(error => this.log(`retry ${id}`, error));
    }, delay);
    timer.unref?.();
    this.retryTimers.set(id, timer);
  }

  /**
   * The pending retry is due: queue it. `pendingRetry` stays persisted until
   * the retry actually starts (see `fire`), so a quit while it waits in the
   * in-memory queue re-arms it on the next launch.
   */
  private async retryDue(id: string) {
    const live = this.live.get(id);
    const pending = live?.task.status.pendingRetry;
    if (!live || !pending) return;
    if (!live.task.enabled || !(live.task.retry && live.task.retry.attempts >= 1)) { await this.clearPendingRetry(id); return; }
    const due = Date.parse(pending.dueAt);
    if (Number.isFinite(due) && due > Date.now() + 1_000) { this.armRetry(id); return; }
    // Any retry already queued for this schedule (a manual one included) serves
    // this chain too: one run re-runs the schedule (D8). Never replace it.
    if (this.queue.some(entry => entry.taskId === id && entry.trigger === 'retry')) return;
    if (pending.attempt > live.task.retry.attempts + 1) { await this.clearPendingRetry(id); return; }
    const root = live.task.status.runs.find(run => run.id === pending.rootRunId);
    const slot = Date.parse(root?.slotAt ?? '');
    const queued = this.enqueue({
      taskId: id,
      trigger: 'retry',
      retryOf: pending.rootRunId,
      attempt: pending.attempt,
      ...(Number.isFinite(slot) ? { slotAt: slot } : {}),
      enqueuedAt: Date.now(),
      auto: true
    });
    if (!queued.ok) {
      await this.recordQueueFull(id, { manual: false, trigger: 'retry', retryOf: pending.rootRunId, attempt: pending.attempt });
      await this.clearPendingRetry(id);
    }
  }

  /** Cancel a task's retry timer and its queued automatic retries (the policy went away). */
  private cancelAutoRetries(id: string) {
    const timer = this.retryTimers.get(id);
    if (timer) clearTimeout(timer);
    this.retryTimers.delete(id);
    const before = this.queue.length;
    this.queue = this.queue.filter(entry => entry.taskId !== id || entry.trigger !== 'retry' || !entry.auto);
    if (this.queue.length !== before) this.syncQueuedAt(id);
  }

  /** Drop a pending retry (a success, a disable): persisted, timer cancelled. */
  private async clearPendingRetry(id: string) {
    const timer = this.retryTimers.get(id);
    if (timer) clearTimeout(timer);
    this.retryTimers.delete(id);
    const live = this.live.get(id);
    if (!live?.task.status.pendingRetry) return;
    const next = structuredClone(live.task);
    delete next.status.pendingRetry;
    try { await this.persist(next); } catch (error) { this.log(`persist retry ${id}`, error); return; }
    this.publishRuntime(live, next);
    this.emit('changed');
  }

  // ----- run query / dismiss / retry ------------------------------------------

  /** A pure read of the live list: not queued behind fires and drains (`get`/`list` aren't either). */
  queryRuns(query?: ScheduleRunQuery): Promise<ScheduleRunQueryResult> {
    return Promise.resolve().then(() => collectRunRows(this.list(), query, Date.now()));
  }

  /** Mark runs dismissed (they leave Open). Returns how many changed. */
  dismissRuns(refs: ScheduleRunRef[]): Promise<number> {
    return this.serial(async () => {
      if (!Array.isArray(refs) || refs.length > MAX_REF_DISMISS) throw new Error(`dismissRuns takes at most ${MAX_REF_DISMISS} runs`);
      const byTask = new Map<string, Set<string>>();
      for (const ref of refs) {
        if (!ref || typeof ref.scheduleId !== 'string' || typeof ref.runId !== 'string') continue;
        const set = byTask.get(ref.scheduleId) ?? new Set<string>();
        set.add(ref.runId);
        byTask.set(ref.scheduleId, set);
      }
      let dismissed = 0;
      const dismissedAt = new Date().toISOString();
      for (const [scheduleId, runIds] of byTask) {
        const live = this.live.get(scheduleId);
        if (!live || live.task.external) continue;
        const next = structuredClone(live.task);
        let changed = 0;
        next.status.runs = next.status.runs.map(run => {
          if (!run.id || !runIds.has(run.id) || run.dismissedAt || run.launchState === 'pending') return run;
          changed++;
          return { ...run, dismissedAt };
        });
        if (!changed) continue;
        await this.persist(next);
        this.publishRuntime(live, next);
        dismissed += changed;
      }
      if (dismissed) this.emit('changed');
      return dismissed;
    });
  }

  /**
   * Retry problem runs (or catch up a missed marker). Rejected per ref when the
   * schedule or run is unknown, external, still launching, or not retryable.
   * A valid ref is queued and the queue drained: `started` when it launched at
   * once, else `queued` (waiting for a free slot or for the schedule's last run).
   */
  retryRuns(refs: ScheduleRunRef[]): Promise<ScheduleRetryResult[]> {
    type Pending = { entry: QueueEntry; index: number; root: string; attempt: number };
    return this.serial(async () => {
      if (!Array.isArray(refs) || refs.length < 1 || refs.length > MAX_REF_RETRY) throw new Error(`retryRuns takes 1-${MAX_REF_RETRY} runs`);
      const results: ScheduleRetryResult[] = [];
      const pending: Pending[] = [];
      for (const ref of refs) {
        const base = { scheduleId: String(ref?.scheduleId), runId: String(ref?.runId) };
        const fail = (error: string) => results.push({ ...base, ok: false, error });
        const live = this.live.get(base.scheduleId);
        if (!live) { fail('schedule not found'); continue; }
        if (live.task.external) { fail('external schedules cannot be retried here'); continue; }
        const run = live.task.status.runs.find(candidate => candidate.id === base.runId);
        if (!run) { fail('run not found'); continue; }
        if (run.launchState === 'pending') { fail('run is still launching'); continue; }
        const reason = runReason(run);
        const retryable = isProblemRun(run) && (reason ? SCHEDULE_REASONS[reason].manualRetry : true);
        if (!retryable) { fail('run cannot be retried'); continue; }
        const root = run.retryOf ?? run.id!;
        // One retry per chain at a time: a second request while one is queued or
        // running would only start the same work twice.
        const chainBusy = this.queue.some(entry => entry.taskId === base.scheduleId && entry.trigger !== 'schedule' && entry.retryOf === root)
          || live.task.status.runs.some(candidate => candidate.retryOf === root
            && (candidate.launchState === 'pending' || (candidate.launchState === 'running' && candidate.durationMs === undefined && !candidate.finishedAt)));
        if (chainBusy) { fail('already retrying'); continue; }
        const attemptOf = (candidate: ScheduleRun) => (Number.isInteger(candidate.attempt) && candidate.attempt! >= 1 ? candidate.attempt! : 1);
        const attempt = Math.max(...live.task.status.runs
          .filter(candidate => candidate.id === root || candidate.retryOf === root)
          .map(attemptOf), attemptOf(run)) + 1;
        const slot = Date.parse(run.missed?.to ?? run.slotAt ?? '');
        if (run.marker && !live.task.enabled) { fail('enable the schedule to catch up missed runs'); continue; }
        // Manual retries always queue, even when overflow is `skip`.
        const queued = this.enqueue({
          taskId: base.scheduleId,
          trigger: run.marker ? 'catch-up' : 'retry',
          retryOf: root,
          attempt,
          ...(Number.isFinite(slot) ? { slotAt: slot } : {}),
          enqueuedAt: Date.now()
        });
        if (!queued.ok) { fail(SCHEDULE_REASONS['queue-full'].label); continue; }
        if (queued.replaced) {
          // Coalesced, not failed: the schedule re-runs once, and that run serves
          // the earlier ref too (its success closes the earlier problem, D8).
          for (const item of pending) if (item.entry === queued.replaced) item.entry = queued.entry;
        }
        pending.push({ entry: queued.entry, index: results.length, root, attempt });
        results.push({ ...base, ok: true, status: 'queued' });
      }
      return { results, pending };
    }).then(async ({ results, pending }) => {
      if (!pending.length) return results;
      const epoch = this.epoch;
      // Launch in a separate serial op so this call never holds the scheduler,
      // and answer within the CLI's control timeout: whatever hasn't started by
      // then is reported `queued` and starts as soon as the drain gets to it.
      const drained = this.serial(() => this.drainNow()).catch(error => this.log('retry drain', error));
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([drained, new Promise<void>(resolve => { timer = setTimeout(resolve, RETRY_REPORT_WAIT_MS); timer.unref?.(); })]);
      if (timer) clearTimeout(timer);
      if (epoch !== this.epoch) {
        return results.map(result => result.ok ? { ...result, ok: false, status: undefined, error: 'Scheduler stopped' } : result);
      }
      for (const item of pending) {
        const result = results[item.index];
        if (!result.ok || this.queue.includes(item.entry)) continue;
        // The drain consumed the entry: it launched, unless the launch itself failed.
        const thrown = this.launchErrors.get(item.entry);
        if (thrown) { results[item.index] = { ...result, ok: false, status: undefined, error: thrown }; continue; }
        // Match the entry that actually ran: refs merged into one entry share its launch.
        const newest = this.live.get(result.scheduleId)?.task.status.runs[0];
        const failed = newest && newest.retryOf === (item.entry.retryOf ?? item.root) && newest.attempt === (item.entry.attempt ?? item.attempt)
          && (newest.reasonCode === 'launch-failed' || newest.reasonCode === 'project-missing');
        if (failed) results[item.index] = { ...result, ok: false, status: undefined, error: SCHEDULE_REASONS[newest.reasonCode!].label };
        else result.status = 'started';
      }
      return results;
    });
  }

  /**
   * Attach an agent-authored summary to the run owning `sessionId`. Called from
   * the `schedule_report` MCP tool via the mcp-server `onReport` callback.
   *
   * The route carries only (projectId, sessionId), not a scheduleId, so we scan
   * live schedules for the one whose runs include this session. The optimistic
   * `recordRun` at fire time guarantees a matching run exists by the time the
   * agent could call this. We MERGE (spread) rather than replace — mirroring
   * `recordRun` — so the report and the exit-time result are commutative:
   *   - report before exit: merges onto the optimistic run; later onExit spread
   *     (`{...existing, ...finalRun}`) carries no `report`, so it's preserved.
   *   - report after exit: merges onto the finalized run. If the exit handler
   *     had already stamped it `incomplete` (no report seen yet), a report
   *     arriving late is proof the run DID reach its end — just filed a beat
   *     after the process closed — so it's promoted back to `success` here
   *     rather than left permanently flagged as a silent failure.
   *
   * Best-effort: if the run was evicted from the ring buffer (extremely
   * unlikely within one run's lifetime), we log and return — the tool still
   * reports success (fire-and-forget contract).
   */
  private async attachReportNow(
    sessionId: string,
    summary: string,
    status?: 'success' | 'partial' | 'failure'
  ) {
    for (const live of this.live.values()) {
      const next = structuredClone(live.task);
      const runs = next.status.runs;
      const idxFromMap = live.runIndexBySession.get(sessionId);
      const idx =
        idxFromMap !== undefined && runs[idxFromMap]?.sessionId === sessionId
          ? idxFromMap
          : runs.findIndex((r) => r.sessionId === sessionId);
      if (idx < 0) continue;
      const wasIncomplete = runs[idx].result === 'incomplete';
      runs[idx] = {
        ...runs[idx],
        report: summary,
        reportedAt: new Date().toISOString(),
        reportStatus: status,
        // The promoted record must not keep its `no-report` reason or message.
        ...(wasIncomplete ? { result: 'success' as const, reasonCode: undefined, message: undefined } : {})
      };
      if (wasIncomplete && live.task.status.lastRunSessionId === sessionId) {
        next.status.lastRunResult = 'success';
      }
      // The exit path held this run's notice back when it scheduled a retry (D9);
      // the promotion ends that chain, so it gets its one notice here.
      const heldNotice = wasIncomplete && !!live.task.status.pendingRetry
        && live.task.status.pendingRetry.rootRunId === (runs[idx].retryOf ?? runs[idx].id);
      await this.persist(next);
      this.publishRuntime(live, next);
      this.emit('changed');
      if (wasIncomplete) await this.onFinishedSuccess(live.task.id, runs[idx].id);
      if (heldNotice && (live.task.inboxLevel ?? 'quiet') !== 'silent') {
        const project = this.deps?.store.listProjects().find(candidate => candidate.id === live.task.projectId);
        if (project) void this.notifyInboxOnExit(live.task, runs[idx], project, false);
      }
      return;
    }
    this.log('attachReport', `no run found for session ${sessionId} (report dropped)`);
  }

  /**
   * The agent finished its turn (Stop hook), reported via the mcp-server
   * `onStopHook` callback. For an interactive (non-auto-close) scheduled run
   * the pty stays alive at the prompt and never emits `exit`, so this is the
   * only signal that the work is done — we stamp `finishedAt` (and a duration
   * derived from the run's fire time) so the UI can show "done · session open"
   * instead of "running" forever.
   *
   * For an auto-close task we ALSO close the pty as an *expected* close, exactly
   * as the old `onStopHook` did, so the subsequent `onExit` logs success rather
   * than a kill-signal error. The merge-style `recordRun` keeps the two updates
   * commutative (see `attachReport`'s note).
   *
    * A Stop hook now also powers interactive lifecycle status. If no scheduled
    * run matches, leave that session open at its prompt; the lifecycle caller has
    * already recorded the completed turn.
   */
  private async onAgentFinishedNow(sessionId: string) {
    for (const live of this.live.values()) {
      const next = structuredClone(live.task);
      const runs = next.status.runs;
      const idxFromMap = live.runIndexBySession.get(sessionId);
      const idx =
        idxFromMap !== undefined && runs[idxFromMap]?.sessionId === sessionId
          ? idxFromMap
          : runs.findIndex((r) => r.sessionId === sessionId);
      if (idx < 0) continue;
      const run = runs[idx];
      // Don't clobber a duration the exit handler already recorded; otherwise
      // derive elapsed from the fire timestamp.
      const startMs = Date.parse(run.at);
      const durationMs =
        run.durationMs ??
        (Number.isFinite(startMs) ? Math.max(0, Date.now() - startMs) : undefined);
      runs[idx] = {
        ...run,
        finishedAt: new Date().toISOString(),
        ...(durationMs !== undefined ? { durationMs } : {})
      };
      await this.persist(next);
      this.publishRuntime(live, next);
      this.emit('changed');
      if (live.task.autoCloseOnFinish) {
        const pendingSubagents = this.deps?.getPendingSubagentCount?.(sessionId) ?? 0;
        if (pendingSubagents > 0) {
          this.deferClose(sessionId, live.task.id, run.id);
        } else {
          // Current main-owned count is authoritative for this later parent Stop.
          this.clearDeferredClose(sessionId);
          this.deps?.ptys.closeExpected(sessionId);
        }
      }
      return;
    }
    // A non-scheduled interactive session is finished for now, not exited. Its
    // next UserPromptSubmit begins another lifecycle turn in the same PTY.
  }

  /**
   * Re-evaluate a deferred scheduled session after a trusted Task hook transition.
   * A zero count is intentionally not enough to close: parent must first process
   * child output and send its later Stop hook.
   */
  onSubagentCountChanged(sessionId: string) {
    // This only records readiness. Parent Stop remains close authorization so it
    // can process Task output and publish a final result before its PTY closes.
    if (!this.deferredCloses.has(sessionId)) return;
    this.deps?.getPendingSubagentCount?.(sessionId);
  }

  private deferClose(sessionId: string, taskId: string, runId?: string) {
    if (this.deferredCloses.has(sessionId)) return;
    const timeout = setTimeout(() => {
      void this.serial(async () => {
      const deferred = this.deferredCloses.get(sessionId);
      if (!deferred) return;
      this.deferredCloses.delete(sessionId);
      const live = this.live.get(deferred.taskId);
      if (!live) return;
      const run = live.task.status.runs.find(
        (candidate) => (deferred.runId !== undefined && candidate.id === deferred.runId) || candidate.sessionId === sessionId
      );
      if (run) {
        await this.recordRun(deferred.taskId, {
          ...run,
          result: 'error',
          reasonCode: 'subagent-timeout',
          message: 'background subagent timed out'
        });
      }
      this.deps?.ptys.closeExpected(sessionId);
      }).catch(error => this.log(`deferred close ${sessionId}`, error));
    }, SCHEDULED_SUBAGENT_WAIT_TIMEOUT_MS);
    timeout.unref?.();
    this.deferredCloses.set(sessionId, { taskId, runId, timeout });
  }

  private releaseSession(sessionId: string) {
    this.exitListeners.get(sessionId)?.(); this.exitListeners.delete(sessionId);
    for (const timers of [this.nonHookWatchdogs, this.maxDurationWatchdogs]) {
      const timer = timers.get(sessionId); if (timer) clearTimeout(timer); timers.delete(sessionId);
    }
    this.timedOutSessions.delete(sessionId);
    this.clearDeferredClose(sessionId);
  }

  private clearDeferredClose(sessionId: string) {
    const deferred = this.deferredCloses.get(sessionId);
    if (!deferred) return;
    clearTimeout(deferred.timeout);
    this.deferredCloses.delete(sessionId);
  }

  private clearDeferredClosesForTask(taskId: string) {
    for (const [sessionId, deferred] of this.deferredCloses) {
      if (deferred.taskId === taskId) this.clearDeferredClose(sessionId);
    }
  }
}

/** Latest of the last run, the slot cursor and the queued-through slot (epoch ms, 0 = none). */
function anchorOf(status: { lastRunAt?: string; slotCursorAt?: string }, queuedThroughMs = 0, now = Date.now()): number {
  const ms = (iso?: string) => { const v = iso ? Date.parse(iso) : 0; return Number.isFinite(v) ? v : 0; };
  // `lastRunAt` is used exactly as before (Classic parity). Our own anchors are
  // ignored when they sit in the future, so clock skew can't silently stop a schedule.
  const own = (v: number) => (v > now + FUTURE_ANCHOR_TOLERANCE_MS ? 0 : v);
  return Math.max(ms(status.lastRunAt), own(ms(status.slotCursorAt)), own(queuedThroughMs));
}

/**
 * The `n` newest slots of a late gap, oldest first, never at or before its
 * floor. Walks back from the gap's true newest slot, so a gap longer than the
 * 1000-slot count cap still replays its newest slots.
 */
function newestSlots(cadence: ScheduledTask['schedule'], late: Pick<LateInfo, 'floor' | 'last' | 'intervalMs'>, n: number): number[] {
  const out: number[] = [];
  if (late.intervalMs !== undefined) {
    for (let i = n - 1; i >= 0; i--) {
      const slot = late.last - i * late.intervalMs;
      if (slot > late.floor) out.push(slot);
    }
    return out;
  }
  for (const slot of previousCronSlots(cadence.cron!, cadence.tz, late.last, n)) {
    if (slot > late.floor) out.push(slot);
  }
  return out.length ? out : [late.last];
}

function clampRetain(n: number): number {
  if (!Number.isFinite(n)) return 10;
  return Math.max(1, Math.min(MAX_RETAIN, Math.round(n)));
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  if (m < 60) return `${m}m ${remS}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}h ${remM}m`;
}
