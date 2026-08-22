import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { WebSocketServer } from 'ws';
import { handleProductHttp } from './product-api.js';
import { createProductHttpContext, type ProductHttpContext } from './product-context.js';
import { createProductWebSocketServer, handleProductUpgrade } from './product-ws.js';
import type { LocalAppOriginArgs } from './local-app-origins.js';

export interface ProductServer {
  readonly url: string;
  readonly port: number;
  readonly ctx: ProductHttpContext;
  close(): Promise<void>;
}

export interface StartProductServerOptions {
  host?: string;
  port?: number;
  dataDir?: string;
  origins: LocalAppOriginArgs;
  /**
   * Optional extra handler used when this listener also serves renderer
   * assets. Return true when the request was fully handled.
   */
  fallback?: (request: IncomingMessage, response: ServerResponse) => Promise<boolean> | boolean;
}

export async function startProductServer(options: StartProductServerOptions): Promise<ProductServer> {
  const hostName = options.host ?? '127.0.0.1';
  if (hostName !== '127.0.0.1' && hostName !== '::1') {
    throw new Error('product HTTP is restricted to a loopback host');
  }

  const ctx = createProductHttpContext({
    dataDir: options.dataDir,
    origins: { ...options.origins, serverPort: options.port ?? options.origins.serverPort }
  });
  const wss = createProductWebSocketServer(ctx);

  const server = createServer(async (request, response) => {
    if (await handleProductHttp(request, response, ctx)) return;
    if (options.fallback && (await options.fallback(request, response))) return;
    response.writeHead(404).end();
  });

  attachProductUpgrade(server, ctx, wss);

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(options.port ?? 0, hostName, () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Product HTTP did not bind a TCP address');
  }

  const boundPort = address.port;
  ctx.origins.serverPort = boundPort;

  return {
    url: `http://${hostName}:${boundPort}/`,
    port: boundPort,
    ctx,
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        wss.close();
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      })
  };
}

export function attachProductUpgrade(
  server: Server,
  ctx: ProductHttpContext,
  wss: WebSocketServer
): void {
  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (handleProductUpgrade(request, socket, head, ctx, wss)) return;
  });
}
