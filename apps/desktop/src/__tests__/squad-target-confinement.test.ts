import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Project, AppConfig, ProjectSettings } from '@zana-ai/zcc-domain/product';

/**
 * Host confinement for a user-owned squad target (B8): a project-contained
 * checkout is accepted as the members' cwd and survives commit revalidation,
 * while a path that escapes the registered project is never selected.
 * Harness mirrors create-terminal-confined.test.ts.
 */

const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-squad-target-')));
const ROOT = join(fixture, 'proj');
const PROJECT: Project = { id: 'p1', name: 'Proj', path: ROOT } as Project;
mkdirSync(ROOT, { recursive: true });
const CONFIG: AppConfig = { version: 1, theme: 'dark', shell: '/bin/zsh', claudeBinary: 'claude', fontSize: 13, lastProjectId: null };
const PROJECT_SETTINGS: ProjectSettings = {} as ProjectSettings;
const projects: Project[] = [PROJECT];
const createScratchSubfolder = vi.fn(() => join(ROOT, 'scratch'));
const createCalls: unknown[] = [];

vi.mock('@zana-ai/zcc-host-daemon/pty', () => {
  class PtyManager {
    setMcpBaseUrl() {}
    setProjectRoots() {}
    setRulesResolver() {}
    create(opts: {
      cwd: string;
      extraArgs?: string[];
      profile: string;
      persona: unknown;
      remote?: unknown;
      remoteToolProxy?: boolean;
      openingPrompt?: string;
      authorizedModel?: unknown;
    }) {
      createCalls.push({
        authorizedModel: opts.authorizedModel,
        cwd: opts.cwd,
        extraArgs: opts.extraArgs,
        profile: opts.profile,
        persona: opts.persona,
        remote: opts.remote,
        remoteToolProxy: opts.remoteToolProxy,
        openingPrompt: opts.openingPrompt
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

vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({
  store: {
    listProjects: () => projects,
    getConfig: () => CONFIG,
    getProjectSettings: () => PROJECT_SETTINGS,
    createScratchSubfolder,
    ensureRemoteProjectLocalDir: (project: Project) => project
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
vi.mock('@zana-ai/zcc-host-daemon/mcp-config', () => ({
  ensureMcpConfigForProject: () => '/tmp/p1/.mcp.json',
  ensureMcpConfigForProjectSync: () => '/tmp/p1/.mcp.json',
  alwaysOnPluginMcpAllowlist: () => []
}));

const { revalidateEffectiveLaunch, resolveEffectiveLaunch } = await import('../host.js');

describe('user-owned squad target confinement (B8)', () => {
  it('selects a project-contained worktree and keeps it valid at commit', () => {
    const wt = join(ROOT, 'checkouts', 'feat');
    mkdirSync(wt, { recursive: true });
    const effective = resolveEffectiveLaunch({ worktreeInfo: { path: wt, branch: 'feat' } }, PROJECT);
    expect(effective).toMatchObject({ cwd: wt, worktree: { path: wt, branch: 'feat' } });
    expect(revalidateEffectiveLaunch(effective, PROJECT)).toEqual({ ok: true });
  });

  it('selects the project root itself as a target', () => {
    const effective = resolveEffectiveLaunch({ worktreeInfo: { path: ROOT, branch: 'main' } }, PROJECT);
    expect(effective).toMatchObject({ cwd: ROOT, worktree: { path: ROOT, branch: 'main' } });
    expect(revalidateEffectiveLaunch(effective, PROJECT)).toEqual({ ok: true });
  });

  it('never selects a symlink that escapes the registered project', () => {
    const outside = join(fixture, 'outside');
    mkdirSync(outside, { recursive: true });
    const link = join(ROOT, 'escape');
    symlinkSync(outside, link, 'dir');
    const effective = resolveEffectiveLaunch({ worktreeInfo: { path: link, branch: 'x' } }, PROJECT);
    expect(effective.worktree).toBeUndefined();
    expect(effective.cwd).toBe(ROOT);
  });

  it('fails commit revalidation when a project-contained target is retargeted outside', () => {
    const wt = join(ROOT, 'checkouts', 'moving');
    mkdirSync(wt, { recursive: true });
    const effective = resolveEffectiveLaunch({ worktreeInfo: { path: wt, branch: 'm' } }, PROJECT);
    expect(revalidateEffectiveLaunch({ ...effective, cwd: join(fixture, 'outside') }, PROJECT))
      .toEqual({ ok: false, reason: 'effective launch path changed after preflight' });
    rmSync(wt, { recursive: true, force: true });
    expect(revalidateEffectiveLaunch(effective, PROJECT)).toEqual({ ok: false, reason: 'effective launch path changed after preflight' });
  });
});
