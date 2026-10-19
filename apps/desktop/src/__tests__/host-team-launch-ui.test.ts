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


const { startTeamJobFromUi } = await import('../host.js');

const projectDir = realpathSync(mkdtempSync(join(h.root, 'proj-')));
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
    [{ teamId: 'team1', projectId: 'nope', goal: 'g' }, 'NOT_FOUND']
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
    expect(result.ok).toBe(false);
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
