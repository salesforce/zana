import { beforeEach, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { bindIpcCtx } from './ctx.js';
const h = vi.hoisted(() => ({ openIn: vi.fn(), trusted: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: { handle() {} }, BrowserWindow: {}, dialog: {}, shell: {}, clipboard: {} }));
vi.mock('./shared.js', () => ({ trustedProjectRoot: h.trusted, rejectRoot: () => ({ ok: false }) }));
vi.mock('../native/openers.js', () => ({ openIn: h.openIn }));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({
  store: { listProjects: () => [], getConfig: () => ({ editorCodeBinary: 'my-code', terminalApp: 'pwsh' }) },
  worktreeRoot: () => '/unused'
}));
import { registerFsIpc } from './fs.js';
const handlers = new Map<string, (...args: any[]) => any>();
beforeEach(() => {
  vi.clearAllMocks(); handlers.clear(); h.openIn.mockResolvedValue({ ok: true });
  bindIpcCtx({ safeHandle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler) } as never);
  registerFsIpc();
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
