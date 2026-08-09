import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Project, AppConfig, ProjectSettings } from '../../shared/types.js';

/**
 * Main-path enforcement of the launch-arg denylist (A6). `createTerminalConfined`
 * is the SINGLE chokepoint shared by the `terminals:create` IPC handler AND the
 * `zcc` CLI control plane (control-plane.ts term.create -> createTerminal). It
 * must strip denied flags from the UNTRUSTED `req.extraArgs` before they reach
 * `ptys.create`, so no caller — renderer OR core — can bypass the denylist. The
 * renderer host.ts pass is advisory (toast only); THIS is the authority
 * (CLAUDE.md #1).
 *
 * We mock `./pty.js` to capture the exact `extraArgs` reaching `ptys.create`,
 * and `./store.js` to seed one project + config. `electron` is mocked so
 * importing index.ts (which registers app handlers and a whenReady bootstrap at
 * module scope) is side-effect-free in the test environment. `resolvePersonaLaunch`
 * (persona-store.js) runs for real so the prompt-positional wiring is exercised.
 */

const PROJECT: Project = {
  id: 'p1',
  name: 'Proj',
  path: '/tmp/proj'
} as Project;

const CONFIG: AppConfig = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
};

const PROJECT_SETTINGS: ProjectSettings = {} as ProjectSettings;

// Capture every ptys.create() call so we can assert what reaches the pty layer.
const createCalls: Array<{ extraArgs?: string[]; profile: string; persona: unknown }> = [];

vi.mock('../pty.js', () => {
  class PtyManager {
    setMcpBaseUrl() {}
    setProjectRoots() {}
    setRulesResolver() {}
    create(opts: { extraArgs?: string[]; profile: string; persona: unknown }) {
      createCalls.push({
        extraArgs: opts.extraArgs,
        profile: opts.profile,
        persona: opts.persona
      });
      return { id: `s${createCalls.length}` };
    }
    // createTerminalConfined's OpenCode spawn-time tab-namer trigger calls
    // ptys.getSession() right after create() — return null so fireTabNamer's
    // liveness check bails cleanly instead of throwing on a missing session.
    getSession() {
      return null;
    }
  }
  return {
    PtyManager,
    isClaudeProfile: (p: string) => p === 'claude'
  };
});

vi.mock('../store.js', () => ({
  store: {
    listProjects: () => [PROJECT],
    getConfig: () => CONFIG,
    getProjectSettings: () => PROJECT_SETTINGS,
    createScratchSubfolder: () => '/tmp/proj/scratch'
  },
  scratchWorkspaceRoot: () => '/tmp/scratch-root',
  worktreeRoot: () => '/tmp/zcc-worktrees',
  worktreeTargetDir: (_p: unknown, slug: string) => `/tmp/zcc-worktrees/${slug}`
}));

// index.ts registers app.on(...) and app.whenReady().then(bootstrap) at module
// scope. A never-resolving whenReady keeps bootstrap from running during import.
vi.mock('electron', () => ({
  // index.ts constructs the harness credential store at module scope, which
  // reads `safeStorage`; isEncryptionAvailable:false routes it to its plaintext
  // fallback so no encrypt/decrypt stub is needed.
  safeStorage: { isEncryptionAvailable: () => false },
  app: {
    on: () => {},
    whenReady: () => new Promise(() => {}),
    getPath: () => '/tmp',
    setName: () => {},
    requestSingleInstanceLock: () => true,
    quit: () => {}
  },
  BrowserWindow: class {
    static getAllWindows() {
      return [];
    }
    static getFocusedWindow() {
      return null;
    }
  },
  ipcMain: { handle: () => {}, on: () => {} },
  dialog: {},
  shell: {},
  screen: {},
  Menu: { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) },
  nativeImage: { createFromPath: () => ({}) },
  powerMonitor: { on: () => {} }
}));

// updater.ts pulls electron-updater which touches app.getVersion at import.
vi.mock('../updater.js', () => ({
  createUpdater: () => ({})
}));

// Avoid writing a real ~/.zcc/mcp file if any claude-profile path touches it.
vi.mock('../mcp-config.js', () => ({
  ensureMcpConfigForProject: () => '/tmp/p1/.mcp.json',
  ensureMcpConfigForProjectSync: () => '/tmp/p1/.mcp.json'
}));

const { createTerminalConfined, resolveWorktreeForRequest, sanitizeRendererTerminalRequest } = await import('../index.js');

describe('sanitizeRendererTerminalRequest', () => {
  it('strips renderer-forgeable team, background, and resolved-worktree authority', () => {
    expect(sanitizeRendererTerminalRequest({
      projectId: 'p1', profile: 'claude', cols: 80, rows: 24,
      headless: true,
      worktreeInfo: { path: '/tmp/forged', branch: 'forged' },
      cohort: { cohortId: 'forged', teamId: 'team', teamName: 'Team', role: 'orchestrator' }
    })).toEqual({ projectId: 'p1', profile: 'claude', cols: 80, rows: 24 });
  });
});

describe('resolveWorktreeForRequest', () => {
  it('fails closed for an explicit unusable name', async () => {
    const result = await resolveWorktreeForRequest({
      projectId: 'p1', profile: 'claude', cols: 80, rows: 24, worktree: { branch: '///' }
    });
    expect(result).toEqual({ ok: false, code: 'INVALID', message: 'Worktree name required.' });
  });

  it('keeps legacy boolean intent compatible when project is not a git repo', async () => {
    const request = {
      projectId: 'p1', profile: 'claude' as const, cols: 80, rows: 24, worktree: true
    };
    expect(await resolveWorktreeForRequest(request)).toEqual({ ok: true, value: request });
  });

  it('fails visibly for named intent when project is not a git repo', async () => {
    const result = await resolveWorktreeForRequest({
      projectId: 'p1', profile: 'claude', cols: 80, rows: 24,
      worktree: { branch: 'task' }
    });
    expect(result).toEqual({
      ok: false,
      code: 'WORKTREE_UNAVAILABLE',
      message: 'Worktree isolation requires a Git repository.'
    });
  });
});

function lastCreate() {
  return createCalls[createCalls.length - 1];
}

describe('createTerminalConfined — main-side denylist enforcement', () => {
  beforeEach(() => {
    createCalls.length = 0;
  });

  it('strips a denied flag while preserving benign flags (--flag value form)', () => {
    const res = createTerminalConfined({
      projectId: 'p1',
      profile: 'claude',
      cols: 80,
      rows: 24,
      extraArgs: ['--model', 'opus', '--dangerously-skip-permissions', '-p', 'x']
    });
    expect(res.ok).toBe(true);
    const args = lastCreate().extraArgs ?? [];
    expect(args).not.toContain('--dangerously-skip-permissions');
    expect(args).toEqual(['--model', 'opus', '-p', 'x']);
  });

  it('strips --mcp-config + its value but keeps the prompt positional last', () => {
    const res = createTerminalConfined({
      projectId: 'p1',
      profile: 'claude',
      cols: 80,
      rows: 24,
      extraArgs: ['--mcp-config', '/tmp/evil.json'],
      // prompt is appended by resolvePersonaLaunch for claude-family profiles
      prompt: 'do work'
    } as Parameters<typeof createTerminalConfined>[0]);
    expect(res.ok).toBe(true);
    const args = lastCreate().extraArgs ?? [];
    expect(args).not.toContain('--mcp-config');
    expect(args).not.toContain('/tmp/evil.json');
    expect(args[args.length - 1]).toBe('do work');
  });

  it('strips the --flag=value form too', () => {
    createTerminalConfined({
      projectId: 'p1',
      profile: 'claude',
      cols: 80,
      rows: 24,
      extraArgs: ['--permission-mode=acceptEdits', '--allowedTools=Bash', '--model=opus']
    });
    const args = lastCreate().extraArgs ?? [];
    expect(args).toEqual(['--model=opus']);
  });

  it('does not throw on undefined extraArgs and forwards an empty vector', () => {
    const res = createTerminalConfined({
      projectId: 'p1',
      profile: 'shell',
      cols: 80,
      rows: 24,
      extraArgs: undefined
    });
    expect(res.ok).toBe(true);
    expect(lastCreate().extraArgs ?? []).toEqual([]);
  });

  it('resolves a seeded launch through the configured global harness', () => {
    const prior = CONFIG.defaultHarness;
    const priorEnabled = CONFIG.harnessCodexEnabled;
    CONFIG.defaultHarness = 'codex';
    CONFIG.harnessCodexEnabled = true;
    try {
      const res = createTerminalConfined({
        projectId: 'p1',
        profile: 'claude',
        profileSource: 'seeded-default',
        cols: 80,
        rows: 24
      });
      expect(res.ok).toBe(true);
      expect(lastCreate().profile).toBe('codex');
    } finally {
      CONFIG.defaultHarness = prior;
      CONFIG.harnessCodexEnabled = priorEnabled;
    }
  });

  it('formats a seeded prompt for the resolved OpenCode profile', () => {
    const prior = CONFIG.defaultHarness;
    const priorEnabled = CONFIG.harnessOpenCodeEnabled;
    CONFIG.defaultHarness = 'opencode';
    CONFIG.harnessOpenCodeEnabled = true;
    try {
      const res = createTerminalConfined({
        projectId: 'p1',
        profile: 'claude',
        profileSource: 'seeded-default',
        prompt: 'do work',
        cols: 80,
        rows: 24
      });
      expect(res.ok).toBe(true);
      expect(lastCreate().profile).toBe('opencode');
      expect(lastCreate().extraArgs).toEqual(['--prompt', 'do work']);
    } finally {
      CONFIG.defaultHarness = prior;
      CONFIG.harnessOpenCodeEnabled = priorEnabled;
    }
  });

  it('blocks a seeded launch when its configured global harness is disabled', () => {
    const prior = CONFIG.defaultHarness;
    const priorEnabled = CONFIG.harnessOpenCodeEnabled;
    CONFIG.defaultHarness = 'opencode';
    CONFIG.harnessOpenCodeEnabled = false;
    try {
      const res = createTerminalConfined({
        projectId: 'p1',
        profile: 'claude',
        profileSource: 'seeded-default',
        cols: 80,
        rows: 24
      });
      expect(res).toMatchObject({ ok: false, code: 'UNAVAILABLE_DEFAULT' });
      expect(createCalls).toHaveLength(0);
    } finally {
      CONFIG.defaultHarness = prior;
      CONFIG.harnessOpenCodeEnabled = priorEnabled;
    }
  });
});
