// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HelpReleaseNotesSection, ReleaseNotesBrowser } from './HelpReleaseNotes.js';

const api = vi.hoisted(() => ({ getReleaseNotes: vi.fn() }));
vi.mock('../../lib/product-client.js', () => ({ product: { updates: api } }));
vi.mock('../MarkdownContent.js', () => ({ MarkdownContent: ({ text }: { text: string }) => <div>{text}</div> }));
vi.mock('../ReleaseNoteVideo.js', () => ({ ReleaseNoteVideo: ({ version }: { version: string }) => <div>Video {version}</div> }));
const notes = [{ version: '2.5.1', markdown: 'Plugin packs' }, { version: '2.3.0', markdown: 'Use Zana everywhere' }];
beforeEach(() => { api.getReleaseNotes.mockResolvedValue(notes); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('loads release metadata and opens the same catalogue from the latest card and All releases', async () => {
  const onOpen = vi.fn();
  render(<HelpReleaseNotesSection onOpen={onOpen} />);
  expect(screen.getByRole('status').textContent).toContain('Loading');
  expect(screen.getByRole('button', { name: /All releases/ }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(await screen.findByRole('button', { name: /Zana 2.5.1 Latest/ }));
  expect(onOpen).toHaveBeenLastCalledWith(notes);
  fireEvent.click(screen.getByRole('button', { name: /All releases/ }));
  expect(onOpen).toHaveBeenCalledTimes(2);
  expect(onOpen).toHaveBeenLastCalledWith(notes);
});

it('retries a failed read and reports an empty catalogue without an enabled action', async () => {
  api.getReleaseNotes.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
  render(<HelpReleaseNotesSection onOpen={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('No release notes available.'));
  expect(screen.getByRole('button', { name: /All releases/ }).hasAttribute('disabled')).toBe(true);
});

it.each(['resolve', 'reject'])('ignores a late %s after closing the menu', async (outcome) => {
  let resolve!: (value: typeof notes) => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<typeof notes>((yes, no) => { resolve = yes; reject = no; });
  api.getReleaseNotes.mockReturnValueOnce(pending);
  const first = render(<HelpReleaseNotesSection onOpen={vi.fn()} />);
  first.unmount();
  render(<HelpReleaseNotesSection onOpen={vi.fn()} />);
  await screen.findByRole('button', { name: /Zana 2.5.1/ });
  if (outcome === 'resolve') resolve([]); else reject(new Error('late failure'));
  await pending.catch(() => {});
  expect(screen.getByRole('button', { name: /Zana 2.5.1/ })).toBeTruthy();
  expect(screen.queryByRole('status')).toBeNull();
});

it('selects one release at a time, including its video, and closes from Done or Escape', () => {
  const close = vi.fn();
  render(<ReleaseNotesBrowser notes={notes} onClose={close} />);
  expect(screen.getByRole('dialog', { name: 'Release notes' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '2.5.1 Latest' }).getAttribute('aria-current')).toBe('true');
  expect(screen.getByRole('article', { name: 'Release 2.5.1' }).textContent).toContain('Plugin packs');
  fireEvent.click(screen.getByRole('button', { name: '2.3.0' }));
  expect(screen.getByRole('article', { name: 'Release 2.3.0' }).textContent).toContain('Video 2.3.0');
  expect(screen.queryByText('Plugin packs')).toBeNull();
  expect(screen.getByRole('button', { name: '2.5.1 Latest' }).getAttribute('aria-current')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(close).toHaveBeenCalledTimes(2);
});
