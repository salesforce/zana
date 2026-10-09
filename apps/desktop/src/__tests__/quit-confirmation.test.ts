import { describe, it, expect, vi } from 'vitest';

// Import the real main registration with Electron startup suspended. The built
// app test separately proves the native lifecycle and persistence boundary.
const state = vi.hoisted(() => ({
  beforeQuit: undefined as undefined | ((event: { preventDefault(): void }) => void),
  count: vi.fn(async () => 1),
  dialog: vi.fn(async (..._args: unknown[]) => ({ response: 1 })),
  quit: vi.fn(),
  terminals: 0
}));
vi.mock('../runtime/quit-guard.js', async (original) => ({
  ...await original<typeof import('../runtime/quit-guard.js')>(),
  readQuitThreadCount: state.count
}));

vi.mock('@zana-ai/zcc-host-daemon/pty', () => ({
  PtyManager: class {
    setMcpBaseUrl() {}
    setProjectRoots() {}
    setRulesResolver() {}
    liveCount() { return state.terminals; }
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
    on: (name: string, handler: (event: { preventDefault(): void }) => void) => { if (name === 'before-quit') state.beforeQuit = handler; },
    whenReady: () => new Promise(() => {}),
    getPath: () => '/tmp',
    setName: () => {},
    requestSingleInstanceLock: () => true,
    quit: state.quit
  },
  BrowserWindow: {
    getAllWindows: () => [],
    getFocusedWindow: () => null
  },
  ipcMain: { handle: () => {}, on: () => {} },
  dialog: { showMessageBox: state.dialog },
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

await import('../host.js');
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

describe('main quit confirmation wiring', () => {
  it('combines terminal and Modern counts, defaults to Cancel, and preserves services on cancel', async () => {
    const event = { preventDefault: vi.fn() };
    state.beforeQuit!(event);
    await settle();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(state.dialog).toHaveBeenLastCalledWith(expect.objectContaining({
      message: 'Quit and end 1 running session?', buttons: ['Quit', 'Cancel'], defaultId: 1, cancelId: 1
    }));
    expect(state.quit).not.toHaveBeenCalled();
    state.terminals = 2;
    state.beforeQuit!(event);
    await settle();
    expect(state.dialog).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'Quit and end 3 running sessions?' }));
    state.terminals = 0;
  });

  it('asks for consent when the server is unavailable and exits only on explicit Quit', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      state.count.mockRejectedValueOnce(new Error('offline'));
      state.beforeQuit!({ preventDefault: vi.fn() });
      await settle();
      expect(state.dialog).toHaveBeenLastCalledWith(expect.objectContaining({
        message: 'Quit and end running sessions?',
        detail: expect.stringContaining('Agent activity could not be checked')
      }));
      expect(state.quit).not.toHaveBeenCalled();
      state.dialog.mockResolvedValueOnce({ response: 0 });
      state.beforeQuit!({ preventDefault: vi.fn() });
      await settle();
      expect(state.quit).toHaveBeenCalledOnce();
    } finally { errorLog.mockRestore(); }
  });
});
