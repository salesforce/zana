import { SHARED_PRODUCT_EVENTS, SHARED_PRODUCT_FAMILIES, SHARED_PRODUCT_METHODS } from '@zana-ai/zcc-contracts/shared-product';
import { apiJson } from './fetch-with-app-surface.js';
import { subscribeProductEvent, subscribeProductReconnect } from './product-ws.js';
const refreshReaders: Record<string, string> = {
  'config.onChanged': 'get', 'scheduler.onChanged': 'list', 'scheduler.groups.onChanged': 'list',
  'scheduler.onTemplatesChanged': 'listTemplates', 'goals.onChanged': 'list', 'followups.onChanged': 'list',
  'personas.onChanged': 'list', 'teams.onChanged': 'list', 'quickPrompts.onChanged': 'list', 'extensions.onChanged': 'list'
};
let capability: Promise<boolean> | undefined;
function hasSharedServices(): Promise<boolean> {
  return capability ??= apiJson<{ sharedProductServices: boolean }>('/system/instance')
    .then(value => value.sharedProductServices === true)
    .catch(error => { capability = undefined; throw error; });
}
/** Browser operations always target their own product origin; no local fallback. */
export function sharedProductFamily(family: string, fallback: object = {}): object {
  return new Proxy(fallback, {
    // The outer product adapter checks membership before reading a method.
    // Closed remote capabilities exist even when the standalone fallback has
    // no implementation; otherwise they are replaced with unavailable stubs.
    has(target, key) {
      if (typeof key !== 'string') return Reflect.has(target, key);
      const method = `${family}.${key}`;
      return Object.hasOwn(SHARED_PRODUCT_FAMILIES, method) || SHARED_PRODUCT_METHODS.has(method) || SHARED_PRODUCT_EVENTS.has(method) || Reflect.has(target, key);
    },
    get(target, key) {
      if (typeof key !== 'string') return Reflect.get(target, key);
      const method = `${family}.${key}`;
      if (SHARED_PRODUCT_FAMILIES[method]) return sharedProductFamily(method, Reflect.get(target, key) ?? {});
      const channel = SHARED_PRODUCT_EVENTS.get(method);
      if (channel) return (callback: (...args: unknown[]) => void) => {
        let stopped = false, unsubscribe: (() => void) | undefined, stopReconnect: (() => void) | undefined, revision = 0;
        void hasSharedServices().then(supported => {
          if (stopped) return;
          unsubscribe = supported
            ? subscribeProductEvent<{ channel: string; args: unknown[] }>('shared:changed', event => {
              if (event.channel !== channel) return;
              const before = ++revision;
              if (event.args.length > 0 || !refreshReaders[method]) { callback(...event.args); return; }
              // A zero-arg change is an invalidation (snapshot too large to carry): re-read it.
              const reader = Reflect.get(sharedProductFamily(family, target), refreshReaders[method]!);
              void (async () => reader())().then(value => {
                if (!stopped && before === revision && value !== undefined) callback(value);
              }).catch(() => {});
            })
            : Reflect.get(target, key)?.(callback);
          if (supported && refreshReaders[method]) {
            stopReconnect = subscribeProductReconnect(async () => {
              const before = ++revision;
              const reader = Reflect.get(sharedProductFamily(family, target), refreshReaders[method]!);
              const value = await reader();
              if (!stopped && before === revision) callback(value);
            });
          }
        }).catch(() => {});
        return () => { stopped = true; unsubscribe?.(); stopReconnect?.(); };
      };
      if (!SHARED_PRODUCT_METHODS.has(method)) return Reflect.get(target, key);
      return async (...args: unknown[]) => {
        if (!await hasSharedServices()) {
          // Standalone product servers keep their existing HTTP service surface.
          // This is the same origin and is decided by capabilities, never by a failed mutation.
          const existing = Reflect.get(target, key);
          if (typeof existing === 'function') return existing(...args);
          throw new Error('This operation requires the authoritative Zana desktop to be running');
        }
        const response = await apiJson<{ ok: boolean; value?: unknown; message?: string }>('/shared-product', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, args })
        });
        if (!response.ok) throw new Error(response.message ?? 'Shared product operation is unavailable');
        return response.value;
      };
    }
  });
}
