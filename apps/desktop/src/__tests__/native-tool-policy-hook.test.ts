import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import { createNativeToolPolicyHook } from '../runtime/native-tool-policy.js';

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
const { sendQueuedMessageNow, nativeToolPolicyHook } = await import('../host.js');

// 2.3.4 denied EVERY local Claude PTY tool call: Claude's PreToolUse payload has
// no turn_id, and the decision went to a product route that never registers
// main's PTYs. These are the real payloads both CLIs send to the hook.
describe('native tool policy callback', () => {
  const claudeEvent = {
    session_id: '6f1c2c8e-8a52-4a8b-9d1e-0c9e2f4b7a10',
    transcript_path: '/home/user/.claude/projects/p/6f1c2c8e.jsonl',
    cwd: '/work/project',
    prompt_id: 'a3e1b7c2-5d4f-4e8a-9b6c-2f1d0e9c8b7a',
    permission_mode: 'default',
    effort: 'medium',
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'pwd' },
    tool_use_id: 'toolu_01ABC'
  };
  const codexEvent = {
    session_id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    transcript_path: '/home/user/.codex/sessions/rollout.jsonl',
    cwd: '/work/project',
    hook_event_name: 'PreToolUse',
    model: 'gpt-5.5',
    permission_mode: 'default',
    turn_id: 'turn-1',
    tool_name: 'Bash',
    tool_use_id: 'call-1',
    tool_input: { command: 'pwd' }
  };
  const sha = (key: unknown[]) => createHash('sha256').update(JSON.stringify(key)).digest('hex');

  it.each([
    ['claude', claudeEvent, null],
    ['codex', codexEvent, 'turn-1']
  ] as const)('asks the plugin policy for a %s PTY call with main-asserted identity', async (profile, event, turnId) => {
    const decide = vi.fn(async () => ({ action: 'deny', reason: 'blocked by plugin policy' }));
    const hook = createNativeToolPolicyHook({
      getSession: (id) => (id === 'session-1' ? { id, projectId: 'project-1', profile, status: 'running' } : null),
      decider: () => decide
    });
    await expect(hook('project-1', 'session-1', JSON.stringify(event))).resolves.toEqual({ decision: 'deny', reason: 'blocked by plugin policy' });
    expect(decide).toHaveBeenCalledWith({
      invocationId: sha(['session-1', turnId, event.tool_use_id, 'Bash', { command: 'pwd' }]),
      threadId: 'session-1', projectId: 'project-1', profile, toolName: 'Bash', input: { command: 'pwd' }
    });
  });

  // host.ts wires the hook to main's live PtyManager and the runtime supervisor.
  // No supervisor runs under unit bootstrap; the supervised path is proven by
  // e2e/native-tool-policy-pty.spec.ts.
  it('fails closed without a supervisor outside electron-vite dev, never asking a product server', async () => {
    liveSessions.set('session-1', { id: 'session-1', projectId: 'project-1', profile: 'claude', status: 'running' });
    vi.stubEnv('ELECTRON_RENDERER_URL', '');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      await expect(nativeToolPolicyHook('project-1', 'session-1', JSON.stringify(claudeEvent))).resolves.toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      vi.unstubAllEnvs();
      vi.stubEnv('ZCC_SERVER_URL', 'http://127.0.0.1:9/');
      liveSessions.clear();
    }
  });

  it('in electron-vite dev, wires main\'s hook to the live PTY record and the signed product route', async () => {
    liveSessions.set('session-1', { id: 'session-1', projectId: 'project-1', profile: 'claude', status: 'running' });
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173/');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ action: 'deny', reason: 'blocked by dev policy' }));
    try {
      await expect(nativeToolPolicyHook('project-1', 'session-1', JSON.stringify(claudeEvent))).resolves.toEqual({
        decision: 'deny', reason: 'blocked by dev policy'
      });
      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(new URL(String(url)).pathname).toBe('/api/v1/native-tool-policy');
      expect((init!.headers as Record<string, string>)['x-zcc-native-tool-policy-proof']).toMatch(/^\d{13}\.[a-f0-9]{32}\.[a-f0-9]{64}$/);
      expect(JSON.parse(init!.body as string)).toMatchObject({ threadId: 'session-1', projectId: 'project-1', profile: 'claude', toolName: 'Bash' });

      fetchSpy.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
      await expect(nativeToolPolicyHook('project-1', 'session-1', JSON.stringify(claudeEvent))).resolves.toBeNull();
      await expect(nativeToolPolicyHook('project-1', 'session-unknown', JSON.stringify(claudeEvent))).resolves.toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(new URL(String(fetchSpy.mock.calls[0]![0])).origin).toBe('http://127.0.0.1:9');
    } finally {
      fetchSpy.mockRestore();
      vi.unstubAllEnvs();
      vi.stubEnv('ZCC_SERVER_URL', 'http://127.0.0.1:9/');
      liveSessions.clear();
    }
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
