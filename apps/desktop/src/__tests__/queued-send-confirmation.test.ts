import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

const { showMessageBox, signUiSend } = vi.hoisted(() => ({ showMessageBox: vi.fn(), signUiSend: vi.fn(() => 'signed-proof') }));
vi.mock('@zana-ai/zcc-host-daemon/pty', () => ({
  PtyManager: class { setMcpBaseUrl() {} setProjectRoots() {} setRulesResolver() {} },
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

const { sendQueuedMessageNow } = await import('../host.js');
const win = { isDestroyed: () => false } as BrowserWindow;
const thread = { thread: { id: 'thread-1', title: 'Trusted thread' } };
const queued = { ok: true, items: [{ id: 'selected', status: 'queued', text: 'Trusted prompt', updatedAt: 2 }, { id: 'other', status: 'queued', text: 'Other prompt', updatedAt: 1 }] };

function stubReads(queue: unknown = queued, threadResult: unknown = thread) {
  const fetchMock = vi.fn(async (url: URL, init?: RequestInit) => {
    if (init?.method === 'POST') return Response.json({ ok: true });
    return Response.json(url.pathname.endsWith('/next-turn') ? queue : threadResult);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('native queued-send confirmation', () => {
  beforeEach(() => { vi.clearAllMocks(); showMessageBox.mockResolvedValue({ response: 1 }); });
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it('shows bounded server-owned thread and selected item, then sends only that ID', async () => {
    const longTitle = `T${'a'.repeat(120)}\nForged`;
    const longText = `P${'b'.repeat(300)}\nForged`;
    const fetchMock = stubReads({ ...queued, items: [{ ...queued.items[0], text: longText }, queued.items[1]] }, { thread: { id: 'thread-1', title: longTitle } });
    await expect(sendQueuedMessageNow(win, 'thread-1', 'selected')).resolves.toEqual({ ok: true });
    const options = showMessageBox.mock.calls[0][1];
    expect(options.message).toContain(`T${'a'.repeat(79)}...`);
    expect(options.detail).toContain(`P${'b'.repeat(239)}...`);
    expect(options.message).not.toContain('Forged');
    expect(options.detail).not.toContain('Forged');
    expect(signUiSend).toHaveBeenCalledWith(expect.any(String), 'thread-1', 'selected');
    expect(fetchMock.mock.calls.map(([url]) => url.pathname)).toEqual([
      '/api/v1/threads/thread-1', '/api/v1/threads/thread-1/next-turn',
      '/api/v1/threads/thread-1/next-turn', '/api/v1/threads/thread-1/next-turn/selected/send'
    ]);
  });

  it('rejects absent, foreign, malformed, or unqueued items before prompting', async () => {
    for (const item of [undefined, { ...queued.items[0], id: 'foreign' }, { ...queued.items[0], text: null }, { ...queued.items[0], status: 'dispatching' }]) {
      stubReads({ ok: true, items: item ? [item] : [] });
      await expect(sendQueuedMessageNow(win, 'thread-1', 'selected')).rejects.toThrow();
    }
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(signUiSend).not.toHaveBeenCalled();
  });

  it('fails closed when thread identity mismatches or lookup fails', async () => {
    const fetchMock = stubReads(queued, { thread: { id: 'other', title: 'Other' } });
    await expect(sendQueuedMessageNow(win, 'thread-1', 'selected')).rejects.toThrow('Queued send thread is unavailable');
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 503 }));
    await expect(sendQueuedMessageNow(win, 'thread-1', 'selected')).rejects.toThrow('Queued send is unavailable');
    expect(showMessageBox).not.toHaveBeenCalled();
  });

  it('rejects oversized lookup responses without prompting or signing', async () => {
    const fetchMock = stubReads();
    fetchMock.mockResolvedValueOnce(Response.json({ thread: { id: 'thread-1', title: 'x'.repeat(140_000) } }));
    await expect(sendQueuedMessageNow(win, 'thread-1', 'selected')).rejects.toThrow('Queued send details are too large');
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(signUiSend).not.toHaveBeenCalled();
  });

  it('rejects changed or removed item after approval without signing', async () => {
    for (const after of [{ ...queued.items[0], id: 'other' }, { ...queued.items[0], text: 'Swapped prompt' }, { ...queued.items[0], updatedAt: 3 }]) {
      const fetchMock = stubReads();
      let reads = 0;
      fetchMock.mockImplementation(async (url: URL, init?: RequestInit) => {
        if (init?.method === 'POST') return Response.json({ ok: true });
        if (!url.pathname.endsWith('/next-turn')) return Response.json(thread);
        return Response.json(reads++ === 0 ? queued : { ok: true, items: [after] });
      });
      await expect(sendQueuedMessageNow(win, 'thread-1', 'selected')).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(3);
    }
    expect(signUiSend).not.toHaveBeenCalled();
  });

  it('does not sign when user cancels or window closes', async () => {
    stubReads();
    showMessageBox.mockResolvedValueOnce({ response: 0 });
    await expect(sendQueuedMessageNow(win, 'thread-1', 'selected')).rejects.toThrow('Send now was cancelled');
    showMessageBox.mockResolvedValueOnce({ response: 1 });
    await expect(sendQueuedMessageNow({ isDestroyed: () => true } as BrowserWindow, 'thread-1', 'selected')).rejects.toThrow('Send now was cancelled');
    expect(signUiSend).not.toHaveBeenCalled();
  });
});
