import { BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import {
  parseDesktopBrowserAttachRequest,
  parseDesktopBrowserNavigateRequest,
  parseDesktopBrowserSetBoundsRequest,
  parseDesktopBrowserSetVisibleRequest,
  parseDesktopBrowserTabRef
} from '@zana-ai/zcc-desktop-contract';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import type { DesktopBrowserViewManager } from './desktop-browser-view.js';

function hostWindowFromEvent(event: IpcMainEvent | IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

function registerTabCommand(
  channel: string,
  run: (args: { hostWindow: BrowserWindow; tabId: string }) => void
): void {
  ipcMain.on(channel, (event, payload: unknown) => {
    const hostWindow = hostWindowFromEvent(event);
    if (hostWindow === null) return;
    const parsed = parseDesktopBrowserTabRef(payload);
    if (!parsed.success) return;
    run({ hostWindow, tabId: parsed.data.tabId });
  });
}

export function registerDesktopBrowserIpc(manager: DesktopBrowserViewManager): void {
  ipcMain.on(IPC.browser.attach, (event, payload: unknown) => {
    const hostWindow = hostWindowFromEvent(event);
    if (hostWindow === null) return;
    const parsed = parseDesktopBrowserAttachRequest(payload);
    if (!parsed.success) return;
    manager.attach({ hostWindow, request: parsed.data });
  });

  ipcMain.on(IPC.browser.navigate, (event, payload: unknown) => {
    const hostWindow = hostWindowFromEvent(event);
    if (hostWindow === null) return;
    const parsed = parseDesktopBrowserNavigateRequest(payload);
    if (!parsed.success) return;
    manager.navigate({ hostWindow, request: parsed.data });
  });

  ipcMain.on(IPC.browser.setBounds, (event, payload: unknown) => {
    const hostWindow = hostWindowFromEvent(event);
    if (hostWindow === null) return;
    const parsed = parseDesktopBrowserSetBoundsRequest(payload);
    if (!parsed.success) return;
    manager.setBounds({ hostWindow, request: parsed.data });
  });

  ipcMain.on(IPC.browser.setVisible, (event, payload: unknown) => {
    const hostWindow = hostWindowFromEvent(event);
    if (hostWindow === null) return;
    const parsed = parseDesktopBrowserSetVisibleRequest(payload);
    if (!parsed.success) return;
    manager.setVisible({ hostWindow, request: parsed.data });
  });

  registerTabCommand(IPC.browser.detach, (args) => manager.detach(args));
  registerTabCommand(IPC.browser.goBack, (args) => manager.goBack(args));
  registerTabCommand(IPC.browser.goForward, (args) => manager.goForward(args));
  registerTabCommand(IPC.browser.reload, (args) => manager.reload(args));
  registerTabCommand(IPC.browser.stop, (args) => manager.stop(args));

  ipcMain.handle(IPC.browser.registerAutomationTarget, (event, payload: unknown) => {
    const hostWindow = hostWindowFromEvent(event);
    if (hostWindow === null) return { ok: false };
    if (!payload || typeof payload !== 'object') return { ok: false };
    const record = payload as { targetId?: unknown; tabId?: unknown };
    if (typeof record.targetId !== 'string' || typeof record.tabId !== 'string') return { ok: false };
    return {
      ok: manager.registerAutomationTarget({
        tabId: record.tabId,
        targetId: record.targetId,
        hostWebContentsId: hostWindow.webContents.id
      })
    };
  });

  ipcMain.handle(IPC.browser.unregisterAutomationTarget, (_event, targetId: unknown) => {
    if (typeof targetId !== 'string' || targetId.length === 0) return { ok: false };
    return { ok: manager.unregisterAutomationTarget(targetId) };
  });

  ipcMain.handle(IPC.browser.stopAutomation, (_event, targetId: unknown) => {
    if (typeof targetId !== 'string' || targetId.length === 0) return { ok: false };
    manager.closeAutomationTarget(targetId);
    return { ok: true };
  });
}
