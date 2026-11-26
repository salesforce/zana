import { describe, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { bindIpcCtx } from './ctx.js';
import { safeProductHandle } from './shared-product-registration.js';

vi.mock('electron', () => ({ ipcMain: {}, app: { getPath: () => '/tmp' } }));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({ store: { listProjects: () => [] } }));

vi.mock('./shared-product-registration.js', () => ({ productHandle: vi.fn(), safeProductHandle: vi.fn() }));

import { focusMenubarAgent, registerTerminalsIpc } from './terminals.js';

function deps(session: { projectId: string } | null = null) {
  return {
    ptys: { getSession: vi.fn(() => session) },
    showMainWindow: vi.fn(),
    ensureMainWindowReady: vi.fn().mockResolvedValue(true),
    openMenubarThread: vi.fn().mockResolvedValue({ ok: true }),
    logMainError: vi.fn(),
    sendToMainWindow: vi.fn().mockResolvedValue(true),
    menubar: { hide: vi.fn() }
  };
}

describe('focusMenubarAgent', () => {
  it('waits for renderer readiness before opening a Thread', async () => {
    const value = deps();
    value.ensureMainWindowReady.mockResolvedValue(false);
    await focusMenubarAgent(value, 'thread', 't1', 'p1');
    expect(value.showMainWindow).toHaveBeenCalledOnce();
    expect(value.openMenubarThread).not.toHaveBeenCalled();
    expect(value.logMainError).toHaveBeenCalledWith('menubar focus thread', expect.any(String));
  });

  it('logs rejected Thread opens and hides only after successful delivery', async () => {
    const value = deps();
    value.openMenubarThread.mockResolvedValueOnce({ ok: false, reason: 'thread unavailable' });
    await focusMenubarAgent(value, 'thread', 't1', 'p1');
    expect(value.logMainError).toHaveBeenCalledWith('menubar focus thread', 'thread unavailable');
    expect(value.menubar.hide).not.toHaveBeenCalled();
    value.openMenubarThread.mockResolvedValueOnce({ ok: true });
    await focusMenubarAgent(value, 'thread', 't1', 'p1');
    expect(value.menubar.hide).toHaveBeenCalledOnce();
  });

  it('authorizes legacy CLI focus against main session state', async () => {
    const value = deps({ projectId: 'p1' });
    await focusMenubarAgent(value, 'cli', 's1', 'wrong');
    expect(value.sendToMainWindow).not.toHaveBeenCalled();
    await focusMenubarAgent(value, 'cli', 's1', 'p1');
    expect(value.sendToMainWindow).toHaveBeenCalledWith('app:focusSession', 's1', 'p1');
  });
});

it('routes menu-bar views to the primary window and only shows it for Dashboard', async () => {
  const value = deps();
  bindIpcCtx({ ...value, ptys: { on: vi.fn() } } as never);
  registerTerminalsIpc();
  const [, open] = vi.mocked(safeProductHandle).mock.calls.find(([channel]) => channel === IPC.menubar.open)!;
  for (const view of ['agents', 'settings', 'scheduler', 'dashboard']) await open(view);
  expect(value.sendToMainWindow.mock.calls).toEqual([['app:openAgents'], ['app:openSettings'], ['app:openScheduler']]);
  expect(value.showMainWindow).toHaveBeenCalledTimes(4);
  expect(value.menubar.hide).toHaveBeenCalledTimes(4);
});
