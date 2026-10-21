import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { ctx } from './ctx.js';
import { isTrustedRendererUrl } from '../window/renderer-url.js';
import type { CompanionController } from '../companion.js';

/**
 * Command Center companion verbs. The rail/panel verbs are accepted ONLY from
 * the companion's own windows (main frame, trusted renderer origin); `enter`
 * is also callable from the app windows (sidebar button). Every argument is an
 * untrusted lookup the controller re-authorizes from main state (Rule 1).
 */
export function registerCompanionIpc(): void {
  const companion = (): CompanionController | null => ctx.companion ?? null;

  const fromCompanion = <TArgs extends unknown[], TResult>(
    channel: string,
    handler: (c: CompanionController, ...args: TArgs) => TResult,
    fallback: TResult
  ) => {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: TArgs) => {
      try {
        const c = companion();
        if (!c || !trustedFrame(event) || !c.ownsSender(event.sender)) return fallback;
        return handler(c, ...args);
      } catch (err) {
        ctx.logMainError(`ipc ${channel}`, err);
        return fallback;
      }
    });
  };

  fromCompanion(IPC.companion.request, (c) => c.buildSnapshot(), null);
  fromCompanion(IPC.companion.exit, (c) => c.exit(), undefined);
  fromCompanion(IPC.companion.openPanel, (c, kind: unknown, focus: unknown) => c.openPanel(kind, focus), undefined);
  fromCompanion(IPC.companion.closePanel, (c) => c.closePanel(), undefined);
  fromCompanion(IPC.companion.panelState, (c) => c.getPanelState(), null);
  fromCompanion(IPC.companion.tooltip, (c, tip: unknown) => c.tooltip(tip), undefined);
  fromCompanion(IPC.companion.tooltipState, (c) => c.getTooltip(), null);
  fromCompanion(IPC.companion.dragStart, (c) => c.dragStart(), undefined);
  fromCompanion(IPC.companion.dragEnd, (c) => c.dragEnd(), undefined);
  fromCompanion(IPC.companion.answer, (c, id: unknown, text: unknown) => c.answer(id, text), {
    ok: false,
    reason: 'unknown' as const
  });
  fromCompanion(IPC.companion.open, (c, target: unknown) => c.open(target as never), undefined);
  fromCompanion(IPC.companion.runSchedule, (c, taskId: unknown) => c.runSchedule(taskId), false);

  // Entry from the app itself (sidebar button / tray / menu route through main
  // directly). Any trusted app frame may ask; the controller gates on the flag.
  ipcMain.handle(IPC.companion.enter, (event: IpcMainInvokeEvent) => {
    try {
      if (!trustedFrame(event)) return false;
      return companion()?.enter() ?? false;
    } catch (err) {
      ctx.logMainError(`ipc ${IPC.companion.enter}`, err);
      return false;
    }
  });
}

function trustedFrame(event: IpcMainInvokeEvent): boolean {
  return event.senderFrame === event.sender.mainFrame && isTrustedRendererUrl(event.sender.getURL());
}
