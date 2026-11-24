import { expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { bindIpcCtx } from './ctx.js';
import { registerWindowsIpc } from './windows.js';

vi.mock('electron', () => ({ ipcMain: {} }));

it('opens and leaves shell windows through the calling window registration', async () => {
  const safeHandleFromWindow = vi.fn();
  const openNewWindow = vi.fn(() => true);
  const leaveProjectWindow = vi.fn(async () => true);
  bindIpcCtx({ safeHandleFromWindow, safeHandle: vi.fn(), openNewWindow, leaveProjectWindow } as never);
  registerWindowsIpc();
  const sender = { id: 7 };
  const [, open, openFallback] = safeHandleFromWindow.mock.calls.find(([channel]) => channel === IPC.windows.openNew)!;
  expect(open(sender, 'project')).toBe(true);
  expect(openNewWindow).toHaveBeenCalledExactlyOnceWith('project');
  const [, leave, leaveFallback] = safeHandleFromWindow.mock.calls.find(([channel]) => channel === IPC.windows.leaveProject)!;
  await expect(leave(sender, 'settings')).resolves.toBe(true);
  expect(leaveProjectWindow).toHaveBeenCalledExactlyOnceWith(sender, 'settings');
  expect(openFallback()).toBe(false);
  expect(leaveFallback()).toBe(false);
});
