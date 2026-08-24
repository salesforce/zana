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
  | 'projects:cloneProgress'
  | 'library:changed'
  | 'terminals:data'
  | 'terminals:exit'
  | 'terminals:updated';

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
  return {
    add(socket: WebSocket): void {
      clients.add(socket);
      socket.on('close', () => {
        clients.delete(socket);
      });
    },
    emit(type: ProductEventType, payload: unknown): void {
      const msg = JSON.stringify({ type, payload } satisfies ProductEvent);
      for (const socket of clients) {
        if (socket.readyState === socket.OPEN) socket.send(msg);
      }
    },
    size(): number {
      return clients.size;
    }
  };
}

export type ProductHub = ReturnType<typeof createProductHub>;
