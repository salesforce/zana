import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledTask, ScheduleRun } from '@zana-ai/zcc-domain/product';

const h = vi.hoisted(() => ({ resumeRun: vi.fn(), pushToast: vi.fn(), enterProjectFocus: vi.fn() }));
vi.mock('../../lib/product-client.js', () => ({ product: { scheduler: { resumeRun: h.resumeRun } } }));
vi.mock('../../store.js', () => ({ useUi: { getState: () => ({ pushToast: h.pushToast, enterProjectFocus: h.enterProjectFocus }) } }));

import { canResumeRun, resumeScheduledRun } from './resumeScheduledRun.js';

const conversation = { profile: 'claude', id: 'conv-1', cwd: '/p', startedAt: '2026-01-01T00:00:00Z' } as const;
const run = (over: Partial<ScheduleRun> = {}): ScheduleRun => ({ id: 'r1', at: new Date(Date.now() - 2 * 3_600_000).toISOString(), result: 'success', conversation, ...over });
const task = (runs: ScheduleRun[] = [run()], over: Partial<ScheduledTask> = {}) =>
  ({ id: 's1', name: 'Nightly', projectId: 'p1', status: { runCount: 1, runs }, ...over }) as unknown as ScheduledTask;
const opened = { ok: true, value: { session: { id: 'new-pty', projectId: 'p1' }, reused: false } };
const navigate = vi.fn();

beforeEach(() => { h.resumeRun.mockReset(); h.pushToast.mockReset(); h.enterProjectFocus.mockReset(); navigate.mockReset(); });
afterEach(() => vi.restoreAllMocks());

describe('resumeScheduledRun', () => {
  it('reopens the latest run: focuses the project, opens the tab and says so', async () => {
    h.resumeRun.mockResolvedValue(opened);
    await resumeScheduledRun(task(), undefined, navigate);
    expect(h.resumeRun).toHaveBeenCalledWith({ scheduleId: 's1' });
    expect(h.enterProjectFocus).toHaveBeenCalledWith('p1');
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining('new-pty'));
    expect(h.pushToast).toHaveBeenCalledWith('Reopened the latest "Nightly" run', 'info');
  });

  it('names the run\'s age when a specific run is reopened', async () => {
    h.resumeRun.mockResolvedValue(opened);
    await resumeScheduledRun(task(), 'r1', navigate);
    expect(h.resumeRun).toHaveBeenCalledWith({ scheduleId: 's1', runId: 'r1' });
    expect(h.pushToast).toHaveBeenCalledWith('Reopened the "Nightly" run from 2h ago', 'info');
  });

  it('falls back to the latest wording when the named run is no longer in the list', async () => {
    h.resumeRun.mockResolvedValue(opened);
    await resumeScheduledRun(task([]), 'gone', navigate);
    expect(h.pushToast).toHaveBeenCalledWith('Reopened the latest "Nightly" run', 'info');
  });

  it('says it switched when the conversation was already open', async () => {
    h.resumeRun.mockResolvedValue({ ok: true, value: { session: { id: 'open-pty', projectId: 'p1' }, reused: true } });
    await resumeScheduledRun(task(), undefined, navigate);
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining('open-pty'));
    expect(h.pushToast).toHaveBeenCalledWith('Switched to "Nightly"', 'info');
  });

  it('toasts main\'s message on failure and opens nothing', async () => {
    h.resumeRun.mockResolvedValue({ ok: false, code: 'CONVERSATION_MISSING', message: "Couldn't reopen this run: its conversation is no longer on this machine" });
    await resumeScheduledRun(task(), undefined, navigate);
    expect(h.pushToast).toHaveBeenCalledWith("Couldn't reopen this run: its conversation is no longer on this machine", 'error');
    expect(navigate).not.toHaveBeenCalled();
    expect(h.enterProjectFocus).not.toHaveBeenCalled();
  });

  it('ignores a second click on the same schedule while one is in flight, then allows another', async () => {
    let release!: (value: unknown) => void;
    h.resumeRun.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const first = resumeScheduledRun(task(), undefined, navigate);
    await resumeScheduledRun(task(), undefined, navigate);
    expect(h.resumeRun).toHaveBeenCalledTimes(1);
    release(opened);
    await first;
    h.resumeRun.mockResolvedValue(opened);
    await resumeScheduledRun(task(), undefined, navigate);
    expect(h.resumeRun).toHaveBeenCalledTimes(2);
  });

  it('toasts a rejected call in plain words, opens nothing and releases the guard', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ipcError = new Error("Error invoking remote method 'scheduler:resumeRun': Error: No handler registered");
    h.resumeRun.mockRejectedValueOnce(ipcError);
    await resumeScheduledRun(task(), undefined, navigate);
    expect(h.pushToast).toHaveBeenCalledWith("Couldn't reopen this run. Try again.", 'error');
    expect(h.pushToast).not.toHaveBeenCalledWith(expect.stringContaining('remote method'), 'error');
    expect(warn).toHaveBeenCalledWith('[scheduler] resumeRun failed', ipcError);
    expect(navigate).not.toHaveBeenCalled();
    h.resumeRun.mockRejectedValueOnce('odd');
    await resumeScheduledRun(task(), undefined, navigate);
    expect(h.pushToast).toHaveBeenLastCalledWith("Couldn't reopen this run. Try again.", 'error');
    warn.mockRestore();
    h.pushToast.mockClear();
    h.resumeRun.mockResolvedValue(opened);
    await resumeScheduledRun(task(), undefined, navigate);
    expect(h.resumeRun).toHaveBeenCalledTimes(3);
  });
});

describe('canResumeRun', () => {
  it('needs a recorded conversation on a started agent run of a plain schedule', () => {
    expect(canResumeRun(task(), run())).toBe(true);
    expect(canResumeRun(task(), run({ conversation: undefined }))).toBe(false);
    expect(canResumeRun(task([], { kind: 'team' }), run())).toBe(false);
    expect(canResumeRun(task([], { external: { kind: 'claude-loop' } } as never), run())).toBe(false);
    expect(canResumeRun(task(), run({ marker: true }))).toBe(false);
    expect(canResumeRun(task(), run({ result: 'skipped' }))).toBe(false);
    expect(canResumeRun(task(), run({ launchState: 'pending' }))).toBe(false);
    expect(canResumeRun(task(), run({ launchState: 'failed' }))).toBe(false);
    expect(canResumeRun(task(), run({ executionId: 'e1' }))).toBe(false);
  });
});
