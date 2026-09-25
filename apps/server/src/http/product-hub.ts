import type { WebSocket } from 'ws';

export type ProductEventType =
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
  | 'scheduler:command'
  | 'projects:cloneProgress'
  | 'library:changed'
  | 'hosts:changed'
  | 'relay:changed'
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
export function createProductHub() {
  const clients = new Set<WebSocket>();
  const listeners = new Map<ProductEventType, Set<(payload: unknown) => void>>();
  return {
    add(socket: WebSocket): void {
      clients.add(socket);
      socket.on('close', () => {
        clients.delete(socket);
      });
    },
    emit(type: ProductEventType, payload: unknown): void {
      for (const listener of listeners.get(type) ?? []) listener(payload);
      const msg = JSON.stringify({ type, payload } satisfies ProductEvent);
      for (const socket of clients) {
        if (socket.readyState === socket.OPEN) socket.send(msg);
      }
    },
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
