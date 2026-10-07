import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { SchedulerManager } from '@zana-ai/zcc-server/services/scheduler/scheduler';
import type { Project } from '@zana-ai/zcc-domain/product';

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

const { sendQueuedMessageNow, signMobileQueuedSend, scheduleAgentApi, scheduleControlApi, discoveryForRegisteredLaunch } = await import('../host.js');
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
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });

  it('stamps phone approval with main credentials and the mobile surface', () => {
    expect(signMobileQueuedSend('thread-1', 'selected')).toBe('signed-proof');
    expect(signUiSend).toHaveBeenCalledWith(expect.any(String), 'thread-1', 'selected', expect.any(Number), 'mobile-ui');
  });

  it('forwards schedule agent operations to the main-owned scheduler', async () => {
    const task = { id: 's1' } as ReturnType<SchedulerManager['get']>;
    const spies = {
      list: vi.spyOn(SchedulerManager.prototype, 'list').mockReturnValue([task]),
      get: vi.spyOn(SchedulerManager.prototype, 'get').mockReturnValue(task),
      update: vi.spyOn(SchedulerManager.prototype, 'update').mockResolvedValue(task),
      reload: vi.spyOn(SchedulerManager.prototype, 'reload').mockResolvedValue({ reloaded: true, schedule: task }),
      runNow: vi.spyOn(SchedulerManager.prototype, 'runNow').mockResolvedValue(task),
      setEnabled: vi.spyOn(SchedulerManager.prototype, 'setEnabled').mockResolvedValue(task)
    };
    expect(scheduleAgentApi.list()).toEqual([task]);
    expect(scheduleAgentApi.get('s1')).toEqual(task);
    await expect(scheduleAgentApi.update('s1', { prompt: 'Updated' })).resolves.toEqual(task);
    await expect(scheduleAgentApi.reload('s1')).resolves.toEqual({ reloaded: true, schedule: task });
    await expect(scheduleAgentApi.runNow('s1')).resolves.toEqual(task);
    await expect(scheduleAgentApi.setEnabled('s1', false)).resolves.toEqual(task);
    expect(spies.update).toHaveBeenCalledWith('s1', { prompt: 'Updated' });
    expect(spies.setEnabled).toHaveBeenCalledWith('s1', false);
  });

  it('returns acknowledged scheduler results and isolates control operation failures', async () => {
    const task = { id: 's1' } as ReturnType<SchedulerManager['get']>;
    const get = vi.spyOn(SchedulerManager.prototype, 'get').mockReturnValueOnce(task).mockImplementation(() => { throw new Error('missing schedule'); });
    const reload = vi.spyOn(SchedulerManager.prototype, 'reload').mockResolvedValueOnce({ reloaded: true, schedule: task }).mockRejectedValue(new Error('reload failed'));
    const update = vi.spyOn(SchedulerManager.prototype, 'update').mockResolvedValueOnce(task).mockRejectedValue(new Error('update failed'));
    await expect(scheduleControlApi.getSchedule!('s1')).resolves.toEqual({ ok: true, value: task });
    await expect(scheduleControlApi.reloadSchedule!('s1')).resolves.toEqual({ ok: true, value: { reloaded: true, schedule: task } });
    await expect(scheduleControlApi.updateSchedule!('s1', { prompt: 'Updated' })).resolves.toEqual({ ok: true, value: task });
    await expect(scheduleControlApi.getSchedule!('missing')).resolves.toMatchObject({ ok: false, code: 'GET_FAILED', message: expect.stringContaining('missing schedule') });
    await expect(scheduleControlApi.reloadSchedule!('missing')).resolves.toMatchObject({ ok: false, code: 'RELOAD_FAILED', message: expect.stringContaining('reload failed') });
    await expect(scheduleControlApi.updateSchedule!('missing', {})).resolves.toMatchObject({ ok: false, code: 'UPDATE_FAILED', message: expect.stringContaining('update failed') });
    expect(get).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith('s1', { prompt: 'Updated' });
  });

  it('discovers on the project target and never supplies a local cwd for an enrolled remote project', async () => {
    const localHost = '11111111-1111-4111-8111-111111111111';
    const projectHost = '22222222-2222-4222-8222-222222222222';
    const requestedHost = '33333333-3333-4333-8333-333333333333';
    const cliDiscovery = vi.fn(async () => ({ query: 'version' as const, version: '1.0' }));
    const supervisor = { hostId: localHost, cliDiscovery };
    const launch = { cwd: '/registered/project' };
    const project = { id: 'p1' };
    for (const [record, request, expectedHost] of [
      [project, {}, localHost],
      [{ ...project, hostId: projectHost }, {}, projectHost],
      [{ ...project, hostId: projectHost }, { hostId: requestedHost }, requestedHost]
    ] as const) {
      await expect(discoveryForRegisteredLaunch(supervisor, record, launch, request, 'claude', true)!.installedVersion()).resolves.toBe('1.0');
      expect(cliDiscovery).toHaveBeenLastCalledWith({ projectId: 'p1', hostId: expectedHost, cwd: launch.cwd, profile: 'claude', nativeAgentDiscoveryEnabled: true, query: 'version' });
    }
    const remote: Project['remote'] = { host: 'remote.test', user: 'tester', remotePath: '/remote/project' };
    await discoveryForRegisteredLaunch(supervisor, { ...project, hostId: projectHost, remote }, launch, { hostId: requestedHost }, 'claude', false)!.installedVersion();
    expect(cliDiscovery).toHaveBeenLastCalledWith({ projectId: 'p1', hostId: projectHost, profile: 'claude', nativeAgentDiscoveryEnabled: false, query: 'version' });
    expect(discoveryForRegisteredLaunch(supervisor, { ...project, remote }, launch, {}, 'claude', false)).toBeUndefined();
    expect(discoveryForRegisteredLaunch(null, project, launch, {}, 'claude', true)).toBeUndefined();
    expect(discoveryForRegisteredLaunch(supervisor, project, { ...launch, worktree: true }, {}, 'claude', true)).toBeUndefined();
    expect(discoveryForRegisteredLaunch(supervisor, project, { ...launch, scratch: true }, {}, 'claude', true)).toBeUndefined();
    expect(cliDiscovery).toHaveBeenCalledTimes(4);
  });

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
    expect(fetchMock.mock.calls.at(-1)![1]?.body).toBe(JSON.stringify({ confirmed: true, expectedUpdatedAt: 2 }));
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

  it('confirms and retries a failed row through the same selected-message flow', async () => {
    stubReads({ ...queued, items: [{ ...queued.items[0], status: 'failed' }] });
    await expect(sendQueuedMessageNow(win, 'thread-1', 'selected')).resolves.toEqual({ ok: true });
    expect(signUiSend).toHaveBeenCalledWith(expect.any(String), 'thread-1', 'selected');
    expect(showMessageBox).toHaveBeenCalledOnce();
  });
});
