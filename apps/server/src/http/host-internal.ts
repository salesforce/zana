import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  HOST_RPC_PROTOCOL_VERSION,
  HostEnrollRequestSchema,
  HostEnrollResponseSchema
} from '@zana-ai/zcc-contracts/host-rpc';
import { getConversationThread, getHost, upsertHost } from '@zana-ai/zcc-db';
import {
  hostDaemonInteractiveInterruptRequestSchema,
  hostDaemonInteractiveRequestSchema
} from '@zana-ai/zcc-host-daemon-contract';
import { isLoopbackHttpHost } from '../browser-bootstrap.js';
import { generateHostKey, hashHostKey, hostKeyMatches } from './host-hub.js';
import { headerValue } from './browser-request-guard.js';
import { readJsonBody, sendJson } from './json.js';
import type { ProductHttpContext } from './product-context.js';

function tokenMatches(received: string, expected: string): boolean {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function bearerToken(headers: IncomingMessage['headers']): string | null {
  const value = headerValue(headers, 'authorization');
  if (!value) return null;
  const prefix = 'Bearer ';
  if (!value.toLowerCase().startsWith(prefix.toLowerCase())) return null;
  const token = value.slice(prefix.length).trim();
  return token.length > 0 ? token : null;
}

function hasBrowserOrigin(request: IncomingMessage): boolean {
  const origin = headerValue(request.headers, 'origin');
  return origin !== undefined && origin.length > 0;
}

export function createHostDaemonWebSocketServer(): WebSocketServer {
  return new WebSocketServer({ noServer: true });
}

export async function handleHostInternalHttp(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: ProductHttpContext
): Promise<boolean> {
  const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
  const pathname = requestUrl.pathname.replace(/\/$/, '') || '/';

  if (pathname === '/internal/hosts/enroll') {
    return handleHostEnroll(request, response, ctx);
  }
  if (
    pathname === '/internal/hosts/interactive-request'
    || pathname === '/internal/hosts/interactive-request/interrupt'
  ) {
    return handleHostInteractiveRequest(request, response, ctx, pathname);
  }
  return false;
}

async function handleHostEnroll(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: ProductHttpContext
): Promise<boolean> {
  if (!isLoopbackHttpHost(headerValue(request.headers, 'host'))) {
    sendJson(response, 403, { error: 'host is not a loopback app origin' });
    return true;
  }
  if (hasBrowserOrigin(request)) {
    sendJson(response, 403, { error: 'host enroll is not a browser origin' });
    return true;
  }

  const token = bearerToken(request.headers);
  if (!token || !tokenMatches(token, ctx.enrollToken)) {
    sendJson(response, 401, { error: 'unauthorized' });
    return true;
  }

  if ((request.method ?? 'GET').toUpperCase() !== 'POST') {
    sendJson(response, 405, { error: 'method not allowed' });
    return true;
  }

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: 'invalid JSON' });
    return true;
  }

  const parsed = HostEnrollRequestSchema.safeParse(body);
  if (!parsed.success) {
    sendJson(response, 400, { error: 'invalid enroll request' });
    return true;
  }
  if (parsed.data.protocolVersion !== HOST_RPC_PROTOCOL_VERSION) {
    sendJson(response, 409, { error: 'incompatible host-rpc protocol version' });
    return true;
  }

  const hostKey = generateHostKey();
  const host = upsertHost(ctx.db, {
    id: parsed.data.hostId,
    name: parsed.data.hostName,
    hostKeyHash: hashHostKey(hostKey)
  });
  sendJson(response, 201, HostEnrollResponseSchema.parse({
    protocolVersion: HOST_RPC_PROTOCOL_VERSION,
    hostId: host.id,
    hostKey
  }));
  return true;
}

function authenticateHostCall(
  request: IncomingMessage,
  requestUrl: URL,
  ctx: ProductHttpContext
): { hostId: string } | { error: string; status: number } {
  if (!isLoopbackHttpHost(headerValue(request.headers, 'host'))) {
    return { error: 'host is not a loopback app origin', status: 403 };
  }
  if (hasBrowserOrigin(request)) {
    return { error: 'host call is not a browser origin', status: 403 };
  }
  const hostId = headerValue(request.headers, 'x-zcc-host-id') ?? requestUrl.searchParams.get('hostId');
  const hostKey = bearerToken(request.headers) ?? requestUrl.searchParams.get('hostKey');
  if (!hostId || !hostKey) {
    return { error: 'unauthorized', status: 401 };
  }
  const host = getHost(ctx.db, hostId);
  if (!host || !hostKeyMatches(hostKey, host.hostKeyHash)) {
    return { error: 'unauthorized', status: 401 };
  }
  return { hostId };
}

async function handleHostInteractiveRequest(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: ProductHttpContext,
  pathname: string
): Promise<boolean> {
  const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
  const auth = authenticateHostCall(request, requestUrl, ctx);
  if ('error' in auth) {
    sendJson(response, auth.status, { error: auth.error });
    return true;
  }
  if ((request.method ?? 'GET').toUpperCase() !== 'POST') {
    sendJson(response, 405, { error: 'method not allowed' });
    return true;
  }
  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: 'invalid JSON' });
    return true;
  }

  if (pathname.endsWith('/interrupt')) {
    const parsed = hostDaemonInteractiveInterruptRequestSchema.safeParse(body);
    if (!parsed.success) {
      sendJson(response, 400, { error: 'invalid interrupt request' });
      return true;
    }
    const interruptible = parsed.data.threadIds.filter((threadId) => {
      const thread = getConversationThread(ctx.db, threadId);
      return thread?.hostId === auth.hostId;
    });
    const interrupted = ctx.pendingInteractions.interruptPendingInteractionsForThreads({
      providerId: parsed.data.providerId,
      threadIds: interruptible,
      reason: parsed.data.reason
    });
    sendJson(response, 200, {
      ok: true,
      interactionIds: interrupted.map((row) => row.id)
    });
    return true;
  }

  const parsed = hostDaemonInteractiveRequestSchema.safeParse(body);
  if (!parsed.success) {
    sendJson(response, 400, { error: 'invalid interactive request' });
    return true;
  }
  const thread = getConversationThread(ctx.db, parsed.data.interaction.threadId);
  if (!thread) {
    sendJson(response, 200, { outcome: 'rejected', reason: 'Thread does not exist' });
    return true;
  }
  if (thread.hostId !== auth.hostId) {
    sendJson(response, 403, { error: 'thread does not belong to this host' });
    return true;
  }
  sendJson(response, 200, ctx.pendingInteractions.registerPendingInteraction(parsed.data.interaction));
  return true;
}

export function handleHostInternalUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  ctx: ProductHttpContext,
  wss: WebSocketServer
): boolean {
  const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (requestUrl.pathname !== '/internal/hosts/ws' && requestUrl.pathname !== '/internal/hosts/ws/') {
    return false;
  }

  if (!isLoopbackHttpHost(headerValue(request.headers, 'host'))) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return true;
  }
  if (hasBrowserOrigin(request)) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return true;
  }

  const hostId = headerValue(request.headers, 'x-zcc-host-id') ?? requestUrl.searchParams.get('hostId');
  const hostKey = bearerToken(request.headers) ?? requestUrl.searchParams.get('hostKey');
  if (!hostId || !hostKey) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return true;
  }
  const host = getHost(ctx.db, hostId);
  if (!host || !hostKeyMatches(hostKey, host.hostKeyHash)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return true;
  }

  wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
    const timer = setTimeout(() => {
      ws.close();
    }, 5_000);
    ws.once('message', (raw) => {
      clearTimeout(timer);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString()) as unknown;
      } catch {
        ws.close();
        return;
      }
      if (!ctx.hostHub.acceptHello(ws, hostId, parsed)) {
        ws.close();
      }
    });
  });
  return true;
}
