import { useEffect, useRef } from 'react';
import { listContentScripts, subscribePluginSlots } from './plugin-slots.js';
import { observeAgentActivity } from './agent-activity.js';
import { subscribeProductEvent } from '../lib/product-ws.js';

/**
 * Mounts plugin content scripts once at app init (Rule 3). Disposes and
 * remounts when a plugin's generation changes.
 */
export function PluginContentScriptsHost() {
  const controllers = useRef(new Map<string, AbortController>());

  useEffect(() => {
    const sync = () => {
      const scripts = listContentScripts();
      const wanted = new Set(scripts.map((row) => `${row.pluginId}:${row.id}:${row.generation}`));
      for (const [key, controller] of controllers.current) {
        if (!wanted.has(key)) {
          controller.abort();
          controllers.current.delete(key);
        }
      }
      for (const script of scripts) {
        const key = `${script.pluginId}:${script.id}:${script.generation}`;
        if (controllers.current.has(key)) continue;
        const controller = new AbortController();
        controllers.current.set(key, controller);
        const bind = (off: () => void) => {
          let disposed = false;
          const dispose = () => { if (disposed) return; disposed = true; controller.signal.removeEventListener('abort', dispose); off(); };
          controller.signal.addEventListener('abort', dispose, { once: true });
          return dispose;
        };
        void Promise.resolve().then(() => controller.signal.aborted ? undefined : script.mount({
            pluginId: script.pluginId,
            generation: script.generation,
            signal: controller.signal,
            experimental_observeAgents: (listener) => {
              if (controller.signal.aborted) return () => undefined;
              return bind(observeAgentActivity(snapshot => { try { listener(snapshot); } catch { /* plugin failure is isolated */ } }));
            },
            experimental_onSignal: (channel, listener) => {
              if (controller.signal.aborted) return () => undefined;
              const off = subscribeProductEvent<{ pluginId: string; channel: string; payload: unknown }>('plugin-signal', event => {
                if (event.pluginId === script.pluginId && event.channel === channel) { try { listener(event.payload); } catch { /* plugin failure is isolated */ } }
              });
              return bind(off);
            }
          }))
          .then((dispose) => {
            if (typeof dispose !== 'function') return;
            const onAbort = () => {
              try { void Promise.resolve(dispose()).catch(() => { /* isolated */ }); } catch { /* isolated */ }
            };
            if (controller.signal.aborted) onAbort();
            else controller.signal.addEventListener('abort', onAbort, { once: true });
          })
          .catch(() => {
            /* isolated */
          });
      }
    };
    sync();
    return subscribePluginSlots(sync);
  }, []);

  useEffect(
    () => () => {
      for (const controller of controllers.current.values()) controller.abort();
      controllers.current.clear();
    },
    []
  );

  return null;
}
