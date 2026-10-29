// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HELP_ENABLED_KEY, HelpProvider } from './HelpProvider.js';
import { HelpMenu } from './HelpMenu.js';
import { HelpToggle } from './HelpToggle.js';
import { HelpVideoLibrary } from './HelpVideoLibrary.js';
import { HELP_VIDEOS_WATCHED_KEY, useHelpVideos } from './help-videos-store.js';

const ui = vi.hoisted(() => ({ setWalkthroughOpen: vi.fn(), getReleaseNotes: vi.fn(async () => [{ version: '2.5.1', markdown: '# Plugin packs' }, { version: '2.3.0', markdown: '# Use Zana everywhere' }]) }));
vi.mock('../../store.js', () => ({
  useUi: { getState: () => ({ setWalkthroughOpen: ui.setWalkthroughOpen }) }
}));

vi.mock('../../lib/product-client.js', () => ({ product: { updates: { getReleaseNotes: ui.getReleaseNotes } } }));
vi.mock('../MarkdownContent.js', () => ({ MarkdownContent: ({ text }: { text: string }) => <div>{text}</div> }));

beforeEach(() => {
  localStorage.clear();
  useHelpVideos.setState({ openId: null, watched: [] });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

const trigger = () => screen.getByTestId('titlebar-help-toggle');
const hints = () => screen.getByRole('switch', { name: /Page hints/ });
function renderMenu() {
  return render(<HelpProvider><HelpMenu /><HelpToggle /><HelpVideoLibrary /><input aria-label="Outside" /></HelpProvider>);
}

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
  expect(fresh.useHelpVideos.getState().watched).toEqual(['guided-start']);
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
  const lastVideo = screen.getByRole('button', { name: 'Play Use Zana everywhere, 1:04' });
  lastVideo.focus();
  fireEvent.keyDown(lastVideo, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Replay walkthrough' }));
});
