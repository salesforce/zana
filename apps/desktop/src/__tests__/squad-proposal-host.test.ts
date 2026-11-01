import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  replyThrows: false,
  projectSettings: {} as Record<string, unknown>,
  reviewIds: new Set<string>(),
  executionStores: [] as any[]
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
  store: { listProjects: () => h.projects, getConfig: () => h.config, getProjectSettings: () => h.projectSettings },
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
    launchReviewRequired(id: string) { return h.reviewIds.has(id); }
    start() {}
    stop() {}
    refresh() {}
    rebindProjects() {}
  }
  return { ...actual, TeamStore: FakeTeamStore };
});
vi.mock('@zana-ai/zcc-server/services/execution/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zana-ai/zcc-server/services/execution/store')>();
  return { ...actual, createExecutionStore: (...args: Parameters<typeof actual.createExecutionStore>) => {
    const created = actual.createExecutionStore(...args);
    h.executionStores.push(created);
    return created;
  } };
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
const { SquadExecutionService } = await import('@zana-ai/zcc-server/services/execution/service');

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
  h.projectSettings = {};
  h.reviewIds.clear();
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
  it('provides the squad deps while Team jobs are on', () => {
    expect(Object.keys(host.squadProposalMcpDeps()).sort()).toEqual(['checkSquadPlan', 'launchSquadNow', 'proposeSquad']);
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

  it('follows the effective transport: Modern registers via MCP, so a Write deny does not block it', () => {
    h.personas = [{ id: 'orch', name: 'Orch', baseProfile: 'claude', deniedTools: ['Write'] }];
    expect(host.canInferPlanForTeam({ orchestratorPersonaId: 'orch', transport: 'MODERN' })).toBe(true);
    expect(host.canInferPlanForTeam({ orchestratorPersonaId: 'orch', transport: 'CLI' })).toBe(false);
    h.personas = [{ id: 'orch', name: 'Orch', baseProfile: 'claude', deniedTools: ['mcp__zcc-inbox__execution.plan.register'] }];
    expect(host.canInferPlanForTeam({ orchestratorPersonaId: 'orch', transport: 'MODERN' })).toBe(false);
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

  // As the app does once sessions are back; before this a blocker is left to the replay.
  beforeAll(async () => { await host.squadProposalNotifier.replayUnreported(); });

  it('delivers a blocker report to an idle PTY proposer, arms the quiet-gate timer and forgets the session', async () => {
    h.sessions.set('s1', pty({ lastKeyInputAt: 0 }));
    await host.squadProposalNotifier.onHumanBlocker(record('pty'), blocker);
    host.squadProposalNotifier.onState('s1', 'idle');
    // Delivery re-checks that the blocker is still open before typing, so it lands a tick later.
    await vi.waitFor(() => expect(h.replies.at(-1)?.[0]).toBe('s1'));
    expect(h.replies.at(-1)?.[1]).toContain('[Squad report]');

    // A recent keystroke holds delivery behind the quiet gate; forget drops the held report.
    const delivered = h.replies.length;
    h.sessions.set('s1', pty({ lastKeyInputAt: Date.now() }));
    await host.squadProposalNotifier.onHumanBlocker(record('pty'), { ...blocker, id: 'b2' });
    host.squadProposalNotifier.onState('s1', 'idle');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.replies).toHaveLength(delivered);
    host.squadProposalNotifier.forget('s1');
    h.sessions.set('s1', pty({ lastKeyInputAt: 0 }));
    host.squadProposalNotifier.onState('s1', 'idle');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.replies).toHaveLength(delivered);
  });

  it('quiets on keystrokes only, holds behind a pending draft, and treats waiting as rest only for non-OSC harnesses', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const RECHECK = 5_000;
    let n = 0;
    // Blocker -> state edge -> delivered (or, after a re-check window, still not delivered).
    const offer = async (session: Record<string, unknown>, state: 'idle' | 'waiting') => {
      h.sessions.set('s1', pty(session));
      await host.squadProposalNotifier.onHumanBlocker(record('pty'), { ...blocker, id: `k${n += 1}` });
      host.squadProposalNotifier.onState('s1', state);
    };
    const expectHeld = async (count: number) => {
      await vi.advanceTimersByTimeAsync(RECHECK * 2);
      expect(h.replies).toHaveLength(count);
    };
    try {
      // A user who never typed (no keystroke clock) with fresh non-key input: delivers.
      let delivered = h.replies.length;
      await offer({ lastKeyInputAt: undefined, lastInputAt: Date.now() }, 'idle');
      await vi.waitFor(() => expect(h.replies).toHaveLength(delivered + 1));
      host.squadProposalNotifier.forget('s1');

      // Old keystroke with fresh non-key input: delivers.
      delivered = h.replies.length;
      await offer({ lastInputAt: Date.now(), lastKeyInputAt: 0 }, 'idle');
      await vi.waitFor(() => expect(h.replies).toHaveLength(delivered + 1));
      host.squadProposalNotifier.forget('s1');

      // A recent keystroke holds delivery behind the quiet gate.
      delivered = h.replies.length;
      await offer({ lastKeyInputAt: Date.now() }, 'idle');
      await expectHeld(delivered);
      host.squadProposalNotifier.forget('s1');

      // A fresh pending draft holds delivery.
      await offer({ lastKeyInputAt: Date.now() - 60_000, draftPending: true }, 'idle');
      await expectHeld(delivered);
      host.squadProposalNotifier.forget('s1');

      // `waiting` is not rest for an OSC harness...
      await offer({ lastKeyInputAt: 0, profile: 'claude' }, 'waiting');
      await expectHeld(delivered);
      host.squadProposalNotifier.forget('s1');

      // ...but is for output-activity and screen-scan harnesses, and for a headless cohort worker.
      for (const session of [
        { lastKeyInputAt: 0, profile: 'codex' },
        { lastKeyInputAt: 0, profile: 'opencode' },
        { lastKeyInputAt: 0, profile: 'claude', headless: true, cohort: { role: 'worker' } }
      ]) {
        delivered = h.replies.length;
        await offer(session, 'waiting');
        await vi.waitFor(() => expect(h.replies).toHaveLength(delivered + 1));
        host.squadProposalNotifier.forget('s1');
      }

      // A session that vanished after the report was queued never receives it.
      delivered = h.replies.length;
      await offer({ lastKeyInputAt: 0, profile: 'claude' }, 'waiting');
      h.sessions.delete('s1');
      host.squadProposalNotifier.onState('s1', 'waiting');
      await expectHeld(delivered);
    } finally {
      vi.useRealTimers();
    }
  });

  it('logs a failed PTY delivery instead of throwing', async () => {
    h.sessions.set('s1', pty({ lastKeyInputAt: 0 }));
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

describe('sessionRestsInWaiting', () => {
  it('is false for an unknown session and for an OSC harness', () => {
    expect(host.sessionRestsInWaiting(undefined)).toBe(false);
    expect(host.sessionRestsInWaiting(null)).toBe(false);
    expect(host.sessionRestsInWaiting(pty() as never)).toBe(false);
  });

  it('is true for output-activity and screen-scan harnesses and a headless cohort worker', () => {
    expect(host.sessionRestsInWaiting(pty({ profile: 'codex' }) as never)).toBe(true);
    expect(host.sessionRestsInWaiting(pty({ profile: 'opencode' }) as never)).toBe(true);
    expect(host.sessionRestsInWaiting(pty({ headless: true, cohort: { role: 'worker' } }) as never)).toBe(true);
  });
});

describe('resolveTeamLaunchApproval', () => {
  it('is direct for an unknown team with no project requirement', async () => {
    expect(await host.resolveTeamLaunchApproval('ghost', 'p1')).toBe('direct');
    expect(await host.resolveTeamLaunchApproval('team1', 'p1')).toBe('direct');
  });

  it('is review when the Squad file, a shadowed copy, or the Project asks for it', async () => {
    h.teams = [{ id: 'team1', name: 'Team', launchApproval: 'review', slots: [] }];
    expect(await host.resolveTeamLaunchApproval('team1', 'p1')).toBe('review');
    h.teams = [{ id: 'team1', name: 'Team', slots: [] }];
    h.reviewIds.add('team1');
    expect(await host.resolveTeamLaunchApproval('team1', 'p1')).toBe('review');
    h.reviewIds.clear();
    h.projectSettings = { launchApproval: 'review' };
    expect(await host.resolveTeamLaunchApproval('team1', 'p1')).toBe('review');
  });
});

describe('squad_launch wiring (launchNow deps)', () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
  const route = { projectId: 'p1', sessionId: 's1' };
  const input = { teamId: 'team1', goal: 'Do the thing', planning: 'infer' as const };
  const setup = () => {
    const dir = mkdtempSync(join(tmpdir(), 'squad-now-project-'));
    dirs.push(dir);
    h.projects = [{ id: 'p1', name: 'Proj', path: dir }];
    h.sessions.set('s1', pty());
    h.teams = [{ id: 'team1', name: 'Team', orchestratorPersonaId: 'orch', slots: [{ personaId: 'worker', quantity: 1 }] }];
    h.personas = [{ id: 'orch', name: 'Orch', baseProfile: 'claude' }, { id: 'worker', name: 'Worker', baseProfile: 'claude' }];
    return vi.spyOn(SquadExecutionService.prototype, 'start')
      .mockImplementation(async () => ({ ok: true, value: { id: `exec-${Math.random()}`, state: 'RUNNING' } }) as never);
  };
  const spyStores = (fns: { active?: number; get?: unknown }) => {
    for (const created of h.executionStores) {
      if (fns.active !== undefined) vi.spyOn(created, 'countActiveOwned').mockResolvedValue(fns.active);
      if ('get' in fns) vi.spyOn(created, 'get').mockResolvedValue(fns.get as never);
    }
  };

  it('starts a Squad owned by the calling session with an agent-prefixed launch id', async () => {
    const start = setup();
    const outcome = await host.squadProposalService.launchSquadNow({ ...route }, { ...input, goal: 'Own launch' });
    expect(outcome).toMatchObject({ ok: true, value: { state: 'RUNNING' } });
    const [principal, projectId, request, options] = start.mock.calls[0] as unknown as [string, string, { launchRequestId: string; objective: string }, unknown];
    expect([principal, projectId]).toEqual(['s1', 'p1']);
    expect(request.launchRequestId).toMatch(/^agent:/);
    expect(request.objective).toBe('Own launch');
    expect(options).toMatchObject({ reportTo: { kind: 'pty', id: 's1', role: 'owner' } });
  });

  it('also routes through the MCP dep', async () => {
    const start = setup();
    const { launchSquadNow } = host.squadProposalMcpDeps() as { launchSquadNow: (r: typeof route, i: typeof input) => Promise<unknown> };
    expect(await launchSquadNow(route, { ...input, goal: 'Via MCP' })).toMatchObject({ ok: true });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('dedupes a repeat while the run is live, and starts afresh when its state is gone or terminal', async () => {
    const start = setup();
    const repeat = { ...input, goal: 'Repeat me' };
    expect(await host.squadProposalService.launchSquadNow(route, repeat)).toMatchObject({ ok: true });
    spyStores({ active: 0, get: { state: 'RUNNING' } });
    expect(await host.squadProposalService.launchSquadNow(route, repeat)).toMatchObject({ ok: true, value: { deduped: true } });
    expect(start).toHaveBeenCalledTimes(1);
    for (const state of [undefined, 'COMPLETED', 'FAILED'] as const) {
      const before = start.mock.calls.length;
      // Re-prime the cached launch, then let its run go missing or terminal.
      spyStores({ get: { state: 'RUNNING' } });
      expect(await host.squadProposalService.launchSquadNow(route, { ...repeat, goal: `Repeat ${state}` })).toMatchObject({ ok: true });
      spyStores({ get: state ? { state } : undefined });
      expect(await host.squadProposalService.launchSquadNow(route, { ...repeat, goal: `Repeat ${state}` })).toMatchObject({ ok: true });
      expect(start).toHaveBeenCalledTimes(before + 2);
    }
  });

  it('refuses at the per-session cap using the store count of owned non-terminal runs', async () => {
    const start = setup();
    spyStores({ active: 3, get: undefined });
    expect(await host.squadProposalService.launchSquadNow(route, { ...input, goal: 'Capped' })).toMatchObject({ ok: false, code: 'TOO_MANY_LAUNCHES' });
    expect(start).not.toHaveBeenCalled();
    spyStores({ active: 2 });
    expect(await host.squadProposalService.launchSquadNow(route, { ...input, goal: 'Under cap' })).toMatchObject({ ok: true });
    expect(start).toHaveBeenCalledTimes(1);
    for (const created of h.executionStores) expect(created.countActiveOwned).toHaveBeenCalledWith('s1', 'p1');
  });

  it('requires review when the Project or the Squad asks for it, without starting a run', async () => {
    const start = setup();
    h.projectSettings = { launchApproval: 'review' };
    expect(await host.squadProposalService.launchSquadNow(route, input)).toMatchObject({ ok: false, code: 'LAUNCH_REVIEW_REQUIRED' });
    h.projectSettings = {};
    h.reviewIds.add('team1');
    expect(await host.squadProposalService.launchSquadNow(route, input)).toMatchObject({ ok: false, code: 'LAUNCH_REVIEW_REQUIRED' });
    expect(start).not.toHaveBeenCalled();
  });

  it('surfaces a refused start as the failure code', async () => {
    const start = setup();
    start.mockResolvedValue({ ok: false, code: 'TEAM_NOT_FOUND', message: 'nope' } as never);
    expect(await host.squadProposalService.launchSquadNow(route, { ...input, goal: 'Refused' })).toMatchObject({ ok: false });
  });
});
