import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import published from '../../../../content/videos/catalogue.json';
import { HELP_VIDEO_CATALOGUE_MAX_BYTES, type HelpVideoCatalogue } from '@zana-ai/zcc-server-contract';
import { HelpVideoCatalogueService, HELP_VIDEO_REFRESH_MS, HELP_VIDEO_REPO_BASE } from './help-video-catalogue.js';

let root: string;
const services: HelpVideoCatalogueService[] = [];
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'help-video-test-')); });
afterEach(async () => {
  services.forEach(service => service.dispose()); services.length = 0;
  vi.useRealTimers(); vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
const bytes = Buffer.from('small verified media fixture');
const sha = createHash('sha256').update(bytes).digest('hex');
function fixture(): HelpVideoCatalogue {
  const entry = structuredClone(published.videos[0]);
  entry.id = 'new-tutorial'; entry.title = 'New tutorial';
  for (const [kind, ext] of [['src', 'mp4'], ['poster', 'jpg'], ['captions', 'vtt']] as const) {
    entry[kind] = { path: `content/videos/media/new-tutorial-${sha}.${ext}`, sha256: sha, bytes: bytes.length };
  }
  return { version: 1, videos: [entry] };
}
function service(fetcher: ReturnType<typeof vi.fn>, options: Record<string, unknown> = {}) {
  const instance = new HelpVideoCatalogueService(root, { fetch: fetcher as typeof fetch, ...options });
  services.push(instance); return instance;
}

it('coalesces refreshes, serves the remote catalogue and conditional revalidates after five minutes', async () => {
  let now = 0;
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(fixture(), { headers: { etag: '"v1"' } }))
    .mockResolvedValueOnce(new Response(null, { status: 304 }));
  const instance = service(fetcher, { now: () => now });
  const [one, two] = await Promise.all([instance.list(), instance.list()]);
  expect(one).toEqual(two); expect(one[0].title).toBe('New tutorial');
  expect(one[0].src).toBe(`/api/v1/help/videos/assets/${sha}.mp4`);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0][0])).toBe(`${HELP_VIDEO_REPO_BASE}content/videos/catalogue.json`);
  expect(fetcher.mock.calls[0][1].redirect).toBe('error');
  now += HELP_VIDEO_REFRESH_MS;
  expect(await instance.list()).toEqual(one);
  expect(fetcher.mock.calls[1][1].headers).toEqual({ 'If-None-Match': '"v1"', 'Accept-Encoding': 'identity' });
});

it('persists the last good catalogue and reuses it after an offline restart', async () => {
  const first = service(vi.fn().mockResolvedValue(Response.json(fixture())));
  const expected = await first.list(); first.dispose();
  const offline = service(vi.fn().mockRejectedValue(new Error('offline')));
  expect(await offline.list()).toEqual(expected);
});

it.each(['offline', 'http-error', 'schema', 'oversized', 'bad-json'])('keeps bundled basics on %s', async failure => {
  const fetcher = vi.fn().mockImplementation(async () => {
    if (failure === 'offline') throw new Error('offline');
    if (failure === 'http-error') return new Response('missing', { status: 404 });
    if (failure === 'oversized') return new Response('x'.repeat(HELP_VIDEO_CATALOGUE_MAX_BYTES + 1));
    return new Response(failure === 'schema' ? '{}' : 'not json');
  });
  const instance = service(fetcher);
  expect((await instance.list()).map(video => video.id)).toEqual(published.videos.map(video => video.id));
  await instance.list(); expect(fetcher).toHaveBeenCalledTimes(1);
});

it('rejects corrupt/oversized disk catalogues and filters by inclusive app compatibility', async () => {
  await mkdir(join(root, 'help-videos'));
  await writeFile(join(root, 'help-videos/catalogue.json'), 'x'.repeat(HELP_VIDEO_CATALOGUE_MAX_BYTES + 2049));
  const value = fixture();
  value.videos[0].minAppVersion = '2.5.0'; value.videos[0].maxAppVersion = '2.5.0';
  expect((await service(vi.fn().mockResolvedValue(Response.json(value)), { appVersion: '2.5.0' }).list())).toHaveLength(1);
  expect(await service(vi.fn().mockResolvedValue(Response.json(value)), { appVersion: '2.4.0' }).list()).toEqual([]);
  expect(await service(vi.fn().mockResolvedValue(Response.json(value)), { appVersion: '2.6.0' }).list()).toEqual([]);
  await writeFile(join(root, 'help-videos/catalogue.json'), '{}');
  expect(await service(vi.fn().mockRejectedValue(new Error('offline'))).list()).toHaveLength(published.videos.length);
});

it('downloads only registered assets, verifies them, coalesces reads and uses the disk cache offline', async () => {
  const fetcher = vi.fn().mockImplementation(async (url: URL) => String(url).endsWith('.json') ? Response.json(fixture()) : new Response(bytes));
  const instance = service(fetcher); await instance.list();
  expect(await instance.asset('unregistered.mp4')).toBeNull();
  const [first, second] = await Promise.all([instance.asset(`${sha}.mp4`), instance.asset(`${sha}.mp4`)]);
  expect(first).toEqual(second); expect(await readFile(first!.path)).toEqual(bytes);
  expect(first!.type).toBe('video/mp4'); expect(fetcher).toHaveBeenCalledTimes(2);
  fetcher.mockRejectedValue(new Error('offline'));
  expect(await instance.asset(`${sha}.mp4`)).toEqual(first);
  const restarted = service(fetcher);
  expect(await restarted.asset(`${sha}.mp4`)).toEqual(first);
});

it.each(['hash', 'short', 'oversized', 'length', 'http'])('rejects %s asset responses and removes partial files', async failure => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(fixture())).mockImplementation(async () => {
    if (failure === 'http') return new Response('no', { status: 404 });
    if (failure === 'length') return new Response(bytes, { headers: { 'content-length': '9999' } });
    if (failure === 'short') return new Response('short');
    if (failure === 'oversized') return new Response(Buffer.concat([bytes, bytes]));
    return new Response(Buffer.alloc(bytes.length));
  });
  const instance = service(fetcher); await instance.list();
  await expect(instance.asset(`${sha}.mp4`)).rejects.toThrow();
  expect((await readdir(join(root, 'help-videos'))).filter(name => name.endsWith('.tmp') || name.endsWith('.mp4'))).toEqual([]);
});

it('bounds cache retention and replaces damaged cached media', async () => {
  const fetcher = vi.fn().mockImplementation(async (url: URL) => String(url).endsWith('.json') ? Response.json(fixture()) : new Response(bytes));
  const instance = service(fetcher); await instance.list();
  const old = join(root, 'help-videos', `${'a'.repeat(64)}.mp4`);
  const handle = await open(old, 'w'); await handle.truncate(193 * 1024 * 1024); await handle.close();
  await writeFile(join(root, 'help-videos', `${sha}.mp4`), 'broken');
  await instance.asset(`${sha}.mp4`);
  expect(await readdir(join(root, 'help-videos'))).not.toContain(`${'a'.repeat(64)}.mp4`);
});

it('cleans up interrupted downloads on restart and queues distinct downloads while limiting active transfers to three', async () => {
  await mkdir(join(root, 'help-videos'));
  const stale = `${sha}.mp4-${'b'.repeat(32)}.tmp`;
  await writeFile(join(root, 'help-videos', stale), 'partial');
  let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fetcher = vi.fn().mockImplementation(async (url: URL) => {
    if (String(url).endsWith('.json')) return Response.json(fixture());
    await gate;
    return new Response(String(url).endsWith(published.videos[0].poster.path) ? await readFile(published.videos[0].poster.path) : bytes);
  });
  const instance = service(fetcher); await instance.list();
  expect(await readdir(join(root, 'help-videos'))).not.toContain(stale);
  const pending = [instance.asset(`${sha}.mp4`), instance.asset(`${sha}.jpg`), instance.asset(`${sha}.vtt`)];
  // A registered baseline asset is a fourth distinct download.
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
  const baseline = published.videos[0].poster;
  const fourth = instance.asset(`${baseline.sha256}.jpg`);
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(fetcher).toHaveBeenCalledTimes(4);
  release!(); await Promise.all([...pending, fourth]);
  expect(fetcher).toHaveBeenCalledTimes(5);
});

it('times out slow refreshes and aborts in-flight work on disposal', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));
  const instance = service(fetcher);
  const pending = instance.list();
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(5001);
  expect(await pending).toHaveLength(published.videos.length);
  const other = service(fetcher); const pendingOther = other.list();
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  other.dispose(); expect(await pendingOther).toHaveLength(published.videos.length);
  expect(await other.list()).toHaveLength(published.videos.length);
});

it('only enables the loopback repository seam in explicitly opted-in E2E runs', async () => {
  vi.stubEnv('ZCC_E2E_HELP_VIDEOS_ORIGIN', 'http://127.0.0.1:9999/');
  const fetcher = vi.fn().mockRejectedValue(new Error('offline'));
  await service(fetcher).list(); expect(String(fetcher.mock.calls[0][0])).toContain(HELP_VIDEO_REPO_BASE);
  vi.stubEnv('ZCC_E2E', '1');
  await service(fetcher).list(); expect(String(fetcher.mock.calls[1][0])).toContain('http://127.0.0.1:9999/');
  vi.stubEnv('ZCC_E2E_HELP_VIDEOS_ORIGIN', 'https://evil.test/');
  await service(fetcher).list(); expect(String(fetcher.mock.calls[2][0])).toContain(HELP_VIDEO_REPO_BASE);
});
