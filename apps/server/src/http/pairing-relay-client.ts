import WebSocket from 'ws';
import { isLoopbackHttpHost } from '../browser-bootstrap.js';
import { isAllowedHttp, isAllowedWs, normalizePairingPath } from './pairing-allowlist.js';
import {
  BODY_CHUNK,
  FLAG,
  TYPE,
  decodeFrame,
  decodeJsonPayload,
  encodeFrame,
  encodeJsonPayload
} from './pairing-relay-protocol.js';
import { isRelaySessionId, type PairingRelaySnapshot } from './pairing-session-url.js';

export type { PairingRelaySnapshot } from './pairing-session-url.js';
import { resolvePublicAppUrl } from './public-app-url.js';

export type PairingRelayState = 'connected' | 'offline' | 'unconfigured';
export type PairingRelayHello = { sessionId: string; joinUntil: number };

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'origin',
  'content-length',
  // Last hop is loopback; a forwarded Heroku Host would 403 when Settings
  // and the public origin disagree (plan: force Host 127.0.0.1).
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-proto',
  'forwarded'
]);

const PING_MS = 20_000;
const MAX_BACKOFF_MS = 30_000;
const MAX_WS = 8;

export function resolveRelayToken(input?: {
  env?: NodeJS.ProcessEnv;
  bundledToken?: string | null;
  /** @deprecated Ignored — pairing does not read Settings. */
  configToken?: string | null;
}): string | undefined {
  const env = input?.env ?? process.env;
  const fromEnv = env.ZCC_RELAY_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const bundled = input && 'bundledToken' in input
    ? input.bundledToken?.trim()
    : (typeof __ZCC_BUNDLED_RELAY_TOKEN__ === 'string' ? __ZCC_BUNDLED_RELAY_TOKEN__.trim() : undefined);
  return bundled || undefined;
}

function relayWsUrl(origin: string): string {
  const url = new URL('/_zcc/relay', origin.endsWith('/') ? origin : `${origin}/`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function isPublicOrigin(origin: string): boolean {
  try {
    return !isLoopbackHttpHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function headerPairsToFetch(pairs: Array<[string, string]>, loopbackHost: string): Record<string, string> {
  const headers: Record<string, string> = { host: loopbackHost };
  for (const [name, value] of pairs) {
    if (!name || HOP_BY_HOP.has(name.toLowerCase())) continue;
    const existing = headers[name];
    headers[name] = existing ? `${existing}, ${value}` : value;
  }
  return headers;
}

function responseHeadersToPairs(headers: Headers): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  headers.forEach((value, name) => {
    if (HOP_BY_HOP.has(name.toLowerCase())) return;
    pairs.push([name, value]);
  });
  return pairs;
}

export interface PairingRelayClientOptions {
  productPort: number;
  origin?: string;
  token?: string;
  now?: () => number;
  WebSocketImpl?: typeof WebSocket;
  fetchImpl?: typeof fetch;
  /** Test-only: dial a loopback relay (production never treats 127.0.0.1 as public). */
  allowLoopbackOrigin?: boolean;
  /** Persisted routing id so enrolled daemons can reclaim `/t/<id>` after restart. */
  sessionId?: string;
  onHello?: (hello: PairingRelayHello) => void;
}

export interface PairingRelayClient {
  state(): PairingRelayState;
  snapshot(): PairingRelaySnapshot;
  sessionId(): string | undefined;
  joinUntil(): number | undefined;
  renewJoinWindow(): Promise<PairingRelaySnapshot>;
  start(): void;
  stop(): void;
  onState(listener: (state: PairingRelayState) => void): () => void;
}

export function createPairingRelayClient(options: PairingRelayClientOptions): PairingRelayClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const WsImpl = options.WebSocketImpl ?? WebSocket;
  const listeners = new Set<(state: PairingRelayState) => void>();
  const helloWaiters = new Set<(hello: PairingRelayHello) => void>();
  let socket: WebSocket | null = null;
  let pingTimer: NodeJS.Timeout | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let backoff = 1000;
  let stopped = true;
  let current: PairingRelayState = 'unconfigured';
  let currentSessionId = isRelaySessionId(options.sessionId) ? options.sessionId : undefined;
  let currentJoinUntil: number | undefined;
  const remoteSockets = new Map<number, WebSocket>();
  const wsQueues = new Map<number, Array<{ payload: Buffer; binary: boolean }>>();

  function setState(next: PairingRelayState): void {
    if (current === next) return;
    current = next;
    for (const listener of listeners) listener(next);
  }

  function loopbackOrigin(): string {
    return `http://127.0.0.1:${options.productPort}`;
  }

  function loopbackHost(): string {
    return `127.0.0.1:${options.productPort}`;
  }

  function send(type: number, flags: number, streamId: number, payload?: Buffer): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(encodeFrame(type, flags, streamId, payload ?? Buffer.alloc(0)));
  }

  async function handleHttpReq(frame: NonNullable<ReturnType<typeof decodeFrame>>, body: Buffer): Promise<void> {
    let meta: { method?: string; url?: string; headers?: Array<[string, string]> };
    try {
      meta = decodeJsonPayload(frame.payload) as typeof meta;
    } catch {
      send(TYPE.HTTP_RES, FLAG.META | FLAG.FIN, frame.streamId, encodeJsonPayload({
        status: 400,
        headers: [['content-type', 'application/json; charset=utf-8']]
      }));
      return;
    }
    const method = (meta.method ?? 'GET').toUpperCase();
    const url = meta.url ?? '/';
    const path = normalizePairingPath(new URL(url, 'http://127.0.0.1').pathname);
    if (!isAllowedHttp(method, path)) {
      send(TYPE.HTTP_RES, FLAG.META, frame.streamId, encodeJsonPayload({
        status: 403,
        headers: [['content-type', 'application/json; charset=utf-8']]
      }));
      send(
        TYPE.HTTP_RES,
        FLAG.FIN,
        frame.streamId,
        Buffer.from(JSON.stringify({ error: 'path is not allowed' }))
      );
      return;
    }
    const headers = headerPairsToFetch(meta.headers ?? [], loopbackHost());
    try {
      const response = await fetchImpl(new URL(url, `${loopbackOrigin()}/`), {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : body
      });
      const hasBody = Boolean(response.body) && method !== 'HEAD';
      send(
        TYPE.HTTP_RES,
        FLAG.META | (hasBody ? 0 : FLAG.FIN),
        frame.streamId,
        encodeJsonPayload({
          status: response.status,
          headers: responseHeadersToPairs(response.headers)
        })
      );
      if (!hasBody || !response.body) return;
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          send(TYPE.HTTP_RES, FLAG.FIN, frame.streamId);
          return;
        }
        const chunk = Buffer.from(value);
        for (let offset = 0; offset < chunk.length; offset += BODY_CHUNK) {
          send(TYPE.HTTP_RES, 0, frame.streamId, chunk.subarray(offset, offset + BODY_CHUNK));
        }
      }
    } catch {
      send(TYPE.HTTP_RES, FLAG.META, frame.streamId, encodeJsonPayload({
        status: 502,
        headers: [['content-type', 'application/json; charset=utf-8']]
      }));
      send(
        TYPE.HTTP_RES,
        FLAG.FIN,
        frame.streamId,
        Buffer.from(JSON.stringify({ error: 'relay_fetch_failed' }))
      );
    }
  }

  function handleWsOpen(frame: NonNullable<ReturnType<typeof decodeFrame>>): void {
    if (remoteSockets.size >= MAX_WS) {
      send(TYPE.WS_CLOSE, FLAG.FIN, frame.streamId, encodeJsonPayload({ code: 1013, reason: 'busy' }));
      return;
    }
    let meta: { url?: string; headers?: Array<[string, string]> };
    try {
      meta = decodeJsonPayload(frame.payload) as typeof meta;
    } catch {
      send(TYPE.WS_CLOSE, FLAG.FIN, frame.streamId, encodeJsonPayload({ code: 1002, reason: 'protocol' }));
      return;
    }
    const url = meta.url ?? '/';
    const path = normalizePairingPath(new URL(url, 'http://127.0.0.1').pathname);
    if (!isAllowedWs(path)) {
      send(TYPE.WS_CLOSE, FLAG.FIN, frame.streamId, encodeJsonPayload({ code: 1008, reason: 'not allowed' }));
      return;
    }
    const headers = headerPairsToFetch(meta.headers ?? [], loopbackHost());
    const wsUrl = new URL(url, `${loopbackOrigin()}/`);
    wsUrl.protocol = 'ws:';
    const child = new WsImpl(wsUrl, { headers, perMessageDeflate: false });
    const queued: Array<{ payload: Buffer; binary: boolean }> = [];
    wsQueues.set(frame.streamId, queued);
    remoteSockets.set(frame.streamId, child);
    child.on('open', () => {
      for (const item of queued) child.send(item.payload, { binary: item.binary });
      queued.length = 0;
    });
    child.on('message', (data, isBinary) => {
      const payload = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      send(TYPE.WS_DATA, isBinary ? 0 : FLAG.TEXT, frame.streamId, payload);
    });
    child.on('close', (code, reason) => {
      remoteSockets.delete(frame.streamId);
      wsQueues.delete(frame.streamId);
      send(TYPE.WS_CLOSE, FLAG.FIN, frame.streamId, encodeJsonPayload({
        code,
        reason: reason.toString()
      }));
    });
    child.on('error', () => {
      child.close();
    });
  }

  const pendingHttp = new Map<number, { meta: NonNullable<ReturnType<typeof decodeFrame>>; chunks: Buffer[] }>();

  function onFrame(raw: Buffer): void {
    const frame = decodeFrame(raw);
    if (!frame) return;
    if (frame.type === TYPE.PING) {
      send(TYPE.PONG, 0, frame.streamId);
      return;
    }
    if (frame.type === TYPE.HELLO) {
      try {
        const meta = decodeJsonPayload(frame.payload) as { sessionId?: string; joinUntil?: number };
        if (!isRelaySessionId(meta.sessionId) || typeof meta.joinUntil !== 'number') return;
        currentSessionId = meta.sessionId;
        currentJoinUntil = meta.joinUntil;
        const hello = { sessionId: meta.sessionId, joinUntil: meta.joinUntil };
        options.onHello?.(hello);
        for (const waiter of [...helloWaiters]) waiter(hello);
      } catch {
        /* ignore malformed hello */
      }
      return;
    }
    if (frame.type === TYPE.PONG) return;
    if (frame.type === TYPE.HTTP_REQ) {
      if (frame.flags & FLAG.META) {
        pendingHttp.set(frame.streamId, { meta: frame, chunks: [] });
        if (frame.flags & FLAG.FIN) {
          pendingHttp.delete(frame.streamId);
          void handleHttpReq(frame, Buffer.alloc(0));
        }
        return;
      }
      const pending = pendingHttp.get(frame.streamId);
      if (!pending) return;
      if (frame.payload.length > 0) pending.chunks.push(frame.payload);
      if (frame.flags & FLAG.FIN) {
        pendingHttp.delete(frame.streamId);
        void handleHttpReq(pending.meta, Buffer.concat(pending.chunks));
      }
      return;
    }
    if (frame.type === TYPE.WS_OPEN) {
      handleWsOpen(frame);
      return;
    }
    if (frame.type === TYPE.WS_DATA) {
      const child = remoteSockets.get(frame.streamId);
      const binary = !(frame.flags & FLAG.TEXT);
      if (!child) return;
      if (child.readyState !== WebSocket.OPEN) {
        wsQueues.get(frame.streamId)?.push({ payload: frame.payload, binary });
        return;
      }
      child.send(frame.payload, { binary });
      return;
    }
    if (frame.type === TYPE.WS_CLOSE) {
      const child = remoteSockets.get(frame.streamId);
      if (!child) return;
      remoteSockets.delete(frame.streamId);
      child.close();
    }
  }

  function disconnect(): void {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    for (const child of remoteSockets.values()) {
      try {
        child.terminate();
      } catch {
        /* ignore */
      }
    }
    remoteSockets.clear();
    wsQueues.clear();
    pendingHttp.clear();
    if (socket) {
      const currentSocket = socket;
      socket = null;
      currentSocket.removeAllListeners();
      currentSocket.on('error', () => undefined);
      try {
        if (currentSocket.readyState === WebSocket.OPEN) currentSocket.close();
        else currentSocket.terminate();
      } catch {
        /* ignore CONNECTING teardown */
      }
    }
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer) return;
    const delay = backoff;
    backoff = Math.min(MAX_BACKOFF_MS, backoff * 2);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function connect(): void {
    if (stopped) return;
    const origin = options.origin;
    const token = options.token;
    if (!origin || !token || (!options.allowLoopbackOrigin && !isPublicOrigin(origin))) {
      setState('unconfigured');
      return;
    }
    disconnect();
    setState('offline');
    currentJoinUntil = undefined;
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (currentSessionId) headers['X-Zcc-Relay-Session'] = currentSessionId;
    const next = new WsImpl(relayWsUrl(origin), {
      headers,
      perMessageDeflate: false
    });
    socket = next;
    next.on('open', () => {
      backoff = 1000;
      setState('connected');
      pingTimer = setInterval(() => send(TYPE.PING, 0, 0), PING_MS);
    });
    next.on('message', (data) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      onFrame(buf);
    });
    next.on('close', () => {
      if (socket === next) {
        socket = null;
        if (!stopped) {
          setState(options.origin && options.token && (options.allowLoopbackOrigin || isPublicOrigin(options.origin)) ? 'offline' : 'unconfigured');
          scheduleReconnect();
        }
      }
    });
    next.on('error', () => {
      /* 401 / handshake failures surface as error+close; reconnect is on close */
    });
  }

  function snapshot(): PairingRelaySnapshot {
    return {
      state: current,
      ...(currentSessionId ? { sessionId: currentSessionId } : {}),
      ...(typeof currentJoinUntil === 'number' ? { joinUntil: currentJoinUntil } : {})
    };
  }

  return {
    state: () => current,
    snapshot,
    sessionId: () => currentSessionId,
    joinUntil: () => currentJoinUntil,
    renewJoinWindow() {
      if (current !== 'connected' || !socket || socket.readyState !== WebSocket.OPEN) {
        return Promise.resolve(snapshot());
      }
      return new Promise<PairingRelaySnapshot>((resolve) => {
        const timer = setTimeout(() => {
          helloWaiters.delete(onHello);
          resolve(snapshot());
        }, 2_000);
        const onHello = () => {
          clearTimeout(timer);
          helloWaiters.delete(onHello);
          resolve(snapshot());
        };
        helloWaiters.add(onHello);
        send(TYPE.JOIN_RENEW, FLAG.FIN, 0);
      });
    },
    start() {
      stopped = false;
      backoff = 1000;
      connect();
    },
    stop() {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      disconnect();
      setState(
        options.origin && options.token && (options.allowLoopbackOrigin || isPublicOrigin(options.origin))
          ? 'offline'
          : 'unconfigured'
      );
    },
    onState(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}

export function pairingRelayTargets(input: {
  env?: NodeJS.ProcessEnv;
  bundledUrl?: string | null;
  bundledToken?: string | null;
  /** @deprecated Ignored. */
  configUrl?: string | null;
  /** @deprecated Ignored. */
  configToken?: string | null;
}): { origin?: string; token?: string } {
  const origin = resolvePublicAppUrl({
    env: input.env,
    ...('bundledUrl' in input ? { bundledUrl: input.bundledUrl } : {})
  });
  const token = resolveRelayToken({
    env: input.env,
    ...('bundledToken' in input ? { bundledToken: input.bundledToken } : {})
  });
  if (!origin || !isPublicOrigin(origin) || !token) return {};
  return { origin, token };
}
