import { z } from 'zod';
import bundledCatalogue from '../content/videos/catalogue.json';
import { HELP_VIDEO_ORIGIN } from './help-video-assets';

export const HELP_VIDEO_CATALOGUE_URL = `${HELP_VIDEO_ORIGIN}content/videos/catalogue.json`;
const MAX_CATALOGUE_BYTES = 64 * 1024;

const asset = (extension: string) => z.object({
  path: z.string().regex(new RegExp(`^content/videos/media/[a-z0-9-]+-[a-f0-9]{64}\\.${extension}$`))
});
const text = z.string().trim().min(1).max(1000);
const catalogueSchema = z.object({
  version: z.literal(1),
  videos: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]+$/).max(100),
    title: text,
    description: text,
    group: text,
    duration: z.string().regex(/^\d{1,3}:[0-5]\d$/),
    details: text,
    silent: z.boolean(),
    src: asset('mp4'),
    poster: asset('jpg'),
    captions: asset('vtt')
  })).min(1).max(50)
});

export type HelpVideo = z.infer<typeof catalogueSchema>['videos'][number];

export function parseHelpVideos(value: unknown): HelpVideo[] {
  const { videos } = catalogueSchema.parse(value);
  if (new Set(videos.map(video => video.id)).size !== videos.length) {
    throw new Error('Duplicate help video ID');
  }
  return videos;
}

async function readCatalogue(response: Response): Promise<unknown> {
  if (!response.ok || Number(response.headers.get('content-length')) > MAX_CATALOGUE_BYTES) {
    await response.body?.cancel();
    throw new Error('Help video catalogue unavailable or too large');
  }
  if (!response.body) throw new Error('Empty help video catalogue');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_CATALOGUE_BYTES) throw new Error('Help video catalogue too large');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Same public catalogue as desktop Help; Next refreshes it without a site deploy. */
export async function loadHelpVideos(fetchImpl: typeof fetch = fetch): Promise<HelpVideo[]> {
  try {
    const response = await fetchImpl(HELP_VIDEO_CATALOGUE_URL, {
      next: { revalidate: 300 },
      redirect: 'error',
      signal: AbortSignal.timeout(5000)
    });
    return parseHelpVideos(await readCatalogue(response));
  } catch {
    // A checked-in snapshot keeps onboarding available during upstream failures
    // and in website-only Docker builds.
    return parseHelpVideos(bundledCatalogue);
  }
}
