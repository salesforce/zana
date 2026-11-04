import type { WebSocket } from 'ws';
import { boundedSocketSender } from './bounded-socket-sender.js';

export type ProductEventType =
  | 'product:reset'
  | 'shared:changed'
  | 'inbox:appended'
  | 'inbox:removed'
  | 'inbox:updated'
  | 'inbox:pruned'
  | 'suggestions:appended'
  | 'suggestions:removed'
  | 'suggestions:updated'
  | 'suggestions:pruned'
  | 'config:changed'
  | 'projects:changed'
  | 'projects:sync'
  | 'followups:changed'
  | 'saved:changed'
  | 'agent-status:changed'
  | 'goals:changed'
  | 'scheduler:changed'
  | 'personas:changed'
  | 'threads:updated'
  | 'threads:event'
  | 'threads:open'
  | 'threads:tabs'
  | 'threads:browser'
  | 'projects:cloneProgress'
  | 'library:changed'
  | 'hosts:changed'
  | 'provider-model-catalog:changed'
  | 'terminals:data'
  | 'terminals:exit'
  | 'terminals:updated'
  | 'plugin-signal';

export interface ProductEvent {
  type: ProductEventType;
  payload: unknown;
}

/**
 * In-process fan-out for loopback `/ws` clients. The product HTTP handlers emit
 * here after a store mutation so browser tabs stay live without polling.
 */
export function createProductHub(onLibraryChanged?: () => void, onProjectsChanged?: () => void) {
  const clients = new Map<WebSocket, ReturnType<typeof boundedSocketSender>>();
  const budget = { bytes: 0, limit: 32 * 1024 * 1024 };
  const listeners = new Map<ProductEventType, Set<(payload: unknown) => void>>();
  return {
    add(socket: WebSocket): void {
      if (clients.has(socket)) return;
      if (clients.size >= 128) { socket.close(1013, 'product-client-limit'); return; }
      const sender = boundedSocketSender(socket, budget, () => clients.delete(socket));
      clients.set(socket, sender);
      socket.on('close', () => {
        sender.dispose();
        clients.delete(socket);
      });
    },
    emit(type: ProductEventType, payload: unknown): void {
      for (const listener of listeners.get(type) ?? []) listener(payload);
      const msg = JSON.stringify({ type, payload } satisfies ProductEvent);
      for (const sender of clients.values()) sender.send(msg);
      if (type === 'library:changed' || type === 'hosts:changed') { try { onLibraryChanged?.(); } catch { /* Parent shutdown must not fail an acknowledged mutation. */ } }
      if (type === 'projects:changed') { try { onProjectsChanged?.(); } catch { /* The registry commit has already succeeded. */ } }
    },
    pong(socket: WebSocket): void { clients.get(socket)?.send('{"type":"pong"}'); },
    subscribe(type: ProductEventType, listener: (payload: unknown) => void): () => void {
      const set = listeners.get(type) ?? new Set<(payload: unknown) => void>();
      set.add(listener);
      listeners.set(type, set);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(type);
      };
    },
    size(): number {
      return clients.size;
    }
  };
}

export type ProductHub = ReturnType<typeof createProductHub>;
