import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const h = vi.hoisted(() => ({
  root: (require('node:fs') as typeof import('node:fs')).mkdtempSync(
    require('node:path').join(require('node:os').tmpdir(), 'squad-proposal-host-')
  ),
  config: {} as Record<string, unknown>,
  teams: [] as any[],
  personas: [] as any[],
  sessions: new Map<string, any>(),
  projects: [] as any[],
  replies: [] as Array<[string, string]>,
  replyThrows: false
}));

vi.stubEnv('ZCC_DATA_DIR', h.root);
vi.stubEnv('ZCC_EXECUTION_STORE', 'json');
// Never the installed app on :8780: an unmocked product-server call must fail.
vi.stubEnv('ZCC_SERVER_URL', 'http://127.0.0.1:9/');

vi.mock('@zana-ai/zcc-host-daemon/pty', () => ({
  PtyManager: class {
    setMcpBaseUrl() {}
    setProjectRoots() {}
    setRulesResolver() {}
    getSession(id: string) { return h.sessions.get(id) ?? null; }
    reply(id: string, text: string) { if (h.replyThrows) throw new Error('pty gone'); h.replies.push([id, text]); return true; }
    list() { return [...h.sessions.values()]; }
    on() { return this; }
  },
  isClaudeProfile: () => false
}));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({
  store: { listProjects: () => h.projects, getConfig: () => h.config, getProjectSettings: () => ({}) },
  scratchWorkspaceRoot: () => '/tmp/scratch-root',
  worktreeRoot: () => '/tmp/zcc-worktrees',
  worktreeTargetDir: () => '/tmp/zcc-worktrees/target'
}));
vi.mock('@zana-ai/zcc-server/services/agents/persona-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zana-ai/zcc-server/services/agents/persona-store')>();
  class FakePersonaStore extends actual.PersonaStore {
    list() { return h.personas; }
    start() {}
    stop() {}
    refresh() {}
    rebindProjects() {}
  }
  return { ...actual, PersonaStore: FakePersonaStore };
});
vi.mock('@zana-ai/zcc-server/services/agents/team-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zana-ai/zcc-server/services/agents/team-store')>();
  class FakeTeamStore extends actual.TeamStore {
    list() { return h.teams; }
    start() {}
    stop() {}
    refresh() {}
    rebindProjects() {}
  }
  return { ...actual, TeamStore: FakeTeamStore };
});
vi.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false },
  app: { on: () => {}, whenReady: () => new Promise(() => {}), getPath: () => h.root, setName: () => {}, requestSingleInstanceLock: () => true, quit: () => {} },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  ipcMain: { handle: () => {}, on: () => {} }, dialog: {}, shell: {}, screen: {},
  Menu: { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) },
  nativeImage: { createFromPath: () => ({}) }, powerMonitor: { on: () => {} }
}));
vi.mock('../updater.js', () => ({ createUpdater: () => ({}) }));
vi.mock('../test-tap.js', () => ({ record: () => {}, recordLog: () => {}, isEnabled: () => false, enable: () => {}, drain: () => ({ entries: [], cursor: 0 }), snapshot: () => ({ entries: [] }), reset: () => {} }));

const host = await import('../host.js');

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(h.root, { recursive: true, force: true });
});

beforeEach(() => {
  h.config = {};
  h.sessions.clear();
  h.projects = [];
  h.replies = [];
  h.replyThrows = false;
  h.teams = [{ id: 'team1', name: 'Team', orchestratorPersonaId: 'orch', slots: [] }];
  h.personas = [{ id: 'orch', name: 'Orch', baseProfile: 'claude' }];
});
afterEach(() => vi.restoreAllMocks());

const pty = (extra: Record<string, unknown> = {}) => ({ id: 's1', projectId: 'p1', status: 'running', profile: 'claude', title: 'Design chat', cwd: '/work', ...extra });

describe('lookupProposer', () => {
  it('identifies a live PTY that is a Squad member', async () => {
    h.sessions.set('s1', pty({ cohort: { executionId: 'e1' } }));
    expect(await host.lookupProposer('s1', 'p1')).toMatchObject({ kind: 'pty', id: 's1', title: 'Design chat', squadMember: true, origin: { profile: 'claude', cwd: '/work' } });
  });

  it('identifies a live PTY that is not a member, without a title when it has none', async () => {
    h.sessions.set('s1', pty({ title: '' }));
    const found = await host.lookupProposer('s1', 'p1');
    expect(found).toMatchObject({ kind: 'pty', squadMember: false });
    expect(found).not.toHaveProperty('title');
  });

  it('falls back to a live Modern thread', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ live: true }));
    expect(await host.lookupProposer('thread-1', 'p1')).toEqual({ kind: 'thread', id: 'thread-1', squadMember: false, origin: { threadId: 'thread-1' } });
    expect(String(fetchSpy.mock.calls[0]![0])).toContain('/api/v1/threads/thread-1/live');
  });

  it('names a live Modern thread by its title for the proposal card', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => String(url).includes('/menubar/threads')
      ? Response.json({ agents: [{ kind: 'thread', agentId: 'thread-1', projectId: 'p1', rowKey: 'thread:thread-1', projectName: 'Proj', title: ' Design chat ', state: 'idle', favorite: false, canFavorite: true, canReply: true, createdAt: 1, threadId: 'thread-1', status: 'idle', hasPendingInteraction: false }], needsYou: 0, working: 0 })
      : Response.json({ live: true }));
    expect(await host.lookupProposer('thread-1', 'p1')).toMatchObject({ kind: 'thread', id: 'thread-1', title: 'Design chat' });
  });

  it('returns null for an exited PTY, a PTY in another project, and an unknown id', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ live: false }));
    h.sessions.set('s1', pty({ status: 'exited' }));
    h.sessions.set('s2', pty({ id: 's2', projectId: 'other' }));
    expect(await host.lookupProposer('s1', 'p1')).toBeNull();
    expect(await host.lookupProposer('s2', 'p1')).toBeNull();
    expect(await host.lookupProposer('nope', 'p1')).toBeNull();
  });
});

describe('squadProposalMcpDeps', () => {
  it('provides both deps while Team jobs are on', () => {
    expect(Object.keys(host.squadProposalMcpDeps()).sort()).toEqual(['checkSquadPlan', 'proposeSquad']);
  });

  it('provides nothing when Team jobs are off', () => {
    h.config = { teamJobLaunchEnabled: false, composerShowAutonomousTeam: false };
    expect(host.squadProposalMcpDeps()).toEqual({});
  });

  it('squad_plan_check works from a route without a session id', async () => {
    const { checkSquadPlan } = host.squadProposalMcpDeps() as { checkSquadPlan: (route: { projectId: string }, input: { text: string }) => Promise<unknown> };
    expect(await checkSquadPlan({ projectId: 'p1' }, { text: 'no steps here' })).toMatchObject({ ok: true, value: { ok: false } });
  });
});

describe('list_teams canInferPlan', () => {
  it('is true only when the orchestrator persona can write files', () => {
    expect(host.listTeamSummariesForMcp()).toMatchObject([{ id: 'team1', canInferPlan: true }]);
    h.personas = [{ id: 'orch', name: 'Orch', baseProfile: 'claude', deniedTools: ['Write'] }];
    expect(host.listTeamSummariesForMcp()[0]!.canInferPlan).toBe(false);
  });

  it('is false when the team has no orchestrator or the persona is unknown', () => {
    expect(host.canInferPlanForTeam({})).toBe(false);
    expect(host.canInferPlanForTeam({ orchestratorPersonaId: 'ghost' })).toBe(false);
  });
});

describe('findExecutionForProposal', () => {
  it('finds nothing for a proposal that never launched', async () => {
    expect(await host.findExecutionForProposal('p1', 'never-launched')).toBeUndefined();
  });
});

describe('queueThreadTurnForProposal fallback (no utility child)', () => {
  it('POSTs a queue-if-active text turn to the product server', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));
    expect(await host.queueThreadTurnForProposal('thread-1', 'p1', 'report')).toEqual({ ok: true });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(new URL(String(url)).pathname).toBe('/api/v1/threads/thread-1/send');
    expect(init!.method).toBe('POST');
    expect(JSON.parse(init!.body as string)).toEqual({ input: [{ type: 'text', text: 'report', mentions: [] }], mode: 'queue-if-active' });
  });

  it('reports the server error code, an http status, and transport errors', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(Response.json({ code: 'deferred_queue_full' }, { status: 409 }));
    expect(await host.queueThreadTurnForProposal('t', 'p1', 'x')).toEqual({ ok: false, reason: 'deferred_queue_full' });
    fetchSpy.mockResolvedValueOnce(new Response('oops', { status: 500 }));
    expect(await host.queueThreadTurnForProposal('t', 'p1', 'x')).toEqual({ ok: false, reason: 'http-500' });
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await host.queueThreadTurnForProposal('t', 'p1', 'x')).toEqual({ ok: false, reason: 'ECONNREFUSED' });
  });
});


describe('service wiring against the host singletons', () => {
  const dirs: string[] = [];
  const projectDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'squad-host-project-'));
    dirs.push(dir);
    h.projects = [{ id: 'p1', name: 'Proj', path: dir }];
    return dir;
  };
  afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  it('proposes, reviews, dismisses and launches through the real stores', async () => {
    const dir = projectDir();
    h.sessions.set('s1', pty());
    h.teams = [{ id: 'team1', name: 'Team', orchestratorPersonaId: 'orch', slots: [{ personaId: 'worker', quantity: 1 }] }];
    h.personas = [{ id: 'orch', name: 'Orch', baseProfile: 'claude' }, { id: 'worker', name: 'Worker', baseProfile: 'claude' }];
    const proposed = await host.squadProposalService.propose({ projectId: 'p1', sessionId: 's1' }, { teamId: 'team1', goal: 'Do the thing', planning: 'infer' });
    expect(proposed).toMatchObject({ ok: true, value: { planning: 'infer', team: { workers: 1 } } });
    if (!proposed.ok) return;

    const reviewed = await host.squadProposalService.review(1, proposed.value.proposalId, () => true);
    expect(reviewed).toMatchObject({ ok: true, value: { coordinationMode: 'freeform', goal: 'Do the thing' } });

    await host.squadProposalService.handleAction({ ref: proposed.value.proposalId, input: { optionId: 'dismiss' } });
    expect(await host.squadProposalService.beginLaunch(proposed.value.proposalId, 'p1')).toMatchObject({ ok: false, code: 'NOT_PENDING' });

    const second = await host.squadProposalService.propose({ projectId: 'p1', sessionId: 's1' }, { teamId: 'team1', goal: 'Another', planning: 'infer' });
    expect(second.ok).toBe(true);
    if (second.ok) await host.squadProposalService.markLaunched(second.value.proposalId, 'exec-1');

    // Files go through the real fs deps and the plan resolver.
    writeFileSync(join(dir, 'plan.md'), '# prose only, no executable steps');
    const provided = await host.squadProposalService.propose({ projectId: 'p1', sessionId: 's1' }, { teamId: 'team1', goal: 'Plan it', planning: 'provided', sources: ['plan.md'] });
    expect(provided).toMatchObject({ ok: false, code: 'INVALID_PLAN' });
  });
});

describe('report-back wiring', () => {
  const proposal = (kind: 'pty' | 'thread') => ({ id: 'prop-1', proposerKind: kind, proposerId: kind === 'pty' ? 's1' : 'thread-1', proposerTitle: 'Chat' });
  const record = (kind: 'pty' | 'thread') => ({ id: 'exec-1', projectId: 'p1', proposal: proposal(kind), state: 'RUNNING', attempt: 1 }) as never;
  const blocker = { id: 'b1', question: 'Which label?', audience: 'human' } as never;

  it('delivers a blocker report to an idle PTY proposer, arms the quiet-gate timer and forgets the session', async () => {
    h.sessions.set('s1', pty({ lastInputAt: 0 }));
    await host.squadProposalNotifier.onHumanBlocker(record('pty'), blocker);
    host.squadProposalNotifier.onState('s1', 'idle');
    expect(h.replies.at(-1)?.[0]).toBe('s1');
    expect(h.replies.at(-1)?.[1]).toContain('[Squad report]');

    // A recent keystroke holds delivery behind the quiet gate; forget drops the held report.
    const delivered = h.replies.length;
    h.sessions.set('s1', pty({ lastInputAt: Date.now() }));
    await host.squadProposalNotifier.onHumanBlocker(record('pty'), { ...blocker, id: 'b2' });
    host.squadProposalNotifier.onState('s1', 'idle');
    expect(h.replies).toHaveLength(delivered);
    host.squadProposalNotifier.forget('s1');
    h.sessions.set('s1', pty({ lastInputAt: 0 }));
    host.squadProposalNotifier.onState('s1', 'idle');
    expect(h.replies).toHaveLength(delivered);
  });

  it('logs a failed PTY delivery instead of throwing', async () => {
    h.sessions.set('s1', pty({ lastInputAt: 0 }));
    h.replyThrows = true;
    await host.squadProposalNotifier.onHumanBlocker(record('pty'), { ...blocker, id: 'b3' });
    expect(() => host.squadProposalNotifier.onState('s1', 'idle')).not.toThrow();
    host.squadProposalNotifier.forget('s1');
  });

  it('queues the report into a live Modern thread', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ live: true }));
    await host.squadProposalNotifier.onHumanBlocker(record('thread'), { ...blocker, id: 'b4' });
    const sends = fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/send'));
    expect(sends).toHaveLength(1);
    expect(JSON.parse(sends[0]![1]!.body as string).input[0].text).toContain('[Squad report]');
  });

  it('ignores terminal records it does not know and replays nothing', async () => {
    await host.squadProposalNotifier.onTerminal({ ...record('pty'), state: 'COMPLETED' } as never);
    await host.squadProposalNotifier.replayUnreported();
    expect(h.replies).toEqual([]);
  });

  it('passes the worktree outcome to the report-back, after the lifecycle', async () => {
    const order: string[] = [];
    const lifecycle = vi.spyOn(host.squadWorktreeRuntime, 'handleSquadWorktreeTerminal')
      .mockImplementationOnce(async () => { order.push('lifecycle'); return 'merged'; })
      .mockImplementationOnce(async () => { order.push('lifecycle'); return undefined; });
    const report = vi.spyOn(host.squadProposalNotifier, 'onTerminal').mockImplementation(async () => { order.push('report'); });
    try {
      const done = { ...record('pty'), state: 'COMPLETED' } as never;
      // The outcome is returned too, so session-exit teardown keeps the typed contract.
      expect(await host.handleSquadTerminalWithReport(done)).toBe('merged');
      expect(report).toHaveBeenLastCalledWith(done, { worktree: 'merged' });
      // Nothing applied in this call (e.g. team teardown pending): the notifier gets no outcome and waits.
      expect(await host.handleSquadTerminalWithReport(done)).toBeUndefined();
      expect(report).toHaveBeenLastCalledWith(done, undefined);
      expect(order).toEqual(['lifecycle', 'report', 'lifecycle', 'report']);
    } finally {
      lifecycle.mockRestore();
      report.mockRestore();
    }
  });

  it('still runs the report-back when the lifecycle throws, and propagates the error', async () => {
    const lifecycle = vi.spyOn(host.squadWorktreeRuntime, 'handleSquadWorktreeTerminal').mockRejectedValue(new Error('git failed'));
    const report = vi.spyOn(host.squadProposalNotifier, 'onTerminal').mockResolvedValue(undefined);
    try {
      const done = { ...record('pty'), state: 'COMPLETED' } as never;
      await expect(host.handleSquadTerminalWithReport(done)).rejects.toThrow('git failed');
      expect(report).toHaveBeenCalledWith(done, undefined);
      // With a worktree, a throwing handler left the checkout in place: reported as kept, not withheld.
      const withWorktree = { ...record('pty'), state: 'COMPLETED', squadWorktree: { path: '/wt', branch: 'sq' } } as never;
      await expect(host.handleSquadTerminalWithReport(withWorktree)).rejects.toThrow('git failed');
      expect(report).toHaveBeenLastCalledWith(withWorktree, { worktree: 'kept' });
    } finally {
      lifecycle.mockRestore();
      report.mockRestore();
    }
  });
});
