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
  hostDaemonInteractiveRequestSchema,
  hostDaemonToolCallRequestSchema,
  hostDaemonToolCallResponseSchema
} from '@zana-ai/zcc-host-daemon-contract';
import { isAllowedHostInternalHost, requestHostHeader, resolvePublicAppUrl } from './public-app-url.js';
import { generateHostKey, hashHostKey, hostKeyMatches } from './host-hub.js';
import { headerValue } from './browser-request-guard.js';
import { readJsonBody, sendJson } from './json.js';
import { sendHostArtifactFile } from './host-artifact-response.js';
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

function publicOrigin(ctx: ProductHttpContext): string | undefined {
  return resolvePublicAppUrl({ configUrl: ctx.config.getConfig().publicAppUrl });
}

function hostInternalAllowed(request: IncomingMessage, ctx: ProductHttpContext): boolean {
  return isAllowedHostInternalHost(requestHostHeader(request), publicOrigin(ctx));
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
  if (pathname === '/internal/hosts/tool-call') {
    return handleHostToolCall(request, response, ctx);
  }
  if (pathname.startsWith('/internal/plugins/')) {
    return handlePluginHostArtifact(request, response, ctx, pathname);
  }
  return false;
}

async function handleHostEnroll(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: ProductHttpContext
): Promise<boolean> {
  if (!hostInternalAllowed(request, ctx)) {
    sendJson(response, 403, { error: 'host is not a loopback app origin' });
    return true;
  }
  if (hasBrowserOrigin(request)) {
    sendJson(response, 403, { error: 'host enroll is not a browser origin' });
    return true;
  }

  const token = bearerToken(request.headers);
  const joinPeek = token ? ctx.joinCodes.peek(token) : null;
  const loopback = Boolean(token && tokenMatches(token, ctx.enrollToken));
  if (!joinPeek && !loopback) {
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

  const reportedVersion = body && typeof body === 'object' && 'protocolVersion' in body
    ? (body as { protocolVersion?: unknown }).protocolVersion
    : undefined;
  if (typeof reportedVersion === 'number' && reportedVersion !== HOST_RPC_PROTOCOL_VERSION) {
    sendJson(response, 409, { error: 'incompatible host-rpc protocol version' });
    return true;
  }

  const parsed = HostEnrollRequestSchema.safeParse(body);
  if (!parsed.success) {
    sendJson(response, 400, { error: 'invalid enroll request' });
    return true;
  }
  if (joinPeek && parsed.data.hostId && parsed.data.hostId !== joinPeek.hostId) {
    sendJson(response, 400, { error: 'join code hostId mismatch' });
    return true;
  }

  const join = token && joinPeek ? ctx.joinCodes.redeem(token) : null;
  const hostKey = generateHostKey();
  const host = upsertHost(ctx.db, {
    id: join?.hostId ?? parsed.data.hostId,
    name: parsed.data.hostName,
    hostKeyHash: hashHostKey(hostKey),
    isPrimary: join ? false : undefined,
    homeDir: parsed.data.homeDir
  });
  ctx.hub.emit('hosts:changed', undefined);
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
  if (!hostInternalAllowed(request, ctx)) {
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

async function handleHostToolCall(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: ProductHttpContext
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
  const parsed = hostDaemonToolCallRequestSchema.safeParse(body);
  if (!parsed.success) {
    sendJson(response, 400, { error: 'invalid tool call request' });
    return true;
  }
  const thread = getConversationThread(ctx.db, parsed.data.threadId);
  if (!thread) {
    sendJson(response, 200, hostDaemonToolCallResponseSchema.parse({
      success: false,
      contentItems: [{ type: 'inputText', text: `Unknown thread: ${parsed.data.threadId}` }]
    }));
    return true;
  }
  if (thread.hostId !== auth.hostId) {
    sendJson(response, 403, { error: 'thread does not belong to this host' });
    return true;
  }
  if (!ctx.plugins) {
    sendJson(response, 200, hostDaemonToolCallResponseSchema.parse({
      success: false,
      contentItems: [{ type: 'inputText', text: `Unsupported tool: ${parsed.data.tool}` }]
    }));
    return true;
  }

  const ac = new AbortController();
  const onClose = () => ac.abort();
  request.on('close', onClose);
  try {
    const result = await ctx.plugins.invokeAgentTool({
      name: parsed.data.tool,
      input: parsed.data.arguments,
      ctx: {
        threadId: thread.id,
        projectId: thread.projectId,
        signal: ac.signal
      }
    });
    sendJson(response, 200, hostDaemonToolCallResponseSchema.parse(result));
  } catch (error) {
    sendJson(response, 200, hostDaemonToolCallResponseSchema.parse({
      success: false,
      contentItems: [{
        type: 'inputText',
        text: `Tool "${parsed.data.tool}" failed: ${error instanceof Error ? error.message : String(error)}`
      }]
    }));
  } finally {
    request.removeListener('close', onClose);
  }
  return true;
}

const PLUGIN_HOST_ARTIFACT_PATH = /^\/internal\/plugins\/([^/]+)\/host\/([^/]+)$/u;
const HOST_ARTIFACT_DIGEST = /^[a-f0-9]{64}$/u;

async function handlePluginHostArtifact(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: ProductHttpContext,
  pathname: string
): Promise<boolean> {
  const matched = PLUGIN_HOST_ARTIFACT_PATH.exec(pathname);
  if (!matched) return false;
  const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
  const auth = authenticateHostCall(request, requestUrl, ctx);
  if ('error' in auth) {
    sendJson(response, auth.status, { error: auth.error });
    return true;
  }
  const method = (request.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    sendJson(response, 405, { error: 'method not allowed' });
    return true;
  }
  const pluginId = decodeURIComponent(matched[1] ?? '');
  const digest = matched[2] ?? '';
  const notFound = () => {
    sendJson(response, 404, { error: 'not found' });
  };
  if (!HOST_ARTIFACT_DIGEST.test(digest)) {
    notFound();
    return true;
  }
  const artifact = ctx.pluginHostArtifacts.get(pluginId);
  if (artifact === undefined || artifact.digest !== digest) {
    notFound();
    return true;
  }
  const sent = await sendHostArtifactFile(response, {
    path: artifact.path,
    byteLength: artifact.byteLength,
    digest,
    headOnly: method === 'HEAD'
  });
  if (!sent) {
    notFound();
    return true;
  }
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

  if (!hostInternalAllowed(request, ctx)) {
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
        ws.close(4002, 'protocol-mismatch');
      }
    });
  });
  return true;
}
