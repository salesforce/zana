// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HELP_ENABLED_KEY, HelpProvider } from './HelpProvider.js';
import { HelpMenu } from './HelpMenu.js';
import { HelpToggle } from './HelpToggle.js';
import { HelpVideoLibrary } from './HelpVideoLibrary.js';
import { HELP_VIDEOS_WATCHED_KEY, useHelpVideos } from './help-videos-store.js';
import { HELP_VIDEOS } from '../../lib/help-videos.js';
import { TUTORIAL_DISCOVERY_DISMISSED_KEY } from './useTutorialDiscovery.js';

const ui = vi.hoisted(() => ({ setWalkthroughOpen: vi.fn(), getReleaseNotes: vi.fn(async () => [{ version: '2.5.1', markdown: '# Plugin packs' }, { version: '2.3.0', markdown: '# Use Zana everywhere' }]) }));
vi.mock('../../store.js', () => ({
  useUi: { getState: () => ({ setWalkthroughOpen: ui.setWalkthroughOpen }) }
}));

vi.mock('../../lib/product-client.js', () => ({ product: { updates: { getReleaseNotes: ui.getReleaseNotes } } }));
vi.mock('../../lib/fetch-with-app-surface.js', () => ({ apiJson: vi.fn(async () => { throw new Error('offline fixture'); }) }));
vi.mock('../MarkdownContent.js', () => ({ MarkdownContent: ({ text }: { text: string }) => <div>{text}</div> }));

beforeEach(() => {
  localStorage.clear();
  useHelpVideos.setState({ openId: null, watched: [], videos: HELP_VIDEOS });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

const trigger = () => screen.getByTestId('titlebar-help-toggle');
const hints = () => screen.getByRole('switch', { name: /Page hints/ });
const category = (group: string) => screen.getByRole('button', { name: name => name.startsWith(`${group}, `) });
function renderMenu(discoveryEnabled = false) {
  return render(<HelpProvider><HelpMenu discoveryEnabled={discoveryEnabled} /><HelpToggle /><HelpVideoLibrary /><input aria-label="Outside" /></HelpProvider>);
}

it('offers tutorials without stealing focus and opens the library with hints off', async () => {
  localStorage.setItem(HELP_ENABLED_KEY, '0');
  renderMenu(true);
  screen.getByLabelText('Outside').focus();
  await screen.findByRole('region', { name: 'Discover video tutorials' });
  expect(document.activeElement).toBe(screen.getByLabelText('Outside'));
  expect(trigger().getAttribute('aria-describedby')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Watch tutorials' }));
  expect(screen.queryByRole('region', { name: 'Discover video tutorials' })).toBeNull();
  expect(screen.getByRole('dialog', { name: 'Video tutorials' })).toBeTruthy();
  expect(localStorage.getItem(TUTORIAL_DISCOVERY_DISMISSED_KEY)).toBe('1');
  expect(localStorage.getItem(HELP_ENABLED_KEY)).toBe('0');
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(document.activeElement).toBe(trigger());
});

it.each(['Not now', 'Dismiss tutorial hint'])('retires discovery with %s and keeps Help reachable', async name => {
  renderMenu(true);
  await screen.findByRole('region', { name: 'Discover video tutorials' });
  fireEvent.click(screen.getByRole('button', { name }));
  expect(document.activeElement).toBe(trigger());
  expect(trigger().hasAttribute('aria-describedby')).toBe(false);
  expect(localStorage.getItem(TUTORIAL_DISCOVERY_DISMISSED_KEY)).toBe('1');
  fireEvent.click(trigger());
  expect(screen.getByText('Video tutorials')).toBeTruthy();
  expect(screen.getByRole('button', { name: /All videos/ })).toBeTruthy();
});

it('dismisses discovery with Escape from its controls or the Help trigger', async () => {
  renderMenu(true);
  await screen.findByRole('region', { name: 'Discover video tutorials' });
  fireEvent.keyDown(screen.getByRole('button', { name: 'Not now' }), { key: 'Tab' });
  expect(screen.getByRole('region', { name: 'Discover video tutorials' })).toBeTruthy();
  fireEvent.keyDown(trigger(), { key: 'Escape' });
  expect(screen.queryByRole('region', { name: 'Discover video tutorials' })).toBeNull();
  expect(document.activeElement).toBe(trigger());
});

it('retires discovery when Help is opened before the hint appears', async () => {
  renderMenu(true);
  fireEvent.click(trigger());
  expect(localStorage.getItem(TUTORIAL_DISCOVERY_DISMISSED_KEY)).toBe('1');
  fireEvent.keyDown(hints(), { key: 'Escape' });
  cleanup();
  renderMenu(true);
  expect(screen.queryByRole('region', { name: 'Discover video tutorials' })).toBeNull();
});

it('discovers a remote video, pins its playing cut across refreshes and offers retry on failure', async () => {
  const remote = { ...HELP_VIDEOS[0], id: 'new-tutorial', title: 'New tutorial', revision: 'new', src: '/api/v1/help/videos/assets/new.mp4' };
  useHelpVideos.setState({ videos: [remote, ...HELP_VIDEOS] });
  renderMenu(); fireEvent.click(trigger());
  fireEvent.click(category('Getting started'));
  fireEvent.click(screen.getByRole('button', { name: 'Play New tutorial, 0:30' }));
  const player = screen.getByTestId('help-video-player');
  expect(player.querySelector('source')?.getAttribute('src')).toBe(remote.src);
  act(() => { useHelpVideos.setState({ videos: [{ ...remote, title: 'Changed', src: '/changed.mp4' }, ...HELP_VIDEOS] }); });
  expect(player.getAttribute('aria-label')).toBe('New tutorial');
  fireEvent.error(player.querySelector('source')!);
  expect(screen.getByRole('status').textContent).toContain('This video is unavailable');
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: 'Retry video' }));
  expect(screen.queryByRole('status')).toBeNull();
});

it('falls back to the bundled copy when a remotely revised basic cannot play', () => {
  const remote = { ...HELP_VIDEOS[0], src: '/api/v1/help/videos/assets/revised.mp4' };
  useHelpVideos.setState({ videos: [remote, ...HELP_VIDEOS.slice(1)] });
  renderMenu(); fireEvent.click(trigger());
  fireEvent.click(category('Getting started'));
  fireEvent.click(screen.getByRole('button', { name: /Play Your first project/ }));
  fireEvent.error(screen.getByTestId('help-video-player'));
  expect(screen.getByRole('status').textContent).toContain('Playing the offline copy');
  expect(screen.getByTestId('help-video-player').querySelector('source')?.getAttribute('src')).toBe(HELP_VIDEOS[0].src);
});

it('returns keyboard focus to the fullscreen button after leaving video fullscreen', () => {
  renderMenu(); fireEvent.click(trigger());
  fireEvent.click(category('Getting started'));
  fireEvent.click(screen.getByRole('button', { name: /Play Your first project/ }));
  const player = screen.getByTestId('help-video-player');
  const original = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
  let fullscreen: Element | null = player;
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen });
  try {
    fireEvent(document, new Event('fullscreenchange'));
    fullscreen = null;
    fireEvent(document, new Event('fullscreenchange'));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Full screen' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByTestId('help-video-library')).toBeNull();
  } finally {
    if (original) Object.defineProperty(document, 'fullscreenElement', original);
    else Reflect.deleteProperty(document, 'fullscreenElement');
  }
});

it('opens a menu whose first row is the page-hints switch, shared with mobile', () => {
  renderMenu();
  expect(trigger().getAttribute('aria-haspopup')).toBe('dialog');
  expect(trigger().getAttribute('aria-expanded')).toBe('false');
  expect(trigger().className).toContain('is-active');
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(trigger());
  expect(trigger().getAttribute('aria-expanded')).toBe('true');
  expect(trigger().className).toContain('is-open');
  expect(document.activeElement).toBe(hints());
  expect(hints().getAttribute('aria-checked')).toBe('true');
  fireEvent.click(hints());
  expect(hints().getAttribute('aria-checked')).toBe('false');
  expect(trigger().className).not.toContain('is-active');
  expect(screen.getByTestId('mobile-help-toggle').getAttribute('aria-pressed')).toBe('false');
  expect(localStorage.getItem(HELP_ENABLED_KEY)).toBe('0');
  // The switch keeps the menu open so the change is visible.
  expect(screen.getByRole('dialog', { name: 'Help' })).toBeTruthy();
  fireEvent.click(screen.getByTestId('mobile-help-toggle'));
  expect(trigger().className).toContain('is-active');
  fireEvent.click(trigger());
  expect(hints().getAttribute('aria-checked')).toBe('true');
});

it('closes on Escape, outside pointer and blur, returning focus to the trigger on Escape', () => {
  renderMenu();
  fireEvent.click(trigger());
  fireEvent.keyDown(hints(), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger());
  fireEvent.click(trigger());
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(trigger());
  fireEvent.blur(hints(), { relatedTarget: screen.getByLabelText('Outside') });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(trigger());
  fireEvent.click(trigger());
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('moves through the menu with the arrow keys and wraps', () => {
  renderMenu();
  fireEvent.click(trigger());
  const items = Array.from(screen.getByRole('dialog').querySelectorAll('button'));
  fireEvent.keyDown(hints(), { key: 'ArrowUp' });
  expect(document.activeElement).toBe(items.at(-1));
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(items[0]);
  fireEvent.keyDown(items[0], { key: 'ArrowDown' });
  expect(document.activeElement).toBe(items[1]);
  fireEvent.keyDown(items[1], { key: 'Tab' });
  expect(document.activeElement).toBe(items[1]);
});

it('opens a video, switches clips, tracks watched state and closes back to the trigger', () => {
  renderMenu();
  fireEvent.click(trigger());
  fireEvent.click(category('What’s new · 2.3.0'));
  fireEvent.click(screen.getByRole('button', { name: 'Play Use Zana everywhere, 1:04' }));
  expect(screen.queryByRole('dialog', { name: 'Help' })).toBeNull();
  const player = () => screen.getByTestId('help-video-player') as HTMLVideoElement;
  expect(player().getAttribute('aria-label')).toBe('Use Zana everywhere');
  expect(player().muted).toBe(false);
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  expect(screen.getByRole('link', { name: 'Save video' }).getAttribute('download')).toBe('zana-everywhere.mp4');
  const fullscreen = vi.fn(async () => {});
  player().requestFullscreen = fullscreen;
  fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
  expect(fullscreen).toHaveBeenCalledOnce();
  player().requestFullscreen = vi.fn(async () => { throw new Error('denied'); });
  fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
  (player() as { requestFullscreen?: unknown }).requestFullscreen = undefined;
  fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));

  expect(screen.getByText('Also in: Release notes 2.3.0')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /How to use a Squad/ }));
  expect(player().getAttribute('aria-label')).toBe('How to use a Squad');
  expect(player().muted).toBe(false);
  expect(screen.queryByText(/^Also in:/)).toBeNull();
  expect(screen.getByRole('link', { name: 'Save video' }).getAttribute('download')).toBe('zana-how-to-use-a-squad.mp4');

  fireEvent.click(screen.getByRole('button', { name: /Your first project in 30 seconds/ }));
  expect(player().getAttribute('aria-label')).toBe('Your first project in 30 seconds');
  expect(player().muted).toBe(true);
  Object.defineProperty(player(), 'duration', { configurable: true, value: 30 });
  Object.defineProperty(player(), 'currentTime', { configurable: true, value: 10 });
  fireEvent.timeUpdate(player());
  expect(useHelpVideos.getState().watched).toEqual([]);
  Object.defineProperty(player(), 'currentTime', { configurable: true, value: 28 });
  fireEvent.timeUpdate(player());
  fireEvent.timeUpdate(player());
  expect(useHelpVideos.getState().watched).toEqual(['guided-start']);
  expect(JSON.parse(localStorage.getItem(HELP_VIDEOS_WATCHED_KEY)!)).toEqual(['guided-start']);
  expect(screen.getByRole('button', { name: /Your first project/ }).getAttribute('aria-current')).toBe('true');
  expect(screen.getByText('✓ Watched')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByTestId('help-video-library')).toBeNull();
  expect(document.activeElement).toBe(trigger());
  fireEvent.click(trigger());
  fireEvent.click(category('Getting started'));
  expect(screen.getByRole('button', { name: 'Play Your first project in 30 seconds, 0:30, watched' })).toBeTruthy();
});

it('opens the first clip from All videos and leaves reduced motion paused', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
  renderMenu();
  fireEvent.click(trigger());
  fireEvent.click(screen.getByRole('button', { name: /All videos/ }));
  expect(screen.getByTestId('help-video-player').getAttribute('aria-label')).toBe('Your first project in 30 seconds');
  expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

it('replays the walkthrough and opens the release browser with focus restored on close', async () => {
  renderMenu();
  fireEvent.click(trigger());
  fireEvent.click(screen.getByRole('button', { name: 'Replay walkthrough' }));
  expect(ui.setWalkthroughOpen).toHaveBeenCalledWith(true);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(trigger());
  await waitFor(() => expect(screen.getByRole('button', { name: /Zana 2.5.1 Latest/ })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: /Zana 2.5.1 Latest/ }));
  expect(screen.queryByRole('dialog', { name: 'Help' })).toBeNull();
  expect(screen.getByRole('dialog', { name: 'Release notes' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '2.3.0' }));
  expect(screen.getByRole('article', { name: 'Release 2.3.0' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(document.activeElement).toBe(trigger());
  fireEvent.click(trigger());
  await waitFor(() => expect(screen.getByRole('button', { name: /All releases/ }).hasAttribute('disabled')).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: /All releases/ }));
  expect(screen.getByRole('article', { name: 'Release 2.5.1' })).toBeTruthy();
});

it('ignores unknown ids and keeps a corrupt or foreign watched list safe', async () => {
  localStorage.setItem(HELP_VIDEOS_WATCHED_KEY, '["guided-start","removed-clip",3]');
  vi.resetModules();
  const fresh = await import('./help-videos-store.js');
  expect(fresh.useHelpVideos.getState().watched).toEqual(['guided-start', 'removed-clip']);
  localStorage.setItem(HELP_VIDEOS_WATCHED_KEY, '{not json');
  vi.resetModules();
  expect((await import('./help-videos-store.js')).useHelpVideos.getState().watched).toEqual([]);
  localStorage.setItem(HELP_VIDEOS_WATCHED_KEY, '{"a":1}');
  vi.resetModules();
  expect((await import('./help-videos-store.js')).useHelpVideos.getState().watched).toEqual([]);

  act(() => useHelpVideos.getState().open('removed-clip'));
  expect(useHelpVideos.getState().openId).toBe('guided-start');
  act(() => useHelpVideos.getState().markWatched('removed-clip'));
  expect(useHelpVideos.getState().watched).toEqual([]);
  act(() => useHelpVideos.getState().close());
  expect(useHelpVideos.getState().openId).toBeNull();
});


it('skips the disabled release action during keyboard navigation while notes load', () => {
  ui.getReleaseNotes.mockReturnValueOnce(new Promise(() => {}));
  renderMenu();
  fireEvent.click(trigger());
  fireEvent.click(category('What’s new · 2.3.0'));
  const lastVideo = screen.getByRole('button', { name: 'Play Use Zana everywhere, 1:04' });
  lastVideo.focus();
  fireEvent.keyDown(lastVideo, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Replay walkthrough' }));
});

it('groups the live catalogue, counts clips and starts with all categories collapsed', () => {
  const extra = (id: string, group: string) => ({ ...HELP_VIDEOS[0], id, group, title: id });
  useHelpVideos.setState({ videos: [
    ...HELP_VIDEOS,
    extra('agent-build', 'Agentforce'), extra('agent-tests', 'Agentforce'),
    ...Array.from({ length: 9 }, (_, index) => extra(`squad-${index}`, 'Squads')),
    extra('new-topic', 'New topic')
  ] });
  renderMenu(); fireEvent.click(trigger());
  const buttons = screen.getAllByRole('button', { expanded: false });
  expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual([
    'Getting started, 2 videos', 'Agentforce, 2 videos', 'Squads, 9 videos', 'New topic, 1 video', 'What’s new · 2.3.0, 1 video'
  ]);
  for (const button of buttons) {
    expect(document.getElementById(button.getAttribute('aria-controls')!)?.hidden).toBe(true);
  }
  expect(screen.queryByRole('button', { name: /^Play / })).toBeNull();
  expect(screen.getByText('Build, launch and manage runs')).toBeTruthy();
  expect(screen.getByText('Build and test your agents')).toBeTruthy();
  expect(screen.getByText('Explore tutorials and walkthroughs')).toBeTruthy();

  fireEvent.click(category('Squads'));
  expect(category('Squads').getAttribute('aria-expanded')).toBe('true');
  expect(screen.getAllByRole('button', { name: /^Play / })).toHaveLength(9);
  fireEvent.click(category('Agentforce'));
  expect(category('Squads').getAttribute('aria-expanded')).toBe('false');
  expect(screen.getAllByRole('button', { name: /^Play / })).toHaveLength(2);
  fireEvent.click(category('Agentforce'));
  expect(screen.queryByRole('button', { name: /^Play / })).toBeNull();
  fireEvent.click(category('New topic'));
  fireEvent.click(screen.getByRole('button', { name: 'Play new-topic, 0:30' }));
  expect(screen.getByTestId('help-video-player').getAttribute('aria-label')).toBe('new-topic');
});

it('updates category counts during refresh and resets expansion when reopening the menu', () => {
  renderMenu(); fireEvent.click(trigger());
  fireEvent.click(category('Getting started'));
  category('Getting started').focus();
  act(() => useHelpVideos.setState({ videos: [
    ...HELP_VIDEOS, { ...HELP_VIDEOS[0], id: 'fresh-tutorial', title: 'Fresh tutorial' }
  ] }));
  expect(category('Getting started').getAttribute('aria-label')).toBe('Getting started, 3 videos');
  expect(category('Getting started').getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(category('Getting started'));
  expect(screen.getByRole('button', { name: 'Play Fresh tutorial, 0:30' })).toBeTruthy();
  fireEvent.keyDown(category('Getting started'), { key: 'Escape' });
  fireEvent.click(trigger());
  expect(category('Getting started').getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('button', { name: /^Play / })).toBeNull();
});

it('navigates category headers and expanded clips without focusing collapsed clips', () => {
  renderMenu(); fireEvent.click(trigger());
  const gettingStarted = category('Getting started');
  const highlights = category('What’s new · 2.3.0');
  gettingStarted.focus();
  fireEvent.keyDown(gettingStarted, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(highlights);
  fireEvent.click(gettingStarted);
  gettingStarted.focus();
  fireEvent.keyDown(gettingStarted, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: /Play Your first project/ }));
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(gettingStarted);
  fireEvent.click(highlights);
  highlights.focus();
  fireEvent.keyDown(highlights, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Play Use Zana everywhere, 1:04' }));
});
