import { protectPreviewServer } from '../../../services/mobile-relay/protected-ports.mjs';
/**
 * Loopback authority/browser checks and socket ownership are adapted from BB's
 * machine-auth-proxy.ts (MIT; docs/third-party/BB-LICENSE). Zana restricts the
 * proxy to one granted CLI session instead of forwarding arbitrary server URLs.
 */
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { CLI_CALLBACK_MAX_BODY_BYTES, CLI_CALLBACK_MAX_RESPONSE_BYTES, cliCallbackPaths, isCliNativeToolPath, type CliCallbackGrant } from '@zana-ai/zcc-contracts/cli-callbacks';
export { CLI_CALLBACK_MAX_BODY_BYTES, CLI_CALLBACK_MAX_RESPONSE_BYTES, cliCallbackPaths } from '@zana-ai/zcc-contracts/cli-callbacks';
const MAX_ACTIVE_CALLBACKS = 8;
/** Per proxy (one session), reserved so 15-minute /mcp and question callbacks cannot starve the per-tool-call policy hook. */
const MAX_ACTIVE_NATIVE_TOOL_CALLBACKS = 8;
const REQUEST_TIMEOUT_MS = 15 * 60_000;
let activeCallbacks = 0;

export interface CliCallbackRequest {
  path: string;
  headers: Record<string, string>;
  body: Buffer;
  signal: AbortSignal;
}
export interface CliCallbackResponse {
  status: number;
  contentType?: string;
  body: Buffer;
}

function allowedAuthority(request: IncomingMessage, port: number): boolean {
  if (request.headers.origin !== undefined || request.headers['sec-fetch-site'] !== undefined || !request.headers.host) return false;
  try {
    const url = new URL(`http://${request.headers.host}`);
    return !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash
      && Number(url.port || 80) === port && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch { return false; }
}

export async function startCliCallbackProxy(options: {
  grant: CliCallbackGrant;
  forward(request: CliCallbackRequest): Promise<CliCallbackResponse>;
  /** Injectable for deterministic timeout verification; production uses 15 min. */
  timeoutMs?: number;
}): Promise<{ baseUrl: string; close(): Promise<void> }> {
  const paths = cliCallbackPaths(options.grant);
  const capabilityPrefix = `/${randomBytes(32).toString('hex')}`;
  const sockets = new Set<Socket>(), active = new Set<AbortController>();
  let port = 0, closed = false, activeNativeToolCallbacks = 0;
  const server = createServer((request, response) => {
    const reject = (status: number) => { response.writeHead(status, { connection: 'close' }).end(); request.resume(); };
    if (closed || !allowedAuthority(request, port)) { reject(403); return; }
    if (request.method !== 'POST') { reject(405); return; }
    // Compare the raw request target; URL normalization must not turn traversal,
    // encoded slashes, queries or another session into an authorized callback.
    if (!request.url?.startsWith(`${capabilityPrefix}/`)) { reject(403); return; }
    const path = request.url.slice(capabilityPrefix.length);
    if (!paths.has(path)) { reject(403); return; }
    const nativeTool = isCliNativeToolPath(path);
    if (nativeTool ? activeNativeToolCallbacks >= MAX_ACTIVE_NATIVE_TOOL_CALLBACKS : activeCallbacks >= MAX_ACTIVE_CALLBACKS) { reject(429); return; }
    const length = Number(request.headers['content-length'] ?? 0);
    if (!Number.isSafeInteger(length) || length < 0 || length > CLI_CALLBACK_MAX_BODY_BYTES) { reject(413); return; }
    if (nativeTool) activeNativeToolCallbacks++; else activeCallbacks++;
    const controller = new AbortController(); active.add(controller);
    const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('callback aborted')), { once: true }));
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS);
    const onClose = () => controller.abort(); response.once('close', onClose);
    void (async () => {
      try {
        const read = async () => {
          let size = 0; const chunks: Buffer[] = [];
          for await (const chunk of request) {
            size += chunk.length;
            if (size > CLI_CALLBACK_MAX_BODY_BYTES) { reject(413); return null; }
            chunks.push(Buffer.from(chunk));
          }
          return Buffer.concat(chunks, size);
        };
        const body = await Promise.race([read(), aborted]);
        if (body === null || controller.signal.aborted) return;
        const headers: Record<string, string> = {};
        for (const name of ['content-type', 'accept', 'mcp-protocol-version']) {
          const value = request.headers[name];
          if (typeof value === 'string') headers[name] = value;
        }
        const result = await Promise.race([options.forward({ path, body, headers, signal: controller.signal }), aborted]);
        if (!Number.isInteger(result.status) || result.status < 200 || result.status > 599
          || !Buffer.isBuffer(result.body) || result.body.byteLength > CLI_CALLBACK_MAX_RESPONSE_BYTES
          || (result.contentType !== undefined && !/^[\x20-\x7e]{1,200}$/.test(result.contentType))) throw new Error('Invalid callback response');
        if (!controller.signal.aborted) response.writeHead(result.status, result.contentType ? { 'content-type': result.contentType } : {}).end(result.body);
      } catch { if (!response.headersSent && !response.destroyed) reject(controller.signal.aborted ? 504 : 502); }
      finally {
        clearTimeout(timer); response.off('close', onClose); active.delete(controller);
        if (nativeTool) activeNativeToolCallbacks--; else activeCallbacks--;
        // Also stop a caller's pending body/forward operation after a deadline.
        controller.abort();
        if (!request.complete) request.destroy();
      }
    })();
  });
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 32;
  server.maxConnections = 32;
  const rejectSocket = (socket: Socket) => socket.end('HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  server.on('connect', (_request, socket) => rejectSocket(socket as Socket));
  server.on('upgrade', (_request, socket) => rejectSocket(socket as Socket));
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    protectPreviewServer(server);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  port = (server.address() as { port: number }).port;
  let closing: Promise<void> | undefined;
  return {
    baseUrl: `http://127.0.0.1:${port}${capabilityPrefix}`,
    close() {
      if (!closing) {
        closed = true;
        for (const controller of active) controller.abort();
        closing = new Promise<void>(resolve => {
          server.close(() => resolve());
          for (const socket of sockets) socket.destroy();
        });
      }
      return closing;
    }
  };
}
