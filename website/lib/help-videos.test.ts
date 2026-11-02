import { afterEach, describe, expect, it, vi } from 'vitest';
import catalogue from '../content/videos/catalogue.json';
import { HELP_VIDEO_CATALOGUE_URL, loadHelpVideos, parseHelpVideos } from './help-videos';
import { HELP_VIDEO_ORIGIN, helpVideoAssetUrl } from './help-video-assets';

afterEach(() => vi.restoreAllMocks());

describe('shared How To catalogue', () => {
  it('uses the desktop catalogue order and only repository media URLs', () => {
    const videos = parseHelpVideos(catalogue);
    expect(videos.map(video => video.id)).toEqual(catalogue.videos.map(video => video.id));
    expect(videos[0].id).toBe('guided-start');
    expect(helpVideoAssetUrl(videos[0].src)).toBe(HELP_VIDEO_ORIGIN + catalogue.videos[0].src.path);
  });

  it.each([
    null, {}, { version: 2, videos: catalogue.videos }, { version: 1, videos: [] },
    { version: 1, videos: Array(51).fill(catalogue.videos[0]) },
    { version: 1, videos: [catalogue.videos[0], catalogue.videos[0]] },
    ...['https://evil.example/video.mp4', 'content/videos/media/../secret.mp4', 'content/videos/media/unversioned.mp4'].map(path => ({
      version: 1, videos: [{ ...catalogue.videos[0], src: { path } }]
    }))
  ])('rejects invalid or unsafe catalogues %#', value => {
    expect(() => parseHelpVideos(value)).toThrow();
  });

  it('loads newly published videos without a bundled list update', async () => {
    const published = { ...catalogue.videos[0], id: 'new-tutorial', title: 'New tutorial' };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: 1, videos: [...catalogue.videos, published] })));
    const videos = await loadHelpVideos(fetcher);
    expect(videos.at(-1)?.id).toBe('new-tutorial');
    expect(fetcher).toHaveBeenCalledWith(HELP_VIDEO_CATALOGUE_URL, expect.objectContaining({
      next: { revalidate: 300 }, redirect: 'error', signal: expect.any(AbortSignal)
    }));
  });

  it.each([
    () => Promise.reject(new Error('offline')),
    () => Promise.reject(new DOMException('Timeout', 'TimeoutError')),
    () => Promise.resolve(new Response('unavailable', { status: 503 })),
    () => Promise.resolve(new Response(null)),
    () => Promise.resolve(new Response('invalid JSON')),
    () => Promise.resolve(new Response('{}')),
    () => Promise.resolve(new Response('{}', { headers: { 'content-length': '65537' } })),
    () => Promise.resolve(new Response('x'.repeat(65537)))
  ])('retains onboarding when upstream fails %#', async fetcher => {
    expect(await loadHelpVideos(vi.fn(fetcher))).toEqual(parseHelpVideos(catalogue));
  });

  it('releases a broken stream and falls back to bundled metadata', async () => {
    const stream = new ReadableStream({ start(controller) { controller.error(new Error('disconnected')); } });
    expect(await loadHelpVideos(vi.fn().mockResolvedValue(new Response(stream)))).toEqual(parseHelpVideos(catalogue));
  });

  it('uses the platform fetch by default', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(catalogue))));
    try { expect(await loadHelpVideos()).toHaveLength(catalogue.videos.length); }
    finally { vi.unstubAllGlobals(); }
  });
});
