import { describe, expect, it, vi } from 'vitest';
import type { Goal, GoalIteration, Project, TerminalSession } from '@zana-ai/zcc-domain/product';
import { registrationFor } from '@zana-ai/zcc-host-daemon/harness/registry';
import { resumeGoalIteration } from '../goal-resume-run.js';

const local: Project = { id: 'p1', name: 'P', path: '/proj', createdAt: 0, lastActiveAt: 0 };
const at = (minutesAgo: number) => new Date(Date.parse('2026-10-27T12:00:00Z') - minutesAgo * 60_000).toISOString();
const conv = (over: Record<string, unknown> = {}) => ({ profile: 'claude', id: 'conv-1', cwd: '/proj', startedAt: at(10), ...over });
const iter = (over: Partial<GoalIteration> = {}): GoalIteration =>
  ({ id: 'i1', at: at(10), sessionId: 'old-pty', launchState: 'running', verdict: 'pass', finishedAt: at(5), conversation: conv() as never, ...over });
const goal = (iterations: GoalIteration[], over: Partial<Goal> = {}): Goal =>
  ({ id: 'g1', projectId: 'p1', title: 'Green suite', assignment: { kind: 'profile', profile: 'claude' }, history: { retain: 20, iterations }, ...over }) as unknown as Goal;
const session = (id: string, over: Record<string, unknown> = {}) => ({ id, projectId: 'p1', profile: 'claude', status: 'running', ...over }) as unknown as TerminalSession;

function setup(g: Goal | undefined, over: Record<string, unknown> & { project?: Project | null; live?: TerminalSession[] } = {}) {
  const created = session('new-pty');
  const deps = {
    getGoal: vi.fn(() => g),
    listProjects: vi.fn(() => (over.project === null ? [] : [over.project ?? local])),
    listLiveSessions: vi.fn(() => over.live ?? []),
    createInteractiveTerminal: vi.fn(async () => ({ ok: true as const, value: created })),
    registrationFor: vi.fn((profile: string) => registrationFor(profile as never) as never),
    realpath: vi.fn((p: string) => `/real${p}`),
    ...over
  } as Record<string, unknown>;
  delete deps.project; delete deps.live;
  return { deps: deps as never, spy: deps as Record<string, ReturnType<typeof vi.fn>>, created };
}
const go = (deps: never, input: { goalId: string; iterationId?: string } = { goalId: 'g1' }) => resumeGoalIteration(input, deps);

describe('REQ-7 resumeGoalIteration opens the conversation', () => {
  it('reopens the latest resumable iteration with --resume, no prompt, no new iteration', async () => {
    const g = goal([iter()]);
    const { deps, spy, created } = setup(g);
    await expect(go(deps)).resolves.toEqual({ ok: true, value: { session: created, reused: false } });
    const req = spy.createInteractiveTerminal!.mock.calls[0]![0] as Record<string, unknown>;
    expect(req).toMatchObject({ projectId: 'p1', cwd: '/real/proj', title: '↺ Goal: Green suite', profile: 'claude', extraArgs: ['--resume', 'conv-1'] });
    for (const key of ['prompt', 'headless', 'scheduled', 'personaId', 'autoCloseOnFinish']) expect(req).not.toHaveProperty(key);
    expect(g.history.iterations).toHaveLength(1);
  });
  it('skips iterations that are not resumable when picking the latest', async () => {
    const g = goal([
      iter({ id: 'squad', executionId: 'e1' }), iter({ id: 'pending', launchState: 'pending' }),
      iter({ id: 'failed', launchState: 'failed' }), iter({ id: 'old', conversation: undefined }),
      iter({ id: 'good', conversation: conv({ id: 'good-conv' }) as never })
    ]);
    const { deps, spy } = setup(g);
    await go(deps);
    expect((spy.createInteractiveTerminal!.mock.calls[0]![0] as { extraArgs: string[] }).extraArgs).toEqual(['--resume', 'good-conv']);
  });
  it('uses an explicit iterationId', async () => {
    const g = goal([iter({ id: 'new', conversation: conv({ id: 'new-conv' }) as never }), iter({ id: 'old', conversation: conv({ id: 'old-conv' }) as never })]);
    const { deps, spy } = setup(g);
    await go(deps, { goalId: 'g1', iterationId: 'old' });
    expect((spy.createInteractiveTerminal!.mock.calls[0]![0] as { extraArgs: string[] }).extraArgs).toEqual(['--resume', 'old-conv']);
  });
  it('reopens a Codex iteration only with the id it recorded', async () => {
    const { deps, spy } = setup(goal([iter({ conversation: conv({ profile: 'codex', id: 'codex-9' }) as never })]));
    await go(deps);
    expect(spy.createInteractiveTerminal!.mock.calls[0]![0]).toMatchObject({ profile: 'codex-resume', resumeSessionId: 'codex-9' });
  });
});

describe('REQ-8 a second Resume switches to the open tab', () => {
  it("reuses the iteration's own live pty", async () => {
    const own = session('old-pty');
    const { deps, spy } = setup(goal([iter()]), { live: [own] });
    await expect(go(deps)).resolves.toEqual({ ok: true, value: { session: own, reused: true } });
    expect(spy.createInteractiveTerminal).not.toHaveBeenCalled();
  });
  it('reuses another live tab holding the same conversation', async () => {
    const other = session('other', { claudeSessionId: 'conv-1' });
    const { deps, spy } = setup(goal([iter()]), { live: [other] });
    await expect(go(deps)).resolves.toEqual({ ok: true, value: { session: other, reused: true } });
    expect(spy.createInteractiveTerminal).not.toHaveBeenCalled();
  });
  it('two clicks at once join one launch', async () => {
    let finish!: (value: { ok: true; value: TerminalSession }) => void;
    const create = vi.fn(() => new Promise<{ ok: true; value: TerminalSession }>((resolve) => { finish = resolve; }));
    const { deps } = setup(goal([iter()]), { createInteractiveTerminal: create });
    const first = go(deps); const second = go(deps);
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    finish({ ok: true, value: session('one') });
    await expect(first).resolves.toMatchObject({ value: { reused: false } });
    await expect(second).resolves.toMatchObject({ value: { session: { id: 'one' }, reused: true } });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('REQ-9 plain refusals', () => {
  it('NOT_FOUND for a missing goal', async () => {
    const { deps } = setup(undefined);
    await expect(go(deps)).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
  it('RUN_NOT_FOUND for an unknown iteration', async () => {
    const { deps } = setup(goal([iter()]));
    await expect(go(deps, { goalId: 'g1', iterationId: 'nope' })).resolves.toEqual({ ok: false, code: 'RUN_NOT_FOUND', message: "This run is no longer in the goal's history" });
  });
  it.each([
    ['no iterations', []],
    ['a Squad iteration', [iter({ executionId: 'e1' })]],
    ['no recorded conversation', [iter({ conversation: undefined })]],
    ['an option-like id', [iter({ conversation: conv({ id: '--dangerously-skip-permissions' }) as never })]],
    ['an empty id', [iter({ conversation: conv({ id: '' }) as never })]],
    ['a non-string profile', [iter({ conversation: conv({ profile: 7 }) as never })]]
  ])('NO_CONVERSATION for %s, launching nothing', async (_n, iterations) => {
    const { deps, spy } = setup(goal(iterations as GoalIteration[]));
    await expect(go(deps)).resolves.toEqual({ ok: false, code: 'NO_CONVERSATION', message: "This run didn't record a conversation to reopen" });
    expect(spy.createInteractiveTerminal).not.toHaveBeenCalled();
  });
  it('NO_CONVERSATION for an explicit bad iteration too', async () => {
    const { deps } = setup(goal([iter({ id: 'bad', conversation: conv({ id: '--x' }) as never })]));
    await expect(go(deps, { goalId: 'g1', iterationId: 'bad' })).resolves.toMatchObject({ code: 'NO_CONVERSATION' });
  });
  it('PROJECT_MISSING when the project is unregistered', async () => {
    const { deps } = setup(goal([iter()]), { project: null });
    await expect(go(deps)).resolves.toEqual({ ok: false, code: 'PROJECT_MISSING', message: 'The project for this goal is no longer registered' });
  });
  it('PROJECT_MISSING when the folder is gone', async () => {
    const { deps, spy } = setup(goal([iter()]), { realpath: vi.fn(() => { throw new Error('ENOENT'); }) });
    await expect(go(deps)).resolves.toMatchObject({ ok: false, code: 'PROJECT_MISSING' });
    expect(spy.createInteractiveTerminal).not.toHaveBeenCalled();
  });
  it('CONVERSATION_MOVED for a conversation recorded in another folder', async () => {
    const { deps, spy } = setup(goal([iter({ conversation: conv({ cwd: '/other' }) as never })]));
    await expect(go(deps)).resolves.toMatchObject({ ok: false, code: 'CONVERSATION_MOVED' });
    expect(spy.createInteractiveTerminal).not.toHaveBeenCalled();
  });
  it('UNSUPPORTED for a harness that cannot reopen a conversation', async () => {
    const { deps } = setup(goal([iter({ conversation: conv({ profile: 'shell' }) as never })]));
    await expect(go(deps)).resolves.toEqual({ ok: false, code: 'UNSUPPORTED', message: "This agent can't reopen a past conversation" });
  });
  it('returns a failed create unchanged', async () => {
    const failure = { ok: false as const, code: 'PROFILE_CONFLICT', message: 'nope' };
    const { deps } = setup(goal([iter()]), { createInteractiveTerminal: vi.fn(async () => failure) });
    await expect(go(deps)).resolves.toBe(failure);
  });
});
