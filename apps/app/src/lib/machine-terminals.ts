import type { CcApi } from '@zana-ai/zcc-desktop-contract';
import { fetchWithAppSurface } from './fetch-with-app-surface.js';
import { hasDesktopBridge } from './app-surface.js';

type RoutedTerminals = CcApi['terminals'] & { streamsOverProductSocket?: (id: string) => Promise<boolean> };

/** Whether a session's live output travels over the product WebSocket, so a product
 * reset or reconnect can have dropped output. Desktop-bridge sessions stream over IPC. */
export async function streamsOverProductSocket(terminals: CcApi['terminals'], id: string): Promise<boolean> {
  if (!hasDesktopBridge()) return true;
  const decide = (terminals as RoutedTerminals).streamsOverProductSocket;
  if (typeof decide !== 'function') return true;
  try { return await decide.call(terminals, id); } catch { return true; }
}

/** Select transport by recorded session ownership before performing an action.
 * A failed mutation is never retried against a different machine. */
export function machineTerminals(owner: CcApi['terminals'], hosts: CcApi['terminals']): CcApi['terminals'] {
  const hostSessions = new Set<string>();
  const ownerSessions = new Set<string>();
  // This adapter is app-lifetime; retain a bounded recent routing cache only.
  function remember(set: Set<string>, id: string) {
    set.delete(id); set.add(id);
    if (set.size > 2048) set.delete(set.values().next().value!);
  }
  async function transport(id: string, signal?: AbortSignal) {
    if (hostSessions.has(id)) return hosts;
    if (ownerSessions.has(id)) return owner;
    const response = await fetchWithAppSurface(`/api/v1/terminals/${encodeURIComponent(id)}`, { signal });
    if (response.ok) { remember(hostSessions, id); return hosts; }
    if (response.status !== 404) throw new Error('Cannot determine the terminal’s machine. Reconnect before trying again.');
    remember(ownerSessions, id); return owner;
  }
  function both<T extends unknown[]>(a: (callback: (...args: T) => void) => () => void, b: (callback: (...args: T) => void) => () => void, callback: (...args: T) => void) {
    const first = a(callback), second = b(callback);
    return () => { first(); second(); };
  }
  // Electron freezes contextBridge objects. Proxying that object directly would
  // violate JavaScript invariants when an adapter overrides a method.
  return new Proxy({} as CcApi['terminals'], {
    get(_target, method) {
      switch (method) {
        case 'create': return async (request: Parameters<CcApi['terminals']['create']>[0]) => {
          const selected = request.profile === 'shell' && request.hostId ? hosts : owner;
          const result = await selected.create(request);
          if (result.ok) remember(selected === hosts ? hostSessions : ownerSessions, result.value.id);
          return result;
        };
        case 'list': return async (projectId: string) => {
          const [local, remote] = await Promise.all([owner.list(projectId), hosts.list(projectId)]);
          local.forEach(session => remember(ownerSessions, session.id));
          remote.forEach(session => remember(hostSessions, session.id));
          return [...new Map([...local, ...remote].map(session => [session.id, session])).values()];
        };
        case 'backlogSnapshot': return async (id: string, signal?: AbortSignal) => {
          const selected = await transport(id, signal);
          return selected.backlogSnapshot ? selected.backlogSnapshot(id, ...(selected === hosts ? [signal] : [])) : selected.backlog(id);
        };
        case 'write': case 'reply': case 'resize': case 'close': case 'backlog':
          return async (id: string, ...args: unknown[]) => {
            const selected = await transport(id);
            return (selected[method] as (...values: any[]) => unknown)(id, ...args);
          };
        case 'streamsOverProductSocket': return async (id: string) => (await transport(id)) === hosts;
        case 'onData': return (cb: Parameters<CcApi['terminals']['onData']>[0]) => both(owner.onData, hosts.onData, cb);
        case 'onExit': return (cb: Parameters<CcApi['terminals']['onExit']>[0]) => both(owner.onExit, hosts.onExit, cb);
        case 'onUpdated': return (cb: Parameters<CcApi['terminals']['onUpdated']>[0]) => both(owner.onUpdated, hosts.onUpdated, cb);
        default: return Reflect.get(owner, method);
      }
    }
  });
}
