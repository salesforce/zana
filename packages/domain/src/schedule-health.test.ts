import { describe, expect, it } from 'vitest';
import type { ScheduleRun, ScheduledTask } from './product.js';
import {
  OPEN_PROBLEM_MAX_AGE_MS,
  SCHEDULE_REASONS,
  canManualRetry,
  collectRunRows,
  isOpenProblem,
  isProblemRun,
  isRecoveryMode,
  reasonHint,
  reasonLabel,
  runOutcome,
  runReason,
  newestSuccessMs,
  taskOpenProblems,
  countOpenProblems,
  runManualRetry,
  openRetryRefs,
  isValidConversationId,
  latestResumableRun,
  resumableRun
} from './schedule-health.js';

const NOW = Date.parse('2026-10-14T12:00:00Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const H = 3_600_000;

const run = (over: Partial<ScheduleRun>): ScheduleRun => ({ at: iso(H), result: 'error', ...over });

function task(id: string, runs: ScheduleRun[], over: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id, name: `Task ${id}`, enabled: true, projectId: 'p1', profile: 'claude',
    schedule: { every: '1h' }, overlap: 'skip', history: { retain: 10 },
    status: { runCount: runs.length, runs }, createdAt: iso(99 * H), updatedAt: iso(99 * H),
    ...over
  } as ScheduledTask;
}

describe('reason catalogue', () => {
  const codes = Object.keys(SCHEDULE_REASONS) as (keyof typeof SCHEDULE_REASONS)[];
  it('has all 16 codes with label and hint', () => {
    expect(codes).toHaveLength(16);
    for (const c of codes) {
      expect(reasonLabel(c)).toBe(SCHEDULE_REASONS[c].label);
      expect(reasonHint(c)).toBe(SCHEDULE_REASONS[c].hint);
      expect(reasonLabel(c)).not.toBe('');
    }
  });
  it('matches the design table flags', () => {
    const nonProblem = codes.filter((c) => !SCHEDULE_REASONS[c].problem);
    expect(nonProblem.sort()).toEqual(['in-flight', 'overlap', 'squad-stopped']);
    // Squad runs are expensive: never retried automatically, only by hand.
    expect(codes.filter((c) => !SCHEDULE_REASONS[c].autoRetry).sort())
      .toEqual(['in-flight', 'missed-app-closed', 'missed-asleep', 'outcome-unknown', 'overlap', 'project-missing', 'squad-failed', 'squad-stopped']);
    expect(codes.filter((c) => !SCHEDULE_REASONS[c].manualRetry).sort())
      .toEqual(['in-flight', 'overlap', 'project-missing', 'squad-stopped']);
  });
  it('degrades for unknown codes', () => {
    expect(reasonLabel(undefined)).toBe('');
    expect(reasonHint('bogus' as never)).toBe('');
  });
  it('exposes the retention constant', () => {
    expect(OPEN_PROBLEM_MAX_AGE_MS).toBe(7 * 24 * H);
  });
});

describe('runReason', () => {
  it('prefers the stamped code, ignoring unknown codes', () => {
    expect(runReason(run({ reasonCode: 'queue-full', message: 'exit 1' }))).toBe('queue-full');
    expect(runReason(run({ reasonCode: 'nope' as never, message: 'exit 1' }))).toBe('exit-nonzero');
  });
  it.each([
    ['concurrency-cap: 5 scheduled runs already active', 'skipped', 'concurrency-cap'],
    ['previous run still active', 'skipped', 'overlap'],
    ['exit 1', 'error', 'exit-nonzero'],
    ['exit -9', 'error', 'exit-nonzero'],
    ['exceeded maximum duration (30m)', 'error', 'timeout'],
    ['exited without filing a schedule_report', 'incomplete', 'no-report'],
    ['background subagent timed out', 'error', 'subagent-timeout'],
    ['project p9 not found', 'error', 'project-missing'],
    ['Recovery confirmed the worker never started.', 'error', 'worker-not-started'],
    ['Recovery confirmed the worker exited; its outcome was not recorded.', 'error', 'outcome-unknown']
  ] as const)('infers %s', (message, result, code) => {
    expect(runReason(run({ message, result }))).toBe(code);
  });
  it('launch-failed only with launchState failed', () => {
    expect(runReason(run({ message: 'spawn ENOENT', launchState: 'failed' }))).toBe('launch-failed');
    expect(runReason(run({ message: 'spawn ENOENT' }))).toBeUndefined();
  });
  it('incomplete with no message is no-report; with unknown message is undefined', () => {
    expect(runReason(run({ result: 'incomplete' }))).toBe('no-report');
    expect(runReason(run({ result: 'incomplete', message: 'odd' }))).toBeUndefined();
  });
  it('never throws on garbage', () => {
    expect(runReason(null as never)).toBeUndefined();
    expect(runReason({ at: 'x', result: 'error', message: 5 } as never)).toBeUndefined();
  });
});

describe('runOutcome / isProblemRun', () => {
  it('missed markers are outcome missed', () => {
    expect(runOutcome(run({ result: 'skipped', reasonCode: 'missed-asleep', marker: true }))).toBe('missed');
    expect(runOutcome(run({ result: 'skipped', reasonCode: 'missed-app-closed' }))).toBe('missed');
  });
  it('passes the stored result through', () => {
    for (const r of ['success', 'error', 'skipped', 'incomplete'] as const) {
      expect(runOutcome(run({ result: r, message: undefined }))).toBe(r === 'incomplete' ? 'incomplete' : r);
    }
    expect(runOutcome(null as never)).toBe('skipped');
  });
  it('problem rules', () => {
    expect(isProblemRun(run({ launchState: 'pending' }))).toBe(false);
    expect(isProblemRun(run({ result: 'success', launchState: 'running' }))).toBe(false);
    expect(isProblemRun(run({ result: 'success', launchState: 'running', durationMs: 5 }))).toBe(false);
    expect(isProblemRun(run({ result: 'success' }))).toBe(false);
    expect(isProblemRun(run({ result: 'error' }))).toBe(true);
    expect(isProblemRun(run({ result: 'incomplete', message: 'odd' }))).toBe(true);
    expect(isProblemRun(run({ result: 'skipped', message: 'concurrency-cap: full' }))).toBe(true);
    expect(isProblemRun(run({ result: 'skipped', reasonCode: 'missed-asleep' }))).toBe(true);
    expect(isProblemRun(run({ result: 'skipped', message: 'previous run still active' }))).toBe(false);
    expect(isProblemRun(run({ result: 'skipped', reasonCode: 'in-flight' }))).toBe(false);
    expect(isProblemRun(run({ result: 'skipped' }))).toBe(false);
    expect(isProblemRun(null as never)).toBe(false);
  });
});

describe('isOpenProblem', () => {
  it('closes on resolvedBy, dismissedAt and age', () => {
    expect(isOpenProblem(run({}), NOW)).toBe(true);
    expect(isOpenProblem(run({ resolvedBy: 'r2' }), NOW)).toBe(false);
    expect(isOpenProblem(run({ dismissedAt: iso(0) }), NOW)).toBe(false);
    expect(isOpenProblem(run({ at: iso(OPEN_PROBLEM_MAX_AGE_MS) }), NOW)).toBe(true);
    expect(isOpenProblem(run({ at: iso(OPEN_PROBLEM_MAX_AGE_MS + 1) }), NOW)).toBe(false);
    expect(isOpenProblem(run({ result: 'success' }), NOW)).toBe(false);
    expect(isOpenProblem(run({ at: 'garbage' }), NOW)).toBe(false);
    expect(isOpenProblem(null as never, NOW)).toBe(false);
  });
});

describe('isRecoveryMode', () => {
  it('is driven by catchUp presence', () => {
    expect(isRecoveryMode(task('a', []))).toBe(false);
    expect(isRecoveryMode(task('a', [], { catchUp: { mode: 'skip' } }))).toBe(true);
  });
});

// A realistic 2.3-era history: no reasonCode anywhere, newest first.
const legacyRuns: ScheduleRun[] = [
  run({ at: iso(1 * H), result: 'skipped', message: 'concurrency-cap: 5/5 scheduled runs active' }),
  run({ at: iso(2 * H), result: 'success', sessionId: 's5', durationMs: 1000 }),
  run({ at: iso(3 * H), result: 'incomplete', sessionId: 's4', message: 'exited without filing a schedule_report — possible silent failure' }),
  run({ at: iso(4 * H), result: 'error', sessionId: 's3', message: 'exit 1' }),
  run({ at: iso(5 * H), result: 'skipped', message: 'previous run still active' }),
  run({ at: iso(6 * H), result: 'error', sessionId: 's2', message: 'exceeded maximum duration of 30 minutes' }),
  run({ at: iso(7 * H), result: 'success', launchState: 'running', sessionId: 's1' })
];

describe('legacy history', () => {
  it('infers reasons for 2.3 records', () => {
    expect(legacyRuns.map(runReason)).toEqual([
      'concurrency-cap', undefined, 'no-report', 'exit-nonzero', 'overlap', 'timeout', undefined
    ]);
  });
  it('a later finished success closes older problems at read time, with no resolvedBy written', () => {
    // The finished success at 2 h closes the no-report, exit and timeout runs
    // before it; the optimistic in-flight record at 7 h is not a finished success.
    const res = collectRunRows([task('a', legacyRuns)], undefined, NOW);
    expect(res.rows.map((r) => r.reason)).toEqual(['concurrency-cap']);
    expect(res.total).toBe(1);
    expect(res.truncated).toBe(false);
    expect(legacyRuns.some((r) => r.resolvedBy)).toBe(false);
  });
  it('still lists every problem as history under state "problems"', () => {
    const res = collectRunRows([task('a', legacyRuns)], { state: 'problems' }, NOW);
    expect(res.rows.map((r) => [r.reason, r.open])).toEqual([
      ['concurrency-cap', true], ['no-report', false], ['exit-nonzero', false], ['timeout', false]
    ]);
  });
  it('newestSuccessMs ignores the optimistic in-flight record', () => {
    expect(newestSuccessMs(legacyRuns)).toBe(Date.parse(iso(2 * H)));
    expect(newestSuccessMs([run({ result: 'success', launchState: 'running' })])).toBe(-Infinity);
    expect(newestSuccessMs([run({ result: 'success', launchState: 'running', finishedAt: iso(0) })])).toBe(Date.parse(iso(1 * H)));
    expect(newestSuccessMs(undefined)).toBe(-Infinity);
  });
  it('taskOpenProblems and countOpenProblems apply the same closure', () => {
    const tasks = [task('a', legacyRuns), task('b', [run({ at: iso(1 * H), message: 'exit 2' }), run({ at: iso(2 * H), result: 'skipped', reasonCode: 'missed-asleep', marker: true })])];
    expect(taskOpenProblems(tasks[0], NOW).map(runReason)).toEqual(['concurrency-cap']);
    expect(taskOpenProblems({ ...tasks[0], external: { kind: 'claude-loop', cron: '* * * * *' } }, NOW)).toEqual([]);
    expect(countOpenProblems(tasks, NOW)).toEqual({ runs: 3, schedules: 2, byOutcome: { success: 0, error: 1, skipped: 1, incomplete: 0, missed: 1 } });
    expect(countOpenProblems([], NOW).runs).toBe(0);
  });
  it('closes a problem by when it ENDED: a long run that failed after a success stays open', () => {
    // A: started 6 h ago, failed 1 h ago (ran 5 h). B: a Run now 3 h ago that finished.
    const longFailure = run({ id: 'A', at: iso(6 * H), durationMs: 5 * H, message: 'exit 1' });
    const success = run({ id: 'B', at: iso(3 * H), result: 'success', durationMs: 60_000 });
    const quickFailure = run({ id: 'C', at: iso(5 * H), durationMs: 60_000, message: 'exit 2' });
    const open = taskOpenProblems(task('t', [success, longFailure, quickFailure]), NOW).map((r) => r.id);
    expect(open).toEqual(['A']);
    // finishedAt wins over duration when both are present.
    const finished = run({ id: 'D', at: iso(6 * H), finishedAt: iso(4 * H), durationMs: 5 * H });
    expect(taskOpenProblems(task('t', [success, finished]), NOW)).toEqual([]);
  });
  it('runManualRetry is the one rule every surface uses', () => {
    const t = task('t', []);
    expect(runManualRetry(t, run({ id: 'r', message: 'exit 1' }))).toBe(true);
    expect(runManualRetry(t, run({ message: 'exit 1' }))).toBe(false);
    expect(runManualRetry(t, run({ id: 'r', reasonCode: 'project-missing' }))).toBe(false);
    expect(runManualRetry(t, run({ id: 'r', result: 'success' }))).toBe(false);
    const marker = run({ id: 'm', result: 'skipped', reasonCode: 'missed-asleep', marker: true });
    expect(runManualRetry(t, marker)).toBe(true);
    // Catching up a paused schedule is refused by the server, so no surface offers it.
    expect(runManualRetry({ ...t, enabled: false }, marker)).toBe(false);
    expect(runManualRetry({ ...t, external: { kind: 'claude-loop', cron: '* * * * *' } }, run({ id: 'r', message: 'exit 1' }))).toBe(false);
    const paused = collectRunRows([task('p', [marker], { enabled: false })], { state: 'open' }, NOW).rows[0];
    expect(paused.manualRetry).toBe(false);
    expect(openRetryRefs([paused])).toEqual([]);
  });
  it('never treats a success as a problem, even one promoted from incomplete that keeps its old reason', () => {
    expect(isProblemRun(run({ result: 'success', reasonCode: 'no-report', message: 'exited without filing a schedule_report — possible silent failure', durationMs: 5 }))).toBe(false);
  });
});

describe('collectRunRows', () => {
  const missed = run({ at: iso(2 * H), result: 'skipped', reasonCode: 'missed-asleep', marker: true, missed: { count: 3, from: iso(5 * H), to: iso(2 * H) } });
  const tasks = [
    task('a', [run({ id: 'a1', at: iso(1 * H) }), missed, run({ at: iso(3 * H), result: 'success' })]),
    task('b', [run({ at: iso(4 * H), message: 'exit 2', dismissedAt: iso(0) }), run({ at: iso(30 * 24 * H), message: 'exit 3' })], { projectId: 'p2' }),
    task('x', [run({ at: iso(H) })], { external: { kind: 'claude-loop', cron: '* * * * *' } as never })
  ];
  it('skips external tasks', () => {
    expect(collectRunRows(tasks, { state: 'all' }, NOW).rows.some((r) => r.scheduleId === 'x')).toBe(false);
  });
  it('state filters', () => {
    expect(collectRunRows(tasks, { state: 'open' }, NOW).total).toBe(2);
    expect(collectRunRows(tasks, { state: 'problems' }, NOW).total).toBe(4);
    expect(collectRunRows(tasks, { state: 'all' }, NOW).total).toBe(5);
  });
  it('row fields and manualRetry', () => {
    const rows = collectRunRows(tasks, { state: 'open' }, NOW).rows;
    expect(rows[0]).toMatchObject({ scheduleId: 'a', scheduleName: 'Task a', projectId: 'p1', problem: true, open: true, manualRetry: true, outcome: 'error' });
    expect(rows[1]).toMatchObject({ outcome: 'missed', reason: 'missed-asleep' });
    expect(canManualRetry(rows[0])).toBe(true);
    const dismissed = collectRunRows(tasks, { state: 'problems', projectId: 'p2' }, NOW).rows[0];
    expect(canManualRetry(dismissed)).toBe(false);
    expect(canManualRetry(undefined as never)).toBe(false);
  });
  it('project-missing is not manually retryable', () => {
    const t = task('m', [run({ message: 'project p9 not found' })]);
    const row = collectRunRows([t], {}, NOW).rows[0];
    expect(row.manualRetry).toBe(false);
    expect(canManualRetry(row)).toBe(false);
  });
  it('outcome, reason, project and schedule filters', () => {
    expect(collectRunRows(tasks, { state: 'all', outcomes: ['missed'] }, NOW).total).toBe(1);
    expect(collectRunRows(tasks, { state: 'all', reasonCodes: ['exit-nonzero'] }, NOW).total).toBe(2);
    expect(collectRunRows(tasks, { state: 'all', projectId: 'p2' }, NOW).total).toBe(2);
    expect(collectRunRows(tasks, { state: 'all', scheduleIds: ['b'] }, NOW).total).toBe(2);
  });
  it('since / until bounds, ignoring unparseable values', () => {
    expect(collectRunRows(tasks, { state: 'all', since: iso(3.5 * H) }, NOW).total).toBe(3);
    expect(collectRunRows(tasks, { state: 'all', until: iso(3.5 * H) }, NOW).total).toBe(2);
    expect(collectRunRows(tasks, { state: 'all', since: 'garbage' }, NOW).total).toBe(5);
  });
  it('limit caps rows and sets truncated; limit is clamped', () => {
    const many = task('m', Array.from({ length: 30 }, (_, i) => run({ at: iso((i + 1) * 60_000) })));
    const r = collectRunRows([many], { limit: 5 }, NOW);
    expect(r.rows).toHaveLength(5);
    expect(r.total).toBe(30);
    expect(r.truncated).toBe(true);
    expect(collectRunRows([many], { limit: 0 }, NOW).rows).toHaveLength(1);
    expect(collectRunRows([many], { limit: 99999 }, NOW).rows).toHaveLength(30);
    expect(collectRunRows([many], { limit: NaN }, NOW).rows).toHaveLength(30);
    const big = task('b', Array.from({ length: 600 }, (_, i) => run({ at: iso((i + 1) * 1000) })));
    expect(collectRunRows([big], { limit: 99999 }, NOW).rows).toHaveLength(500);
  });
  it('limits scheduleIds to 50 and skips runs with bad timestamps', () => {
    const ts = Array.from({ length: 60 }, (_, i) => task(`t${i}`, [run({})]));
    expect(collectRunRows(ts, { scheduleIds: ts.map((t) => t.id) }, NOW).total).toBe(50);
    expect(collectRunRows([task('z', [run({ at: 'nope' })])], { state: 'all' }, NOW).total).toBe(0);
  });
  it('tolerates empty input', () => {
    expect(collectRunRows([], undefined, NOW)).toEqual({ rows: [], total: 0, truncated: false });
    expect(collectRunRows(undefined as never, undefined, NOW).total).toBe(0);
  });
});

describe('resumable runs', () => {
  const conversation = { profile: 'claude' as const, id: 'abc-123', cwd: '/p', startedAt: iso(H) };
  const resumable = (over: Partial<ScheduleRun> = {}) => run({ result: 'success', conversation, ...over });

  it('accepts only conversation ids that are safe for an argv', () => {
    expect(isValidConversationId('0199-abc_DEF')).toBe(true);
    expect(isValidConversationId('--flag')).toBe(false);
    expect(isValidConversationId('')).toBe(false);
    expect(isValidConversationId('a'.repeat(129))).toBe(false);
    expect(isValidConversationId(42)).toBe(false);
  });

  it('needs a recorded conversation and is never a Squad run', () => {
    expect(resumableRun(resumable())).toBe(true);
    expect(resumableRun(run({ result: 'success' }))).toBe(false);
    expect(resumableRun(resumable({ launchKind: 'team' }))).toBe(false);
    expect(resumableRun(resumable({ executionId: 'e1' }))).toBe(false);
    expect(resumableRun(null as unknown as ScheduleRun)).toBe(false);
    expect(resumableRun(resumable({ conversation: 'x' as never }))).toBe(false);
  });

  it('needs a valid recorded id, so a detected-id run that never found its id is not offered', () => {
    expect(resumableRun(resumable({ conversation: { ...conversation, id: undefined } }))).toBe(false);
    expect(resumableRun(resumable({ conversation: { ...conversation, id: '--resume' } }))).toBe(false);
    expect(resumableRun(resumable({ conversation: { ...conversation, profile: 7 as never } }))).toBe(false);
  });

  it('applies the same launch checks to a single run as "latest" does', () => {
    expect(resumableRun(resumable({ marker: true }))).toBe(false);
    expect(resumableRun(resumable({ result: 'skipped' }))).toBe(false);
    expect(resumableRun(resumable({ launchState: 'pending' }))).toBe(false);
    expect(resumableRun(resumable({ launchState: 'failed' }))).toBe(false);
    expect(resumableRun(resumable({ launchState: 'running', result: 'error' }))).toBe(true);
  });

  it('picks the newest resumable run, skipping markers, skipped, pending and failed', () => {
    const newest = resumable({ id: 'newest', at: iso(2 * H) });
    const runs = [
      resumable({ id: 'marker', at: iso(0), marker: true }),
      resumable({ id: 'skipped', at: iso(0.1 * H), result: 'skipped' }),
      resumable({ id: 'pending', at: iso(0.2 * H), launchState: 'pending' }),
      resumable({ id: 'failed', at: iso(0.3 * H), launchState: 'failed' }),
      resumable({ id: 'older', at: iso(5 * H) }),
      newest,
      run({ id: 'noconv', at: iso(0.4 * H), result: 'success' })
    ];
    expect(latestResumableRun(runs)?.id).toBe('newest');
    expect(latestResumableRun([])).toBeUndefined();
    expect(latestResumableRun(undefined)).toBeUndefined();
    expect(latestResumableRun([null as unknown as ScheduleRun])).toBeUndefined();
    expect(latestResumableRun([resumable({ id: 'bad', at: 'nope' }), resumable({ id: 'good' })])?.id).toBe('good');
  });
});
