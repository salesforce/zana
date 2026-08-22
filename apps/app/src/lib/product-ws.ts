import { getAppSurface } from './app-surface.js';

export interface ProductWsEvent {
  type: string;
  payload: unknown;
}

type Listener = (event: ProductWsEvent) => void;

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();

function wsUrl(): string {
  const devPort =
    typeof __ZCC_DEV_WS_PORT__ === 'number' && Number.isFinite(__ZCC_DEV_WS_PORT__)
      ? __ZCC_DEV_WS_PORT__
      : undefined;
  if (devPort && getAppSurface() === 'web') {
    return `ws://127.0.0.1:${devPort}/ws`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

function connect(): void {
  if (typeof WebSocket === 'undefined') return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  try {
    socket = new WebSocket(wsUrl());
  } catch {
    scheduleReconnect();
    return;
  }
  socket.addEventListener('message', (event) => {
    try {
      const parsed = JSON.parse(String(event.data)) as ProductWsEvent;
      if (!parsed || typeof parsed.type !== 'string') return;
      for (const listener of listeners) listener(parsed);
    } catch {
      /* ignore malformed frames */
    }
  });
  socket.addEventListener('close', () => {
    socket = null;
    if (listeners.size > 0) scheduleReconnect();
  });
  socket.addEventListener('error', () => {
    socket?.close();
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 1500);
}

export function subscribeProductWs(listener: Listener): () => void {
  listeners.add(listener);
  connect();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      socket?.close();
      socket = null;
    }
  };
}

export function subscribeProductEvent<T>(type: string, callback: (payload: T) => void): () => void {
  return subscribeProductWs((event) => {
    if (event.type === type) callback(event.payload as T);
  });
}
