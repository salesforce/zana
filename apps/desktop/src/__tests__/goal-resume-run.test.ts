import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { SHARED_PRODUCT_METHODS } from '@zana-ai/zcc-contracts/shared-product';
import { registerSchedulerIpc } from '../ipc/scheduler.js';
import type { Goal, GoalIteration, Project, TerminalSession } from '@zana-ai/zcc-domain/product';
import { registrationFor } from '@zana-ai/zcc-host-daemon/harness/registry';
import { resumeGoalIteration } from '../goal-resume-run.js';

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  goalsList: vi.fn(), ptysList: vi.fn(), create: vi.fn(), listProjects: vi.fn(), realpath: vi.fn(), logMainError: vi.fn()
}));
vi.mock('../ipc/shared-product-registration.js', () => ({
  productHandle: (channel: string, handler: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, handler),
  safeProductHandle: (channel: string, handler: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, handler)
}));
vi.mock('../ipc/ctx.js', () => ({ ctx: {
  scheduler: { on: vi.fn() }, goals: { list: ipc.goalsList, on: vi.fn() }, ptys: { list: ipc.ptysList },
  createInteractiveTerminal: ipc.create, logMainError: ipc.logMainError,
  followups: { on: vi.fn() }, feedStore: { on: vi.fn() }, templates: { on: vi.fn() }, scheduleGroups: { on: vi.fn() }
} }));
vi.mock('../ipc/shared.js', () => ({ isExternalId: () => false, externalReject: () => ({ ok: false }), listSchedulesForUi: () => [] }));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({ store: { listProjects: ipc.listProjects } }));
vi.mock('node:fs', async (importOriginal) => ({ ...(await importOriginal<typeof import('node:fs')>()), realpathSync: ipc.realpath }));

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
  it('OBL-002 with no iterationId, reopens the newest FINISHED iteration, not a newer one still running', async () => {
    const g = goal([
      iter({ id: 'running', at: at(1), finishedAt: undefined, verdict: undefined, conversation: conv({ id: 'running-conv' }) as never }),
      iter({ id: 'finished', conversation: conv({ id: 'finished-conv' }) as never })
    ]);
    const { deps, spy } = setup(g);
    await go(deps);
    expect((spy.createInteractiveTerminal!.mock.calls[0]![0] as { extraArgs: string[] }).extraArgs).toEqual(['--resume', 'finished-conv']);
  });
  it('refuses an explicit iterationId of an iteration that is still running', async () => {
    const g = goal([iter({ id: 'running', finishedAt: undefined, verdict: undefined, conversation: conv({ id: 'running-conv' }) as never })]);
    const { deps, spy } = setup(g);
    await expect(go(deps, { goalId: 'g1', iterationId: 'running' })).resolves.toEqual({ ok: false, code: 'RUN_NOT_FINISHED', message: 'This run is still going' });
    expect(spy.createInteractiveTerminal).not.toHaveBeenCalled();
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

describe('REQ-7 / REQ-9 goals:resumeIteration (IPC handler)', () => {
  beforeEach(() => { vi.clearAllMocks(); ipc.handlers.clear(); registerSchedulerIpc(); });
  const call = (arg: unknown) => ipc.handlers.get(IPC.goals.resumeIteration)!(arg) as Promise<unknown>;

  it('stays desktop-only: it starts an interactive terminal', () => {
    expect([...SHARED_PRODUCT_METHODS.keys()]).not.toContain('goals.resumeIteration');
    expect([...SHARED_PRODUCT_METHODS.values()]).not.toContain(IPC.goals.resumeIteration);
  });
  it.each([undefined, 'x', {}, { goalId: '' }, { goalId: 'g', extra: 1 }, { goalId: 'g', iterationId: '' }, { goalId: 'x'.repeat(257) }])(
    'rejects malformed input %j before doing any work', async (input) => {
      await expect(call(input)).resolves.toMatchObject({ ok: false, code: 'BAD_INPUT' });
      expect(ipc.goalsList).not.toHaveBeenCalled();
    });
  it('reopens the goal conversation end to end with dependencies read from main services', async () => {
    const created = session('new-pty');
    ipc.goalsList.mockReturnValue([goal([iter()])]);
    ipc.listProjects.mockReturnValue([local]);
    ipc.ptysList.mockReturnValue([session('dead', { status: 'exited', claudeSessionId: 'conv-1' })]);
    ipc.realpath.mockImplementation((p: string) => `/real${p}`);
    ipc.create.mockResolvedValue({ ok: true, value: created });
    await expect(call({ goalId: 'g1' })).resolves.toEqual({ ok: true, value: { session: created, reused: false } });
    expect(ipc.create.mock.calls[0]![0]).toMatchObject({ extraArgs: ['--resume', 'conv-1'], title: '↺ Goal: Green suite', cwd: '/real/proj' });
  });
  it('refuses an unknown goal without launching', async () => {
    ipc.goalsList.mockReturnValue([]);
    await expect(call({ goalId: 'gone' })).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(ipc.create).not.toHaveBeenCalled();
  });
  it('turns a thrown error into RESUME_FAILED without leaking it, and logs it with the ids', async () => {
    ipc.goalsList.mockImplementation(() => { throw new Error('ENOENT: /Users/someone/secret/path'); });
    const result = await call({ goalId: 'g1', iterationId: 'i9' });
    expect(result).toEqual({ ok: false, code: 'RESUME_FAILED', message: "Couldn't reopen this run's conversation. Try again in a moment." });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(ipc.logMainError).toHaveBeenCalledWith('goal resume iteration (goalId=g1, iterationId=i9)', expect.any(Error));
    ipc.goalsList.mockImplementation(() => { throw 'odd'; });
    await call({ goalId: 'g1' });
    expect(ipc.logMainError).toHaveBeenLastCalledWith('goal resume iteration (goalId=g1, iterationId=latest)', 'odd');
  });
});
