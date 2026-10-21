import { beforeEach, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { bindIpcCtx } from './ctx.js';
const h = vi.hoisted(() => ({ openIn: vi.fn(), trusted: vi.fn(), locate: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: { handle() {} }, BrowserWindow: {}, dialog: {}, shell: {}, clipboard: {} }));
vi.mock('./shared.js', () => ({ trustedProjectRoot: h.trusted, rejectRoot: () => ({ ok: false }) }));
vi.mock('../native/openers.js', () => ({ openIn: h.openIn }));
vi.mock('../native/preview-file-location.js', () => ({ previewFileLocation: h.locate }));
vi.mock('@zana-ai/zcc-server/electron-data-dir', () => ({ electronZccDataDir: () => '/data' }));
vi.mock('@zana-ai/zcc-host-daemon/identity', () => ({ readPersistedHostId: () => 'local' }));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({
  store: { listProjects: () => [], getConfig: () => ({ editorCodeBinary: 'my-code', terminalApp: 'pwsh' }) },
  worktreeRoot: () => '/unused'
}));
import { registerFsIpc } from './fs.js';
const handlers = new Map<string, (...args: any[]) => any>();
beforeEach(() => {
  vi.clearAllMocks(); handlers.clear(); h.openIn.mockResolvedValue({ ok: true });
  bindIpcCtx({ localProjects: () => [], safeHandle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler) } as never);
  registerFsIpc();
});

it('confines again when revealing and never calls the OS opener for unavailable files', async () => {
  const input = { path: 'app.dmg', source: 'workspace' };
  h.locate.mockResolvedValueOnce({ ok: true, path: '/real/project/app.dmg' });
  await expect(handlers.get(IPC.openers.revealFile)!(input)).resolves.toEqual({ ok: true });
  expect(h.openIn).toHaveBeenCalledExactlyOnceWith('finder', '/real/project/app.dmg');
  h.openIn.mockClear(); h.locate.mockResolvedValueOnce({ ok: false, message: 'Unavailable' });
  await expect(handlers.get(IPC.openers.revealFile)!(input)).resolves.toEqual({ ok: false, message: 'Unavailable' });
  expect(h.openIn).not.toHaveBeenCalled();
});

it('reads authoritative thread scope from the server and refuses server failures', async () => {
  h.locate.mockResolvedValue({ ok: false });
  await handlers.get(IPC.openers.fileLocation)!({ path: 'app.dmg', source: 'workspace' });
  const deps = h.locate.mock.calls[0][1];
  expect(deps).toMatchObject({ dataDir: '/data', localHostId: 'local', projects: [] });
  const request = vi.spyOn(globalThis, 'fetch');
  try {
    request.mockResolvedValueOnce(new Response(JSON.stringify({ thread: { hostId: 'local', cwd: '/real/project' } })));
    await expect(deps.thread('t1')).resolves.toEqual({ hostId: 'local', cwd: '/real/project' });
    expect(String(request.mock.calls[0][0])).toContain('/api/v1/threads/t1');
    request.mockResolvedValueOnce(new Response('', { status: 404 }));
    await expect(deps.thread('cli-1')).resolves.toBeNull();
    request.mockResolvedValueOnce(new Response('', { status: 503 }));
    await expect(deps.thread('t1')).rejects.toThrow('Thread unavailable');
  } finally { request.mockRestore(); }
});
const overrides = expect.objectContaining({ codeBinary: 'my-code', terminalApp: 'pwsh' });
it('opens the file inside a project root only once main trusts that root', async () => {
  h.trusted.mockResolvedValueOnce('/real/project');
  await expect(handlers.get(IPC.openers.openIn)!('code', '/real/project/a.ts', { projectRoot: '/project' })).resolves.toEqual({ ok: true });
  expect(h.trusted).toHaveBeenCalledWith('/project');
  expect(h.openIn).toHaveBeenCalledWith('code', '/real/project/a.ts', overrides, '/real/project');
});
it('drops an untrusted or malformed project root', async () => {
  h.trusted.mockResolvedValueOnce(null);
  await handlers.get(IPC.openers.openIn)!('cursor', '/etc/a.ts', { projectRoot: '/etc' });
  await handlers.get(IPC.openers.openIn)!('cursor', '/etc/a.ts', { projectRoot: 42 });
  await handlers.get(IPC.openers.openIn)!('finder', '/etc/a.ts');
  expect(h.trusted).toHaveBeenCalledOnce();
  expect(h.openIn.mock.calls.map((c) => c[3])).toEqual([null, null, null]);
});
