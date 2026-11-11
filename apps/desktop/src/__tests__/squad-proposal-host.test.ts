import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveAllLaunch } from '@zana-ai/zcc-domain/launch-options';

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
  executionStores: [] as any[],
  executionDeps: null as any,
  remoteLocalIo: [] as string[]
}));

vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>();
  const guard = (path: unknown) => {
    if (String(path).startsWith('/registered/remote/')) {
      h.remoteLocalIo.push(String(path));
      throw new Error('Remote checkout must never be accessed locally');
    }
  };
  return { ...actual,
    realpath: async (...args: Parameters<typeof actual.realpath>) => { guard(args[0]); return actual.realpath(...args); },
    lstat: async (...args: Parameters<typeof actual.lstat>) => { guard(args[0]); return actual.lstat(...args); },
    open: async (...args: Parameters<typeof actual.open>) => { guard(args[0]); return actual.open(...args); }
  };
});

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
vi.mock('@zana-ai/zcc-server/services/execution/service', async original => {
  const actual = await original<typeof import('@zana-ai/zcc-server/services/execution/service')>();
  return { ...actual, SquadExecutionService: class extends actual.SquadExecutionService {
    constructor(deps: ConstructorParameters<typeof actual.SquadExecutionService>[0]) { super(deps); h.executionDeps = deps; }
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

afterAll(async () => {
  await host.disposeSquadNamedChecks();
  vi.unstubAllEnvs();
  rmSync(h.root, { recursive: true, force: true });
});

beforeEach(() => {
  h.remoteLocalIo = [];
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
function initializeRepo(dir: string) {
  execFileSync('git', ['init', '-b', 'main', dir]);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test']);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', dir, 'commit', '--allow-empty', '-m', 'initial']);
}

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
  const remotePlan = '## Launch\n- worktree: false\n- push: false\n## Execution Plan\n### read: Read <!-- executable-step -->\n- Mode: Read-only\n- Work: Read\n- Verification: Read';
  it('previews remote attached bytes and launches with exact project/window binding', async () => {
    h.projects = [{ id: 'p1', path: '/registered/remote/checkout', name: 'Remote', remote: { host: 'registered-ssh' } }];
    const dir = mkdtempSync(join(tmpdir(), 'remote-attached-'));
    const path = join(dir, 'plan.md');
    writeFileSync(path, remotePlan);
    const { resolveSourcePolicy } = await import('@zana-ai/zcc-server/services/execution/source-policy');
    const policy = await resolveSourcePolicy(async value => realpathSync(value), { home: dir });
    const attached = await h.executionDeps.sources.issue({ windowId: 7, projectId: 'p1', paths: [path], policy });
    const input = { teamId: 'team1', projectId: 'p1', goal: 'Follow attached plan', coordinationMode: 'structured' as const, sourceCapabilityIds: attached.map((view: any) => view.id) };
    const preview = await host.resolveSquadComposerPreview(input, { kind: 'window', windowId: 7 });
    expect(preview).toMatchObject({ location: { kind: 'project-root' }, path: h.projects[0].path, resolvedLaunch: { worktree: { value: false, source: 'plan' } } });
    expect(await host.resolveSquadComposerPreview(input, { kind: 'window', windowId: 7 })).toEqual(preview);
    await expect(host.resolveSquadComposerPreview(input, { kind: 'window', windowId: 8 })).rejects.toThrow('another');
    h.projects.push({ ...h.projects[0], id: 'p2' });
    await expect(host.resolveSquadComposerPreview({ ...input, projectId: 'p2' }, { kind: 'window', windowId: 7 })).rejects.toThrow('project');
    const start = vi.spyOn(SquadExecutionService.prototype, 'start').mockResolvedValue({ ok: true, value: { id: 'remote-attached', state: 'RUNNING' } } as never);
    expect(await host.startTeamJobFromUi({ ...input, previewToken: preview.previewToken }, { windowId: 7 })).toMatchObject({ ok: true });
    expect(start.mock.calls[0]?.[2]).toMatchObject({ planLaunch: { worktree: false, push: false }, workUnits: [expect.objectContaining({ id: 'read' })] });
    for (const declaration of ['worktree: true', 'push: true', 'checks: check:test']) {
      const unsupportedPath = join(dir, `${declaration.split(':')[0]}.md`);
      writeFileSync(unsupportedPath, `## Launch\n- ${declaration}\n## Execution Plan\n${remotePlan.split('## Execution Plan\n')[1]}`);
      const unsupported = await h.executionDeps.sources.issue({ windowId: 7, projectId: 'p1', paths: [unsupportedPath], policy });
      await expect(host.resolveSquadComposerPreview({ ...input, sourceCapabilityIds: unsupported.map((view: any) => view.id) }, { kind: 'window', windowId: 7 })).rejects.toThrow('Remote target');
    }
    const digestPath = join(dir, 'digest.md');
    writeFileSync(digestPath, remotePlan);
    const digest = await h.executionDeps.sources.issue({ windowId: 7, projectId: 'p1', paths: [digestPath], policy });
    writeFileSync(digestPath, `${remotePlan}\nchanged`);
    await expect(host.resolveSquadComposerPreview({ ...input, sourceCapabilityIds: digest.map((view: any) => view.id) }, { kind: 'window', windowId: 7 })).rejects.toThrow('changed');
    rmSync(dir, { recursive: true, force: true });
    expect(h.remoteLocalIo).toEqual([]);
  });
  it('consumes token before concurrent revalidation and invalidates fingerprint mismatch', async () => {
    h.projects = [{ id: 'p1', path: '/registered/remote/checkout', name: 'Remote', remote: { host: 'registered-ssh' } }];
    const input = { teamId: 'team1', projectId: 'p1', goal: 'Concurrent launch', coordinationMode: 'freeform' as const };
    const preview = await host.resolveSquadComposerPreview(input, { kind: 'window', windowId: 7 });
    const start = vi.spyOn(SquadExecutionService.prototype, 'start').mockResolvedValue({ ok: true, value: { id: 'single-start', state: 'RUNNING' } } as never);
    const results = await Promise.all([host.startTeamJobFromUi({ ...input, previewToken: preview.previewToken }, { windowId: 7 }), host.startTeamJobFromUi({ ...input, previewToken: preview.previewToken }, { windowId: 7 })]);
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.filter(result => !result.ok)).toMatchObject([{ code: 'LAUNCH_CHANGED' }]);
    expect(start).toHaveBeenCalledOnce();
    const drift = await host.resolveSquadComposerPreview(input, { kind: 'window', windowId: 7 });
    h.projects[0].remote.host = 'changed-registered-host';
    expect(await host.startTeamJobFromUi({ ...input, previewToken: drift.previewToken }, { windowId: 7 })).toMatchObject({ ok: false, code: 'LAUNCH_CHANGED' });
    h.projects[0].remote.host = 'registered-ssh';
    expect(await host.startTeamJobFromUi({ ...input, previewToken: drift.previewToken }, { windowId: 7 })).toMatchObject({ ok: false, code: 'LAUNCH_CHANGED' });
  });
  it('rejects Windows named checks at preview/admission before spawn', async () => {
    h.projects = [{ id: 'p1', path: h.root, name: 'Repo' }];
    await host.namedChecksSettings.set({ kind: 'project', projectId: 'p1' }, [{ name: 'test', command: 'printf test' }]);
    await expect(host.resolveSquadNamedChecks('p1', ['check:test'], 'win32')).rejects.toThrow('Named checks are unsupported on Windows');
    expect(await host.resolveSquadNamedChecks('p1', [], 'win32')).toEqual([]);
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
    try {
      await expect(host.resolveSquadNamedChecks('p1', ['check:test'])).rejects.toThrow('Named checks are unsupported on Windows');
      await expect(host.resolveSquadComposerPreview({ teamId: 'team1', projectId: 'p1', goal: 'go', checks: ['test'] }, { kind: 'window', windowId: 7 })).rejects.toThrow('Named checks are unsupported on Windows');
      expect(await host.resolveSquadNamedChecks('p1', [])).toEqual([]);
    } finally { Object.defineProperty(process, 'platform', platform); }
  });
  it('previews registered remote default without local path IO; exact token launches', async () => {
    h.projects = [{ id: 'p1', path: '/registered/remote/checkout', name: 'Remote', remote: { host: 'registered-ssh' } }];
    const input = { teamId: 'team1', projectId: 'p1', goal: 'remote default', coordinationMode: 'freeform' as const };
    const preview = await host.resolveSquadComposerPreview(input, { kind: 'shared-owner' });
    expect(preview).toMatchObject({ path: '/registered/remote/checkout', location: { kind: 'project-root', projectId: 'p1' }, previewToken: expect.any(String) });
    expect(preview.branch).toBeUndefined();
    expect(preview.head).toBeUndefined();
    const provided = { ...input, coordinationMode: 'structured' as const, goal: '### read: Read <!-- executable-step -->\n- Mode: Read-only\n- Work: Read\n- Verification: Read' };
    expect(await host.resolveSquadComposerPreview(provided, { kind: 'window', windowId: 7 })).toMatchObject({ path: '/registered/remote/checkout', location: { kind: 'project-root' }, previewToken: expect.any(String) });
    vi.spyOn(SquadExecutionService.prototype, 'start').mockResolvedValue({ ok: true, value: { id: 'remote-start', state: 'RUNNING' } } as never);
    expect(await host.startTeamJobFromUi({ ...input, previewToken: preview.previewToken })).toMatchObject({ ok: true });
    for (const options of [{ worktree: true }, { push: true }, { checks: ['remote_check'] }, { target: { kind: 'project-root' as const } }, { sourceCapabilityIds: ['foreign'] }]) {
      await expect(host.resolveSquadComposerPreview({ ...input, ...options }, { kind: 'window', windowId: 7 })).rejects.toThrow();
    }
  });
  it('host model snapshots and admission use exact configured slot label, not caller label', async () => {
    h.projects = [{ id: 'p1', path: h.root, name: 'Repo' }];
    h.personas = [{ id: 'orch', name: 'Orch', baseProfile: 'shell' }, { id: 'w', name: 'Worker', baseProfile: 'shell' }];
    h.teams = [{ id: 'team1', name: 'T', orchestratorPersonaId: 'orch', slots: [{ personaId: 'w', quantity: 1, label: 'Exact QA' }] }];
    const models = await h.executionDeps.resolveTeamModelSnapshots('p1', { teamId: 'team1', slots: [{ initialTask: '' }, { initialTask: '' }] });
    expect(models[0]).toMatchObject({ slotId: '0:w:0', label: 'Exact QA' });
    const admission = await h.executionDeps.admissionInput('p1', { teamId: 'team1', slots: [{ initialTask: '' }, { initialTask: '' }], resolvedModels: models.map((model: any) => ({ ...model, label: 'caller-forged' })) });
    expect(admission.slotRoutes[0]).toMatchObject({ slotId: '0:w:0', label: 'Exact QA' });
  });

  it('expires preview tokens, denies settings drift and replay', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'token-retention-'));
    try {
      initializeRepo(dir);
      h.projects = [{ id: 'p1', path: dir, name: 'Repo' }];
      const input = { teamId: 'team1', projectId: 'p1', goal: 'retention', coordinationMode: 'freeform' as const };
      const preview = await host.resolveSquadComposerPreview(input, { kind: 'window', windowId: 7 });
      const now = Date.now();
      const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 5 * 60_000 + 1);
      expect(await host.startTeamJobFromUi({ ...input, previewToken: preview.previewToken }, { windowId: 7 })).toMatchObject({ ok: false, code: 'LAUNCH_CHANGED' });
      clock.mockRestore();
      const settingsPreview = await host.resolveSquadComposerPreview(input, { kind: 'window', windowId: 7 });
      h.teams[0].push = true;
      expect(await host.startTeamJobFromUi({ ...input, previewToken: settingsPreview.previewToken }, { windowId: 7 })).toMatchObject({ ok: false, code: 'LAUNCH_CHANGED' });
      h.teams[0].push = false;
      const fresh = await host.resolveSquadComposerPreview(input, { kind: 'window', windowId: 7 });
      vi.spyOn(SquadExecutionService.prototype, 'start').mockResolvedValue({ ok: true, value: { id: 'token-ok', state: 'RUNNING' } } as never);
      expect(await host.startTeamJobFromUi({ ...input, previewToken: fresh.previewToken }, { windowId: 7 })).toMatchObject({ ok: true });
      expect(await host.startTeamJobFromUi({ ...input, previewToken: fresh.previewToken }, { windowId: 7 })).toMatchObject({ ok: false, code: 'LAUNCH_CHANGED' });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it.each(['nonGit', 'quick', 'detached'])('previews no-declaration %s launches without inventing a branch', async kind => {
    const dir = mkdtempSync(join(tmpdir(), 'legacy-preview-'));
    try {
      if (kind !== 'nonGit') initializeRepo(dir);
      if (kind === 'detached') execFileSync('git', ['-C', dir, 'checkout', '--detach']);
      h.projects = [{ id: 'p1', path: dir, name: 'Repo', ...(kind === 'quick' ? { quickAgent: true } : {}) }];
      const preview = await host.resolveSquadComposerPreview({ teamId: 'team1', projectId: 'p1', goal: 'Needs attended plan correction', coordinationMode: 'structured' }, { kind: 'window', windowId: 7 });
      expect(preview).toMatchObject({ location: { kind: 'project-root' }, path: realpathSync(dir), previewToken: expect.any(String) });
      if (kind !== 'quick') expect(preview.branch).toBeUndefined();
      const start = vi.spyOn(SquadExecutionService.prototype, 'start').mockResolvedValue({ ok: true, value: { id: 'correction', state: 'RUNNING' } } as never);
      expect(await host.startTeamJobFromUi({ teamId: 'team1', projectId: 'p1', goal: 'Needs attended plan correction', coordinationMode: 'structured', previewToken: preview.previewToken }, { windowId: 7 })).toMatchObject({ ok: true });
      expect(start.mock.calls[0]?.[2]).toMatchObject({ coordinationMode: 'structured', slots: [expect.objectContaining({ initialTask: expect.stringContaining('no executable steps found') })] });
      expect(start.mock.calls[0]?.[2]).not.toHaveProperty('workUnits');
      await expect(host.resolveSquadComposerPreview({ teamId: 'team1', projectId: 'p1', goal: 'go', worktree: true }, { kind: 'window', windowId: 7 })).rejects.toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('projects implicit isolation on a non-Git checkout as the project root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nongit-isolation-preview-'));
    try {
      h.config = { worktreeIsolationDefault: true };
      h.projects = [{ id: 'p1', path: dir, name: 'NonGit' }];
      await expect(host.resolveSquadComposerPreview({ teamId: 'team1', projectId: 'p1', goal: 'go', coordinationMode: 'freeform' }, { kind: 'window', windowId: 7 }))
        .resolves.toMatchObject({ location: { kind: 'project-root' }, path: realpathSync(dir) });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('binds preview token to trusted window and input, denies root HEAD drift before start', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bound-preview-'));
    try {
      initializeRepo(dir);
      h.projects = [{ id: 'p1', path: dir, name: 'Repo' }];
      const input = { teamId: 'team1', projectId: 'p1', goal: 'go', coordinationMode: 'freeform' as const };
      const preview = await host.resolveSquadComposerPreview(input, { kind: 'window', windowId: 7 });
      expect(preview.previewToken).toEqual(expect.any(String));
      const start = vi.spyOn(SquadExecutionService.prototype, 'start').mockResolvedValue({ ok: true, value: { id: 'token-launch', state: 'RUNNING' } } as never);
      await expect(host.startTeamJobFromUi({ ...input, previewToken: preview.previewToken }, { windowId: 8 })).resolves.toMatchObject({ ok: false, code: 'LAUNCH_CHANGED' });
      await expect(host.startTeamJobFromUi({ ...input, goal: 'other', previewToken: preview.previewToken }, { windowId: 7 })).resolves.toMatchObject({ ok: false, code: 'LAUNCH_CHANGED' });
      execFileSync('git', ['-C', dir, 'commit', '--allow-empty', '-m', 'head changed']);
      await expect(host.startTeamJobFromUi({ ...input, previewToken: preview.previewToken }, { windowId: 7 })).resolves.toMatchObject({ ok: false, code: 'LAUNCH_CHANGED' });
      expect(start).not.toHaveBeenCalled();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('sanitizes unexpected preview revalidation errors before returning them to the renderer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'preview-error-'));
    try {
      initializeRepo(dir);
      h.projects = [{ id: 'p1', path: dir, name: 'Repo' }];
      const input = { teamId: 'team1', projectId: 'p1', goal: 'go', coordinationMode: 'freeform' as const };
      const preview = await host.resolveSquadComposerPreview(input, { kind: 'window', windowId: 7 });
      rmSync(dir, { recursive: true, force: true });
      await expect(host.startTeamJobFromUi({ ...input, previewToken: preview.previewToken }, { windowId: 7 }))
        .resolves.toEqual({ ok: false, code: 'LAUNCH_CHANGED', message: 'Launch preview changed. Prepare the launch again.' });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('evicts old opaque tokens at bounded retention cap', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'token-cap-'));
    try {
      h.projects = [{ id: 'p1', path: dir, name: 'NonGit' }];
      const input = { teamId: 'team1', projectId: 'p1', goal: 'first', coordinationMode: 'freeform' as const };
      const first = await host.resolveSquadComposerPreview(input, { kind: 'window', windowId: 7 });
      for (let index = 0; index < 200; index++) await host.resolveSquadComposerPreview({ ...input, goal: `later ${index}` }, { kind: 'window', windowId: 7 });
      expect(await host.startTeamJobFromUi({ ...input, previewToken: first.previewToken }, { windowId: 7 })).toMatchObject({ ok: false, code: 'LAUNCH_CHANGED' });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 30_000);
  it('repeated composer previews preserve attached capability IDs for subsequent launch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'preview-capability-host-'));
    try {
      initializeRepo(dir);
      h.projects = [{ id: 'p1', path: dir, name: 'Repo' }];
      const path = join(dir, 'plan.md');
      writeFileSync(path, '## Launch\n- push: true\n## Execution Plan\n### read: Read <!-- executable-step -->\n- Mode: Read-only\n- Work: Read\n- Verification: Read');
      const selected = await h.executionDeps.sources.issue({ windowId: 7, projectId: 'p1', paths: [path] });
      const input = { teamId: 'team1', projectId: 'p1', goal: 'Follow attached plan', coordinationMode: 'structured' as const, sourceCapabilityIds: selected.map((view: any) => view.id) };
      const first = await host.resolveSquadComposerPreview(input, { kind: 'window', windowId: 7 });
      expect(await host.resolveSquadComposerPreview(input, { kind: 'window', windowId: 7 })).toEqual(first);
      expect(first.resolvedLaunch.push).toEqual({ value: true, source: 'plan' });
      const named = { ...input, goal: 'Follow @plan.md', sourceCapabilityIds: [] };
      expect((await host.resolveSquadComposerPreview(named, { kind: 'window', windowId: 7 })).fingerprint).toBe(first.fingerprint);
      expect((await host.resolveSquadComposerPreview(named, { kind: 'window', windowId: 7 })).fingerprint).toBe(first.fingerprint);
      await expect(host.resolveSquadComposerPreview(named, { kind: 'shared-owner' })).rejects.toThrow('trusted window');
      await expect(host.resolveSquadComposerPreview(input, { kind: 'window', windowId: 8 })).rejects.toThrow('another');
      await expect(host.resolveSquadComposerPreview({ ...input, sourceCapabilityIds: ['missing'] }, { kind: 'window', windowId: 7 })).rejects.toThrow('invalid');
      const start = vi.spyOn(SquadExecutionService.prototype, 'start').mockResolvedValue({ ok: true, value: { id: 'preview-launch', state: 'RUNNING' } } as never);
      expect(await host.startTeamJobFromUi({ ...input, previewToken: first.previewToken }, { windowId: 7 })).toMatchObject({ ok: true });
      expect(start.mock.calls[0]?.[2]).toMatchObject({ planLaunch: { push: true } });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('previews composer options through trusted host resolver and refuses shared source capabilities', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'composer-host-preview-'));
    try {
      initializeRepo(dir);
      h.projects = [{ id: 'p1', path: dir, name: 'Repo' }];
      const input = { teamId: 'team1', projectId: 'p1', goal: 'go', coordinationMode: 'freeform' as const, worktree: true, push: false };
      expect(await host.resolveSquadComposerPreview(input, { kind: 'shared-owner' })).toMatchObject({ resolvedLaunch: { worktree: { value: true, source: 'launch' } }, location: { kind: 'new-worktree' } });
      await expect(host.resolveSquadComposerPreview({ ...input, sourceCapabilityIds: ['caller'] }, { kind: 'shared-owner' })).rejects.toThrow('trusted window');
      await expect(host.resolveSquadComposerPreview({ ...input, coordinationMode: 'structured' }, { kind: 'shared-owner' })).rejects.toThrow('no executable');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('runs the frozen command after Settings mutation and refuses unbound cwd', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'frozen-host-check-'));
    try {
      initializeRepo(dir);
      h.projects = [{ id: 'p1', path: dir, name: 'Repo' }];
      await host.namedChecksSettings.set({ kind: 'global' }, [{ name: 'test', command: 'printf global' }]);
      await host.namedChecksSettings.set({ kind: 'project', projectId: 'p1' }, [{ name: 'test', command: 'printf frozen' }]);
      const resolvedChecks = await host.resolveSquadNamedChecks('p1', ['check:test']);
      expect(resolvedChecks).toEqual([{ reference: 'check:test', name: 'test', command: 'printf frozen' }]);
      await host.namedChecksSettings.set({ kind: 'project', projectId: 'p1' }, [{ name: 'test', command: 'printf edited' }]);
      const record = { projectId: 'p1', resolvedChecks } as never;
      expect(await host.runSquadNamedCheck(record, 'check:test')).toMatchObject({ status: 'passed', output: 'frozen', untrusted: true });
      const worktree = join(realpathSync(dir), '.worktrees', 'check');
      execFileSync('git', ['-C', dir, 'worktree', 'add', '-b', 'check', worktree]);
      expect(await host.runSquadNamedCheck({ ...record as any, squadWorktree: { path: worktree, branch: 'check' } }, 'check:test')).toMatchObject({ status: 'passed', output: 'frozen' });
      await expect(host.runSquadNamedCheck({ ...record as any, squadWorktree: { path: worktree, branch: 'wrong' } }, 'check:test')).rejects.toThrow('branch changed');
      await expect(host.runSquadNamedCheck({ ...record as any, squadWorktree: { path: `${worktree}/../check`, branch: 'check' } }, 'check:test')).rejects.toThrow('changed');
      expect(await host.runSquadNamedCheck({ ...record as any, request: { target: { kind: 'worktree', branch: 'check' } }, squadWorktree: { path: worktree, branch: 'check', ownership: 'user', targetKind: 'worktree' } }, 'check:test')).toMatchObject({ status: 'passed' });
      await host.namedChecksSettings.set({ kind: 'project', projectId: 'p1' }, []);
      expect(await host.resolveSquadNamedChecks('p1', ['check:test'])).toMatchObject([{ command: 'printf global' }]);
      expect(await h.executionDeps.listNamedCheckNames('p1')).toEqual(['test']);
      expect(h.executionDeps.resolveNamedChecks).toBe(host.resolveSquadNamedChecks);
      expect(h.executionDeps.runNamedCheck).toBe(host.runSquadNamedCheck);
      expect(h.executionDeps.resolveLaunchOptions).toBe(host.resolveSquadLaunchOptions);
      await expect(host.runSquadNamedCheck(record, 'check:missing')).rejects.toThrow('not frozen');
      await expect(host.resolveSquadNamedChecks('p1', ['check:missing'])).rejects.toThrow('Unknown check');
      await expect(host.resolveSquadNamedChecks('p1', ['caller command'])).rejects.toThrow('Invalid check');
      await expect(host.namedChecksSettings.get({ kind: 'project', projectId: 'missing' })).rejects.toThrow('not registered');
      await expect(host.runSquadNamedCheck({ ...record as any, squadWorktree: { path: realpathSync(h.root), branch: 'main' } }, 'check:test')).rejects.toThrow('not authorized');
      h.projects[0].remote = { host: 'remote' };
      await expect(host.runSquadNamedCheck(record, 'check:test')).rejects.toThrow('unavailable');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('projects trusted root/generated/user-target previews and detects bad sources', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'preview-host-'));
    try {
      initializeRepo(dir);
      h.projects = [{ id: 'p1', path: dir, name: 'Repo' }];
      const input = { teamId: 'team1', projectId: 'p1', planning: 'infer' as const, goal: 'go', sourcePaths: [], attachments: [], launchOptions: {} };
      expect(await host.resolveSquadLaunchPreview(input)).toMatchObject({ location: { kind: 'project-root' }, branch: 'main' });
      expect(await host.resolveSquadLaunchPreview({ ...input, launchOptions: { worktree: true } })).toMatchObject({ location: { kind: 'new-worktree', baseBranch: 'main', isolationSource: 'launch' } });
      execFileSync('git', ['-C', dir, 'worktree', 'add', '-b', 'feature', join(dir, 'checkout')]);
      expect(await host.resolveSquadLaunchPreview({ ...input, launchOptions: { target: { kind: 'worktree', branch: 'feature' } } })).toMatchObject({ location: { kind: 'worktree', ownership: 'user', branch: 'feature' }, branch: 'feature' });
      expect(await host.resolveSquadLaunchPreview({ ...input, launchOptions: { target: { kind: 'project-root' } } })).toMatchObject({ location: { kind: 'project-root' }, branch: 'main' });
      await expect(host.resolveSquadLaunchPreview({ ...input, sourcePaths: [join(dir, 'missing')] })).rejects.toThrow('does not exist');
      await expect(host.resolveSquadLaunchPreview({ ...input, planning: 'provided' })).rejects.toThrow('no executable');
      writeFileSync(join(dir, 'plan.md'), '### read: Read <!-- executable-step -->\n- Mode: Read-only\n- Work: Read\n- Verification: Read');
      expect(await host.resolveSquadLaunchPreview({ ...input, planning: 'provided', sourcePaths: [join(dir, 'plan.md')] })).toMatchObject({ location: { kind: 'project-root' } });
      expect(await host.resolveSquadLaunchPreview({ ...input, planning: 'provided', attachments: [{ name: 'plan.md', text: '## Launch\n- push: true\n## Execution Plan\n### read: Read <!-- executable-step -->\n- Mode: Read-only\n- Work: Read\n- Verification: Read' }] })).toMatchObject({ resolvedLaunch: { push: { value: true, source: 'plan' } } });
      h.projects[0].remote = { host: 'remote' };
      expect(await host.resolveSquadLaunchPreview(input)).toMatchObject({ location: { kind: 'project-root' }, path: dir });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('exports trusted claim resolver and preserves launch vs plan precedence', async () => {
    h.projects = [{ id: 'p1', path: h.root, name: 'Repo' }];
    h.teams = [{ id: 'team1', worktreeIsolation: true, worktreeOnComplete: 'delete', push: true }];
    const resolve = (host as any).resolveSquadLaunchOptions;
    expect(resolve).toBeTypeOf('function');
    await expect(resolve('missing', { teamId: 'team1' })).rejects.toThrow('not registered');
    await expect(resolve('p1', { teamId: 'missing' })).rejects.toThrow('not found');
    expect(await resolve('p1', { teamId: 'team1', push: false, planLaunch: { onComplete: 'merge' } })).toMatchObject({
      worktree: { value: true, source: 'squad' },
      push: { value: false, source: 'launch' },
      onComplete: { value: 'merge', source: 'plan' }
    });
  });
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

describe('squad_plan_check tier fit (host planTierFit)', () => {
  type Check = (route: { projectId: string }, input: { text: string; teamId?: string }) => Promise<any>;
  const checkPlan = () => (host.squadProposalMcpDeps() as { checkSquadPlan: Check }).checkSquadPlan;
  const PLAN = `## Execution Plan

### only-step: Do it <!-- executable-step -->

- **Depends on:** None
- **Execution class:** Routine
- **Mode:** Mutating
- **Read scope:** None
- **Write scope:** \`a.txt\`
- **Excludes:** None
- **Work:** Write a.txt.
- **Verification:** Read a.txt.
- **Outputs / handoff:** Content.
`;
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
  const knownTeam = (workerModel: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'squad-host-tier-'));
    dirs.push(dir);
    initializeRepo(dir);
    h.projects = [{ id: 'p1', name: 'Proj', path: dir }];
    h.teams = [{ id: 'team1', name: 'Team', orchestratorPersonaId: 'orch', slots: [{ personaId: 'worker', quantity: 1 }] }];
    h.personas = [{ id: 'orch', name: 'Orch', baseProfile: 'claude' }, { id: 'worker', name: 'Worker', baseProfile: 'claude', model: workerModel }];
  };

  it('adds no tierFit for an unknown team id', async () => {
    const result = await checkPlan()({ projectId: 'p1' }, { text: PLAN, teamId: 'ghost' });
    expect(result).toMatchObject({ ok: true, value: { ok: true } });
    expect(result.value).not.toHaveProperty('tierFit');
  });

  it('adds no tierFit without a teamId', async () => {
    knownTeam('opus');
    const result = await checkPlan()({ projectId: 'p1' }, { text: PLAN });
    expect(result).toMatchObject({ ok: true, value: { ok: true } });
    expect(result.value).not.toHaveProperty('tierFit');
  });

  it('flags an over-tiered unit against a known Squad roster while the check stays ok', async () => {
    knownTeam('opus');
    const result = await checkPlan()({ projectId: 'p1' }, { text: PLAN, teamId: 'team1' });
    expect(result).toMatchObject({ ok: true, value: { ok: true, tierFit: { findings: [{ unitId: 'only-step', kind: 'over-tiered' }] } } });
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
    initializeRepo(dir);
    h.projects = [{ id: 'p1', name: 'Proj', path: dir }];
    return dir;
  };
  afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  it('proposes, reviews, dismisses and launches through the real stores', async () => {
    const dir = projectDir();
    h.sessions.set('s1', pty());
    h.teams = [{ id: 'team1', name: 'Team', orchestratorPersonaId: 'orch', slots: [{ personaId: 'worker', quantity: 1 }] }];
    h.personas = [{ id: 'orch', name: 'Orch', baseProfile: 'claude' }, { id: 'worker', name: 'Worker', baseProfile: 'claude' }];
    for (const store of h.executionStores) vi.spyOn(store, 'getInProject').mockImplementation(async (_projectId: string, id: string) => ({ id, projectId: 'p1', resolvedLaunch: resolveAllLaunch({}) }) as never);
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

  it('retires the run plan handoff after every terminal transition, even when the lifecycle throws', async () => {
    const lifecycle = vi.spyOn(host.squadWorktreeRuntime, 'handleSquadWorktreeTerminal')
      .mockResolvedValueOnce('merged')
      .mockRejectedValueOnce(new Error('git failed'));
    const report = vi.spyOn(host.squadProposalNotifier, 'onTerminal').mockResolvedValue(undefined);
    // The retirement re-reads the run from main's store for its project before deciding.
    const reads = h.executionStores.map((created) => vi.spyOn(created, 'getInProject').mockResolvedValue(undefined));
    const retiredFor = () => reads.flatMap((spy) => spy.mock.calls);
    try {
      await host.handleSquadTerminalWithReport({ ...record('pty'), state: 'COMPLETED' } as never);
      await vi.waitFor(() => expect(retiredFor()).toContainEqual(['p1', 'exec-1']));
      reads.forEach((spy) => spy.mockClear());
      await expect(host.handleSquadTerminalWithReport({ ...record('pty'), state: 'STOPPED' } as never)).rejects.toThrow('git failed');
      await vi.waitFor(() => expect(retiredFor()).toContainEqual(['p1', 'exec-1']));
    } finally {
      lifecycle.mockRestore();
      report.mockRestore();
      reads.forEach((spy) => spy.mockRestore());
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
  it.each(['nonGit', 'detached'])('returns successful %s root receipt without branch', async kind => {
    const start = setup();
    const dir = h.projects[0].path;
    if (kind === 'nonGit') rmSync(join(dir, '.git'), { recursive: true, force: true });
    else execFileSync('git', ['-C', dir, 'checkout', '--detach']);
    expect(await host.squadProposalService.launchSquadNow(route, { ...input, goal: `root ${kind}` })).toMatchObject({ ok: true, value: { location: { kind: 'project-root' }, path: realpathSync(dir) } });
    expect(start).toHaveBeenCalledOnce();
  });
  it('sends reviewed non-Git isolation fallback through worktree preparation', async () => {
    setup();
    h.config = { worktreeIsolationDefault: true };
    rmSync(join(h.projects[0].path, '.git'), { recursive: true, force: true });
    const prepare = vi.spyOn(host.squadWorktreeRuntime, 'prepareSquadWorktree').mockImplementation(async record => record as never);
    vi.spyOn(SquadExecutionService.prototype, 'start').mockImplementation(async (_owner, projectId, request: any) => {
      const resolvedLaunch = await host.resolveSquadLaunchOptions(projectId as string, request);
      const record = { id: 'non-git-isolation', projectId, teamId: 'team1', teamLaunchRequestId: request.launchRequestId, request, stateVersion: 1, resolvedLaunch };
      await h.executionDeps.prepareSquadWorktree(record, request);
      return { ok: true, value: { id: record.id, state: 'RUNNING' } } as never;
    });

    expect(await host.squadProposalService.launchSquadNow(route, { ...input, goal: 'non-Git isolation fallback' })).toMatchObject({
      ok: true,
      value: { location: { kind: 'project-root' }, path: realpathSync(h.projects[0].path) }
    });
    expect(prepare).toHaveBeenCalledOnce();
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({
      id: 'non-git-isolation',
      resolvedLaunch: expect.objectContaining({ worktree: expect.objectContaining({ value: true }) })
    }), expect.anything(), undefined);
  });
  it('preserves remote proposal now/review with locally staged plan sources', async () => {
    const start = setup();
    const sourceDir = mkdtempSync(join(tmpdir(), 'remote-proposal-source-'));
    dirs.push(sourceDir);
    const path = join(sourceDir, 'remote-proposal-plan.md');
    writeFileSync(path, '## Launch\n- worktree: false\n- push: false\n## Execution Plan\n### read: Read <!-- executable-step -->\n- Mode: Read-only\n- Work: Read\n- Verification: Read');
    h.projects[0] = { id: 'p1', name: 'Remote', path: '/registered/remote/checkout', remote: { host: 'registered-ssh' } };
    h.config.cloneRoot = sourceDir;
    const supplied = { ...input, goal: 'Read staged plan', planning: 'provided' as const, sources: [path] };
    expect(await host.squadProposalService.launchSquadNow(route, supplied)).toMatchObject({ ok: true, value: { path: h.projects[0].path, location: { kind: 'project-root' } } });
    expect(start.mock.calls[0]?.[2]).toMatchObject({ planLaunch: { worktree: false, push: false } });
    const proposed = await host.squadProposalService.propose(route, { ...supplied, title: 'Remote review', summary: 'Review staged plan' });
    expect(proposed).toMatchObject({ ok: true });
    if (!proposed.ok) return;
    const reviewed = await host.squadProposalService.review(7, proposed.value.proposalId, () => true);
    expect(reviewed).toMatchObject({ ok: true });
    if (!reviewed.ok) return;
    const launched = await host.startTeamJobFromUi({ ...reviewed.value, sourceCapabilityIds: reviewed.value.sources.map(source => source.id), projectId: 'p1', teamId: 'team1', coordinationMode: 'structured', proposalId: proposed.value.proposalId }, { windowId: 7 });
    expect(launched).toEqual(expect.objectContaining({ ok: true }));
    expect(start).toHaveBeenCalledTimes(2);
    expect(h.remoteLocalIo).toEqual([]);
  });
  it('rejects generated preview fallback after claim before cohort spawn', async () => {
    const start = setup();
    start.mockImplementation(async (_owner, projectId, request: any) => {
      const resolvedLaunch = await host.resolveSquadLaunchOptions(projectId as string, request);
      const record = { id: 'generated-binding', projectId, teamId: 'team1', teamLaunchRequestId: request.launchRequestId, request, stateVersion: 1, resolvedLaunch };
      vi.spyOn(host.squadWorktreeRuntime, 'prepareSquadWorktree').mockResolvedValue(record as never);
      await expect(h.executionDeps.prepareSquadWorktree(record, request)).rejects.toThrow('not created');
      return { ok: false, code: 'INVALID', message: 'binding tested' } as never;
    });
    expect(await host.squadProposalService.launchSquadNow(route, { ...input, goal: 'generated test', launchOptions: { worktree: true } })).toMatchObject({ ok: false });
  });
  it('rejects target drift between preview validation and claim resolver', async () => {
    const start = setup();
    start.mockImplementation(async (_owner, projectId, request) => {
      execFileSync('git', ['-C', h.projects[0].path, 'checkout', '-b', 'drifted']);
      await expect(host.resolveSquadLaunchOptions(projectId as string, request as never)).rejects.toThrow('changed before claim');
      return { ok: false, code: 'INVALID', message: 'target drift' } as never;
    });
    expect(await host.squadProposalService.launchSquadNow(route, { ...input, goal: 'drift test' })).toMatchObject({ ok: false });
    expect(start).toHaveBeenCalledOnce();
  });
  it('checks prepared target binding before cohort spawn', async () => {
    const start = setup();
    start.mockImplementation(async (_owner, projectId, request: any) => {
      const resolvedLaunch = await host.resolveSquadLaunchOptions(projectId as string, request);
      const record = { id: 'binding-test', projectId, teamId: 'team1', teamLaunchRequestId: request.launchRequestId, request, stateVersion: 1, resolvedLaunch };
      const prepare = vi.spyOn(host.squadWorktreeRuntime, 'prepareSquadWorktree').mockResolvedValue({ ...record, squadWorktree: { path: '/other', branch: 'main', ownership: 'user', targetKind: 'project-root' } } as never);
      await expect(h.executionDeps.prepareSquadWorktree(record, request)).rejects.toThrow('after claim');
      prepare.mockResolvedValue(record as never);
      expect(await h.executionDeps.prepareSquadWorktree(record, request)).toBe(record);
      return { ok: false, code: 'INVALID', message: 'binding tested' } as never;
    });
    expect(await host.squadProposalService.launchSquadNow(route, { ...input, goal: 'binding test' })).toMatchObject({ ok: false });
  });

  it('returns prepared managed/user worktree location from actual record', async () => {
    setup();
    const dir = h.projects[0].path;
    for (const store of h.executionStores) vi.spyOn(store, 'getInProject').mockResolvedValue({
      id: 'actual', projectId: 'p1', resolvedLaunch: resolveAllLaunch({ launch: { worktree: true } }),
      squadWorktree: { path: dir, branch: 'main', baseBranch: 'main' }
    } as never);
    expect(await host.squadProposalService.launchSquadNow(route, { ...input, goal: 'managed receipt', launchOptions: { worktree: true } })).toMatchObject({ ok: true, value: { location: { kind: 'new-worktree' }, branch: 'main' } });
    for (const store of h.executionStores) vi.spyOn(store, 'getInProject').mockResolvedValue({
      id: 'actual', projectId: 'p1', resolvedLaunch: resolveAllLaunch({}),
      squadWorktree: { path: dir, branch: 'main', ownership: 'user', targetKind: 'project-root' }
    } as never);
    expect(await host.squadProposalService.launchSquadNow(route, { ...input, goal: 'user receipt', launchOptions: { target: { kind: 'project-root' } } })).toMatchObject({ ok: true, value: { location: { kind: 'project-root' }, branch: 'main' } });
  });
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
  const route = { projectId: 'p1', sessionId: 's1' };
  const input = { teamId: 'team1', goal: 'Do the thing', planning: 'infer' as const };
  const setup = () => {
    const dir = mkdtempSync(join(tmpdir(), 'squad-now-project-'));
    dirs.push(dir);
    initializeRepo(dir);
    h.projects = [{ id: 'p1', name: 'Proj', path: dir }];
    h.sessions.set('s1', pty());
    h.teams = [{ id: 'team1', name: 'Team', orchestratorPersonaId: 'orch', slots: [{ personaId: 'worker', quantity: 1 }] }];
    h.personas = [{ id: 'orch', name: 'Orch', baseProfile: 'claude' }, { id: 'worker', name: 'Worker', baseProfile: 'claude' }];
    for (const store of h.executionStores) vi.spyOn(store, 'getInProject').mockImplementation(async (_projectId: string, id: string) => ({ id, projectId: 'p1', resolvedLaunch: resolveAllLaunch({}) }) as never);
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

describe('named-check host shutdown', () => {
  it('awaits cancellation/capture cleanup and rejects future checks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'check-shutdown-host-'));
    try {
      h.projects = [{ id: 'p1', path: dir, name: 'Repo' }];
      const record = { projectId: 'p1', resolvedChecks: [{ reference: 'check:slow', name: 'slow', command: 'sleep 30' }] } as never;
      const pending = host.runSquadNamedCheck(record, 'check:slow');
      await new Promise(resolve => setTimeout(resolve, 50));
      await host.disposeSquadNamedChecks();
      expect(await pending).toMatchObject({ status: 'cancelled' });
      await expect(host.runSquadNamedCheck(record, 'check:slow')).rejects.toThrow('closed');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
