import { expect, it } from 'vitest';
import { HELP_VIDEOS, helpVideo } from './help-videos.js';

it('lists unique bundled clips and rejects unknown ids', () => {
  expect(new Set(HELP_VIDEOS.map((video) => video.id)).size).toBe(HELP_VIDEOS.length);
  expect(HELP_VIDEOS[0].id).toBe('guided-start');
  for (const video of HELP_VIDEOS) {
    for (const url of [video.src, video.poster, video.captions]) expect(url).not.toMatch(/^https?:/);
    expect(video.fileName).toMatch(/\.mp4$/);
  }
  expect(helpVideo('zana-everywhere').title).toBe('Use Zana everywhere');
  expect(() => helpVideo('missing')).toThrow('Unknown help video: missing');
});
