import { describe, expect, it, vi } from 'vitest';
import type { Project, ScheduleRun, ScheduledTask, TerminalSession } from '@zana-ai/zcc-domain/product';
import { registrationFor } from '@zana-ai/zcc-host-daemon/harness/registry';
import { resumeScheduledRun, type ResumeRunDeps } from '../scheduler-resume-run.js';

const local: Project = { id: 'p1', name: 'P', path: '/proj', createdAt: 0, lastActiveAt: 0 };
const remote = { ...local, remote: { host: 'h', remotePath: '/r' } } as unknown as Project;
const at = (minutesAgo: number) => new Date(Date.parse('2026-10-27T12:00:00Z') - minutesAgo * 60_000).toISOString();
const conv = (over: Record<string, unknown> = {}) => ({ profile: 'claude', id: 'conv-1', cwd: '/proj', startedAt: at(10), ...over });
const run = (over: Partial<ScheduleRun> = {}): ScheduleRun => ({ id: 'r1', at: at(10), result: 'success', sessionId: 'old-pty', conversation: conv() as never, ...over });
const task = (runs: ScheduleRun[], over: Partial<ScheduledTask> = {}) =>
  ({ id: 's1', name: 'Nightly', projectId: 'p1', profile: 'claude', status: { runCount: runs.length, runs }, ...over }) as unknown as ScheduledTask;
const session = (id: string, over: Record<string, unknown> = {}) => ({ id, projectId: 'p1', profile: 'claude', status: 'running', ...over }) as unknown as TerminalSession;

function setup(t: ScheduledTask | undefined, over: Partial<ResumeRunDeps> & { project?: Project | null; live?: TerminalSession[] } = {}) {
  const created = session('new-pty');
  const deps = {
    getTask: vi.fn(() => t),
    listProjects: vi.fn(() => (over.project === null ? [] : [over.project ?? local])),
    listLiveSessions: vi.fn(() => over.live ?? []),
    createInteractiveTerminal: vi.fn(async () => ({ ok: true as const, value: created })),
    registrationFor: vi.fn((profile: string) => registrationFor(profile as never) as never),
    realpath: vi.fn((p: string) => `/real${p}`),
    ...over
  } as unknown as ResumeRunDeps & Record<string, ReturnType<typeof vi.fn>>;
  delete (deps as Record<string, unknown>).project; delete (deps as Record<string, unknown>).live;
  return { deps, created };
}
const go = (deps: ResumeRunDeps, input: { scheduleId: string; runId?: string } = { scheduleId: 's1' }) => resumeScheduledRun(input, deps);

describe('resumeScheduledRun', () => {
  it('reopens the newest run in a new tab with only the resume projection', async () => {
    const { deps, created } = setup(task([run()]));
    const result = await go(deps);
    expect(result).toEqual({ ok: true, value: { session: created, reused: false } });
    const req = (deps.createInteractiveTerminal as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(req).sort()).toEqual(['cols', 'cwd', 'extraArgs', 'profile', 'projectId', 'rows', 'title']);
    expect(req).toMatchObject({ projectId: 'p1', cwd: '/real/proj', cols: 80, rows: 24, title: '↺ Nightly', profile: 'claude' });
    expect(req.extraArgs).toEqual(['--resume', 'conv-1']);
    for (const key of ['personaId', 'harnessRouting', 'prompt', 'headless', 'scheduled']) expect(req).not.toHaveProperty(key);
  });

  it('fails with NOT_FOUND for an unknown schedule', async () => {
    const { deps } = setup(undefined);
    await expect(go(deps)).resolves.toEqual({ ok: false, code: 'NOT_FOUND', message: 'This schedule is no longer available' });
  });

  it('picks the newest resumable run, skipping markers, skipped, pending, failed and Squad runs', async () => {
    const runs = [
      run({ id: 'marker', at: at(1), marker: true }),
      run({ id: 'skipped', at: at(2), result: 'skipped' }),
      run({ id: 'pending', at: at(3), launchState: 'pending' }),
      run({ id: 'failed', at: at(4), launchState: 'failed' }),
      run({ id: 'squad', at: at(5), executionId: 'e1' }),
      run({ id: 'plain', at: at(6), conversation: undefined }),
      run({ id: 'good', at: at(7), conversation: conv({ id: 'good-conv' }) as never }),
      run({ id: 'older', at: at(30), conversation: conv({ id: 'older-conv' }) as never })
    ];
    const { deps } = setup(task(runs));
    await go(deps);
    expect((deps.createInteractiveTerminal as ReturnType<typeof vi.fn>).mock.calls[0]![0].extraArgs).toEqual(['--resume', 'good-conv']);
  });

  it('uses an explicit runId, and reports an unknown one', async () => {
    const runs = [run({ id: 'new', at: at(1), conversation: conv({ id: 'new-conv' }) as never }), run({ id: 'old', at: at(60), conversation: conv({ id: 'old-conv' }) as never })];
    const { deps } = setup(task(runs));
    await go(deps, { scheduleId: 's1', runId: 'old' });
    expect((deps.createInteractiveTerminal as ReturnType<typeof vi.fn>).mock.calls[0]![0].extraArgs).toEqual(['--resume', 'old-conv']);
    await expect(go(deps, { scheduleId: 's1', runId: 'nope' })).resolves.toEqual({ ok: false, code: 'RUN_NOT_FOUND', message: "This run is no longer in the schedule's history" });
  });

  it.each([
    ['no runs', []],
    ['a Squad run', [run({ executionId: 'e1' })]],
    ['a run without a conversation', [run({ conversation: undefined })]],
    ['an option-like id', [run({ conversation: conv({ id: '--dangerously-skip-permissions' }) as never })]],
    ['an empty id', [run({ conversation: conv({ id: '' }) as never })]],
    ['a too-long id', [run({ conversation: conv({ id: 'a'.repeat(129) }) as never })]],
    ['a non-string profile', [run({ conversation: conv({ profile: 7 }) as never })]]
  ])('gives NO_CONVERSATION for %s, launching nothing', async (_name, runs) => {
    const { deps } = setup(task(runs as ScheduleRun[]));
    await expect(go(deps)).resolves.toEqual({ ok: false, code: 'NO_CONVERSATION', message: "This run didn't record a conversation to reopen" });
    expect(deps.createInteractiveTerminal).not.toHaveBeenCalled();
  });

  it('gives NO_CONVERSATION for an explicit bad run too', async () => {
    const { deps } = setup(task([run({ id: 'bad', conversation: conv({ id: '--x' }) as never })]));
    await expect(go(deps, { scheduleId: 's1', runId: 'bad' })).resolves.toMatchObject({ code: 'NO_CONVERSATION' });
  });

  it('gives PROJECT_MISSING when the project is unregistered, or its folder is gone', async () => {
    const gone = setup(task([run()]), { project: null });
    await expect(go(gone.deps)).resolves.toEqual({ ok: false, code: 'PROJECT_MISSING', message: 'The project for this schedule is no longer registered' });
    const noFolder = setup(task([run()]), { realpath: vi.fn(() => { throw new Error('ENOENT'); }) });
    await expect(go(noFolder.deps)).resolves.toEqual({ ok: false, code: 'PROJECT_MISSING', message: 'The project folder for this schedule is missing' });
    expect(noFolder.deps.createInteractiveTerminal).not.toHaveBeenCalled();
  });

  it('gives UNSUPPORTED for a harness that cannot reopen a conversation', async () => {
    const { deps } = setup(task([run({ conversation: conv({ profile: 'shell' }) as never })]));
    await expect(go(deps)).resolves.toEqual({ ok: false, code: 'UNSUPPORTED', message: "This agent can't reopen a past conversation" });
    const none = setup(task([run()]), { registrationFor: vi.fn(() => ({ nativeConversationResume: () => undefined })) as never });
    await expect(go(none.deps)).resolves.toMatchObject({ code: 'UNSUPPORTED' });
  });

  it('gives a remote project cwd undefined and never calls realpath', async () => {
    const { deps } = setup(task([run()]), { project: remote });
    await go(deps);
    expect((deps.createInteractiveTerminal as ReturnType<typeof vi.fn>).mock.calls[0]![0].cwd).toBeUndefined();
    expect(deps.realpath).not.toHaveBeenCalled();
  });

  it('reuses the run\'s own live pty without launching', async () => {
    const own = session('old-pty');
    const { deps } = setup(task([run()]), { live: [own] });
    await expect(go(deps)).resolves.toEqual({ ok: true, value: { session: own, reused: true } });
    expect(deps.createInteractiveTerminal).not.toHaveBeenCalled();
  });

  it('reuses another live tab holding the same conversation', async () => {
    const other = session('other', { claudeSessionId: 'conv-1' });
    const { deps } = setup(task([run()]), { live: [session('unrelated', { claudeSessionId: 'zzz' }), other] });
    await expect(go(deps)).resolves.toEqual({ ok: true, value: { session: other, reused: true } });
    expect(deps.createInteractiveTerminal).not.toHaveBeenCalled();
  });

  it.each(['claude-yolo', 'claude-resume'])('reuses the tab a %s run reopened as plain claude, instead of opening another each time', async (recorded) => {
    const reopened = session('reopened', { profile: 'claude', claudeSessionId: 'conv-1' });
    const { deps } = setup(task([run({ conversation: conv({ profile: recorded }) as never })]), { live: [reopened] });
    await expect(go(deps)).resolves.toEqual({ ok: true, value: { session: reopened, reused: true } });
    expect(deps.createInteractiveTerminal).not.toHaveBeenCalled();
  });

  it('joins one pending launch for the same conversation recorded under two profiles of one harness', async () => {
    let finish!: (value: { ok: true; value: TerminalSession }) => void;
    const createInteractiveTerminal = vi.fn(() => new Promise<{ ok: true; value: TerminalSession }>((resolve) => { finish = resolve; }));
    const a = setup(task([run({ conversation: conv({ profile: 'claude-yolo' }) as never })]), { createInteractiveTerminal: createInteractiveTerminal as never });
    const b = setup(task([run()]), { createInteractiveTerminal: createInteractiveTerminal as never });
    const first = go(a.deps);
    const second = go(b.deps);
    await vi.waitFor(() => expect(createInteractiveTerminal).toHaveBeenCalledTimes(1));
    finish({ ok: true, value: session('one') });
    await expect(first).resolves.toMatchObject({ value: { reused: false } });
    await expect(second).resolves.toMatchObject({ value: { session: { id: 'one' }, reused: true } });
    expect(createInteractiveTerminal).toHaveBeenCalledTimes(1);
  });

  it('does not reuse a tab of another harness that happens to hold the same id', async () => {
    const codexTab = session('codex-tab', { profile: 'codex', codexSessionId: 'conv-1' });
    const { deps, created } = setup(task([run()]), { live: [codexTab] });
    await expect(go(deps)).resolves.toEqual({ ok: true, value: { session: created, reused: false } });
  });

  describe('a harness that detects its id after launch (Codex, OpenCode)', () => {
    it('reopens with the id the run detected while it was live', async () => {
      const { deps } = setup(task([run({ conversation: conv({ profile: 'codex', id: 'codex-9' }) as never })]));
      await go(deps);
      const req = (deps.createInteractiveTerminal as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(req).toMatchObject({ profile: 'codex-resume', resumeSessionId: 'codex-9' });
    });

    it('is not offered when the run never detected its id: nothing is guessed later', async () => {
      const { deps } = setup(task([run({ conversation: conv({ profile: 'codex', id: undefined }) as never })]));
      await expect(go(deps)).resolves.toEqual({ ok: false, code: 'NO_CONVERSATION', message: "This run didn't record a conversation to reopen" });
      expect(deps.createInteractiveTerminal).not.toHaveBeenCalled();
      expect(Object.keys(deps)).not.toContain('resolveNativeId');
    });
  });

  describe('the recorded folder', () => {
    it('refuses a conversation recorded in another folder (a moved schedule or an edited file)', async () => {
      const { deps } = setup(task([run({ conversation: conv({ cwd: '/other-project' }) as never })]));
      await expect(go(deps)).resolves.toEqual({ ok: false, code: 'CONVERSATION_MOVED', message: "This run's conversation was recorded in another folder, so it can't be reopened here" });
      expect(deps.createInteractiveTerminal).not.toHaveBeenCalled();
    });

    it('refuses a recorded folder that no longer resolves', async () => {
      const realpath = vi.fn((p: string) => { if (p === '/proj') return '/real/proj'; throw new Error('ENOENT'); });
      const { deps } = setup(task([run({ conversation: conv({ cwd: '/vanished' }) as never })]), { realpath });
      await expect(go(deps)).resolves.toMatchObject({ code: 'CONVERSATION_MOVED' });
    });

    it('accepts a recorded path that is a symlink to the project folder', async () => {
      const realpath = vi.fn((p: string) => (p === '/proj' || p === '/link-to-proj' ? '/real/proj' : p));
      const { deps } = setup(task([run({ conversation: conv({ cwd: '/link-to-proj' }) as never })]), { realpath });
      await expect(go(deps)).resolves.toMatchObject({ ok: true });
    });

    it('reopens a remote project in its named folder, compared as normalised POSIX paths without touching the local disk', async () => {
      const { deps } = setup(task([run({ conversation: conv({ cwd: '/r/./sub/..//' }) as never })]), { project: remote });
      await expect(go(deps)).resolves.toMatchObject({ ok: true, value: { reused: false } });
      expect(deps.realpath).not.toHaveBeenCalled();
      expect((deps.createInteractiveTerminal as ReturnType<typeof vi.fn>).mock.calls[0]![0].cwd).toBeUndefined();
    });

    it('refuses a remote conversation recorded in another folder than the project names', async () => {
      const { deps } = setup(task([run({ conversation: conv({ cwd: '/elsewhere' }) as never })]), { project: remote });
      await expect(go(deps)).resolves.toMatchObject({ ok: false, code: 'CONVERSATION_MOVED' });
      expect(deps.createInteractiveTerminal).not.toHaveBeenCalled();
    });

    it('does not let a dot-dot path climb out of the named remote folder', async () => {
      const { deps } = setup(task([run({ conversation: conv({ cwd: '/r/../etc' }) as never })]), { project: remote });
      await expect(go(deps)).resolves.toMatchObject({ code: 'CONVERSATION_MOVED' });
    });

    it('accepts the project path a local-agent-with-remote-tools session records', async () => {
      const { deps } = setup(task([run()]), { project: remote });
      await expect(go(deps)).resolves.toMatchObject({ ok: true });
    });

    it('has nothing to compare for a remote project that names no folder (the start folder is resolved at launch)', async () => {
      const unnamed = { ...local, remote: { host: 'h' } } as unknown as Project;
      const { deps } = setup(task([run({ conversation: conv({ cwd: '/machine/default' }) as never })]), { project: unnamed });
      await expect(go(deps)).resolves.toMatchObject({ ok: true });
    });
  });

  describe('two opens at once', () => {
    it('join one launch, so one conversation never gets two agents', async () => {
      let finish!: (value: { ok: true; value: TerminalSession }) => void;
      const created = session('new-pty');
      const createInteractiveTerminal = vi.fn(() => new Promise<{ ok: true; value: TerminalSession }>((resolve) => { finish = resolve; }));
      const { deps } = setup(task([run()]), { createInteractiveTerminal: createInteractiveTerminal as never });
      const first = go(deps);
      const second = go(deps, { scheduleId: 's1', runId: 'r1' });
      await vi.waitFor(() => expect(createInteractiveTerminal).toHaveBeenCalledTimes(1));
      finish({ ok: true, value: created });
      await expect(first).resolves.toEqual({ ok: true, value: { session: created, reused: false } });
      await expect(second).resolves.toEqual({ ok: true, value: { session: created, reused: true } });
      expect(createInteractiveTerminal).toHaveBeenCalledTimes(1);
    });

    it('pass a failed launch to the joiner and let a later click try again', async () => {
      let finish!: (value: unknown) => void;
      const failure = { ok: false as const, code: 'PROFILE_CONFLICT', message: 'nope' };
      const createInteractiveTerminal = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
      const { deps } = setup(task([run()]), { createInteractiveTerminal: createInteractiveTerminal as never });
      const first = go(deps);
      const second = go(deps);
      await vi.waitFor(() => expect(createInteractiveTerminal).toHaveBeenCalledTimes(1));
      finish(failure);
      await expect(first).resolves.toBe(failure);
      await expect(second).resolves.toBe(failure);
      createInteractiveTerminal.mockImplementationOnce(async () => ({ ok: true, value: session('later') }));
      await expect(go(deps)).resolves.toMatchObject({ ok: true, value: { reused: false } });
    });
  });

  describe('identical ids that are different conversations', () => {
    const hold = () => {
      const resolvers: Array<(value: { ok: true; value: TerminalSession }) => void> = [];
      const createInteractiveTerminal = vi.fn(() => new Promise<{ ok: true; value: TerminalSession }>((resolve) => { resolvers.push(resolve); }));
      return { resolvers, createInteractiveTerminal };
    };

    it('in different projects each start their own launch and get their own tab', async () => {
      const { resolvers, createInteractiveTerminal } = hold();
      const otherProject = { ...local, id: 'p2', path: '/proj2' } as Project;
      const a = setup(task([run()]), { createInteractiveTerminal: createInteractiveTerminal as never });
      const b = setup(task([run({ conversation: conv({ cwd: '/proj2' }) as never })], { projectId: 'p2' }), { project: otherProject, createInteractiveTerminal: createInteractiveTerminal as never });
      const first = go(a.deps);
      const second = go(b.deps);
      await vi.waitFor(() => expect(createInteractiveTerminal).toHaveBeenCalledTimes(2));
      resolvers[0]!({ ok: true, value: session('tab-p1') });
      resolvers[1]!({ ok: true, value: session('tab-p2', { projectId: 'p2' }) });
      await expect(first).resolves.toMatchObject({ value: { session: { id: 'tab-p1' }, reused: false } });
      await expect(second).resolves.toMatchObject({ value: { session: { id: 'tab-p2' }, reused: false } });
    });

    it('under different harnesses each start their own launch', async () => {
      const { resolvers, createInteractiveTerminal } = hold();
      const a = setup(task([run()]), { createInteractiveTerminal: createInteractiveTerminal as never });
      const b = setup(task([run({ conversation: conv({ profile: 'codex' }) as never })]), { createInteractiveTerminal: createInteractiveTerminal as never });
      const first = go(a.deps);
      const second = go(b.deps);
      await vi.waitFor(() => expect(createInteractiveTerminal).toHaveBeenCalledTimes(2));
      resolvers[0]!({ ok: true, value: session('claude-tab') });
      resolvers[1]!({ ok: true, value: session('codex-tab', { profile: 'codex' }) });
      await expect(first).resolves.toMatchObject({ value: { session: { id: 'claude-tab' }, reused: false } });
      await expect(second).resolves.toMatchObject({ value: { session: { id: 'codex-tab' }, reused: false } });
    });
  });

  it('returns a failed create unchanged', async () => {
    const failure = { ok: false as const, code: 'PROFILE_CONFLICT', message: 'nope' };
    const { deps } = setup(task([run()]), { createInteractiveTerminal: vi.fn(async () => failure) });
    await expect(go(deps)).resolves.toBe(failure);
  });

  it('tolerates a schedule without a status', async () => {
    const { deps } = setup({ id: 's1', name: 'x', projectId: 'p1' } as unknown as ScheduledTask);
    await expect(go(deps)).resolves.toMatchObject({ code: 'NO_CONVERSATION' });
  });
});
