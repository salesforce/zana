import { describe, expect, it, vi } from 'vitest';

const { showMessageBox, signUiSend, liveSessions } = vi.hoisted(() => ({
  showMessageBox: vi.fn(),
  signUiSend: vi.fn(() => 'signed-proof'),
  liveSessions: new Map<string, { id: string; projectId: string; profile: string; status: string }>()
}));

vi.mock('@zana-ai/zcc-host-daemon/pty', () => ({
  PtyManager: class {
    setMcpBaseUrl() {}
    setProjectRoots() {}
    setRulesResolver() {}
    getSession(id: string) { return liveSessions.get(id) ?? null; }
  },
  isClaudeProfile: () => false
}));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({
  store: { listProjects: () => [], getConfig: () => ({}), getProjectSettings: () => ({}) },
  scratchWorkspaceRoot: () => '/tmp/scratch-root',
  worktreeRoot: () => '/tmp/zcc-worktrees',
  worktreeTargetDir: () => '/tmp/zcc-worktrees/target'
}));
vi.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false },
  app: { on: () => {}, whenReady: () => new Promise(() => {}), getPath: () => '/tmp', setName: () => {}, requestSingleInstanceLock: () => true, quit: () => {} },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  ipcMain: { handle: () => {}, on: () => {} }, dialog: { showMessageBox }, shell: {}, screen: {},
  Menu: { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) },
  nativeImage: { createFromPath: () => ({}) }, powerMonitor: { on: () => {} }
}));
vi.mock('../updater.js', () => ({ createUpdater: () => ({}) }));
vi.mock('../test-tap.js', () => ({ record: () => {}, recordLog: () => {}, isEnabled: () => false, enable: () => {}, drain: () => ({ entries: [], cursor: 0 }), snapshot: () => ({ entries: [] }), reset: () => {} }));
vi.mock('@zana-ai/zcc-server/http/ui-send-proof', () => ({ signUiSend }));

// Never the installed app on :8780: an unmocked product-route call must fail.
vi.stubEnv('ZCC_SERVER_URL', 'http://127.0.0.1:9/');
vi.stubEnv('ELECTRON_RENDERER_URL', '');
const { admitPtyDispatch, ptyPluginTools, nativeToolSettledHook, resolvePtyPluginInstructions } = await import('../host.js');


// With no supervised runtime and no electron-vite dev route, every plugin gate main wires in
// host.ts must degrade to its documented closed/empty answer rather than throw.
describe('host plugin gates without a plugin host', () => {
  const live = { id: 's1', projectId: 'p1', profile: 'claude', status: 'running' };

  it('refuses PTY dispatch admission because no channel can answer', async () => {
    await expect(admitPtyDispatch({ sessionId: 's1', projectId: 'p1', entry: 'reply', origin: 'user', promptText: 'hi' }))
      .resolves.toEqual({ code: 'DISPATCH_REJECTED', message: 'Plugin dispatch admission unavailable' });
  });

  it('lists no plugin tools and denies a tool call for a live session', async () => {
    liveSessions.set('s1', live);
    await expect(ptyPluginTools.list('p1', 's1')).resolves.toEqual([]);
    const reply = await ptyPluginTools.call('p1', 's1', 'tool', {});
    expect(reply.success).toBe(false);
  });

  it('launches without plugin instructions and drops settled events', async () => {
    liveSessions.set('s1', live);
    await expect(resolvePtyPluginInstructions({ sessionId: 's1', projectId: 'p1', profile: 'claude' })).resolves.toBe('');
    await expect(nativeToolSettledHook('p1', 's1', '{}')).resolves.toBeUndefined();
  });
});
