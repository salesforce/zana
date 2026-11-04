// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { HELP_VIDEOS } from '../../lib/help-videos.js';
const api = vi.hoisted(() => ({ read: vi.fn(async () => ({ videos: [] as unknown[] })) }));
vi.mock('../../lib/fetch-with-app-surface.js', () => ({ apiJson: api.read }));

beforeEach(() => { localStorage.clear(); vi.resetModules(); api.read.mockReset(); api.read.mockResolvedValue({ videos: [] }); });

it('preserves remote watched IDs before discovery and bounds corrupt/unbounded storage', async () => {
  localStorage.setItem('zcc.helpVideos.watched', JSON.stringify(['new-tutorial', 'new-tutorial', '../bad', 2]));
  const { useHelpVideos } = await import('./help-videos-store.js');
  expect(useHelpVideos.getState().watched).toEqual(['new-tutorial']);
  useHelpVideos.getState().markWatched('unknown');
  expect(useHelpVideos.getState().watched).toEqual(['new-tutorial']);
  useHelpVideos.getState().markWatched('guided-start');
  expect(useHelpVideos.getState().watched).toEqual(['new-tutorial', 'guided-start']);
  useHelpVideos.getState().markWatched('guided-start');
  expect(useHelpVideos.getState().watched).toHaveLength(2);
});

it('coalesces reads, discovers new IDs, preserves watched state and recovers from failed refresh', async () => {
  const { useHelpVideos } = await import('./help-videos-store.js');
  const remote = { ...HELP_VIDEOS[0], id: 'new-tutorial', revision: 'different', src: '/api/v1/help/videos/assets/new.mp4' };
  api.read.mockResolvedValue({ videos: [remote] });
  await Promise.all([useHelpVideos.getState().refresh(), useHelpVideos.getState().refresh()]);
  expect(api.read).toHaveBeenCalledTimes(1);
  useHelpVideos.getState().open('new-tutorial');
  expect(useHelpVideos.getState().openId).toBe('new-tutorial');
  useHelpVideos.getState().markWatched('new-tutorial');
  expect(localStorage.getItem('zcc.helpVideos.watched')).toContain('new-tutorial');
  await useHelpVideos.getState().refresh();
  api.read.mockRejectedValue(new Error('offline'));
  await useHelpVideos.getState().refresh();
  expect(useHelpVideos.getState().videos[0].id).toBe('new-tutorial');
  useHelpVideos.getState().close(); expect(useHelpVideos.getState().openId).toBeNull();
  useHelpVideos.getState().open('missing'); expect(useHelpVideos.getState().openId).toBe('new-tutorial');
  await useHelpVideos.getState().refresh();
});

it.each(['invalid json', '{}'])('handles invalid watched history %s', async value => {
  localStorage.setItem('zcc.helpVideos.watched', value);
  const { useHelpVideos } = await import('./help-videos-store.js');
  expect(useHelpVideos.getState().watched).toEqual([]);
});
