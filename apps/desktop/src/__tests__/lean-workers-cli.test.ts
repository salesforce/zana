import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';

const h = vi.hoisted(() => ({
  root: (require('node:fs') as typeof import('node:fs')).mkdtempSync(
    require('node:path').join(require('node:os').tmpdir(), 'lean-workers-cli-')
  ),
  teams: [] as any[],
  resolve: vi.fn()
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
// Real resolver and provider mapping; only the injected-skill catalog read is stubbed.
vi.mock('@zana-ai/zcc-server/services/skills/injected-skill-entries', () => ({
  listInjectedSkillEntries: () => [{ id: 'zcc:acme/zcc-inbox', name: 'zcc-inbox' }, { id: 'zcc:acme/other', name: 'other' }]
}));
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

const local: any = { id: 'proj', path: '/tmp/p' };
const run = (persona: any, cohort?: { teamId: string; role?: string }) =>
  resolveCliSkillSettings({ profile: 'claude', req: { projectId: 'proj', ...(cohort ? { cohort } : {}) }, project: local, config: {}, persona, cwd: '/tmp/p' } as any);

beforeEach(() => {
  h.teams.length = 0;
  h.resolve.mockReset().mockResolvedValue({ bestEffortPlugins: [], disabledMixedPlugins: [] });
});

describe('leanWorkers on the Claude CLI path (real resolver)', () => {
  it('lean team: a worker with unset skills is restricted to zcc-inbox', async () => {
    h.teams.push({ id: 't1', leanWorkers: true });
    await run({ id: 'w' }, { teamId: 't1', role: 'worker' });
    expect(h.resolve).toHaveBeenCalledWith(expect.objectContaining({ allowlist: ['zcc-inbox'] }));
  });
  it('lean team: the orchestrator is unrestricted (no inventory read)', async () => {
    h.teams.push({ id: 't1', leanWorkers: true });
    expect(await run({ id: 'o' }, { teamId: 't1', role: 'orchestrator' })).toBeUndefined();
    expect(h.resolve).not.toHaveBeenCalled();
  });
  it('lean team: a persona with explicit skills keeps them plus zcc-inbox', async () => {
    h.teams.push({ id: 't1', leanWorkers: true });
    await run({ id: 'w', skills: ['foo'] }, { teamId: 't1', role: 'worker' });
    const allowlist = h.resolve.mock.calls[0]![0].allowlist as string[];
    expect([...allowlist].sort()).toEqual(['foo', 'zcc-inbox']);
  });
  it('lean off or no team: unrestricted', async () => {
    h.teams.push({ id: 't1' });
    expect(await run({ id: 'w' }, { teamId: 't1', role: 'worker' })).toBeUndefined();
    expect(await run({ id: 'w' })).toBeUndefined();
    expect(h.resolve).not.toHaveBeenCalled();
  });
});
