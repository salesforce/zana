import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { watch, existsSync, mkdirSync, type FSWatcher } from 'node:fs';
import type {
  Persona,
  Project,
  ScheduleCreateInput,
  ScheduledTask,
  ScheduleRun,
  ScheduleUpdateInput
} from '@zana-ai/zcc-domain/product';
import { MAX_INTERVAL_MS, MIN_INTERVAL_MS, parseEvery as parseEveryShared } from '@zana-ai/zcc-domain/parse-every';
import { nextCronRunAt } from '@zana-ai/zcc-domain/parse-cron';
import { isCronCadence, validateCadence } from '@zana-ai/zcc-domain/schedule-spec';
import { providerCapabilities, seedPromptArgs } from '@zana-ai/zcc-domain/launch-provider';
import type { PtyManager } from '@zana-ai/zcc-host-daemon/pty';
import type { LaunchTerminal } from '../launch/terminal-launcher.js';
import type { IInboxStore } from '../inbox/inbox-store.js';
import {
  deleteSchedule,
  globalDir,
  listAllSchedules,
  projectDir,
  saveSchedule
} from './scheduler-store.js';
import type { store as Store } from '../projects/store.js';

/** History buffer cap. Hand-editing `retain` higher in the JSON works, but
 *  we won't surface a bigger value than this in the UI. */
const MAX_RETAIN = 100;

/**
 * Global ceiling on concurrently-running scheduled sessions across ALL
 * schedules. Per-schedule `overlap:'skip'` stops a single schedule stacking on
 * itself, but says nothing across schedules: N schedules sharing an interval
 * (e.g. five "every 1h" jobs) all come due in the same tick and would fire N
 * `claude` processes at once — a thundering herd that spikes CPU/memory and
 * races the same git working tree. This caps the herd.
 *
 * 5 is a conservative cockpit value: a handful of background agents can run in
 * parallel without the machine noticing, while a sixth coincident fire waits
 * for its next interval rather than piling on. It sits well under the pty
 * MAX_LIVE_SESSIONS (50) so the two caps don't fight — the scheduler self-limits
 * long before it could exhaust the pty manager's slots, leaving headroom for
 * the user's own interactive tabs.
 */
const MAX_CONCURRENT_SCHEDULED_RUNS = 5;

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
}

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

type Deps = {
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
  /** Lazily set after the window opens. We don't fire before then. */
  private deps: Deps | null = null;

  /** fs.watch handles, keyed by the watched directory path. */
  private watchers = new Map<string, FSWatcher>();
  private watchDebounce: NodeJS.Timeout | null = null;
  /**
   * Epoch-ms until which directory-watch events are ignored. We bump this on
   * every `persist()` (the scheduler writes its own JSON on each fire), so the
   * watcher only reacts to *external* edits — a skill or the user dropping a
   * schedule file — not to our own run-history churn. Without this, a fire's
   * `recordRun` → `persist` would trip the watcher and `loadAll` would wipe
   * in-flight timer/run-index state.
   */
  private suppressWatchUntil = 0;

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
  loadAll(projects: Project[]) {
    this.stopAll();
    const tasks = listAllSchedules(projects, (path, reason) =>
      this.log(`load ${path}`, `invalid schedule file dropped: ${reason}`)
    );
    for (const task of tasks) {
      this.live.set(task.id, this.makeLive(task));
      if (task.enabled) this.arm(task.id);
    }
    this.emit('changed');
  }

  create(input: ScheduleCreateInput): ScheduledTask {
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
      extraArgs: input.extraArgs,
      prompt: input.prompt,
      schedule,
      overlap: 'skip',
      history: { retain: clampRetain(input.retain ?? 10) },
      status: {
        runCount: 0,
        runs: [],
        nextRunAt: new Date(this.nextTargetFireMs(schedule, 0, Date.now())).toISOString()
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
    this.persist(task);
    this.live.set(task.id, this.makeLive(task));
    if (task.enabled) this.arm(task.id);
    this.emit('changed');
    return task;
  }

  update(id: string, patch: ScheduleUpdateInput): ScheduledTask {
    const live = this.live.get(id);
    if (!live) throw new Error(`schedule not found: ${id}`);
    const next: ScheduledTask = { ...live.task };
    if (patch.name !== undefined) next.name = patch.name.trim();
    if (patch.description !== undefined) next.description = patch.description.trim() || undefined;
    if (patch.enabled !== undefined) next.enabled = patch.enabled;
    if (patch.projectId !== undefined) next.projectId = patch.projectId;
    if (patch.profile !== undefined) next.profile = patch.profile;
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
    this.persist(next);
    live.task = next;
    this.disarm(id);
    if (next.enabled) this.arm(id);
    this.emit('changed');
    return next;
  }

  setEnabled(id: string, enabled: boolean): ScheduledTask | null {
    const live = this.live.get(id);
    if (!live) return null;
    return this.update(id, { enabled });
  }

  remove(id: string) {
    this.disarm(id);
    this.clearDeferredClosesForTask(id);
    this.live.delete(id);
    if (this.deps) {
      // Our own delete — keep the watcher quiet (mirrors persist()).
      this.suppressWatchUntil = Date.now() + 1_000;
      deleteSchedule(id, this.deps.store.listProjects());
    }
    this.emit('changed');
  }

  /** Fire immediately, ignoring the timer and the overlap check. */
  runNow(id: string): ScheduledTask {
    const live = this.live.get(id);
    if (!live) throw new Error(`schedule not found: ${id}`);
    this.fire(id, { manual: true });
    return live.task;
  }

  stopAll() {
    for (const id of [...this.live.keys()]) this.disarm(id);
    this.live.clear();
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
  }

  /**
   * Watch the global + per-project schedule directories so externally-authored
   * schedule files (e.g. the `zcc-center` skill writing one, or a hand-edit)
   * go live without an app restart. Our own writes are suppressed via
   * `suppressWatchUntil`, so this only fires on external changes.
   *
   * Call once after `loadAll` at boot, and again via `rebindWatchers` when the
   * project list changes (so new projects' dirs get watched).
   */
  startWatching() {
    this.rebindWatchers();
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
      for (const p of this.deps.store.listProjects()) dirs.push(projectDir(p));
    }
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
    this.watchDebounce = setTimeout(() => {
      this.watchDebounce = null;
      // Skip our own run-history writes.
      if (Date.now() < this.suppressWatchUntil) return;
      if (!this.deps) return;
      // Don't yank state out from under an in-flight fire. loadAll() calls
      // stopAll(), which clears timers and run-index maps — reloading mid-fire
      // would orphan the exit handler's recordRun. Defer instead.
      if (this.hasLiveSession()) {
        this.scheduleReload();
        return;
      }
      this.loadAll(this.deps.store.listProjects());
    }, 250);
  }

  /**
   * Count scheduled sessions still alive across EVERY schedule. Walks each
   * schedule's run history for `sessionId`s and checks them against the live
   * ptys for that project — the same `ptys.list(...).status` mechanism the
   * overlap guard uses, just aggregated globally instead of per-schedule. Dedup
   * by session id so an optimistic + exit-time record of the same run counts
   * once. Backs the {@link MAX_CONCURRENT_SCHEDULED_RUNS} cap in `fire`.
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
        if (r.sessionId && aliveIds.has(r.sessionId)) counted.add(r.sessionId);
      }
    }
    return counted.size;
  }

  /** True if any schedule has a spawned terminal session still running. */
  private hasLiveSession(): boolean {
    if (!this.deps) return false;
    for (const live of this.live.values()) {
      for (const r of live.task.status.runs) {
        if (!r.sessionId) continue;
        const sessions = this.deps.ptys.list(live.task.projectId);
        if (sessions.some((s) => s.id === r.sessionId && s.status !== 'exited')) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Disarm and drop every live schedule referencing the removed project.
   * Called from the projects.remove IPC handler. The on-disk JSON files
   * (under `<project.path>/.zcc/schedules/`) are not deleted — if the
   * project is re-added later, `loadAll` will rediscover them.
   */
  onProjectRemoved(projectId: string) {
    let dropped = 0;
    for (const id of [...this.live.keys()]) {
      const live = this.live.get(id);
      if (!live) continue;
      if (live.task.projectId === projectId) {
        this.disarm(id);
        this.clearDeferredClosesForTask(id);
        this.live.delete(id);
        dropped += 1;
      }
    }
    if (dropped > 0) this.emit('changed');
  }

  // ----- internals -----------------------------------------------------------

  private makeLive(task: ScheduledTask): Live {
    return {
      task,
      timer: null,
      runIndexBySession: new Map(),
      countedRunIds: new Set()
    };
  }

  private persist(task: ScheduledTask) {
    if (!this.deps) return;
    // Our own write — keep the watcher quiet long enough for the fs event to
    // land and be ignored, so run-history churn doesn't trigger a reload.
    this.suppressWatchUntil = Date.now() + 1_000;
    saveSchedule(task, this.deps.store.listProjects());
  }

  /**
   * Epoch-ms of the next intended fire for a cadence, given the last run (0 if
   * never) and now. Shared by `arm` and `create`'s initial `nextRunAt`.
   *
   *  - interval: `lastRun + interval`, but re-armed fresh at `now + interval`
   *    when more than one full interval overdue (schedule sat disabled for days,
   *    or the laptop slept) — prevents drift compounding + resume stampedes.
   *  - cron: the first slot strictly after `lastRun` (or after `now` if never
   *    run). When that slot has already passed (the app was closed across it),
   *    the returned time is in the past; the grace floor in `arm` fires it once,
   *    soon — a single boot catch-up, NOT a replay of every missed slot.
   */
  private nextTargetFireMs(
    schedule: { every?: string; cron?: string; tz?: string },
    lastRun: number,
    now: number
  ): number {
    if (isCronCadence(schedule)) {
      const from = lastRun > 0 ? new Date(lastRun) : new Date(now);
      const next = nextCronRunAt(schedule.cron!, schedule.tz, from);
      // Validated on create/load, so `next` should exist; degrade to a
      // far-future no-op rather than a tight loop if it somehow doesn't.
      return next ? next.getTime() : now + MAX_INTERVAL_MS;
    }
    const intervalMs = parseEveryShared(schedule.every ?? '') ?? MIN_INTERVAL_MS;
    const veryStale = lastRun > 0 && lastRun + intervalMs < now - intervalMs;
    return lastRun && !veryStale ? lastRun + intervalMs : now + intervalMs;
  }

  private arm(id: string) {
    const live = this.live.get(id);
    if (!live || !live.task.enabled) return;
    const now = Date.now();
    const lastRun = live.task.status.lastRunAt ? Date.parse(live.task.status.lastRunAt) : 0;
    const targetAt = this.nextTargetFireMs(live.task.schedule, lastRun, now);
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
    live.timer = setTimeout(() => this.fire(id, { manual: false }), delay);
  }

  private disarm(id: string) {
    const live = this.live.get(id);
    if (!live) return;
    if (live.timer) {
      clearTimeout(live.timer);
      live.timer = null;
    }
  }

  private fire(id: string, opts: { manual: boolean }) {
    const live = this.live.get(id);
    if (!live || !this.deps) return;
    live.timer = null;

    // Concurrent-duplicate guard: a fire whose launch is async (remote/coordinator
    // commit) hasn't returned yet when the next tick (or a watcher-driven reload's
    // re-arm) calls fire again. `firing` marks an in-flight launch so the second
    // fire records a skip instead of spawning a duplicate session. Manual "Run
    // now" bypasses it — an explicit click is the user's deliberate override.
    if (!opts.manual && live.firing) {
      this.log(`fire ${id}`, 'skipped: previous fire/launch is already in progress');
      this.recordRun(id, {
        id: randomUUID(),
        at: new Date().toISOString(),
        result: 'skipped',
        message: 'previous fire/launch is already in progress'
      });
      if (live.task.enabled) this.arm(id);
      return;
    }
    if (!opts.manual) live.firing = true;

    const project = this.deps.store.listProjects().find((p) => p.id === live.task.projectId);
    if (!project) {
      if (!opts.manual) live.firing = false;
      this.log(
        `fire ${id}`,
        `project ${live.task.projectId} not found for schedule "${live.task.name}"`
      );
      this.recordRun(id, {
        id: randomUUID(),
        at: new Date().toISOString(),
        result: 'error',
        message: `project ${live.task.projectId} not found`
      });
      if (live.task.enabled && !opts.manual) this.arm(id);
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
      const aliveRunSessionId = live.task.status.runs
        .map((r) => r.sessionId)
        .find((sid): sid is string => !!sid && aliveIds.has(sid));
      if (aliveRunSessionId) {
        if (!opts.manual) live.firing = false;
        this.log(
          `fire ${id}`,
          `skipped: previous run ${aliveRunSessionId} still active`
        );
        this.recordRun(id, {
          id: randomUUID(),
          at: new Date().toISOString(),
          result: 'skipped',
          sessionId: aliveRunSessionId,
          message: 'previous run still active'
        });
        if (live.task.enabled) this.arm(id);
        return;
      }

      // Global concurrency cap: count scheduled runs alive across ALL schedules
      // (not just this one — overlap above already covered self-stacking) and
      // skip this fire if firing would exceed MAX_CONCURRENT_SCHEDULED_RUNS.
      // Reuses the exact skip/record path as overlap, with a distinct reason so
      // the history (and logs) tell the two apart. Manual "Run now" never
      // reaches here — it bypasses this whole block, matching how it bypasses
      // overlap: an explicit click is the user's deliberate override.
      const liveScheduledRuns = this.countLiveScheduledRuns() + this.pendingLaunches;
      if (liveScheduledRuns >= MAX_CONCURRENT_SCHEDULED_RUNS) {
        if (!opts.manual) live.firing = false;
        this.log(
          `fire ${id}`,
          `skipped: concurrency cap (${liveScheduledRuns}/${MAX_CONCURRENT_SCHEDULED_RUNS} scheduled runs active)`
        );
        this.recordRun(id, {
          id: randomUUID(),
          at: new Date().toISOString(),
          result: 'skipped',
          message: `concurrency-cap: ${liveScheduledRuns}/${MAX_CONCURRENT_SCHEDULED_RUNS} scheduled runs active`
        });
        if (live.task.enabled) this.arm(id);
        return;
      }
    }

    const runId = randomUUID();
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
      // system-prompt guidance (and only for scheduled spawns).
      scheduled: true,
      // Bake the schedule's loudness into the session so an agent-initiated
      // inbox_push during this run is stamped (or dropped, when silent) with
      // the right level — independent of later edits to the schedule.
      inboxLevel: live.task.inboxLevel ?? 'quiet'
    } as const;
    let launched;
    try {
      launched = this.deps.launchTerminal(launchOptions, { kind: 'schedule', id: `schedule:${live.task.id}` });
    } catch (err) {
      this.recordLaunchFailure(id, runId, live, opts, err);
      return;
    }

    if (launched instanceof Promise) {
      this.pendingLaunches += 1;
      void launched.then(
        (session) => {
          this.pendingLaunches -= 1;
          this.finishLaunch(id, runId, live, opts, project, effectiveProfile, session);
        },
        (err) => {
          this.pendingLaunches -= 1;
          this.recordLaunchFailure(id, runId, live, opts, err);
        }
      );
      return;
    }
    this.finishLaunch(id, runId, live, opts, project, effectiveProfile, launched);
  }

  private recordLaunchFailure(id: string, runId: string, live: Live, opts: { manual: boolean }, err: unknown) {
    if (!opts.manual) live.firing = false;
    this.log(`fire ${id} launch`, err);
    this.recordRun(id, {
      id: runId,
      at: new Date().toISOString(),
      result: 'error',
      message: err instanceof Error ? err.message : String(err)
    });
    if (live.task.enabled && !opts.manual) this.arm(id);
  }

  private finishLaunch(
    id: string,
    runId: string,
    live: Live,
    opts: { manual: boolean },
    project: Project,
    effectiveProfile: Parameters<typeof providerCapabilities>[0],
    session: ReturnType<PtyManager['create']>
  ) {
    if (!opts.manual) live.firing = false;

    // A reload can replace this Live while durable coordinator commit is in
    // flight. Session remains valid, but stale scheduler state must not mutate.
    if (this.live.get(id) !== live) return;

    const runStartedAt = new Date().toISOString();
    const runStartMs = Date.now();

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
      }, SCHEDULED_NONHOOK_MAX_RUNTIME_MS);
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
      }, maxMs);
      watchdog.unref?.();
      this.maxDurationWatchdogs.set(session.id, watchdog);
    }

    const onExit = (sessionId: string, exitCode: number) => {
      if (sessionId !== session.id) return;
      this.deps?.ptys.off('exit', onExit);
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
      // reads their report either way.
      const expectsReport =
        (live.task.inboxLevel ?? 'quiet') !== 'silent' &&
        providerCapabilities(effectiveProfile).injectsClaudeMcpConfig;
      const existingRun = live.task.status.runs.find(
        (r) => r.id === runId || r.sessionId === session.id
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
      this.recordRun(id, finalRun);
      // `silent` schedules never write a completion summary; `quiet`/`loud`
      // both write one, stamped with the level so the renderer can decide
      // badge counting and inline-vs-grouped placement. An `incomplete` run
      // always escalates the notice to `loud` regardless of the schedule's
      // configured level, so a quiet schedule's silent failure still surfaces.
      if ((live.task.inboxLevel ?? 'quiet') !== 'silent') {
        void this.notifyInboxOnExit(
          live.task,
          finalRun,
          project,
          result === 'incomplete' || result === 'error'
        );
      }
    };
    this.deps?.ptys.on('exit', onExit);

    // Optimistically record the run as success at fire time so the UI shows the
    // schedule advanced, even if the session is long-lived. The exit handler
    // above will overwrite the entry once the pty closes.
    this.recordRun(id, {
      id: runId,
      at: runStartedAt,
      result: 'success',
      sessionId: session.id
    });

    if (live.task.enabled && !opts.manual) this.arm(id);
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
      const body = `**${task.name}** — ${resultLabel}${durationStr}`;
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

  private recordRun(id: string, run: ScheduleRun) {
    const live = this.live.get(id);
    if (!live) return;
    const status = live.task.status;
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
        ? live.runIndexBySession.get(run.sessionId)
        : undefined;
    if (knownIdx !== undefined && knownIdx >= 0 && status.runs[knownIdx]) {
      status.runs[knownIdx] = { ...status.runs[knownIdx], ...run };
    } else if (run.id && live.countedRunIds.has(run.id)) {
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
      status.runs = [run, ...status.runs].slice(0, live.task.history.retain);
      status.runCount += 1;
      if (run.id) {
        live.countedRunIds.add(run.id);
        // Bound the set: drop oldest ids once over cap (insertion-ordered).
        while (live.countedRunIds.size > COUNTED_RUN_IDS_CAP) {
          const oldest = live.countedRunIds.values().next().value;
          if (oldest === undefined) break;
          live.countedRunIds.delete(oldest);
        }
      }
      // After unshift everything shifts right by one. Rebuild the index from
      // surviving entries so we can still find them on their exit-time update.
      live.runIndexBySession.clear();
      status.runs.forEach((r, idx) => {
        if (r.sessionId) live.runIndexBySession.set(r.sessionId, idx);
      });
    }
    if (run.result === 'error') {
      this.log(`run ${id}`, run.message ?? 'error (no message)');
    }
    status.lastRunAt = run.at;
    status.lastRunResult = run.result;
    status.lastRunSessionId = run.sessionId;
    this.persist(live.task);
    this.emit('changed');
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
  attachReport(
    sessionId: string,
    summary: string,
    status?: 'success' | 'partial' | 'failure'
  ) {
    for (const live of this.live.values()) {
      const runs = live.task.status.runs;
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
        ...(wasIncomplete ? { result: 'success' as const } : {})
      };
      if (wasIncomplete && live.task.status.lastRunSessionId === sessionId) {
        live.task.status.lastRunResult = 'success';
      }
      this.persist(live.task);
      this.emit('changed');
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
  onAgentFinished(sessionId: string) {
    for (const live of this.live.values()) {
      const runs = live.task.status.runs;
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
      this.persist(live.task);
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
      const deferred = this.deferredCloses.get(sessionId);
      if (!deferred) return;
      this.deferredCloses.delete(sessionId);
      const live = this.live.get(deferred.taskId);
      if (!live) return;
      const run = live.task.status.runs.find(
        (candidate) => candidate.id === deferred.runId || candidate.sessionId === sessionId
      );
      if (run) {
        this.recordRun(deferred.taskId, {
          ...run,
          result: 'error',
          message: 'background subagent timed out'
        });
      }
      this.deps?.ptys.closeExpected(sessionId);
    }, SCHEDULED_SUBAGENT_WAIT_TIMEOUT_MS);
    timeout.unref?.();
    this.deferredCloses.set(sessionId, { taskId, runId, timeout });
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
