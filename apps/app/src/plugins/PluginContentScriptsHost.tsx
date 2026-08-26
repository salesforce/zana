import { useEffect, useRef } from 'react';
import { listContentScripts, subscribePluginSlots } from './plugin-slots.js';

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
        void Promise.resolve(
          script.mount({
            pluginId: script.pluginId,
            generation: script.generation,
            signal: controller.signal
          })
        )
          .then((dispose) => {
            if (typeof dispose !== 'function') return;
            const onAbort = () => {
              void dispose();
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
