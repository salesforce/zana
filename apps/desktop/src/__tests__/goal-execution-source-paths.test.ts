import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
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

const { goalExecutionSourcePaths, jobWorkerPrompt } = await import('../host.js');

describe('jobWorkerPrompt', () => {
  const prompt = jobWorkerPrompt({ executionId: 'exec-1', slotId: 'slot-1', label: 'Worker 1', personaName: 'Builder' });

  it('directs the worker to EXECUTE the assigned unit, not wait for pushed source context', () => {
    expect(prompt).toContain('EXECUTE it');
    expect(prompt).toContain('the file scope');
    // the old reflexive-block framing must be gone
    expect(prompt).not.toContain('containing the needed source context');
    expect(prompt).not.toContain('do NOT infer or start independently');
    expect(prompt).toMatch(/do not wait for extra "source context"/i);
    expect(prompt).toContain('Do not block just because a task looks large or under-detailed');
  });

  it('teaches the two block audiences: coordinator for a decidable plan/spec choice, human for a real human decision', () => {
    expect(prompt).toContain('audience: "coordinator"');
    expect(prompt).toContain('audience: "human"');
    expect(prompt).toContain('resumes automatically');
    // delivery pull/ack idempotency contract preserved verbatim
    expect(prompt).toContain('never call `execution.resume` or `execution.respond`');
  });
});

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
});
