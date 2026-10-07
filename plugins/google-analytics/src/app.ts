import { pageForPath } from '../pages.js';

type Context = { pluginId: string; signal?: AbortSignal };
type Result = { ok?: boolean; collected?: boolean; needsOpen?: boolean };
type Kind = 'open' | 'page' | 'heartbeat';
type Script = { id: string; mount(ctx: Context): (() => void) | undefined };

export default {
  __zccPluginApp: true,
  setup(app: { contentScripts: { register(script: Script): void } }) {
    app.contentScripts.register({
      id: 'app-usage',
      mount(ctx) {
        const win = globalThis as typeof globalThis & {
          __ZCC_PLUGIN_HOST__?: { callRpc(pluginId: string, method: string, payload: unknown): Promise<Result> };
        };
        const host = win.__ZCC_PLUGIN_HOST__;
        const doc = win.document;
        if (!host || !doc || ctx.signal?.aborted) return;
        const viewId = crypto.randomUUID();
        let disposed = false;
        let pending = false;
        let opened = false;
        let previousPage: string | undefined;
        let lastSentAt = Date.now();
        let lastPresenceAt = lastSentAt;
        let sampledAt = lastSentAt;
        let wasVisible = doc.visibilityState !== 'hidden';
        let engagementMs = 0;

        const send = async (kind: Kind, page: string) => {
          pending = true;
          lastSentAt = Date.now();
          if (kind !== 'page') lastPresenceAt = lastSentAt;
          const duration = engagementMs;
          engagementMs = 0;
          try {
            const result = await host.callRpc(ctx.pluginId, 'track', { kind, page, viewId, engagementMs: duration });
            if (!disposed) {
              if (result?.ok) {
                opened = true;
                previousPage = page;
                // Page opt-out acknowledges navigation locally; keep this time
                // for the next presence event when nothing was collected.
                if (result.collected === false) engagementMs = Math.min(60000, engagementMs + duration);
              } else {
                opened = false;
                if (result?.needsOpen) lastSentAt -= 60000;
              }
            }
          } catch { opened = false; /* Analytics never interrupts navigation. */ }
          finally { pending = false; }
        };
        const tick = () => {
          if (disposed) return;
          const now = Date.now();
          const visible = doc.visibilityState !== 'hidden';
          // Sleeping/suspended/background time is not engagement.
          if (wasVisible) engagementMs = Math.min(60000, engagementMs + Math.max(0, Math.min(1000, now - sampledAt)));
          sampledAt = now;
          wasVisible = visible;
          if (!visible || pending) return;
          const page = pageForPath(win.location?.pathname || '/');
          if (!opened) { if (now - lastSentAt >= 60000) void send('open', page); }
          else if (page !== previousPage && now - lastSentAt >= 1000) void send('page', page);
          else if (now - lastPresenceAt >= 60000) void send('heartbeat', page);
        };

        if (wasVisible) void send('open', pageForPath(win.location?.pathname || '/'));
        // Observe the URL without wrapping History: other analytics can coexist.
        const timer = setInterval(tick, 1000);
        doc.addEventListener('visibilitychange', tick);
        const dispose = () => {
          if (disposed) return;
          disposed = true;
          clearInterval(timer);
          doc.removeEventListener('visibilitychange', tick);
          ctx.signal?.removeEventListener('abort', dispose);
        };
        ctx.signal?.addEventListener('abort', dispose, { once: true });
        return dispose;
      }
    });
  }
};
