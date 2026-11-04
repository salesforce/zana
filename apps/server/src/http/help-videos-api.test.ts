import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { handleHelpVideosApi } from './help-videos-api.js';
import type { HelpVideoCatalogueService } from '../services/help-video-catalogue.js';
import { startProductServer, type ProductServer } from './product-server.js';

let server: Server; let root: string; let url: string; let product: ProductServer | undefined;
const service = { list: vi.fn(async () => []), asset: vi.fn() };
let available = true;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'help-videos-http-'));
  await writeFile(join(root, 'video.mp4'), '0123456789');
  available = true; service.list.mockClear();
  service.asset.mockReset().mockResolvedValue({ path: join(root, 'video.mp4'), size: 10, type: 'video/mp4' });
  server = createServer(async (req, res) => {
    if (!await handleHelpVideosApi(req, res, available ? service as unknown as HelpVideoCatalogueService : undefined, new URL(req.url!, 'http://local').pathname, req.method!)) res.writeHead(404).end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => {
  await product?.close(); product = undefined;
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
});
const assetPath = `/api/v1/help/videos/assets/${'a'.repeat(64)}.mp4`;

it('serves catalogue reads and rejects unrelated/invalid routes and mutation methods', async () => {
  expect(await (await fetch(`${url}/api/v1/help/videos`)).json()).toEqual({ videos: [] });
  expect((await fetch(`${url}/api/v1/help/videos`, { method: 'HEAD' })).status).toBe(200);
  expect((await fetch(`${url}/other`)).status).toBe(404);
  expect((await fetch(`${url}/api/v1/help/videos/assets/invalid`)).status).toBe(404);
  expect((await fetch(`${url}/api/v1/help/videos`, { method: 'POST' })).status).toBe(405);
  expect((await fetch(`${url}/api/v1/help/videos`, { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
  available = false;
  expect((await fetch(`${url}/api/v1/help/videos`)).status).toBe(503);
});

it('serves same-origin media, complete downloads, HEAD, suffix and ordinary byte ranges', async () => {
  const full = await fetch(`${url}${assetPath}`);
  expect(full.status).toBe(200); expect(await full.text()).toBe('0123456789');
  expect(full.headers.get('content-type')).toBe('video/mp4');
  expect(full.headers.get('cross-origin-resource-policy')).toBe('same-origin');
  const partial = await fetch(`${url}${assetPath}`, { headers: { range: 'bytes=2-5' } });
  expect(partial.status).toBe(206); expect(partial.headers.get('content-range')).toBe('bytes 2-5/10');
  expect(await partial.text()).toBe('2345');
  const suffix = await fetch(`${url}${assetPath}`, { headers: { range: 'bytes=-2' } });
  expect(await suffix.text()).toBe('89');
  const head = await fetch(`${url}${assetPath}`, { method: 'HEAD' });
  expect(head.headers.get('content-length')).toBe('10'); expect(await head.text()).toBe('');
});

it('handles invalid ranges, unknown assets, missing files and failed downloads', async () => {
  const invalid = await fetch(`${url}${assetPath}`, { headers: { range: 'bytes=20-30' } });
  expect(invalid.status).toBe(416); expect(invalid.headers.get('content-range')).toBe('bytes */10');
  service.asset.mockResolvedValueOnce(null);
  expect((await fetch(`${url}${assetPath}`)).status).toBe(404);
  service.asset.mockRejectedValueOnce(new Error('offline'));
  expect((await fetch(`${url}${assetPath}`)).status).toBe(503);
});

it('is wired behind the real product origin guard', async () => {
  product = await startProductServer({ dataDir: join(root, 'product'), origins: { serverPort: 0, devAppPort: 5173 } });
  product.ctx.helpVideos = service as unknown as HelpVideoCatalogueService;
  const rejected = await fetch(`${product.url}api/v1/help/videos`, { headers: { origin: 'https://foreign.test' } });
  expect(rejected.status).toBe(403);
  const accepted = await fetch(`${product.url}api/v1/help/videos`);
  expect(accepted.status).toBe(200); expect(await accepted.json()).toEqual({ videos: [] });
  // Restore lifecycle shape expected by the real context's shutdown path.
  product.ctx.helpVideos = undefined;
});
