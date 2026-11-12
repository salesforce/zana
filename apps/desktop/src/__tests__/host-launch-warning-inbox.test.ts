import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const h = vi.hoisted(() => ({
  root: (require('node:fs') as typeof import('node:fs')).mkdtempSync(
    require('node:path').join(require('node:os').tmpdir(), 'host-launch-warning-')
  ),
  teams: [] as any[],
  selection: vi.fn(),
  allowlist: vi.fn(),
  resolve: vi.fn(),
  inboxAppend: vi.fn(),
  projects: [] as any[],
  personaList: [] as any[],
  onCalls: [] as any[]
}));
vi.stubEnv('ZCC_DATA_DIR', h.root);
vi.stubEnv('ZCC_EXECUTION_STORE', 'json');
afterAll(() => rmSync(h.root, { recursive: true, force: true }));

vi.mock('@zana-ai/zcc-host-daemon/pty', () => ({
  PtyManager: class {
    setMcpBaseUrl() {} setProjectRoots() {} setRulesResolver() {}
    getSession() { return null; } list() { return []; } on(...a: any[]) { h.onCalls.push(a); return this; }
  },
  isClaudeProfile: (p: string) => p === 'claude'
}));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({
  store: {
    listProjects: () => h.projects, getConfig: () => ({}), getProjectSettings: () => ({}),
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
    list() { return h.personaList; } start() {} stop() {} refresh() {} rebindProjects() {}
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

const { routeLaunchWarningToInbox } = await import('../host.js');

const warn = (over: Record<string, unknown> = {}): any => ({
  sessionId: 's1', projectId: 'proj', personaId: 'p1',
  warnings: [{ code: 'allowlisted-mcp-not-found', server: 'ghost', message: 'Allowlisted MCP server "ghost" was not found.' }],
  ...over
});

beforeEach(() => {
  h.projects = [{ id: 'proj', name: 'My Project', path: '/tmp/p' }];
  h.personaList = [{ id: 'p1', name: 'Reviewer' }];
  h.inboxAppend.mockReset().mockResolvedValue({ id: 'e1' });
});

describe('routeLaunchWarningToInbox', () => {
  it('is subscribed exactly once, inside wireBridgeListeners (app init, not createWindow)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../host.ts', import.meta.url), 'utf8');
    expect(src.match(/ptys\.on\('launchWarning'/g)).toHaveLength(1);
    const wire = src.indexOf('function wireBridgeListeners');
    const sub = src.indexOf("ptys.on('launchWarning'");
    const create = src.indexOf('function createWindow');
    expect(wire).toBeGreaterThan(-1);
    expect(sub).toBeGreaterThan(wire);
    expect(create === -1 || create < wire || create > sub).toBe(true);
  });
  it('appends one deduped inbox entry naming the persona and the warning', () => {
    routeLaunchWarningToInbox(warn());
    expect(h.inboxAppend).toHaveBeenCalledTimes(1);
    expect(h.inboxAppend).toHaveBeenCalledWith({
      projectId: 'proj',
      projectLabel: 'My Project',
      subject: 'MCP server allowlist not fully applied',
      comments: 'Persona "Reviewer": Allowlisted MCP server "ghost" was not found.',
      dedupeKey: 'mcp-allowlist-launch:proj:p1:allowlisted-mcp-not-found:ghost'
    });
  });
  it('falls back to the project id and omits the persona when unknown', () => {
    h.projects = [];
    routeLaunchWarningToInbox(warn({ personaId: undefined }));
    expect(h.inboxAppend).toHaveBeenCalledWith(expect.objectContaining({
      projectLabel: 'proj', comments: 'Allowlisted MCP server "ghost" was not found.',
      dedupeKey: 'mcp-allowlist-launch:proj:none:allowlisted-mcp-not-found:ghost'
    }));
    h.personaList = [];
    routeLaunchWarningToInbox(warn());
    expect(h.inboxAppend.mock.calls[1]![0].comments).not.toContain('Persona');
  });
  it('the dedupe fingerprint is order-independent across several warnings', () => {
    const a = { code: 'b', message: 'B' }, b = { code: 'a', server: 'x', message: 'A' };
    routeLaunchWarningToInbox(warn({ warnings: [a, b] }));
    routeLaunchWarningToInbox(warn({ warnings: [b, a] }));
    expect(h.inboxAppend.mock.calls[0]![0].dedupeKey).toBe(h.inboxAppend.mock.calls[1]![0].dedupeKey);
  });
  it('does nothing without warnings', () => {
    routeLaunchWarningToInbox(warn({ warnings: [] }));
    expect(h.inboxAppend).not.toHaveBeenCalled();
  });
  it('logs and swallows an inbox failure', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.inboxAppend.mockRejectedValue(new Error('disk full'));
    expect(() => routeLaunchWarningToInbox(warn())).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(err).toHaveBeenCalledWith(expect.stringContaining('mcp allowlist launch warning inbox'));
    err.mockRestore();
  });
});
