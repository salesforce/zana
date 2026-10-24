import { describe, it, expect, vi } from 'vitest';
import { linkSync, mkdtempSync, mkdirSync, writeFileSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * `goalExecutionSourcePaths` used to let an unguarded `realpath(home)` throw
 * straight out of the whole Team-launch call chain whenever `home` is a
 * remote/nonexistent local project root. Mirrors the lean mocking approach in
 * opencode-tab-namer.test.ts so importing host.ts is side-effect-free.
 */

vi.mock('@zana-ai/zcc-host-daemon/pty', () => ({
  PtyManager: class {
    setMcpBaseUrl() {}
    setProjectRoots() {}
    setRulesResolver() {}
  },
  isClaudeProfile: () => false
}));

vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({
  store: {
    listProjects: () => [],
    getConfig: () => ({}),
    getProjectSettings: () => ({}),
    createScratchSubfolder: () => '/tmp/scratch'
  },
  scratchWorkspaceRoot: () => '/tmp/scratch-root',
  worktreeRoot: () => '/tmp/zcc-worktrees',
  worktreeTargetDir: (_p: unknown, slug: string) => `/tmp/zcc-worktrees/${slug}`
}));

vi.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false },
  app: {
    on: () => {},
    whenReady: () => new Promise(() => {}),
    getPath: () => '/tmp',
    setName: () => {},
    requestSingleInstanceLock: () => true,
    quit: () => {}
  },
  BrowserWindow: {
    getAllWindows: () => [],
    getFocusedWindow: () => null
  },
  ipcMain: { handle: () => {}, on: () => {} },
  dialog: {},
  shell: {},
  screen: {},
  Menu: { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) },
  nativeImage: { createFromPath: () => ({}) },
  powerMonitor: { on: () => {} }
}));

vi.mock('../updater.js', () => ({
  createUpdater: () => ({})
}));

vi.mock('-ai/zcc-host-daemon/mcp-config', () => ({
  ensureMcpConfigForProject: () => '/tmp/p1/.mcp.json',
  ensureMcpConfigForProjectSync: () => '/tmp/p1/.mcp.json',
  alwaysOnPluginMcpAllowlist: () => []
}));

vi.mock('../test-tap.js', () => ({
  record: () => {},
  recordLog: () => {},
  isEnabled: () => false,
  enable: () => {},
  drain: () => ({ entries: [], cursor: 0 }),
  snapshot: () => ({ entries: [] }),
  reset: () => {}
}));

const { goalExecutionSourcePaths } = await import('../host.js');

// `jobWorkerPrompt` has its own dedicated, focused suite —
// see job-worker-prompt.test.ts (assignment, audience selection, delivery
// instructions).

describe('goalExecutionSourcePaths', () => {
  it('returns an empty list instead of throwing when home does not resolve (remote/nonexistent project root)', async () => {
    const missingHome = join(tmpdir(), `zcc-missing-home-${Date.now()}`);
    await expect(goalExecutionSourcePaths('fix the bug in src/app.ts', missingHome)).resolves.toEqual([]);
  });

  it('still discovers a real goal-embedded path under an existing home', async () => {
    const home = mkdtempSync(join(tmpdir(), 'zcc-home-'));
    const targetDir = join(home, 'proj', 'src');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'app.ts'), '// stub');

    const descriptors = await goalExecutionSourcePaths(`fix the bug in ${join(targetDir, 'app.ts')}`, home);
    expect(descriptors.length).toBeGreaterThan(0);
  });

  it('expands a leading ~/ to the user home for bare and quoted goal paths', async () => {
    const userHome = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-userhome-')));
    mkdirSync(join(userHome, 'notes'), { recursive: true });
    writeFileSync(join(userHome, 'notes', 'plan.md'), '# plan');
    const project = mkdtempSync(join(tmpdir(), 'zcc-home-'));

    const bare = await goalExecutionSourcePaths('implement ~/notes/plan.md', project, userHome);
    expect(bare.map((d) => d.canonicalPath)).toEqual([join(userHome, 'notes', 'plan.md')]);
    const quoted = await goalExecutionSourcePaths('implement "~/notes/plan.md"', project, userHome);
    expect(quoted.map((d) => d.canonicalPath)).toEqual([join(userHome, 'notes', 'plan.md')]);
    await expect(goalExecutionSourcePaths('implement ~/notes/missing.md', project, userHome)).resolves.toEqual([]);
  });

  it('skips a hard-linked file (Launch would refuse it and fail the whole launch)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'zcc-home-'));
    writeFileSync(join(home, 'a.md'), '# a');
    linkSync(join(home, 'a.md'), join(home, 'b.md'));
    writeFileSync(join(home, 'solo.md'), '# solo');
    expect(await goalExecutionSourcePaths(`read ${join(home, 'b.md')}`, home)).toEqual([]);
    expect((await goalExecutionSourcePaths(`read ${join(home, 'solo.md')}`, home)).length).toBe(1);
  });

  it('skips a goal path inside a protected folder that links out of it (dotfiles)', async () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-home-')));
    mkdirSync(join(home, 'dotfiles'));
    mkdirSync(join(home, '.ssh'));
    writeFileSync(join(home, 'dotfiles', 'id_rsa'), 'key');
    symlinkSync(join(home, 'dotfiles', 'id_rsa'), join(home, '.ssh', 'id_rsa'));
    writeFileSync(join(home, 'plan.md'), '# plan');
    const project = join(home, 'proj');
    mkdirSync(project);
    expect(await goalExecutionSourcePaths(`read ${join(home, '.ssh', 'id_rsa')}`, project, home)).toEqual([]);
    expect((await goalExecutionSourcePaths(`read ${join(home, 'plan.md')}`, project, home)).length).toBe(1);
  });

  it('skips a folder (Launch would fail with NOT_REGULAR_FILE)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'zcc-home-'));
    mkdirSync(join(home, 'docs'));
    expect(await goalExecutionSourcePaths(`read ${join(home, 'docs')}`, home)).toEqual([]);
  });

  it('discovers a quoted path with spaces under an existing home', async () => {
    const home = mkdtempSync(join(tmpdir(), 'zcc-home-'));
    const targetDir = join(home, 'proj with spaces', 'src folder');
    mkdirSync(targetDir, { recursive: true });
    const targetFile = join(targetDir, 'my app.ts');
    writeFileSync(targetFile, '// stub');

    const descriptors = await goalExecutionSourcePaths(`fix the bug in "${targetFile}"`, home);
    expect(descriptors.length).toBeGreaterThan(0);
    expect(descriptors[0]?.canonicalPath).toBe(realpathSync(targetFile));
  });

  it('discovers a plan referenced OUTSIDE the project but under the user HOME', async () => {
    // The reported stall: the goal named a plan in a doc vault under HOME, which
    // sits outside the selected project. It must still be snapshotted — its
    // location never constrains where execution happens.
    const project = mkdtempSync(join(tmpdir(), 'zcc-project-'));
    const userHome = mkdtempSync(join(tmpdir(), 'zcc-userhome-'));
    const vaultDir = join(userHome, 'doc-vault', 'zana-ui-automation', 'workflow-testing');
    mkdirSync(vaultDir, { recursive: true });
    const plan = join(vaultDir, 'plan.md');
    writeFileSync(plan, '# plan');

    const descriptors = await goalExecutionSourcePaths(`implement ${plan}`, project, userHome);
    expect(descriptors.map((d) => d.canonicalPath)).toContain(realpathSync(plan));
  });

  it('reads Zana\'s library under ~/.zcc and the clone root, but never Zana\'s own credentials or state', async () => {
    const project = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-project-')));
    const userHome = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-userhome-')));
    const cloneRoot = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-clones-')));
    mkdirSync(join(userHome, '.zcc', 'library', 'designs'), { recursive: true });
    mkdirSync(join(userHome, '.zcc', 'plugins'), { recursive: true });
    const design = join(userHome, '.zcc', 'library', 'designs', 'design.md');
    const auth = join(userHome, '.zcc', 'auth.json');
    const pluginState = join(userHome, '.zcc', 'plugins', 'settings.json');
    const cloned = join(cloneRoot, 'plan.md');
    for (const [path, text] of [[design, '# design'], [auth, '{}'], [pluginState, '{}'], [cloned, '# plan']] as const) writeFileSync(path, text);

    const descriptors = await goalExecutionSourcePaths(`Build ${design} and ${cloned}; ignore ${auth} and ${pluginState}`, project, userHome, { cloneRoot });
    expect(descriptors.map((d) => d.canonicalPath).sort()).toEqual([cloned, design].sort());
  });

  it('protects a ZCC_DATA_DIR data folder, the dev data folder and other protected roots as well as ~/.zcc', async () => {
    const project = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-project-')));
    const userHome = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-userhome-')));
    const dataDir = join(userHome, 'zana-data');
    const appData = join(userHome, 'app-data');
    for (const dir of [dataDir, join(userHome, '.zcc-dev'), appData]) mkdirSync(dir);
    const token = join(dataDir, 'host-enroll.token');
    const devToken = join(userHome, '.zcc-dev', 'host-enroll.token');
    const cookies = join(appData, 'Cookies');
    for (const path of [token, devToken, cookies]) writeFileSync(path, 'secret');
    const goal = `read ${token}, ${devToken} and ${cookies}`;
    expect(await goalExecutionSourcePaths(goal, project, userHome, { dataDirs: [dataDir], protectedRoots: [appData] })).toEqual([]);
    // Without them only the folders that are not Zana's are readable.
    expect((await goalExecutionSourcePaths(goal, project, userHome)).map((d) => d.canonicalPath).sort()).toEqual([cookies, token].sort());
  });

  it('blocks a sensitive HOME root even when named in the goal', async () => {
    const project = mkdtempSync(join(tmpdir(), 'zcc-project-'));
    const userHome = mkdtempSync(join(tmpdir(), 'zcc-userhome-'));
    const sshDir = join(userHome, '.ssh');
    mkdirSync(sshDir, { recursive: true });
    const secret = join(sshDir, 'id_rsa');
    writeFileSync(secret, 'PRIVATE');

    const descriptors = await goalExecutionSourcePaths(`read ${secret}`, project, userHome);
    expect(descriptors).toEqual([]);
  });

  it('skips a path outside both the project and the user HOME', async () => {
    const project = mkdtempSync(join(tmpdir(), 'zcc-project-'));
    const userHome = mkdtempSync(join(tmpdir(), 'zcc-userhome-'));
    const elsewhere = mkdtempSync(join(tmpdir(), 'zcc-elsewhere-'));
    const stray = join(elsewhere, 'notes.md');
    writeFileSync(stray, '# stray');

    const descriptors = await goalExecutionSourcePaths(`consider ${stray}`, project, userHome);
    expect(descriptors).toEqual([]);
  });

  it('discovers a project-relative @mention, as the composer writes a dropped or picked file', async () => {
    const project = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-project-')));
    const userHome = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-userhome-')));
    mkdirSync(join(project, 'plans'));
    const plan = join(project, 'plans', 'a-recoverable.md');
    writeFileSync(plan, '# plan');

    const descriptors = await goalExecutionSourcePaths('@plans/a-recoverable.md', project, userHome);
    expect(descriptors).toMatchObject([{ exactPath: plan, canonicalPath: plan, representations: expect.arrayContaining([plan]) }]);
    // Mid-sentence and in parentheses, with trailing punctuation, too.
    expect((await goalExecutionSourcePaths('Run (@plans/a-recoverable.md), then report.', project, userHome)).map((d) => d.canonicalPath)).toEqual([plan]);
  });

  it('discovers an absolute @mention, as the composer writes a file outside the project', async () => {
    const project = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-project-')));
    const userHome = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-userhome-')));
    const plan = join(userHome, 'plan.md');
    writeFileSync(plan, '# plan');

    expect((await goalExecutionSourcePaths(`Implement @${plan}`, project, userHome)).map((d) => d.canonicalPath)).toEqual([plan]);
  });

  it('applies the source policy to @mentions: secrets, escapes, folders and missing files are skipped', async () => {
    const userHome = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-userhome-')));
    const project = join(userHome, 'proj');
    mkdirSync(join(project, 'docs'), { recursive: true });
    mkdirSync(join(userHome, '.ssh'));
    writeFileSync(join(userHome, '.ssh', 'id_rsa'), 'PRIVATE');
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-elsewhere-')));
    writeFileSync(join(elsewhere, 'notes.md'), '# stray');

    const goal = `@../.ssh/id_rsa @docs @missing.md @alice @${join(elsewhere, 'notes.md')}`;
    expect(await goalExecutionSourcePaths(goal, project, userHome)).toEqual([]);
  });
});
