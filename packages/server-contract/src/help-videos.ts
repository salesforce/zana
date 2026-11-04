import { z } from 'zod';

export const HELP_VIDEO_CATALOGUE_MAX_BYTES = 128 * 1024;
export const HELP_VIDEO_MAX_BYTES = 48 * 1024 * 1024;
export const HELP_VIDEO_MAX_ENTRIES = 60;
const text = (max: number) => z.string().trim().min(1).max(max);
const version = z.string().regex(/^\d+\.\d+\.\d+$/);

function asset(extension: string, maxBytes: number) {
  return z.object({
    path: z.string().max(240).regex(new RegExp(`^content/videos/media/[a-z0-9-]+-[a-f0-9]{64}\\.${extension}$`)),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().positive().max(maxBytes)
  }).strict().refine(value => value.path.endsWith(`-${value.sha256}.${extension}`), 'Asset filename must include its SHA-256');
}

export const helpVideoEntrySchema = z.object({
  id: z.string().max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  group: text(100), title: text(160), description: text(1000),
  duration: z.string().regex(/^\d{1,3}:[0-5]\d$/),
  details: text(160), alsoIn: text(100).optional(), silent: z.boolean(),
  fileName: z.string().max(120).regex(/^[a-z0-9][a-z0-9-]*\.mp4$/),
  minAppVersion: version.optional(), maxAppVersion: version.optional(),
  src: asset('mp4', HELP_VIDEO_MAX_BYTES),
  poster: asset('jpg', 2 * 1024 * 1024),
  captions: asset('vtt', 256 * 1024)
}).strict();

export const helpVideoCatalogueSchema = z.object({
  version: z.literal(1),
  videos: z.array(helpVideoEntrySchema).min(1).max(HELP_VIDEO_MAX_ENTRIES)
}).strict().refine(value => new Set(value.videos.map(video => video.id)).size === value.videos.length, 'Duplicate video IDs');

export type HelpVideoCatalogue = z.infer<typeof helpVideoCatalogueSchema>;
export type HelpVideoEntry = HelpVideoCatalogue['videos'][number];
export type HelpVideoAsset = HelpVideoEntry['src'];
export type HelpVideoView = Omit<HelpVideoEntry, 'src' | 'poster' | 'captions' | 'minAppVersion' | 'maxAppVersion'> & {
  src: string; poster: string; captions: string; revision: string;
};

/** Identifies the complete cut, including independently revised captions/poster. */
export function helpVideoRevision(video: Pick<HelpVideoEntry, 'src' | 'poster' | 'captions'>): string {
  return [video.src.sha256, video.poster.sha256, video.captions.sha256].join(':');
}
