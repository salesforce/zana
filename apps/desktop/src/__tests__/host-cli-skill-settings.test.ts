import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const h = vi.hoisted(() => ({
  root: (require('node:fs') as typeof import('node:fs')).mkdtempSync(
    require('node:path').join(require('node:os').tmpdir(), 'host-cli-skill-')
  ),
  teams: [] as any[],
  selection: vi.fn(),
  allowlist: vi.fn(),
  resolve: vi.fn(),
  inboxAppend: vi.fn()
}));
vi.stubEnv('ZCC_DATA_DIR', h.root);
vi.stubEnv('ZCC_EXECUTION_STORE', 'json');
afterAll(() => rmSync(h.root, { recursive: true, force: true }));

vi.mock('@zana-ai/zcc-host-daemon/pty', () => ({
  PtyManager: class {
    setMcpBaseUrl() {} setProjectRoots() {} setRulesResolver() {}
    getSession() { return null; } list() { return []; } on() { return this; }
  },
  isClaudeProfile: (p: string) => p === 'claude'
}));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({
  store: {
    listProjects: () => [], getConfig: () => ({}), getProjectSettings: () => ({}),
    createScratchSubfolder: () => '/tmp/scratch', ensureRemoteProjectLocalDir: (p: unknown) => p
  },
  scratchWorkspaceRoot: () => '/tmp/scratch-root',
  worktreeRoot: () => '/tmp/zcc-worktrees',
  worktreeTargetDir: (_p: unknown, slug: string) => `/tmp/zcc-worktrees/${slug}`
}));
vi.mock('@zana-ai/zcc-server/services/agents/team-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zana-ai/zcc-server/services/agents/team-store')>();
  class FakeTeamStore extends actual.TeamStore {
    list() { return h.teams; } start() {} stop() {} refresh() {} rebindProjects() {}
  }
  return { ...actual, TeamStore: FakeTeamStore };
});
vi.mock('@zana-ai/zcc-server/services/agents/persona-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zana-ai/zcc-server/services/agents/persona-store')>();
  class FakePersonaStore extends actual.PersonaStore {
    list() { return []; } start() {} stop() {} refresh() {} rebindProjects() {}
  }
  return { ...actual, PersonaStore: FakePersonaStore };
});
vi.mock('@zana-ai/zcc-server/services/threads/persona-skill-selection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zana-ai/zcc-server/services/threads/persona-skill-selection')>();
  return { ...actual, resolvePersonaSkillSelection: h.selection, providerSkillAllowlist: h.allowlist };
});
vi.mock('@zana-ai/zcc-server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zana-ai/zcc-server')>();
  return {
    ...actual,
    createInboxStore: (...args: Parameters<typeof actual.createInboxStore>) => {
      const store = actual.createInboxStore(...args);
      const append = store.append.bind(store);
      store.append = ((input: any) => (h.inboxAppend.getMockImplementation() ? h.inboxAppend(input) : append(input))) as typeof store.append;
      return store;
    }
  };
});
vi.mock('@zana-ai/zcc-host-daemon/skill-allowlist-settings', () => ({ resolveSkillSettings: h.resolve }));
vi.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false },
  app: { on: () => {}, whenReady: () => new Promise(() => {}), getPath: () => h.root, setName: () => {}, requestSingleInstanceLock: () => true, quit: () => {} },
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

const { resolveCliSkillSettings } = await import('../host.js');

const persona: any = { id: 'p1', name: 'P', baseProfile: 'claude' };
const local: any = { id: 'proj', path: '/tmp/p' };
const base = (over: Record<string, unknown> = {}): any => ({
  profile: 'claude', req: { projectId: 'proj' }, project: local, config: {}, persona, cwd: '/tmp/p', ...over
});

beforeEach(() => {
  h.teams.length = 0;
  h.selection.mockReset().mockReturnValue({ automatedSkillIds: ['zcc:o/a'], allowedSkillNames: ['b'] });
  h.allowlist.mockReset().mockReturnValue(['a', 'b']);
  h.resolve.mockReset().mockResolvedValue({ disabledMixedPlugins: [], bestEffortPlugins: [] });
  h.inboxAppend.mockReset();
});

describe('resolveCliSkillSettings', () => {
  it('returns undefined without a persona or for non-Claude profiles', async () => {
    expect(await resolveCliSkillSettings(base({ persona: undefined }))).toBeUndefined();
    expect(await resolveCliSkillSettings(base({ profile: 'shell' }))).toBeUndefined();
    expect(h.selection).not.toHaveBeenCalled();
  });
  it('non-Claude CLI profile with a restricted persona: unenforced notice, still undefined', async () => {
    h.inboxAppend.mockResolvedValue({ id: 'e2' });
    const restricted: any = { ...persona, skills: [] };
    expect(await resolveCliSkillSettings(base({ profile: 'codex', persona: restricted }))).toBeUndefined();
    expect(h.inboxAppend).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Skill restriction not enforced',
      dedupeKey: 'skill-restriction-unsupported:proj:p1:codex',
      comments: expect.stringContaining('codex agent does not support skill restriction')
    }));
    expect(h.resolve).not.toHaveBeenCalled();
  });
  it('non-Claude profile: no notice for unrestricted persona or shell', async () => {
    await resolveCliSkillSettings(base({ profile: 'codex' }));
    await resolveCliSkillSettings(base({ profile: 'shell', persona: { ...persona, skills: [] } }));
    expect(h.inboxAppend).not.toHaveBeenCalled();
  });
  it('non-Claude notice: inbox failure is logged, launch unaffected', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.inboxAppend.mockRejectedValue(new Error('disk full'));
    expect(await resolveCliSkillSettings(base({ profile: 'codex', persona: { ...persona, skills: ['a'] } }))).toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(err).toHaveBeenCalledWith(expect.stringContaining('cli skill allowlist unsupported inbox'));
    err.mockRestore();
  });
  it('returns undefined when the persona has no allowlist (unrestricted)', async () => {
    h.allowlist.mockReturnValue(undefined);
    expect(await resolveCliSkillSettings(base())).toBeUndefined();
    expect(h.resolve).not.toHaveBeenCalled();
  });
  it('maps catalog ids and names through providerSkillAllowlist and resolves locally', async () => {
    const settings = { skillOverrides: { x: 'off' } };
    h.resolve.mockResolvedValue({ settings, disabledMixedPlugins: ['dm@m'], bestEffortPlugins: ['mx@m'] });
    expect(await resolveCliSkillSettings(base())).toBe(settings);
    expect(h.allowlist).toHaveBeenCalledWith(['zcc:o/a'], ['b']);
    expect(h.resolve).toHaveBeenCalledWith({ allowlist: ['a', 'b'], cwd: '/tmp/p' });
  });
  it('empty allowlist is passed through as restricted', async () => {
    h.allowlist.mockReturnValue([]);
    await resolveCliSkillSettings(base());
    expect(h.resolve).toHaveBeenCalledWith(expect.objectContaining({ allowlist: [] }));
  });
  it('lean worker: team and role come from the cohort, default role is worker', async () => {
    const team = { id: 't1' };
    h.teams.push(team);
    await resolveCliSkillSettings(base({ req: { projectId: 'proj', cohort: { teamId: 't1', role: 'lead' } } }));
    expect(h.selection).toHaveBeenLastCalledWith(expect.any(String), team, persona, 'lead');
    await resolveCliSkillSettings(base({ req: { projectId: 'proj', cohort: { teamId: 't1' } } }));
    expect(h.selection).toHaveBeenLastCalledWith(expect.any(String), team, persona, 'worker');
    await resolveCliSkillSettings(base({ req: { projectId: 'proj', cohort: { teamId: 'gone' } } }));
    expect(h.selection).toHaveBeenLastCalledWith(expect.any(String), undefined, persona, 'worker');
  });
  it('unreadable inventory logs an error and proceeds unrestricted', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.resolve.mockResolvedValue({ disabledMixedPlugins: [], bestEffortPlugins: [], unavailable: 'skill inventory unavailable on the execution host' });
    expect(await resolveCliSkillSettings(base())).toBeUndefined();
    expect(err).toHaveBeenCalledWith(expect.stringContaining('cli skill allowlist'));
    err.mockRestore();
  });
  it('unreadable inventory surfaces a visible inbox warning', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.inboxAppend.mockResolvedValue({ id: 'e1' });
    h.resolve.mockResolvedValue({ disabledMixedPlugins: [], bestEffortPlugins: [], unavailable: 'cannot read /x: EACCES' });
    expect(await resolveCliSkillSettings(base())).toBeUndefined();
    expect(h.inboxAppend).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'proj',
      comments: expect.stringContaining('Skill restriction skipped: skill inventory unreadable (cannot read /x: EACCES)'),
      dedupeKey: 'skill-restriction-skipped:proj:p1'
    }));
  });
  it('inbox failure is logged and does not break the launch', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.inboxAppend.mockRejectedValue(new Error('disk full'));
    h.resolve.mockResolvedValue({ disabledMixedPlugins: [], bestEffortPlugins: [], unavailable: 'u' });
    expect(await resolveCliSkillSettings(base())).toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(err).toHaveBeenCalledWith(expect.stringContaining('cli skill allowlist inbox'));
    err.mockRestore();
  });
  it('ssh-remote project resolves against the remote; remote-tool proxy stays local', async () => {
    const remote = { host: 'h', remotePath: '/r' };
    const project = { ...local, remote };
    await resolveCliSkillSettings(base({ project }));
    expect(h.resolve.mock.calls[0]![0].remote).toMatchObject({ host: 'h' });
    h.resolve.mockClear();
    await resolveCliSkillSettings(base({ project, req: { projectId: 'proj', remoteToolProxy: true }, config: { cliRemoteToolProxyEnabled: true } }));
    expect(h.resolve.mock.calls[0]![0].remote).toBeUndefined();
  });
});
