import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
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
  ensureMcpConfigForProjectSync: () => '/tmp/p1/.mcp.json'
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
});
