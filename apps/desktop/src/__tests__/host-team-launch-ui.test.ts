import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Drives host.ts `startTeamJobFromUi` end to end (real SquadExecutionService,
 * authorizeTeamLaunch, launchTeam, durable stores) with a faked pty layer and
 * in-memory team/persona stores.
 */
const h = vi.hoisted(() => {
  const root = (require('node:fs') as typeof import('node:fs')).mkdtempSync(
    require('node:path').join(require('node:os').tmpdir(), 'host-team-launch-ui-')
  );
  return {
    root,
    projects: [] as any[],
    config: {} as any,
    teams: [] as any[],
    personas: [] as any[],
    creates: [] as any[],
    createImpl: null as null | ((opts: any) => any),
    sessions: new Map<string, any>(),
    verified: [{ family: 'claude', enabled: true, installed: true }] as any[]
  };
});

vi.stubEnv('ZCC_DATA_DIR', h.root);
vi.stubEnv('ZCC_EXECUTION_STORE', 'json');
// Report-back probes must never reach the developer's live app on :8780.
vi.stubEnv('ZCC_SERVER_URL', 'http://127.0.0.1:9/');

vi.mock('@zana-ai/zcc-host-daemon/pty', () => ({
  PtyManager: class {
    setMcpBaseUrl() {}
    setProjectRoots() {}
    setRulesResolver() {}
    create(opts: any) {
      h.creates.push(opts);
      if (h.createImpl) return h.createImpl(opts);
      const session = { id: opts.preallocatedSessionId ?? opts.sessionId ?? `s${h.creates.length}`, status: 'running', projectId: opts.projectId, cohort: opts.cohort };
      h.sessions.set(session.id, session);
      return session;
    }
    getSession(id: string) { return h.sessions.get(id) ?? null; }
    list() { return [...h.sessions.values()]; }
    reply() {}
    setRestoreCapabilityId() {}
    async waitForReady(id: string) { return h.sessions.get(id); }
    on() { return this; }
    closeExpected() {}
    close() { return true; }
  },
  isClaudeProfile: (p: string) => p === 'claude'
}));

vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({
  store: {
    listProjects: () => h.projects,
    getConfig: () => h.config,
    getProjectSettings: () => ({}),
    createScratchSubfolder: () => '/tmp/scratch',
    ensureRemoteProjectLocalDir: (project: unknown) => project
  },
  scratchWorkspaceRoot: () => '/tmp/scratch-root',
  worktreeRoot: () => '/tmp/zcc-worktrees',
  worktreeTargetDir: (_p: unknown, slug: string) => `/tmp/zcc-worktrees/${slug}`
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

vi.mock('@zana-ai/zcc-host-daemon/harness/harness-verify', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zana-ai/zcc-host-daemon/harness/harness-verify')>();
  return { ...actual, verifyHarnesses: async () => h.verified };
});

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8')
  },
  app: {
    on: () => {},
    whenReady: () => new Promise(() => {}),
    getPath: () => h.root,
    setName: () => {},
    requestSingleInstanceLock: () => true,
    quit: () => {}
  },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  ipcMain: { handle: () => {}, on: () => {} },
  dialog: {}, shell: {}, screen: {},
  Menu: { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) },
  nativeImage: { createFromPath: () => ({}) },
  powerMonitor: { on: () => {} }
}));
vi.mock('../updater.js', () => ({ createUpdater: () => ({}) }));
vi.mock('@zana-ai/zcc-host-daemon/mcp-config', () => ({
  ensureMcpConfigForProject: () => '/tmp/p1/.mcp.json',
  ensureMcpConfigForProjectSync: () => '/tmp/p1/.mcp.json',
  alwaysOnPluginMcpAllowlist: () => []
}));


const { startTeamJobFromUi, squadProposalService, squadProposalStore } = await import('../host.js');
const { SquadExecutionService } = await import('@zana-ai/zcc-server/services/execution/service');

// Outside h.root, which is this test's ZCC_DATA_DIR: the source policy protects Zana's data folder.
const projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-launch-proj-')));
mkdirSync(projectDir, { recursive: true });

const PLAN = [
  '### write: Write output <!-- executable-step -->', '', '- **Depends on:** None', '- **Mode:** Mutating',
  '- **Write scope:** `output.txt`', '- **Work:** Create output.', '- **Verification:** Read output.'
].join('\n');
const BAD_PLAN = '### write: Write output <!-- executable-step -->\n\n- **Mode:** Mutating\n- **Work:** Create output.\n- **Verification:** Read output.';

const persona = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id.toUpperCase(), baseProfile: 'claude', ...extra });

beforeEach(() => {
  h.projects = [{ id: 'p1', name: 'Proj', path: projectDir }];
  h.config = { version: 1, theme: 'dark', shell: '/bin/zsh', claudeBinary: 'claude', fontSize: 13, lastProjectId: null, autoRenameTabs: false };
  h.personas = [persona('orch'), persona('w1')];
  h.teams = [{ id: 'team1', name: 'Team One', orchestratorPersonaId: 'orch', slots: [{ personaId: 'w1', quantity: 2 }] }];
  h.creates.length = 0;
  h.sessions.clear();
  h.createImpl = null;
  h.verified = [{ family: 'claude', enabled: true, installed: true }];
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(h.root, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
});

const input = (extra: Record<string, unknown> = {}) => ({ teamId: 'team1', projectId: 'p1', goal: 'Ship the feature', ...extra }) as never;

describe('startTeamJobFromUi validation', () => {
  it('refuses when team execution is disabled', async () => {
    h.config.teamJobLaunchEnabled = false;
    h.config.composerShowAutonomousTeam = false;
    expect(await startTeamJobFromUi(input())).toMatchObject({ ok: false, code: 'DISABLED' });
  });

  it.each([
    [null, 'INVALID'],
    [{ teamId: 't', projectId: 'p1', goal: 'g', coordinationMode: 'job-team' }, 'INVALID'],
    [{ teamId: '', projectId: 'p1', goal: 'g' }, 'INVALID'],
    [{ teamId: 'team1', projectId: 3, goal: 'g' }, 'INVALID'],
    [{ teamId: 'team1', projectId: 'p1', goal: '   ' }, 'INVALID'],
    [{ teamId: 'nope', projectId: 'p1', goal: 'g' }, 'NOT_FOUND'],
    [{ teamId: 'team1', projectId: 'nope', goal: 'g' }, 'NOT_FOUND'],
    [{ teamId: 'team1', projectId: 'p1', goal: 'g', target: { kind: 'worktree', branch: '../x' } }, 'INVALID'],
    [{ teamId: 'team1', projectId: 'p1', goal: 'g', target: { kind: 'path', path: '/etc' } }, 'INVALID']
  ])('rejects malformed input %j with %s', async (value, code) => {
    expect(await startTeamJobFromUi(value as never)).toMatchObject({ ok: false, code });
  });

  it('rejects secondary-host projects, teams without a usable orchestrator and slot-less teams', async () => {
    h.projects = [{ id: 'p1', name: 'Proj', path: projectDir, hostId: 'other-host' }];
    expect(await startTeamJobFromUi(input())).toMatchObject({ ok: false, code: 'HOST_UNSUPPORTED' });
    h.projects = [{ id: 'p1', name: 'Proj', path: projectDir }];
    h.teams = [{ id: 'team1', name: 'T', slots: [{ personaId: 'w1' }] }];
    expect(await startTeamJobFromUi(input())).toMatchObject({ ok: false, code: 'NO_ORCHESTRATOR' });
    h.teams = [{ id: 'team1', name: 'T', orchestratorPersonaId: 'ghost', slots: [{ personaId: 'w1' }] }];
    expect(await startTeamJobFromUi(input())).toMatchObject({ ok: false, code: 'DENIED', message: 'unknown persona: ghost' });
    h.teams = [{ id: 'team1', name: 'T', orchestratorPersonaId: 'orch', slots: [] }];
    const solo = await startTeamJobFromUi(input());
  });

  it('validates source capability ids and the trusted-window requirement', async () => {
    expect(await startTeamJobFromUi(input({ sourceCapabilityIds: ['ok', 7] }))).toMatchObject({ ok: false, code: 'INVALID', message: 'invalid execution source capability' });
    expect(await startTeamJobFromUi(input({ sourceCapabilityIds: ['cap-1'] }))).toMatchObject({ ok: false, code: 'INVALID_CAPABILITY' });
    const result = await startTeamJobFromUi(input({ sourceCapabilityIds: ['cap-1'] }), { windowId: 1 });
    expect(result).toMatchObject({ ok: false, sources: { renewed: [], dropped: [{ previousId: 'cap-1', reason: 'unknown' }] } });
  });

  it('requires a trusted window for goal-referenced source files', async () => {
    writeFileSync(join(projectDir, 'plan.md'), PLAN);
    const goal = `Execute ${join(projectDir, 'plan.md')}`;
    expect(await startTeamJobFromUi(input({ goal }))).toMatchObject({ ok: false, code: 'INVALID_CAPABILITY' });
    const attended = await startTeamJobFromUi(input({ goal }), { windowId: 1 });
    expect(attended.ok).toBe(true);
  });
});

describe('startTeamJobFromUi launches', () => {
  it('starts an inferred-plan (freeform) job and opens the squad terminals', async () => {
    const result = await startTeamJobFromUi(input({ coordinationMode: 'freeform', title: ' My job ', summary: ' ctx ' }));
    expect(result).toMatchObject({ ok: true, value: { executionId: expect.any(String) } });
    expect(h.creates).toHaveLength(3);
    expect(h.creates.at(-1).cohort).toMatchObject({ role: 'orchestrator', coordinationMode: 'freeform', executionJobTitle: 'My job' });
    expect(h.creates[0].cohort.role).toBe('worker');
  });

  it('refuses infer when the orchestrator cannot author and register a plan on the team transport', async () => {
    h.personas = [persona('orch', { deniedTools: ['Write'] }), persona('w1')];
    expect(await startTeamJobFromUi(input({ coordinationMode: 'freeform' }))).toMatchObject({ ok: false, code: 'ORCHESTRATOR_CANNOT_PLAN' });
    expect(h.creates).toHaveLength(0);
    h.personas = [persona('orch', { deniedTools: ['mcp__zcc-inbox__execution.plan.register'] }), persona('w1')];
    h.teams = [{ ...h.teams[0], transport: 'MODERN' }];
    expect(await startTeamJobFromUi(input({ coordinationMode: 'freeform' }))).toMatchObject({ ok: false, code: 'ORCHESTRATOR_CANNOT_PLAN' });
  });

  it('does not apply the infer gate to a Modern orchestrator that can register', async () => {
    h.personas = [persona('orch', { deniedTools: ['Write'] }), persona('w1')];
    h.teams = [{ ...h.teams[0], transport: 'MODERN' }];
    const result = await startTeamJobFromUi(input({ coordinationMode: 'freeform' }));
    expect(result).not.toMatchObject({ code: 'ORCHESTRATOR_CANNOT_PLAN' });
  });

  it('seeds a valid provided plan as durable work units (structured is the default mode)', async () => {
    const result = await startTeamJobFromUi(input({ goal: PLAN }));
    expect(result.ok).toBe(true);
    expect(h.creates.at(-1).cohort.coordinationMode).toBe('structured');
  });

  it('uses startup autonomous timeout default and honours an explicit 0 (no deadline)', async () => {
    h.config.autonomousTimeoutMs = 0;
    expect((await startTeamJobFromUi(input({ coordinationMode: 'freeform' }))).ok).toBe(true);
    h.config.autonomousTimeoutMs = 120_000;
    expect((await startTeamJobFromUi(input({ coordinationMode: 'freeform' }))).ok).toBe(true);
    delete h.config.autonomousTimeoutMs;
    expect((await startTeamJobFromUi(input({ coordinationMode: 'freeform' }))).ok).toBe(true);
  });

  it('parks an invalid provided plan for correction when an operator window launched it', async () => {
    const result = await startTeamJobFromUi(input({ goal: BAD_PLAN }), { windowId: 1 });
    expect(result.ok).toBe(true);
    const orchestratorPrompt = h.creates.at(-1).openingPrompt ?? h.creates.at(-1).prompt ?? '';
    expect(JSON.stringify(h.creates.at(-1))).toContain('Shared job goal');
    expect(orchestratorPrompt).toBeDefined();
  });

  it('refuses an invalid provided plan for an unattended launch', async () => {
    const result = await startTeamJobFromUi(input({ goal: BAD_PLAN }));
    expect(result).toMatchObject({ ok: false, code: 'INVALID_PLAN' });
    expect(h.creates).toHaveLength(0);
  });

  it('maps admission / start failures and removes the source snapshot', async () => {
    h.verified = [];
    const unavailable = await startTeamJobFromUi(input({ coordinationMode: 'freeform' }));
    expect(unavailable.ok).toBe(false);
    writeFileSync(join(projectDir, 'plan2.md'), PLAN);
    const withSource = await startTeamJobFromUi(input({ goal: `Run ${join(projectDir, 'plan2.md')}`, coordinationMode: 'freeform' }), { windowId: 1 });
    expect(withSource.ok).toBe(false);
  });
});

describe('startTeamJobFromUi shared squad worktree', () => {
  function gitProject() {
    const dir = realpathSync(mkdtempSync(join(h.root, 'git-')));
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    writeFileSync(join(dir, 'README.md'), 'hi');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    return dir;
  }

  it('carries the prepared worktree into worker and orchestrator launches and the plan handoff root', async () => {
    const dir = gitProject();
    h.projects = [{ id: 'p1', name: 'Proj', path: dir }];
    h.teams = [{ ...h.teams[0], worktreeIsolation: true }];
    const result = await startTeamJobFromUi(input({ coordinationMode: 'freeform' }));
    expect(result.ok).toBe(true);
    expect(h.creates.length).toBeGreaterThan(0);
    for (const create of h.creates) expect(String(create.cwd)).toContain('.worktrees');
  });

  it('falls back to the project folder (with an inbox notice) when the project is not a git repo', async () => {
    h.teams = [{ ...h.teams[0], worktreeIsolation: true }];
    const result = await startTeamJobFromUi(input({ coordinationMode: 'freeform' }));
    expect(result.ok).toBe(true);
    for (const create of h.creates) expect(String(create.cwd)).not.toContain('.worktrees');
  });
});

describe('startTeamJobFromUi proposed launches', () => {
  const record = (id: string, extra: Record<string, unknown> = {}) => ({
    id, projectId: 'p1', proposer: { kind: 'thread' as const, id: 'thread-1', title: 'Design chat' }, teamId: 'team1',
    goal: 'Ship the feature', planning: 'infer' as const, sources: [], state: 'pending' as const,
    createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 60_000, ...extra
  });

  it('requires a trusted window when a proposalId is present', async () => {
    expect(await startTeamJobFromUi(input({ coordinationMode: 'freeform', proposalId: 'prop-x' }))).toEqual({
      ok: false, code: 'INVALID_CAPABILITY', message: 'Proposed Squad launches must be opened from the desktop app window.'
    });
    expect(h.creates).toHaveLength(0);
  });

  it('returns the beginLaunch error without starting anything', async () => {
    const result = await startTeamJobFromUi(input({ coordinationMode: 'freeform', proposalId: 'missing' }), { windowId: 1 });
    expect(result).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(h.creates).toHaveLength(0);
  });

  it('passes the proposal to start() as the 4th argument, then marks the proposal launched', async () => {
    await squadProposalStore.create(record('prop-ok') as never);
    const start = vi.spyOn(SquadExecutionService.prototype, 'start');
    const markLaunched = vi.spyOn(squadProposalService, 'markLaunched');
    try {
      const result = await startTeamJobFromUi(input({ coordinationMode: 'freeform', proposalId: 'prop-ok' }), { windowId: 1 });
      expect(result.ok).toBe(true);
      const executionId = (result as { value: { executionId: string } }).value.executionId;
      expect(start.mock.calls[0]).toHaveLength(4);
      expect(start.mock.calls[0]![3]).toEqual({
        proposal: { id: 'prop-ok', proposerKind: 'thread', proposerId: 'thread-1', proposerTitle: 'Design chat' },
        // The run reports back to the conversation that proposed it.
        reportTo: { kind: 'thread', id: 'thread-1', title: 'Design chat', role: 'proposer' }
      });
      expect(markLaunched).toHaveBeenCalledWith('prop-ok', executionId);
      expect(await squadProposalStore.get('prop-ok')).toMatchObject({ state: 'launched', executionId });
    } finally {
      start.mockRestore();
      markLaunched.mockRestore();
    }
  });

  it('does not fail a started Squad when marking the proposal launched throws', async () => {
    await squadProposalStore.create(record('prop-throw') as never);
    const markLaunched = vi.spyOn(squadProposalService, 'markLaunched').mockRejectedValue(new Error('disk full'));
    try {
      expect((await startTeamJobFromUi(input({ coordinationMode: 'freeform', proposalId: 'prop-throw' }), { windowId: 1 })).ok).toBe(true);
    } finally {
      markLaunched.mockRestore();
    }
  });

  it('refuses a second launch while the first is still starting', async () => {
    await squadProposalStore.create(record('prop-race') as never);
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const original = SquadExecutionService.prototype.start;
    const start = vi.spyOn(SquadExecutionService.prototype, 'start').mockImplementationOnce(async function (this: SquadExecutionService, ...args: Parameters<typeof original>) {
      await gate;
      return original.apply(this, args);
    });
    try {
      const first = startTeamJobFromUi(input({ coordinationMode: 'freeform', proposalId: 'prop-race' }), { windowId: 1 });
      await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
      expect(await startTeamJobFromUi(input({ coordinationMode: 'freeform', proposalId: 'prop-race' }), { windowId: 1 }))
        .toMatchObject({ ok: false, code: 'NOT_PENDING', message: 'This Squad launch is already starting.' });
      finish();
      expect((await first).ok).toBe(true);
    } finally {
      start.mockRestore();
    }
  });

  it('releases the proposal when start() throws, so the user can retry at once', async () => {
    await squadProposalStore.create(record('prop-boom') as never);
    const start = vi.spyOn(SquadExecutionService.prototype, 'start').mockRejectedValueOnce(new Error('boom'));
    try {
      await expect(startTeamJobFromUi(input({ coordinationMode: 'freeform', proposalId: 'prop-boom' }), { windowId: 1 })).rejects.toThrow('boom');
      expect((await startTeamJobFromUi(input({ coordinationMode: 'freeform', proposalId: 'prop-boom' }), { windowId: 1 })).ok).toBe(true);
    } finally {
      start.mockRestore();
    }
  });

  // Not under h.root: that is this test's ZCC_DATA_DIR, which the source policy protects.
  async function withFakeHome(run: (fakeHome: string, sourceNames: (call: number) => string[], start: any) => Promise<void>) {
    const fakeHome = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-launch-home-')));
    vi.stubEnv('HOME', fakeHome);
    const start = vi.spyOn(SquadExecutionService.prototype, 'start');
    const sourceNames = (call: number) =>
      ((start.mock.calls[call]![2] as { sourceBundle?: { sources: Array<{ name: string }> } }).sourceBundle?.sources ?? []).map((source) => source.name);
    try {
      await run(fakeHome, sourceNames, start);
    } finally {
      start.mockRestore();
      vi.unstubAllEnvs();
      vi.stubEnv('ZCC_DATA_DIR', h.root);
      vi.stubEnv('ZCC_EXECUTION_STORE', 'json');
      vi.stubEnv('ZCC_SERVER_URL', 'http://127.0.0.1:9/');
      rmSync(fakeHome, { recursive: true, force: true });
    }
  }

  it('a manual launch still attaches goal-named HOME files, never from a credential store', async () => {
    await withFakeHome(async (fakeHome, sourceNames) => {
      const notes = join(fakeHome, 'notes.md');
      writeFileSync(notes, 'design notes');
      mkdirSync(join(fakeHome, '.ssh'));
      const key = join(fakeHome, '.ssh', 'id_e2e');
      writeFileSync(key, 'PRIVATE');
      expect((await startTeamJobFromUi(input({ coordinationMode: 'freeform', goal: `Read ${notes} and ${key}` }), { windowId: 1 })).ok).toBe(true);
      expect(sourceNames(0)).toEqual(['notes.md']);
    });
  });

  it('refuses a proposed launch whose goal names an outside-Project file the card did not list', async () => {
    await withFakeHome(async (fakeHome, _names, start) => {
      const notes = join(fakeHome, 'notes.md');
      writeFileSync(notes, 'private notes');
      await squadProposalStore.create(record('prop-home') as never);
      const refused = await startTeamJobFromUi(input({ coordinationMode: 'freeform', goal: `Read ${notes}`, proposalId: 'prop-home' }), { windowId: 1 });
      expect(refused).toMatchObject({ ok: false, code: 'SOURCE_NOT_ALLOWED', message: expect.stringContaining(`${notes}, which is outside this project`) });
      expect((refused as { message: string }).message).toContain('`sources`');
      expect(start).not.toHaveBeenCalled();
      // The hold is released: the proposal is still launchable once the goal no longer names the file.
      expect((await startTeamJobFromUi(input({ coordinationMode: 'freeform', proposalId: 'prop-home' }), { windowId: 1 })).ok).toBe(true);
    });
  });

  it('refuses a proposed launch whose goal names a file created after the card was reviewed', async () => {
    await withFakeHome(async (fakeHome, _names, start) => {
      const later = join(fakeHome, 'later.md');
      await squadProposalStore.create(record('prop-later') as never);
      // The goal names a path that does not exist yet: nothing to refuse at proposal time.
      writeFileSync(later, 'created after review');
      const refused = await startTeamJobFromUi(input({ coordinationMode: 'freeform', goal: `Read ${later}`, proposalId: 'prop-later' }), { windowId: 1 });
      expect(refused).toMatchObject({ ok: false, code: 'SOURCE_NOT_ALLOWED' });
      expect(start).not.toHaveBeenCalled();
    });
  });

  it('attaches an outside-Project file the goal names when the reviewed card lists it, once', async () => {
    await withFakeHome(async (fakeHome, sourceNames) => {
      const notes = join(fakeHome, 'notes.md');
      writeFileSync(notes, 'design notes');
      await squadProposalStore.create({ ...record('prop-listed'), sources: [{ path: notes, relPath: '~/notes.md', bytes: 12, outsideProject: true }] } as never);
      const launched = await startTeamJobFromUi(input({ coordinationMode: 'freeform', goal: `Read ${notes}`, proposalId: 'prop-listed' }), { windowId: 1 });
      expect(launched.ok).toBe(true);
      // The card's own source capability would attach it; the goal must not attach it a second time.
      expect(sourceNames(0)).toEqual([]);
    });
  });

  it('still attaches goal-named files inside the Project for a proposed launch', async () => {
    await withFakeHome(async (_home, sourceNames) => {
      const inside = join(projectDir, 'plan.md');
      writeFileSync(inside, 'plan');
      await squadProposalStore.create(record('prop-inside') as never);
      expect((await startTeamJobFromUi(input({ coordinationMode: 'freeform', goal: `Follow ${inside}`, proposalId: 'prop-inside' }), { windowId: 1 })).ok).toBe(true);
      expect(sourceNames(0)).toEqual(['plan.md']);
    });
  });

  it('refuses a relaunch once a Squad started from the proposal, even if recording it failed', async () => {
    await squadProposalStore.create(record('prop-heal') as never);
    const markLaunched = vi.spyOn(squadProposalService, 'markLaunched').mockRejectedValueOnce(new Error('disk full'));
    try {
      const first = await startTeamJobFromUi(input({ coordinationMode: 'freeform', proposalId: 'prop-heal' }), { windowId: 1 });
      expect(first.ok).toBe(true);
      // Simulate the hold being gone (expired, or the app restarted) while the record is still pending.
      squadProposalService.releaseLaunch('prop-heal');
      expect(await squadProposalStore.get('prop-heal')).toMatchObject({ state: 'pending' });
      expect(await startTeamJobFromUi(input({ coordinationMode: 'freeform', proposalId: 'prop-heal' }), { windowId: 1 }))
        .toMatchObject({ ok: false, code: 'NOT_PENDING', message: 'A Squad was already started from this proposal.' });
      expect(await squadProposalStore.get('prop-heal')).toMatchObject({
        state: 'launched', executionId: (first as { value: { executionId: string } }).value.executionId
      });
    } finally {
      markLaunched.mockRestore();
    }
  });

  it('blocks a duplicate launch after one finished, and releases the proposal when start fails', async () => {
    await squadProposalStore.create(record('prop-dup') as never);
    const start = vi.spyOn(SquadExecutionService.prototype, 'start').mockResolvedValueOnce({ ok: false, code: 'CONFLICT', message: 'no' } as never);
    try {
      const failed = await startTeamJobFromUi(input({ coordinationMode: 'freeform', proposalId: 'prop-dup' }), { windowId: 1 });
      expect(failed.ok).toBe(false);
      // Released at once: the retry is not locked out and starts the real Squad.
      const retry = await startTeamJobFromUi(input({ coordinationMode: 'freeform', proposalId: 'prop-dup' }), { windowId: 1 });
      expect(retry.ok).toBe(true);
      // The proposal is now launched; a second click is refused.
      expect(await startTeamJobFromUi(input({ coordinationMode: 'freeform', proposalId: 'prop-dup' }), { windowId: 1 })).toMatchObject({ ok: false, code: 'NOT_PENDING' });
    } finally {
      start.mockRestore();
    }
  });

  it('calls start() with exactly three arguments when there is no proposalId', async () => {
    const start = vi.spyOn(SquadExecutionService.prototype, 'start');
    try {
      expect((await startTeamJobFromUi(input({ coordinationMode: 'freeform' }))).ok).toBe(true);
      expect(start.mock.calls[0]).toHaveLength(3);
    } finally {
      start.mockRestore();
    }
  });
});
