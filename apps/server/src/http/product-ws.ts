import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { browserRequestProblem, headerValue } from './browser-request-guard.js';
import type { ProductHttpContext } from './product-context.js';

export function createProductWebSocketServer(ctx: ProductHttpContext): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (socket) => {
    ctx.hub.add(socket);
  });
  return wss;
}

export function handleProductUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  ctx: ProductHttpContext,
  wss: WebSocketServer
): boolean {
  const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (requestUrl.pathname !== '/ws' && requestUrl.pathname !== '/ws/') return false;

  const problem = browserRequestProblem(
    {
      req: {
        url: requestUrl.href,
        method: 'GET',
        header: (name) => headerValue(request.headers, name)
      }
    },
    { config: ctx.origins }
  );
  if (problem) {
    socket.write(`HTTP/1.1 ${problem.status} Forbidden\r\nConnection: close\r\n\r\n`);
    socket.destroy();
    return true;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
  return true;
}
