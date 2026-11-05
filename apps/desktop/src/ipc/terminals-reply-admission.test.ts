import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, { handler: (...args: any[]) => any }>();
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() }, app: { getPath: () => '/tmp' } }));
vi.mock('./shared-product-registration.js', () => ({
  productHandle: (channel: string, handler: (...args: any[]) => any) => { handlers.set(channel, { handler }); },
  safeProductHandle: (channel: string, handler: (...args: any[]) => any) => { handlers.set(channel, { handler }); }
}));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({ store: { listProjects: () => [], getConfig: () => ({}) } }));
vi.mock('@zana-ai/zcc-host-daemon/tmux', () => ({ listLocalTmuxSessionIds: vi.fn(), verifyTmux: vi.fn() }));
vi.mock('@zana-ai/zcc-host-daemon/remembered-sessions', () => ({ listRememberedTombstones: vi.fn() }));
vi.mock('@zana-ai/zcc-host-daemon/harness/cli-plan-watch', () => ({ CliPlanWatcher: class { onSessionExit() {} } }));

import { IPC } from '@zana-ai/zcc-desktop-contract';
import { bindIpcCtx } from './ctx.js';
import { registerTerminalsIpc } from './terminals.js';

const session = { id: 's1', projectId: 'p1', status: 'running' };
const ptys = { on: vi.fn(), getSession: vi.fn(), reply: vi.fn() };
const admitPtyDispatch = vi.fn();
const refresh = vi.fn();

beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();
  ptys.getSession.mockImplementation((id: string) => (id === 's1' ? session : null));
  ptys.reply.mockReturnValue(true);
  admitPtyDispatch.mockResolvedValue(null);
  bindIpcCtx({ ptys, safeSend: vi.fn(), admitPtyDispatch, menubarPopoverEnabled: () => true, MENUBAR_REPLY_MAX_CHARS: 100, menubar: { refresh } } as never);
  registerTerminalsIpc();
});

describe('terminals.reply admission', () => {
  const reply = (id: string, text: string) => handlers.get(IPC.terminals.reply)!.handler(id, text);

  it('admits against the session record main holds, never renderer-supplied identity, then delivers', async () => {
    await expect(reply('s1', 'hi')).resolves.toBe(true);
    expect(admitPtyDispatch).toHaveBeenCalledWith({ sessionId: 's1', projectId: 'p1', entry: 'reply', origin: 'user', promptText: 'hi' });
    expect(ptys.reply).toHaveBeenCalledWith('s1', 'hi');
  });

  it('does not deliver when admission refuses', async () => {
    admitPtyDispatch.mockResolvedValue({ code: 'DISPATCH_REJECTED', message: 'no' });
    await expect(reply('s1', 'hi')).resolves.toBe(false);
    expect(ptys.reply).not.toHaveBeenCalled();
  });

  it('reports a dead session without asking plugins', async () => {
    ptys.reply.mockReturnValue(false);
    await expect(reply('ghost', 'hi')).resolves.toBe(false);
    expect(admitPtyDispatch).not.toHaveBeenCalled();
  });
});

describe('menubar.reply admission', () => {
  const reply = (id: string, text: string) => handlers.get(IPC.menubar.reply)!.handler(id, text);

  it('admits the sanitized reply and delivers it', async () => {
    const result = await reply('s1', 'hello');
    expect(result.ok).toBe(true);
    expect(admitPtyDispatch).toHaveBeenCalledWith({ sessionId: 's1', projectId: 'p1', entry: 'reply', origin: 'user', promptText: 'hello' });
  });

  it('does not deliver when admission refuses', async () => {
    admitPtyDispatch.mockResolvedValue({ code: 'DISPATCH_WAITING', message: 'busy' });
    const result = await reply('s1', 'hello');
    expect(result).toEqual({ ok: false, reason: 'ended' });
    expect(ptys.reply).not.toHaveBeenCalled();
  });
});
