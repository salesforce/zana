import { afterEach, describe, expect, it } from 'vitest';
import { startProductServer, type ProductServer } from './product-server.js';
import WebSocket from 'ws';

let server: ProductServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

describe('product /ws', () => {
  it('accepts a loopback upgrade and rejects a foreign Origin', async () => {
    server = await startProductServer({
      origins: { serverPort: 0, devAppPort: 5173 }
    });
    const wsUrl = server.url.replace(/^http/, 'ws') + 'ws';

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl, { origin: 'http://localhost:5173' });
      ws.on('open', () => {
        ws.close();
        resolve();
      });
      ws.on('error', reject);
    });

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl, { origin: 'https://evil.example' });
      ws.on('open', () => reject(new Error('foreign origin was accepted')));
      ws.on('unexpected-response', (_req, res) => {
        expect(res.statusCode).toBe(403);
        res.resume();
        resolve();
      });
      ws.on('error', () => {
        resolve();
      });
    });
  });
});
