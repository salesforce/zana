// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  state: { setNav: vi.fn(), setWalkthroughHomeMode: vi.fn() }
}));

vi.mock('../store.js', () => ({
  useUi: Object.assign((selector: (state: typeof h.state) => unknown) => selector(h.state), {
    getState: () => h.state
  })
}));

import { Walkthrough } from './Walkthrough.js';

let play: ReturnType<typeof vi.fn>;
let reducedMotion = false;

beforeEach(() => {
  h.state.setNav.mockClear();
  h.state.setWalkthroughHomeMode.mockClear();
  play = vi.fn(() => Promise.resolve());
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: play });
  reducedMotion = false;
  window.matchMedia = vi.fn((query: string) => ({ matches: reducedMotion && query.includes('reduce') })) as never;
});
afterEach(cleanup);

describe('Walkthrough intro video', () => {
  it('plays the bundled, muted clip with captions on the first step', () => {
    render(<Walkthrough onClose={() => undefined} />);
    const video = screen.getByLabelText('First project walkthrough video') as HTMLVideoElement;
    expect(video.muted).toBe(true);
    expect(video.controls).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.getAttribute('poster')).toMatch(/guided-start\.jpg/);
    expect(video.querySelector('source')?.getAttribute('src')).toMatch(/guided-start\.mp4/);
    const track = video.querySelector('track')!;
    expect(track.kind).toBe('captions');
    expect(track.getAttribute('src')).toMatch(/guided-start\.en\.vtt/);
    for (const url of [video.poster, video.querySelector('source')!.src, track.src]) {
      expect(new URL(url).origin).toBe(window.location.origin);
    }
    expect(play).toHaveBeenCalledTimes(1);
    expect(h.state.setNav).toHaveBeenLastCalledWith('home');
    expect(h.state.setWalkthroughHomeMode).toHaveBeenLastCalledWith(null);
  });

  it('waits for the user under prefers-reduced-motion', () => {
    reducedMotion = true;
    render(<Walkthrough onClose={() => undefined} />);
    expect(screen.getByTestId('walkthrough-intro-video')).toBeTruthy();
    expect(play).not.toHaveBeenCalled();
  });

  it('ignores a rejected autoplay', async () => {
    play.mockImplementation(() => Promise.reject(new Error('NotAllowedError')));
    render(<Walkthrough onClose={() => undefined} />);
    await Promise.resolve();
    expect(screen.getByTestId('walkthrough-intro-video')).toBeTruthy();
  });

  it('autoplays without matchMedia and tolerates a play() that returns nothing', () => {
    (window as { matchMedia?: unknown }).matchMedia = undefined;
    play.mockImplementation(() => undefined);
    render(<Walkthrough onClose={() => undefined} />);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('moves on to the Modern composer step with its icon and the narrow card', () => {
    render(<Walkthrough onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    const dialog = screen.getByTestId('walkthrough-dialog');
    expect(dialog.getAttribute('data-walkthrough-step')).toBe('thread');
    expect(dialog.className).not.toContain('walkthrough-card--media');
    expect(dialog.querySelector('.walkthrough-icon')).toBeTruthy();
    expect(screen.queryByTestId('walkthrough-intro-video')).toBeNull();
    expect(screen.getByText('Step 2 of 5')).toBeTruthy();
    expect(screen.getByText('Start a conversation')).toBeTruthy();
    expect(document.querySelector('.walkthrough-backdrop--composer')).toBeTruthy();
    expect(h.state.setWalkthroughHomeMode).toHaveBeenLastCalledWith('thread');
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(screen.getByTestId('walkthrough-intro-video')).toBeTruthy();
  });
});
