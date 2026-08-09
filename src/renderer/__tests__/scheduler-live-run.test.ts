import { describe, it, expect } from 'vitest';
import type { ScheduleRun } from '@shared/types';
import { pickLiveRun } from '../components/SchedulerPanel';

/**
 * Regression (QA medium #16): a schedule can have two live sessions at once — a
 * slow run still working AND a quick later run that finished but stayed open at
 * the prompt. The old scan returned the newest alive run regardless of state, so
 * it surfaced the finished run and painted the row "done" while the earlier one
 * was still working (and clicking "Open" landed on the wrong session). pickLiveRun
 * must prefer a still-working run over a finished-open one.
 */
function run(partial: Partial<ScheduleRun>): ScheduleRun {
  return { at: '2026-07-04T10:00:00Z', result: 'success', ...partial };
}

describe('pickLiveRun', () => {
  const aliveAll = () => true;

  it('prefers a still-working run over a newer finished-open one', () => {
    // runs are newest→oldest: B (newer, finished) then A (older, still working).
    const runB = run({ sessionId: 'B', at: '2026-07-04T10:05:00Z', finishedAt: '2026-07-04T10:06:00Z' });
    const runA = run({ sessionId: 'A', at: '2026-07-04T10:00:00Z' }); // no finishedAt → working
    const picked = pickLiveRun([runB, runA], aliveAll);
    expect(picked?.sessionId).toBe('A');
    expect(picked?.finishedAt).toBeUndefined();
  });

  it('falls back to the newest finished-open run when none are working', () => {
    const runB = run({ sessionId: 'B', at: '2026-07-04T10:05:00Z', finishedAt: '2026-07-04T10:06:00Z' });
    const runA = run({ sessionId: 'A', at: '2026-07-04T10:00:00Z', finishedAt: '2026-07-04T10:01:00Z' });
    const picked = pickLiveRun([runB, runA], aliveAll);
    // Newest-first, both finished → the newest (B) drives "done · session open".
    expect(picked?.sessionId).toBe('B');
  });

  it('skips runs whose session is not alive', () => {
    const runB = run({ sessionId: 'B' }); // working but dead
    const runA = run({ sessionId: 'A', finishedAt: '2026-07-04T10:01:00Z' }); // finished, alive
    const picked = pickLiveRun([runB, runA], (id) => id === 'A');
    expect(picked?.sessionId).toBe('A');
  });

  it('ignores runs with no sessionId (a skipped fire)', () => {
    const skipped = run({ result: 'skipped' }); // no sessionId
    const working = run({ sessionId: 'A' });
    const picked = pickLiveRun([skipped, working], aliveAll);
    expect(picked?.sessionId).toBe('A');
  });

  it('returns null when no run has a live session', () => {
    expect(pickLiveRun([run({ sessionId: 'A' })], () => false)).toBeNull();
    expect(pickLiveRun([], aliveAll)).toBeNull();
  });

  it('picks the first working run when several are working (newest wins)', () => {
    const newer = run({ sessionId: 'N', at: '2026-07-04T10:05:00Z' });
    const older = run({ sessionId: 'O', at: '2026-07-04T10:00:00Z' });
    // runs are newest→oldest; both working → newest working.
    expect(pickLiveRun([newer, older], aliveAll)?.sessionId).toBe('N');
  });
});
