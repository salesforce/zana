import { expect, it } from 'vitest';
import bundledRevisions from './help-video-baseline.json';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { type HelpVideoView } from '@zana-ai/zcc-server-contract';
import { HELP_VIDEOS } from './help-videos.js';
import { mergeHelpVideos } from './help-video-catalogue.js';

const remote = (id = 'new-tutorial'): HelpVideoView => ({ ...HELP_VIDEOS[0], id,
  src: '/api/v1/help/videos/assets/video.mp4', poster: '/api/v1/help/videos/assets/poster.jpg',
  captions: '/api/v1/help/videos/assets/captions.vtt', revision: 'new-cut' });

it('adds remote entries in publication order and retains the bundled offline basics', () => {
  const video = remote();
  expect(mergeHelpVideos([video])).toEqual([video, ...HELP_VIDEOS]);
  expect(mergeHelpVideos([])).toEqual(HELP_VIDEOS);
});
it('keeps matching cuts local while updating metadata, and uses remote URLs for revised cuts', () => {
  const video = { ...remote('guided-start'), title: 'Updated title', revision: bundledRevisions['guided-start'] };
  expect(mergeHelpVideos([video])[0]).toMatchObject({ title: 'Updated title', src: HELP_VIDEOS[0].src });
  expect(mergeHelpVideos([{ ...video, revision: 'changed' }])[0].src).toBe(video.src);
});

// This baseline is deliberately independent of the mutable publication catalogue.
it('records the actual bundled files, so a later content-only revision cannot masquerade as an offline copy', async () => {
  const directories = { 'guided-start': 'onboarding/guided-start', 'how-to-use-a-squad': 'squads/how-to-use-a-squad', 'zana-everywhere': 'release-notes/zana-everywhere' };
  for (const [id, path] of Object.entries(directories)) {
    const hashes = await Promise.all(['.mp4', '.jpg', '.en.vtt'].map(async extension =>
      createHash('sha256').update(await readFile(new URL(`../assets/${path}${extension}`, import.meta.url))).digest('hex')));
    expect((bundledRevisions as Record<string, string>)[id]).toBe(hashes.join(':'));
  }
});
