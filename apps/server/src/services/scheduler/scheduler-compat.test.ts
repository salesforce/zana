/**
 * Frozen copy of the 2.3.x loader. Never edit; it proves files written by newer versions still load in older ones.
 */
import type { ScheduledTask, LaunchProfileId } from '@zana-ai/zcc-domain/product';
// `VALID_PROFILES` and `validateCadence` stay imported: both are unchanged since v2.3.4, and a
// guard test forbids copying the profile list outside launch-provider.ts.
import { VALID_PROFILES } from '@zana-ai/zcc-domain/launch-provider';
import { validateCadence } from '@zana-ai/zcc-domain/schedule-spec';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { SchedulerManager } from './scheduler.js';
import { listAllSchedules, saveSchedule } from './scheduler-store.js';
import type { PtyManager } from '@zana-ai/zcc-host-daemon/pty';
import type { Project } from '@zana-ai/zcc-domain/product';
import { validateScheduleFile } from './schedule-validation.js';
/**
 * Validate a schedule JSON file. Returns the schedule on success, or a string
 * reason on failure (so callers can log the reason rather than silently
 * dropping bad files). Hand-edited files are common — a typoed `every` like
 * `"1 hour"` used to fall through to MIN_INTERVAL_MS and silently fire every
 * 60s; we now reject those at load time.
 */
function validateScheduleFileV23(raw: unknown): ScheduledTask | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'not an object' };
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id.trim()) return { error: 'missing id' };
  if (typeof r.name !== 'string' || !r.name.trim()) return { error: 'missing name' };
  if (typeof r.enabled !== 'boolean') return { error: 'enabled must be boolean' };
  if (typeof r.projectId !== 'string' || !r.projectId.trim()) return { error: 'missing projectId' };
  if (typeof r.profile !== 'string' || !VALID_PROFILES.includes(r.profile as LaunchProfileId)) {
    return { error: `invalid profile: ${String(r.profile)}` };
  }
  const schedule = r.schedule as { every?: unknown; cron?: unknown; tz?: unknown } | undefined;
  if (!schedule || typeof schedule !== 'object') {
    return { error: 'missing schedule' };
  }
  const cadence = {
    every: typeof schedule.every === 'string' ? schedule.every : undefined,
    cron: typeof schedule.cron === 'string' ? schedule.cron : undefined,
    tz: typeof schedule.tz === 'string' ? schedule.tz : undefined
  };
  // Enforces the exactly-one-of {every,cron} invariant AND that the chosen
  // cadence parses. Rejects a hand-edited file rather than silently firing.
  const cadenceError = validateCadence(cadence);
  if (cadenceError) return { error: `schedule: ${cadenceError}` };
  const rawRuns = r.status && typeof r.status === 'object' ? (r.status as { runs?: unknown }).runs : undefined;
  if (rawRuns !== undefined && !Array.isArray(rawRuns)) return { error: 'runs must be an array' };
  const runs: ScheduledTask['status']['runs'] = [];
  for (const value of (rawRuns ?? []) as unknown[]) {
    if (!value || typeof value !== 'object') return { error: 'invalid run' };
    const run = value as ScheduledTask['status']['runs'][number];
    if (typeof run.at !== 'string' || !Number.isFinite(Date.parse(run.at)) ||
        !['success', 'error', 'skipped', 'incomplete'].includes(run.result)) return { error: 'invalid run timestamp or result' };
    if (run.sessionId !== undefined && typeof run.sessionId !== 'string') return { error: 'invalid run session' };
    if (run.launchState !== undefined && !['pending', 'running', 'failed'].includes(run.launchState)) return { error: 'invalid run launch state' };
    if (run.launchState === 'pending' && !run.sessionId) return { error: 'pending run requires a reserved session' };
    if (runs.length < 100) runs.push(run);
    else if (run.launchState === 'pending') return { error: 'pending run exceeds retained history' };
  }
  // Defensive defaults — older hand-edited files may be missing pieces.
  const task: ScheduledTask = {
    id: r.id,
    name: r.name,
    description: typeof r.description === 'string' ? r.description : undefined,
    enabled: r.enabled,
    projectId: r.projectId,
    profile: r.profile as LaunchProfileId,
    extraArgs: Array.isArray(r.extraArgs)
      ? (r.extraArgs as unknown[]).filter((s): s is string => typeof s === 'string')
      : undefined,
    prompt: typeof r.prompt === 'string' ? r.prompt : undefined,
    // Inbox loudness. Prefer the new `inboxLevel`; fall back to the legacy
    // boolean `notifyInbox` (true→loud, false→quiet) so older files keep their
    // intent; default `quiet` when neither is present.
    inboxLevel:
      r.inboxLevel === 'silent' || r.inboxLevel === 'quiet' || r.inboxLevel === 'loud'
        ? r.inboxLevel
        : typeof r.notifyInbox === 'boolean'
          ? r.notifyInbox
            ? 'loud'
            : 'quiet'
          : 'quiet',
    // Default ON when omitted (e.g. hand-authored JSON): scheduled sessions are
    // background work and should close when the agent finishes. A schedule that
    // explicitly saved `false` keeps that choice.
    autoCloseOnFinish: typeof r.autoCloseOnFinish === 'boolean' ? r.autoCloseOnFinish : true,
    maxDurationMinutes: typeof r.maxDurationMinutes === 'number' ? r.maxDurationMinutes : undefined,
    group: typeof r.group === 'string' && r.group.trim() ? r.group : undefined,
    schedule: cadence.cron
      ? { cron: cadence.cron, ...(cadence.tz ? { tz: cadence.tz } : {}) }
      : { every: cadence.every! },
    overlap: 'skip',
    history:
      r.history && typeof r.history === 'object' && typeof (r.history as { retain?: unknown }).retain === 'number'
        ? { retain: Number.isFinite((r.history as { retain: number }).retain) ? Math.max(1, Math.min(100, Math.round((r.history as { retain: number }).retain))) : 10 }
        : { retain: 10 },
    status:
      r.status && typeof r.status === 'object'
        ? {
            runCount: typeof (r.status as { runCount?: unknown }).runCount === 'number'
              ? (r.status as { runCount: number }).runCount
              : 0,
            runs,
            lastRunAt: typeof (r.status as { lastRunAt?: unknown }).lastRunAt === 'string'
              ? (r.status as { lastRunAt: string }).lastRunAt
              : undefined,
            lastRunResult:
              (r.status as { lastRunResult?: 'success' | 'error' | 'skipped' | 'incomplete' })
                .lastRunResult,
            lastRunSessionId:
              typeof (r.status as { lastRunSessionId?: unknown }).lastRunSessionId === 'string'
                ? (r.status as { lastRunSessionId: string }).lastRunSessionId
                : undefined,
            nextRunAt: typeof (r.status as { nextRunAt?: unknown }).nextRunAt === 'string'
              ? (r.status as { nextRunAt: string }).nextRunAt
              : undefined
          }
        : { runCount: 0, runs: [] },
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date().toISOString()
  };
  return task;
}

// ---------------------------------------------------------------------------
// Compatibility tests (everything above this line is the frozen loader).
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/cc-test-home' } }));
vi.mock('./scheduler-store.js', () => ({
  readSchedule: vi.fn((task) => structuredClone(task)), saveSchedule: vi.fn(),
  deleteSchedule: vi.fn(() => true),
  listAllSchedules: vi.fn(() => []),
  globalDir: () => '/tmp/cc-test-home/.zcc/schedules',
  projectDir: (project: { path: string }) => `${project.path}/.zcc/schedules`
}));
vi.mock('../claude.js', () => ({ listClaudeSessions: vi.fn(() => []) }));

const T = '2026-10-13T08:00:00.000Z';
const base = {
  id: 'sched-1', name: 'Nightly', enabled: true, projectId: 'proj-1', profile: 'claude',
  schedule: { cron: '0 8 * * *', tz: 'Europe/Paris' }, overlap: 'skip', history: { retain: 10 },
  createdAt: T, updatedAt: T
};

/** Files as the Recovery-era version writes them. */
const recoveryFiles: Record<string, Record<string, unknown>> = {
  'recovery schedule with catchUp and retry': {
    ...base,
    catchUp: { mode: 'all', max: 3 },
    retry: { attempts: 2, delayMinutes: 15 },
    status: { runCount: 0, runs: [] }
  },
  'runs with reason codes, attempt/retryOf/resolvedBy/dismissedAt': {
    ...base,
    catchUp: { mode: 'once' },
    status: {
      runCount: 3, lastRunAt: T, lastRunResult: 'success',
      runs: [
        { id: 'r3', at: T, result: 'success', trigger: 'retry', attempt: 2, retryOf: 'r1', slotAt: T, lateByMs: 7_200_000, lateCause: 'asleep', durationMs: 5000 },
        { id: 'r2', at: T, result: 'skipped', reasonCode: 'concurrency-cap', message: 'concurrency-cap: 5 runs active', dismissedAt: T },
        { id: 'r1', at: T, result: 'error', reasonCode: 'exit-nonzero', message: 'exit 1', attempt: 1, resolvedBy: 'r3' }
      ]
    }
  },
  'marker missed record': {
    ...base,
    catchUp: { mode: 'skip' },
    status: {
      runCount: 0,
      runs: [{ at: T, result: 'skipped', marker: true, reasonCode: 'missed-app-closed', trigger: 'schedule', missed: { count: 3, from: '2026-10-12T08:00:00.000Z', to: T } }]
    }
  },
  'status slotCursorAt, missedFloorAt and pendingRetry': {
    ...base,
    catchUp: { mode: 'once' },
    retry: { attempts: 3, delayMinutes: 5 },
    status: {
      runCount: 1, runs: [],
      slotCursorAt: T, missedFloorAt: T,
      pendingRetry: { rootRunId: 'r1', attempt: 2, dueAt: '2026-10-13T08:15:00.000Z' }
    }
  },
  'unknown future keys': {
    ...base, futureField: { x: 1 }, status: { runCount: 0, runs: [], futureStatus: true }
  }
};

/** Wait for the scheduler's queued serial work (exit handlers, drains) to finish. */
const settled = (manager: SchedulerManager) =>
  (manager as unknown as { serial: (work: () => Promise<unknown>) => Promise<unknown> }).serial(async () => undefined);

describe('older loader (2.3.x) vs files written by the Recovery version', () => {
  it.each(Object.entries(recoveryFiles))('(a) the 2.3 loader accepts: %s', (_name, file) => {
    const out = validateScheduleFileV23(JSON.parse(JSON.stringify(file)));
    expect('error' in out).toBe(false);
  });

  it.each(Object.entries(recoveryFiles))('(b) 2.3 output re-read by the new loader is a valid Classic schedule: %s', (_name, file) => {
    const old = validateScheduleFileV23(JSON.parse(JSON.stringify(file)));
    if ('error' in old) throw new Error(old.error);
    // The old version strips unknown fields on save; simulate that round-trip.
    const reread = validateScheduleFile(JSON.parse(JSON.stringify(old)));
    if ('error' in reread) throw new Error(reread.error);
    expect(reread.catchUp).toBeUndefined();
    expect('catchUp' in reread).toBe(false);
    expect('retry' in reread).toBe(false);
    expect(reread.schedule).toEqual(old.schedule);
    expect(reread.status.slotCursorAt).toBeUndefined();
    expect(reread.status.missedFloorAt).toBeUndefined();
    expect(reread.status.pendingRetry).toBeUndefined();
    expect(Number.isFinite(reread.status.runCount)).toBe(true);
    expect(Array.isArray(reread.status.runs)).toBe(true);
  });

  it('run records written by the Recovery version survive an old-loader save whole', () => {
    const old = validateScheduleFileV23(JSON.parse(JSON.stringify(recoveryFiles['marker missed record'])));
    if ('error' in old) throw new Error(old.error);
    expect(old.status.runs[0]).toMatchObject({ marker: true, reasonCode: 'missed-app-closed', missed: { count: 3 } });
  });

  it('(c) a pure 2.3-format file loads in the new loader with no new fields added', () => {
    const legacy = {
      ...base, schedule: { every: '30m' }, inboxLevel: 'quiet', autoCloseOnFinish: true,
      status: {
        runCount: 2, lastRunAt: T, lastRunResult: 'error', nextRunAt: T,
        runs: [
          { id: 'a', at: T, result: 'error', message: 'exit 1', sessionId: 's1', durationMs: 10 },
          { id: 'b', at: T, result: 'skipped', message: 'previous run still active' }
        ]
      }
    };
    const fromOld = validateScheduleFileV23(JSON.parse(JSON.stringify(legacy)));
    const loaded = validateScheduleFile(JSON.parse(JSON.stringify(legacy)));
    if ('error' in fromOld || 'error' in loaded) throw new Error('legacy file rejected');
    // Upstream's Squad schedules (#328) default every loaded schedule to
    // `kind: 'agent'`; that is the only addition, and it isn't ours.
    expect(loaded.kind).toBe('agent');
    const { kind: _kind, ...fromNew } = loaded;
    expect(JSON.parse(JSON.stringify(fromNew))).toEqual(JSON.parse(JSON.stringify(fromOld)));
    // Compare what would be serialised: upstream also adds `teamId` / `planSource` as undefined.
    const written = (value: object) => Object.keys(JSON.parse(JSON.stringify(value))).sort();
    expect(written(fromNew)).toEqual(written(fromOld));
    expect(Object.keys(fromNew.status).sort()).toEqual(Object.keys(fromOld.status).sort());
  });
});

// ---------------------------------------------------------------------------
// A real Recovery fire/exit cycle, read back by the 2.3 loader (design 9.2, C4).
// ---------------------------------------------------------------------------

class FakePtys extends EventEmitter {
  constructor() { super(); this.setMaxListeners(0); }
  sessions: Array<{ id: string; projectId: string; title: string; profile: string; cwd: string; status: 'running' | 'exited'; exitCode?: number; createdAt: number }> = [];
  createCalls = 0;
  list(projectId: string) { return this.sessions.filter(s => s.projectId === projectId); }
  getRememberedSession(id: string) { return this.sessions.find(s => s.id === id) ?? null; }
  reapDeadSessions() { return []; }
  create(opts: Record<string, unknown>) {
    this.createCalls += 1;
    const session = { id: opts.preallocatedSessionId as string, projectId: opts.projectId as string, title: 'x', profile: opts.profile as string, cwd: opts.cwd as string, status: 'running' as 'running' | 'exited', createdAt: Date.now() };
    this.sessions.push(session);
    return session;
  }
  write() { /* no-op */ }
  closeExpected() { return true; }
  simulateExit(id: string, code = 0) {
    const session = this.sessions.find(s => s.id === id);
    if (session) { session.status = 'exited'; session.exitCode = code; }
    this.emit('exit', id, code);
  }
}

type ManagerDeps = Parameters<SchedulerManager['setDeps']>[0];
const project: Project = { id: 'proj-1', name: 'P', path: '/tmp/proj', createdAt: 0, lastActiveAt: 0 };

function makeManager() {
  const ptys = new FakePtys();
  const manager = new SchedulerManager();
  manager.setDeps({
    ptys: ptys as unknown as PtyManager,
    launchTerminal: (opts) => ptys.create(opts as unknown as Record<string, unknown>) as never,
    store: { listProjects: () => [project], getConfig: () => ({}) } as unknown as ManagerDeps['store']
  });
  return { manager, ptys };
}

describe('a Recovery schedule written by a real fire/exit cycle falls back to Classic in older versions', () => {
  const START = '2026-07-15T14:00:00Z';
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(START)); });
  afterEach(() => { vi.useRealTimers(); vi.mocked(saveSchedule).mockReset(); });

  async function runCycle() {
    const snapshots: Array<Record<string, any>> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    vi.mocked(saveSchedule).mockImplementation((task) => { snapshots.push(JSON.parse(JSON.stringify(task))); });
    const { manager, ptys } = makeManager();
    const task = await manager.create({
      name: 'cycle', projectId: 'proj-1', profile: 'claude', every: '1h', enabled: true, prompt: 'work', inboxLevel: 'quiet',
      catchUp: { mode: 'all', max: 4 }, retry: { attempts: 2, delayMinutes: 10 }
    });
    await manager.runNow(task.id);
    ptys.simulateExit(ptys.sessions[0].id, 1);
    await settled(manager);
    const pendingSnapshot = snapshots.at(-1)!;
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1_000);
    await manager.attachReport(ptys.sessions[1].id, 'done');
    ptys.simulateExit(ptys.sessions[1].id, 0);
    await settled(manager);
    const finalSnapshot = snapshots.at(-1)!;
    manager.stopAll();
    return { pendingSnapshot, finalSnapshot, snapshots };
  }

  it('writes the new fields, and the 2.3 loader accepts every file it saved', async () => {
    const { pendingSnapshot, finalSnapshot, snapshots } = await runCycle();
    expect(pendingSnapshot.catchUp).toEqual({ mode: 'all', max: 4 });
    expect(pendingSnapshot.status.pendingRetry).toMatchObject({ attempt: 2 });
    expect(finalSnapshot.status.runs[0]).toMatchObject({ result: 'success', trigger: 'retry', attempt: 2 });
    expect(finalSnapshot.status.runs.some((run: { reasonCode?: string }) => run.reasonCode === 'exit-nonzero')).toBe(true);
    // Every file this version saved during the cycle, not just two of them.
    expect(snapshots.length).toBeGreaterThan(2);
    for (const file of snapshots) {
      expect('error' in validateScheduleFileV23(JSON.parse(JSON.stringify(file)))).toBe(false);
    }
  });

  it.each([
    // [how long after the last run the fresh manager loads, expected nextRunAt offset from load time]
    ['0.5 intervals overdue (Classic case 3): grace floor', 1.5 * 3_600_000, 5_000],
    ['3 intervals overdue (Classic case 5): now + interval', 4 * 3_600_000, 3_600_000]
  ])('after the 2.3 loader and the new loader it arms like Classic: %s', async (_name, sinceLastRun, nextOffset) => {
    const { finalSnapshot } = await runCycle();
    const older = validateScheduleFileV23(JSON.parse(JSON.stringify(finalSnapshot)));
    if ('error' in older) throw new Error(older.error);
    const reloaded = validateScheduleFile(JSON.parse(JSON.stringify(older)));
    if ('error' in reloaded) throw new Error(reloaded.error);
    expect(reloaded.catchUp).toBeUndefined();
    expect(reloaded.retry).toBeUndefined();
    expect(reloaded.status.pendingRetry).toBeUndefined();

    const lastRunMs = Date.parse(reloaded.status.lastRunAt!);
    vi.setSystemTime(new Date(lastRunMs + sinceLastRun));
    const { manager, ptys } = makeManager();
    vi.mocked(listAllSchedules).mockReturnValueOnce([{ ...reloaded, enabled: true }]);
    await manager.loadAll([project]);
    const loadedAt = Date.now();
    const loaded = manager.list()[0];
    expect(loaded.catchUp).toBeUndefined();
    expect(Date.parse(loaded.status.nextRunAt!)).toBe(loadedAt + nextOffset);
    // Classic: no queueing, no retry timer.
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(nextOffset + 1_000);
    expect(ptys.createCalls).toBe(1);
    manager.stopAll();
  });
});
