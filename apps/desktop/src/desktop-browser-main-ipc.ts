import { BrowserWindow, ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import {
  parseDesktopBrowserAttachRequest,
  parseDesktopBrowserFindInPageRequest,
  parseDesktopBrowserImportCookiesRequest,
  parseDesktopBrowserNavigateRequest,
  parseDesktopBrowserSetBoundsRequest,
  parseDesktopBrowserSetVisibleRequest,
  parseDesktopBrowserStopFindInPageRequest,
  parseDesktopBrowserTabRef
} from '@zana-ai/zcc-desktop-contract';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import {
  bindAutomationTargetThread,
  peekPendingBrowserOpen,
  unbindAutomationTargetThread
} from './desktop-browser-automation.js';
import type { DesktopBrowserBroker } from './desktop-browser-broker.js';
import type { BrowserImportService } from './browser-import/browser-import.js';
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

export function registerDesktopBrowserIpc(
  manager: DesktopBrowserViewManager,
  options?: {
    broker?: DesktopBrowserBroker;
    browserImport?: BrowserImportService;
  }
): void {
  const broker = options?.broker;
  const browserImport = options?.browserImport;

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

  ipcMain.on(IPC.browser.setVisibleWithoutFocus, (event, payload: unknown) => {
    const hostWindow = hostWindowFromEvent(event);
    if (hostWindow === null) return;
    const parsed = parseDesktopBrowserSetVisibleRequest(payload);
    if (!parsed.success) return;
    manager.setVisibleWithoutFocus({ hostWindow, request: parsed.data });
  });

  ipcMain.on(IPC.browser.findInPage, (event, payload: unknown) => {
    const hostWindow = hostWindowFromEvent(event);
    if (hostWindow === null) return;
    const parsed = parseDesktopBrowserFindInPageRequest(payload);
    if (!parsed.success) return;
    manager.findInPage({ hostWindow, request: parsed.data });
  });

  ipcMain.on(IPC.browser.stopFindInPage, (event, payload: unknown) => {
    const hostWindow = hostWindowFromEvent(event);
    if (hostWindow === null) return;
    const parsed = parseDesktopBrowserStopFindInPageRequest(payload);
    if (!parsed.success) return;
    manager.stopFindInPage({ hostWindow, request: parsed.data });
  });

  registerTabCommand(IPC.browser.detach, (args) => manager.detach(args));
  registerTabCommand(IPC.browser.focus, (args) => manager.focus(args));
  registerTabCommand(IPC.browser.goBack, (args) => manager.goBack(args));
  registerTabCommand(IPC.browser.goForward, (args) => manager.goForward(args));
  registerTabCommand(IPC.browser.reload, (args) => manager.reload(args));
  registerTabCommand(IPC.browser.stop, (args) => manager.stop(args));

  ipcMain.handle(IPC.browser.registerAutomationTarget, (event, payload: unknown) => {
    const hostWindow = hostWindowFromEvent(event);
    if (hostWindow === null) return { ok: false };
    if (!payload || typeof payload !== 'object') return { ok: false };
    const record = payload as { targetId?: unknown; tabId?: unknown; threadId?: unknown };
    if (typeof record.targetId !== 'string' || typeof record.tabId !== 'string') return { ok: false };
    const pending = peekPendingBrowserOpen(record.targetId);
    const threadId =
      typeof record.threadId === 'string' && record.threadId.length > 0
        ? record.threadId
        : pending?.threadId;
    if (threadId) bindAutomationTargetThread(record.targetId, threadId, record.tabId);
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
    unbindAutomationTargetThread(targetId);
    return { ok: manager.unregisterAutomationTarget(targetId) };
  });

  ipcMain.handle(IPC.browser.stopAutomation, (_event, targetId: unknown) => {
    if (typeof targetId !== 'string' || targetId.length === 0) return { ok: false };
    manager.closeAutomationTarget(targetId);
    unbindAutomationTargetThread(targetId);
    return { ok: true };
  });

  ipcMain.handle(IPC.browser.getControl, (event, payload: unknown) => {
    const parsed = parseDesktopBrowserTabRef(payload);
    if (!parsed.success) return null;
    return broker?.getControl(event.sender.id, parsed.data.tabId) ?? null;
  });

  ipcMain.handle(IPC.browser.releaseControl, (event, payload: unknown) => {
    const parsed = parseDesktopBrowserTabRef(payload);
    if (!parsed.success) return { ok: false };
    broker?.takeOver(event.sender.id, parsed.data.tabId);
    return { ok: true };
  });

  ipcMain.handle(IPC.browser.listImportSources, async () => {
    if (!browserImport) return { sources: [] };
    return { sources: await browserImport.listSources() };
  });

  ipcMain.handle(IPC.browser.importCookies, async (_event, payload: unknown) => {
    if (!browserImport) {
      return { ok: false, reason: 'readFailed' as const };
    }
    const parsed = parseDesktopBrowserImportCookiesRequest(payload);
    if (!parsed.success) {
      return { ok: false, reason: 'unknownSourceProfile' as const };
    }
    const profile = parsed.data.intoAutomation
      ? { kind: 'automation' as const, id: 'imported' }
      : { kind: 'personal' as const };
    return browserImport.importCookies(
      {
        sourceId: parsed.data.sourceId,
        sourceProfileDirectory: parsed.data.sourceProfileDirectory
      },
      manager.profileSession(profile)
    );
  });

  ipcMain.handle(IPC.browser.openFullDiskAccessSettings, async () => {
    if (process.platform !== 'darwin') return { ok: false };
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'
    );
    return { ok: true };
  });
}
