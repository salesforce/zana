import { describe, expect, it, vi } from 'vitest';

vi.mock('@zana-ai/zcc-host-daemon/pty', () => ({ PtyManager: class { setMcpBaseUrl() {} setProjectRoots() {} setRulesResolver() {} }, isClaudeProfile: () => false }));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({ store: { listProjects: () => [], getConfig: () => ({}), getProjectSettings: () => ({}) }, scratchWorkspaceRoot: () => '/tmp', worktreeRoot: () => '/tmp', worktreeTargetDir: () => '/tmp' }));
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false }, app: { on: () => {}, whenReady: () => new Promise(() => {}), getPath: () => '/tmp', setName: () => {}, requestSingleInstanceLock: () => true, quit: () => {} }, BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null }, ipcMain: { handle: () => {}, on: () => {} }, dialog: {}, shell: {}, screen: {}, Menu: { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) }, nativeImage: { createFromPath: () => ({}) }, powerMonitor: { on: () => {} } }));
vi.mock('../updater.js', () => ({ createUpdater: () => ({}) }));
vi.mock('../test-tap.js', () => ({ record: () => {}, recordLog: () => {}, isEnabled: () => false, enable: () => {}, drain: () => ({ entries: [], cursor: 0 }), snapshot: () => ({ entries: [] }), reset: () => {} }));

const { flushBlockerNoticesAtBoot } = await import('../host.js');

describe('blocker notice flush', () => {
  it('flushes at boot and isolates later failures', async () => {
    const flushBlockerNotices = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline'));
    const logError = vi.fn();
    const flush = await flushBlockerNoticesAtBoot({ flushBlockerNotices }, logError);
    flush();
    await vi.waitFor(() => expect(logError).toHaveBeenCalledWith('execution.flushBlockerNotices', expect.objectContaining({ message: 'offline' })));
  });
});
