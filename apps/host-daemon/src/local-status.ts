import { createServer, type Server } from 'node:http';

export interface LocalStatusState {
  hostId: string | null;
  serverUrl: string;
  connected: boolean;
  protocolVersion: number;
  autoUpdate: boolean;
}

export function startLocalStatusServer(port: number, state: () => LocalStatusState): Server {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/status' && url.pathname !== '/status/') {
      response.writeHead(404).end();
      return;
    }
    const body = JSON.stringify(state());
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    });
    response.end(body);
  });
  server.listen(port, '127.0.0.1');
  return server;
}
