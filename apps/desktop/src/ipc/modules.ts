// @ts-nocheck
import { ipcMain } from 'electron';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { ctx } from './ctx.js';
import * as testTap from '../test-tap.js';
import { pushInboxOnBehalfOf } from '../extensions/inbox-broker.js';
import { store } from '@zana-ai/zcc-server/services/projects/store';

export function registerModulesIpc(): void {
  

  // App-module multiplexer: one handler set serves every module (plugins/*).
  // `call` dispatches to the module's capability; `storage*` back its KV store.
  ctx.safeHandle(
    IPC.modules.call,
    (moduleId: string, capability: string, args: unknown[]) =>
      ctx.moduleRouter.dispatch(moduleId, capability, Array.isArray(args) ? args : []),
    (err) => {
      // Re-throw so the renderer's invoke() rejects with the real message,
      // which the module panel renders in its error state.
      throw err instanceof Error ? err : new Error(String(err));
    }
  );
  ctx.safeHandle(
    IPC.modules.storageGet,
    (moduleId: string, key: string) => ctx.moduleRouter.storageGet(moduleId, key),
    () => undefined
  );
  ctx.safeHandle(
    IPC.modules.storageSet,
    (moduleId: string, key: string, value: unknown) => {
      ctx.moduleRouter.storageSet(moduleId, key, value);
    },
    () => undefined
  );
  // W1-4 durable park: the renderer pulls + CLEARS every launch a main module
  // parked (on panel mount + on each `launchParked` nudge). Draining removes
  // them so a launch requested while no panel was listening is delivered on the
  // next attach, never re-delivered nor dropped. Rule 1: this returns the
  // ADVISORY spec; the renderer re-authorizes/spawns via its confined launch path.
  ctx.safeHandle(
    IPC.modules.drainParkedLaunches,
    () => ctx.hostCommandRelay.drainParked(),
    () => []
  );
  // W1-5 main-reachable host UX: the renderer replies a confirm/notify answer
  // back to main, keyed by the dialog's requestId, so the relay resolves the
  // child's pending broker Promise. Fire-and-forget from the renderer's side (it
  // doesn't await this); a late/unknown id is a harmless no-op.
  ctx.safeHandle(
    IPC.modules.replyHostDialog,
    (requestId: string, answer: unknown) => {
      ctx.hostCommandRelay.resolveDialog(String(requestId), answer);
    },
    () => undefined
  );
  // Inbox push on a module's behalf. P3-B: gate inbox:push MAIN-SIDE against the
  // permission broker, keyed by the passed moduleId. NOTE (anti-spoof): the
  // renderer passes its own moduleId as a plain arg — main gates the CLAIMED id.
  // A built-in id always passes (trusted); a disk ext is denied unless it
  // declared inbox:push. This is best-effort attribution until P3-C gives each
  // panel an authenticated origin (a panel today could claim another id). Still
  // strictly better than P3-A: a disk ext that lacks the grant cannot push.
  // Shared validation with the brokered main-process path (`inbox-broker.ts`);
  // this path passes NO `extensionSource` — its `moduleId` is only a claim,
  // never authenticated, unlike the brokered child path's port-bound id.
  ctx.safeHandle(
    IPC.modules.pushInbox,
    async (
      moduleId: string,
      msg: { projectId: string; comments?: string; docs?: Array<{ path: string }> }
    ) => {
      ctx.permissionBroker.assert(moduleId, 'inbox:push');
      return pushInboxOnBehalfOf(
        { inboxStore: ctx.inboxStore, projectExists: (id) => store.listProjects().some((p) => p.id === id) },
        moduleId,
        msg
      );
    },
    (err) => {
      throw err instanceof Error ? err : new Error(String(err));
    }
  );

  // E2E test-observability handlers — registered ONLY when the tap is enabled,
  // so with ZCC_E2E unset there is no `test:*` surface at all (an invoke would
  // reject "No handler registered"). Backed by the ring buffer in test-tap.ts.
  if (ctx.E2E_TAP_ENABLED) {
    ipcMain.handle(IPC.test.drainEvents, (_e, cursor: unknown) =>
      testTap.drain(typeof cursor === 'number' ? cursor : 0)
    );
  ipcMain.handle(IPC.test.snapshot, () => testTap.snapshot());
  ipcMain.handle(IPC.test.reset, () => {
      testTap.reset();
    });
  }
}

