import { expect, it } from 'vitest';
import catalogue from '../../../content/videos/catalogue.json';
import { helpVideoCatalogueSchema, helpVideoRevision } from './help-videos.js';

it('accepts the published catalogue and includes all three media hashes in a cut revision', () => {
  const parsed = helpVideoCatalogueSchema.parse(catalogue);
  const first = parsed.videos[0];
  expect(helpVideoRevision(first)).toBe([first.src.sha256, first.poster.sha256, first.captions.sha256].join(':'));
});

it.each([
  (value: any) => { value.version = 2; },
  (value: any) => { value.videos.push(value.videos[0]); },
  (value: any) => { value.videos[0].src.path = 'https://evil.test/video.mp4'; },
  (value: any) => { value.videos[0].src.path = 'content/videos/media/../private.mp4'; },
  (value: any) => { value.videos[0].src.sha256 = 'f'.repeat(64); },
  (value: any) => { value.videos[0].src.bytes = 50 * 1024 * 1024; },
  (value: any) => { value.videos[0].poster.bytes = 0; },
  (value: any) => { value.videos[0].id = '../escape'; },
  (value: any) => { value.videos[0].fileName = '../video.mp4'; },
  (value: any) => { value.videos[0].duration = '1:90'; },
  (value: any) => { value.videos[0].minAppVersion = 'next'; },
  (value: any) => { value.videos[0].script = '<script>'; },
  (value: any) => { value.videos = []; },
  (value: any) => { value.videos = Array(61).fill(value.videos[0]); }
])('rejects malformed, oversized or unsafe content %#', mutate => {
  const value = structuredClone(catalogue);
  mutate(value);
  expect(helpVideoCatalogueSchema.safeParse(value).success).toBe(false);
});
