import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
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

const { decideNativeToolPolicy, sendQueuedMessageNow } = await import('../host.js');
const event = { turn_id: 'turn-1', tool_use_id: 'call-1', tool_name: 'Bash', tool_input: { command: 'pwd' } };

describe('native tool policy callback', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps one bounded ID across retries and separates sessions and calls', async () => {
    const fetchMock = vi.fn(async () => Response.json({ action: 'allow' }));
    vi.stubGlobal('fetch', fetchMock);
    for (const [session, payload] of [['session-a', event], ['session-a', event], ['session-a', { ...event, tool_use_id: 'call-2' }], ['session-a', { ...event, turn_id: 'turn-2' }], ['session-b', event]] as const) {
      expect(await decideNativeToolPolicy(session, JSON.stringify(payload))).toEqual({ decision: 'allow', reason: 'allowed' });
    }
    const ids = fetchMock.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string).invocationId as string);
    expect(ids[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(ids[0]).toBe(ids[1]);
    expect(new Set(ids).size).toBe(4);
  });

  it.each([{ tool_use_id: undefined }, { tool_use_id: '' }, { tool_use_id: 'x'.repeat(513) }, { turn_id: 12 }, { tool_use_id: 'bad\nline' }])('rejects missing or malformed provider identity: %j', async (change) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await decideNativeToolPolicy('session-a', JSON.stringify({ ...event, ...change }))).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([null, [], {}, { action: 'ALLOW' }, { action: true }, { action: 'wait' }])('fails closed on malformed policy: %j', async (policy) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(policy)));
    expect(await decideNativeToolPolicy('session-a', JSON.stringify(event))).toBeNull();
  });

  it('preserves explicit deny and fails closed on transport errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ action: 'deny', reason: 'blocked' })));
    expect(await decideNativeToolPolicy('session-a', JSON.stringify(event))).toEqual({ decision: 'deny', reason: 'blocked' });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ action: 'allow' }, { status: 503 })));
    expect(await decideNativeToolPolicy('session-a', JSON.stringify(event))).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await decideNativeToolPolicy('session-a', JSON.stringify(event))).toBeNull();
    expect(await decideNativeToolPolicy('session-a', '{not json')).toBeNull();
  });

  it('forwards only object input and derives deny reason when policy omits it', async () => {
    const fetchMock = vi.fn(async () => Response.json({ action: 'deny', reason: false }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await decideNativeToolPolicy('session/a', JSON.stringify({ ...event, tool_input: ['not an object'] })))
      .toEqual({ decision: 'deny', reason: 'denied by plugin tool policy' });
    expect(fetchMock).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/api/v1/terminals/session%2Fa/tool-policy' }),
      expect.objectContaining({ body: JSON.stringify({
        invocationId: createHash('sha256').update(JSON.stringify(['session/a', event.turn_id, event.tool_use_id])).digest('hex'),
        toolName: 'Bash', input: {}
      }) }));
  });
});

describe('queued send confirmation', () => {
  const win = { isDestroyed: vi.fn(() => false) } as unknown as BrowserWindow;
  const queueReads = (body: unknown = { ok: true }) => vi.fn(async (url: URL, init?: RequestInit) => {
    if (init?.method === 'POST') return Response.json(body);
    return Response.json(url.pathname.endsWith('/next-turn')
      ? { ok: true, items: [{ id: url.pathname.includes('thread-1') ? 'item_2' : 'item', status: 'queued', text: 'Selected message', updatedAt: 1 }] }
      : { thread: { id: url.pathname.split('/').pop(), title: 'Test thread' } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it.each([
    ['bad/thread', 'item'], ['thread', 'bad/item'], ['', 'item'], ['thread', '']
  ])('rejects invalid IDs without prompting: %j %j', async (threadId, itemId) => {
    await expect(sendQueuedMessageNow(win, threadId, itemId)).rejects.toThrow('Invalid queued send');
    expect(showMessageBox).not.toHaveBeenCalled();
  });

  it('requires affirmative confirmation from a live window before signing', async () => {
    vi.stubGlobal('fetch', queueReads());
    showMessageBox.mockResolvedValueOnce({ response: 0 }).mockResolvedValueOnce({ response: 1 });
    await expect(sendQueuedMessageNow(win, 'thread', 'item')).rejects.toThrow('Send now was cancelled');
    vi.mocked(win.isDestroyed).mockReturnValueOnce(true);
    await expect(sendQueuedMessageNow(win, 'thread', 'item')).rejects.toThrow('Send now was cancelled');
    expect(signUiSend).not.toHaveBeenCalled();
  });

  it('signs confirmed send and forwards proof to product server', async () => {
    showMessageBox.mockResolvedValue({ response: 1 });
    const fetchMock = queueReads();
    vi.stubGlobal('fetch', fetchMock);
    await expect(sendQueuedMessageNow(win, 'thread-1', 'item_2')).resolves.toEqual({ ok: true });
    expect(showMessageBox).toHaveBeenCalledWith(win, expect.objectContaining({ defaultId: 0, cancelId: 0 }));
    expect(signUiSend).toHaveBeenCalledWith(expect.any(String), 'thread-1', 'item_2');
    expect(fetchMock).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/api/v1/threads/thread-1/next-turn/item_2/send' }),
      expect.objectContaining({ method: 'POST', headers: { 'content-type': 'application/json', 'x-zcc-ui-send-proof': 'signed-proof' },
        body: JSON.stringify({ confirmed: true, expectedUpdatedAt: 1 }) }));
  });

  it.each([
    [503, { ok: true, message: 'unavailable' }, 'unavailable'],
    [200, { ok: false, error: 'blocked' }, 'blocked'],
    [200, {}, 'Send now failed']
  ])('surfaces server failure (%i)', async (status, body, expected) => {
    showMessageBox.mockResolvedValue({ response: 1 });
    const fetchMock = queueReads(body);
    if (status !== 200) fetchMock.mockImplementation(async (url: URL, init?: RequestInit) => {
      if (init?.method === 'POST') return Response.json(body, { status });
      return Response.json(url.pathname.endsWith('/next-turn')
        ? { ok: true, items: [{ id: 'item', status: 'queued', text: 'Selected message', updatedAt: 1 }] }
        : { thread: { id: 'thread', title: 'Test thread' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(sendQueuedMessageNow(win, 'thread', 'item')).rejects.toThrow(expected);
  });
});
