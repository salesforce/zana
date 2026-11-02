// @vitest-environment jsdom
import { createElement, type ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GettingStarted } from './GettingStarted';
import catalogue from '../../content/videos/catalogue.json';
import { parseHelpVideos } from '../../lib/help-videos';

vi.mock('next/link', () => ({ default: ({ children, ...props }: ComponentProps<'a'>) => createElement('a', props, children) }));
afterEach(cleanup);
const videos = parseHelpVideos(catalogue);

it('keeps setup to three steps with optional prerequisites and the first walkthrough ready', () => {
  render(<GettingStarted videos={videos} />);
  expect(screen.getByRole('list', { name: 'Set up Zana' }).children).toHaveLength(3);
  expect(screen.getByRole('link', { name: /Download Zana/ }).getAttribute('href')).toBe('/download/');
  expect(screen.getByText('What do I need installed?').closest('details')?.open).toBe(false);
  const player = screen.getByLabelText(videos[0].title) as HTMLVideoElement;
  expect(player.controls).toBe(true);
  expect(player.autoplay).toBe(false);
  expect(player.preload).toBe('none');
  expect(player.muted).toBe(true);
  expect(player.crossOrigin).toBe('anonymous');
  expect(player.querySelector('track')?.src).toContain(videos[0].captions.path);
  expect(player.querySelector('track')?.hasAttribute('default')).toBe(true);
  expect(screen.getByRole('button', { name: new RegExp(videos[0].title) }).getAttribute('aria-pressed')).toBe('true');
});

it('switches title, media, captions and narration together and removes the previous player', () => {
  render(<GettingStarted videos={videos} />);
  const firstPlayer = screen.getByLabelText(videos[0].title);
  fireEvent.click(screen.getByRole('button', { name: new RegExp(videos[1].title) }));
  const player = screen.getByLabelText(videos[1].title) as HTMLVideoElement;
  expect(firstPlayer.isConnected).toBe(false);
  expect(player.src).toContain(videos[1].src.path);
  expect(player.poster).toContain(videos[1].poster.path);
  expect(player.querySelector('track')?.src).toContain(videos[1].captions.path);
  expect(player.muted).toBe(false);
  expect(screen.getByText(videos[1].description)).toBeTruthy();
  expect(screen.getByRole('button', { name: new RegExp(videos[0].title) }).getAttribute('aria-pressed')).toBe('false');
});

it('lets visitors retry a failed video, open it directly, or select another', () => {
  render(<GettingStarted videos={videos} />);
  const player = screen.getByLabelText(videos[0].title);
  fireEvent.error(player);
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'open the video directly' }).getAttribute('href')).toContain(videos[0].src.path);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(player.isConnected).toBe(false);
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.error(screen.getByLabelText(videos[0].title));
  fireEvent.click(screen.getByRole('button', { name: new RegExp(videos[1].title) }));
  expect(screen.queryByRole('alert')).toBeNull();
});

it('keeps setup and the full guide available when no videos are supplied', () => {
  render(<GettingStarted videos={[]} />);
  expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByRole('link', { name: /Read the full guide/ }).getAttribute('href')).toBe('/docs/using-zana/');
});

it('falls back to the first video when a refreshed catalogue removes the selection', () => {
  const { rerender } = render(<GettingStarted videos={videos} />);
  fireEvent.click(screen.getByRole('button', { name: new RegExp(videos[1].title) }));
  rerender(<GettingStarted videos={[videos[0]]} />);
  expect(screen.getByLabelText(videos[0].title)).toBeTruthy();
});
