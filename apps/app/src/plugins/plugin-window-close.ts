import { useSyncExternalStore } from 'react';
import { product } from '../lib/product-client.js';

type Handler = (signal: AbortSignal) => void | Promise<void>;
const handlers = new Set<Handler>();
const listeners = new Set<() => void>();
let state: { pending: boolean; error?: string } = { pending: false };
let unsubscribe: (() => void) | undefined;
let active: Promise<void> | undefined;
let latestRequestId: string | undefined;
let activeController: AbortController | undefined;
const publish = (next: typeof state) => { state = next; for (const listener of listeners) listener(); };

/** One renderer subscription; handlers live exactly as long as their mounted plugin components. */
export function registerPluginWindowCloseHandler(handler: Handler): () => void {
  handlers.add(handler);
  if (!unsubscribe && product.windows.onPluginViewCloseRequest) {
    unsubscribe = product.windows.onPluginViewCloseRequest(request => {
      if (request.error) { activeController?.abort(); publish({ pending: false, error: request.error }); return; }
      if (!request.requestId) return;
      latestRequestId = request.requestId;
      publish({ pending: true });
      // Retries reuse one in-flight handoff rather than accumulating plugin calls.
      if (active) return;
      const controller = new AbortController();
      activeController = controller;
      active = (async () => {
        try {
          for (const close of [...handlers]) {
            if (controller.signal.aborted) throw Error('Closing was cancelled. Your window remains open.');
            await close(controller.signal);
          }
          if (activeController !== controller) return;
          if (controller.signal.aborted) throw Error('Closing was cancelled. Your window remains open.');
          await product.windows.pluginViewCloseComplete(latestRequestId!, { ok: true });
        } catch (error) {
          if (activeController !== controller) return;
          const message = error instanceof Error ? error.message : 'Could not prepare this window to close.';
          publish({ pending: false, error: message });
          await product.windows.pluginViewCloseComplete(latestRequestId!, { ok: false, error: message }).catch(() => false);
        }
      })().finally(() => {
        if (activeController === controller) { active = undefined; latestRequestId = undefined; activeController = undefined; }
      });
    });
    void product.windows.pluginViewCloseReady(true).catch(() => false);
  }
  return () => {
    handlers.delete(handler);
    if (handlers.size || !unsubscribe) return;
    activeController?.abort();
    active = undefined; latestRequestId = undefined; activeController = undefined;
    unsubscribe(); unsubscribe = undefined;
    void product.windows.pluginViewCloseReady(false).catch(() => false);
    publish({ pending: false });
  };
}

export function usePluginWindowCloseState() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => state, () => state);
}
