import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal, GoalIteration } from '@zana-ai/zcc-domain/product';

const h = vi.hoisted(() => ({ resumeIteration: vi.fn(), pushToast: vi.fn(), enterProjectFocus: vi.fn() }));
vi.mock('../../../lib/product-client.js', () => ({ product: { goals: { resumeIteration: h.resumeIteration } } }));
vi.mock('../../../store.js', () => ({ useUi: { getState: () => ({ pushToast: h.pushToast, enterProjectFocus: h.enterProjectFocus }) } }));

import { canResumeIteration, resumeGoalIteration } from '../resumeGoalIteration.js';

const conversation = { profile: 'claude', id: 'conv-1', cwd: '/p', startedAt: '2026-01-01T00:00:00.000Z' } as const;
const it_ = (over: Partial<GoalIteration> = {}): GoalIteration => ({ id: 'i1', at: '2026-01-01T00:00:00.000Z', sessionId: 's1', launchState: 'running', verdict: 'pass', finishedAt: '2026-01-01T00:10:00.000Z', conversation, ...over });
const goal = (over: Partial<Goal> = {}, iterations: GoalIteration[] = [it_()]): Goal => ({
  id: 'g1', projectId: 'p1', title: 'Green suite', statement: 's', successCriteria: [], driver: 'native',
  assignment: { kind: 'profile', profile: 'claude' }, cadence: { mode: 'continuous' }, maxIterations: 5, iteration: 1, noProgressLimit: 2,
  status: 'paused', history: { retain: 20, iterations }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over
}) as Goal;
const opened = { ok: true, value: { session: { id: 'new-pty', projectId: 'p1' }, reused: false } };
const navigate = vi.fn();

beforeEach(() => { h.resumeIteration.mockReset(); h.pushToast.mockReset(); h.enterProjectFocus.mockReset(); navigate.mockReset(); });
afterEach(() => vi.restoreAllMocks());

describe('REQ-10 resumeGoalIteration (renderer)', () => {
  it('reopens the latest run, focuses the project, opens the tab and says so', async () => {
    h.resumeIteration.mockResolvedValue(opened);
    await resumeGoalIteration(goal(), undefined, navigate);
    expect(h.resumeIteration).toHaveBeenCalledWith({ goalId: 'g1' });
    expect(h.enterProjectFocus).toHaveBeenCalledWith('p1');
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining('new-pty'));
    expect(h.pushToast).toHaveBeenCalledWith('Reopened the latest "Green suite" run', 'info');
  });
  it('sends the iteration id when a specific one is chosen', async () => {
    h.resumeIteration.mockResolvedValue(opened);
    await resumeGoalIteration(goal(), 'i1', navigate);
    expect(h.resumeIteration).toHaveBeenCalledWith({ goalId: 'g1', iterationId: 'i1' });
  });
  it('says it switched when the conversation was already open (REQ-8)', async () => {
    h.resumeIteration.mockResolvedValue({ ok: true, value: { session: { id: 'open-pty', projectId: 'p1' }, reused: true } });
    await resumeGoalIteration(goal(), undefined, navigate);
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining('open-pty'));
    expect(h.pushToast).toHaveBeenCalledWith('Switched to "Green suite"', 'info');
  });
  it("toasts main's message on failure and opens nothing", async () => {
    h.resumeIteration.mockResolvedValue({ ok: false, code: 'CONVERSATION_MOVED', message: 'moved' });
    await resumeGoalIteration(goal(), undefined, navigate);
    expect(h.pushToast).toHaveBeenCalledWith('moved', 'error');
    expect(navigate).not.toHaveBeenCalled();
    expect(h.enterProjectFocus).not.toHaveBeenCalled();
  });
  it('ignores a second click on the same goal while one is in flight, then allows another', async () => {
    let release!: (value: unknown) => void;
    h.resumeIteration.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const first = resumeGoalIteration(goal(), undefined, navigate);
    await resumeGoalIteration(goal(), undefined, navigate);
    expect(h.resumeIteration).toHaveBeenCalledTimes(1);
    release(opened);
    await first;
    h.resumeIteration.mockResolvedValue(opened);
    await resumeGoalIteration(goal(), undefined, navigate);
    expect(h.resumeIteration).toHaveBeenCalledTimes(2);
  });
  it('toasts a rejected call in plain words, opens nothing and releases the guard', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.resumeIteration.mockRejectedValueOnce(new Error("Error invoking remote method 'goals:resumeIteration'"));
    await resumeGoalIteration(goal(), undefined, navigate);
    expect(h.pushToast).toHaveBeenCalledWith("Couldn't reopen this run. Try again.", 'error');
    expect(navigate).not.toHaveBeenCalled();
    h.resumeIteration.mockResolvedValue(opened);
    await resumeGoalIteration(goal(), undefined, navigate);
    expect(h.resumeIteration).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe('REQ-10 canResumeIteration', () => {
  it('offers a finished iteration that recorded a conversation', () => {
    expect(canResumeIteration(goal(), it_())).toBe(true);
  });
  it.each([
    ['a Squad goal', goal({ assignment: { kind: 'team', teamId: 't1' } as never }), it_()],
    ['an old iteration without a conversation (REQ-12)', goal(), it_({ conversation: undefined })],
    ['a Squad iteration', goal(), it_({ executionId: 'e1' })],
    ['a pending launch', goal(), it_({ launchState: 'pending' })],
    ['a failed launch', goal(), it_({ launchState: 'failed' })],
    ['an option-like id', goal(), it_({ conversation: { ...conversation, id: '--x' } })]
  ])('does not offer %s', (_name, g, iteration) => {
    expect(canResumeIteration(g, iteration)).toBe(false);
  });
});
