import { expect, it } from 'vitest';
import { HELP_VIDEOS, helpVideo } from './help-videos.js';

it('lists unique bundled clips and rejects unknown ids', () => {
  expect(new Set(HELP_VIDEOS.map((video) => video.id)).size).toBe(HELP_VIDEOS.length);
  expect(HELP_VIDEOS.map((video) => video.id)).toEqual(['guided-start', 'how-to-use-a-squad', 'zana-everywhere']);
  for (const video of HELP_VIDEOS) {
    for (const url of [video.src, video.poster, video.captions]) expect(url).not.toMatch(/^https?:/);
    expect(video.fileName).toMatch(/\.mp4$/);
  }
  expect(helpVideo('how-to-use-a-squad')).toMatchObject({ title: 'How to use a Squad', group: 'Getting started', silent: false });
  expect(helpVideo('how-to-use-a-squad').alsoIn).toBeUndefined();
  expect(helpVideo('zana-everywhere').title).toBe('Use Zana everywhere');
  expect(() => helpVideo('missing')).toThrow('Unknown help video: missing');
});
