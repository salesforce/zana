import { describe, expect, it } from 'vitest';
import type { ExecutionRecord } from '@zana-ai/zcc-server/services/execution/store';
import { buildSquadBlockerReport, buildSquadReport, formatSquadDuration } from './report.js';

const CLOSING = 'Tell the user. Do not change the Squad\'s work or answer its questions; answers go through the Inbox.';

function record(over: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    id: 'e1', jobTitle: 'Ship it', state: 'COMPLETED', createdAt: 0, updatedAt: 42 * 60_000, finalSummary: 'All good.',
    request: { version: 1, slots: [] },
    workUnits: [
      { id: 'a', state: 'COMPLETED' }, { id: 'b', state: 'COMPLETED' }, { id: 'c', state: 'FAILED' }, { id: 'd', state: 'SKIPPED' }
    ],
    ...over
  } as unknown as ExecutionRecord;
}

describe('formatSquadDuration', () => {
  it.each([[0, 'under a minute'], [59_999, 'under a minute'], [-5, 'under a minute'], [42 * 60_000, '42 min'], [72 * 60_000, '1 h 12 min'], [120 * 60_000, '2 h 0 min']])('%i ms', (ms, text) => {
    expect(formatSquadDuration(ms)).toBe(text);
  });
});

describe('buildSquadReport', () => {
  it.each([['COMPLETED', 'completed'], ['FAILED', 'failed'], ['STOPPED', 'stopped'], ['RUNNING', 'ended']])('names the %s outcome', (state, word) => {
    expect(buildSquadReport(record({ state: state as never }), {})).toContain(`"Ship it" ${word} after 42 min.`);
  });

  it('describes a run in the project folder with unit counts and the summary', () => {
    expect(buildSquadReport(record(), {})).toBe(
      `[Squad report] "Ship it" completed after 42 min. Worked in the project folder. Units: 2 done, 1 failed, 1 skipped. Summary: All good. ${CLOSING}`);
  });

  it('says none when there is no summary or units', () => {
    const text = buildSquadReport(record({ finalSummary: undefined, workUnits: undefined }), {});
    expect(text).toContain('Units: 0 done, 0 failed, 0 skipped. Summary: none.');
  });

  const worktree = { path: '/tmp/wt', branch: 'squad/x', baseBranch: 'main' };
  it('names what the worktree handler actually did', () => {
    const merge = record({ squadWorktree: worktree, request: { version: 1, slots: [], onComplete: 'merge' } as never });
    expect(buildSquadReport(merge, { worktree: 'merged' })).toContain('Branch squad/x merged into main.');
    expect(buildSquadReport(merge, { worktree: 'kept' })).toContain('Branch squad/x, worktree kept at /tmp/wt.');
    expect(buildSquadReport(merge, { worktree: 'missing' })).toContain('Branch squad/x; its worktree was already removed.');
    // A run with a worktree but no outcome is described as kept (never guessed as merged).
    expect(buildSquadReport(merge)).toContain('worktree kept at /tmp/wt');
  });

  it('falls back when the base branch is unknown and reports a run without a worktree', () => {
    const merge = record({ squadWorktree: { path: '/p', branch: 'b' }, request: { version: 1, slots: [], onComplete: 'merge' } as never });
    expect(buildSquadReport(merge, { worktree: 'merged' })).toContain('merged into the base branch');
    expect(buildSquadReport(record(), { worktree: 'merged' })).toContain('Worked in the project folder.');
  });

  it('strips control characters so Squad text cannot type keystrokes into the session', () => {
    const hostile = '\u001b[201~x\u001b[Z\u0003y\u009bz\u007f';
    const text = buildSquadReport(record({
      jobTitle: `T${hostile}`, finalSummary: `S${hostile}`,
      squadWorktree: { path: `/w${hostile}`, branch: `b${hostile}`, baseBranch: `m${hostile}` }
    }), { worktree: 'kept' });
    expect(text).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    const blocker = buildSquadBlockerReport(record({ jobTitle: `T${hostile}` }), { id: 'b', question: `Q${hostile}` } as never);
    expect(blocker).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(blocker).toContain('"Q [201~x [Z y z"');
  });

  it('caps huge branch, base and path text and never cuts the closing sentence', () => {
    const huge = { path: `/${'p'.repeat(2047)}`, branch: 'b'.repeat(2048), baseBranch: 'm'.repeat(2048) };
    for (const worktree of ['kept', 'merged'] as const) {
      const text = buildSquadReport(record({
        jobTitle: 't'.repeat(2048), finalSummary: 's'.repeat(2048), squadWorktree: huge,
        request: { version: 1, slots: [], onComplete: 'merge' } as never
      }), { worktree });
      expect(text.length).toBeLessThanOrEqual(2048);
      expect(text.endsWith(CLOSING)).toBe(true);
      expect(text).not.toContain('b'.repeat(201));
    }
  });

  it('never contains a newline and collapses whitespace', () => {
    const text = buildSquadReport(record({ jobTitle: 'a\r\nb\nc', finalSummary: 'x\n\ny\r\tz' }), {});
    expect(text).not.toMatch(/[\r\n]/);
    expect(text).toContain('"a b c"');
    expect(text).toContain('Summary: x y z.');
  });

  it('trims the summary to 600 chars', () => {
    const text = buildSquadReport(record({ finalSummary: 's'.repeat(5000) }), {});
    expect(text).toContain(`${'s'.repeat(599)}…`);
    expect(text).not.toContain('s'.repeat(601));
  });

  it('cuts the title, keeping the closing sentence, when the worktree text is huge', () => {
    const text = buildSquadReport(record({ jobTitle: 't'.repeat(3000), finalSummary: 's'.repeat(600), squadWorktree: { path: 'p'.repeat(1200), branch: 'b' } }), {});
    expect(text.length).toBeLessThanOrEqual(2048);
    expect(text.endsWith(CLOSING)).toBe(true);
    expect(text).not.toMatch(/[\r\n]/);
  });

  it('cuts the summary before the title', () => {
    const text = buildSquadReport(record({ jobTitle: 'T'.repeat(300), finalSummary: 's'.repeat(600), squadWorktree: { path: 'p'.repeat(1300), branch: 'b' } }), {});
    expect(text.length).toBeLessThanOrEqual(2048);
    expect(text).toContain('T'.repeat(300));
    expect(text.endsWith(CLOSING)).toBe(true);
  });
});

describe('buildSquadBlockerReport', () => {
  it('quotes the question trimmed to 300 chars on one line', () => {
    const text = buildSquadBlockerReport(record(), { id: 'b', question: `q\n${'x'.repeat(500)}` } as never);
    expect(text).toMatch(/^\[Squad report\] "Ship it" is waiting for an answer in the Inbox: "q x+….*"\. Tell the user; do not answer it yourself\.$/);
    expect(text).not.toMatch(/[\r\n]/);
    expect(text).not.toContain('x'.repeat(300));
  });

  it('shrinks an oversized title', () => {
    const text = buildSquadBlockerReport(record({ jobTitle: 't'.repeat(5000) }), { id: 'b', question: 'Which?' } as never);
    expect(text.length).toBeLessThanOrEqual(2048);
    expect(text.endsWith('Tell the user; do not answer it yourself.')).toBe(true);
  });
});
