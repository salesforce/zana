// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueuedMessagesCard } from './ComposerStackCards.js';

const api = vi.hoisted(() => ({
  nextTurn: vi.fn(), sendNextTurn: vi.fn(), flushNextTurn: vi.fn(),
  deleteNextTurn: vi.fn(), onUpdated: vi.fn(), unsubscribe: vi.fn()
}));
vi.mock('../../../lib/product-client.js', () => ({ product: { threads: api } }));
vi.mock('../../../lib/in-app-browser-link-preference.js', () => ({ handleHttpLinkClick: vi.fn() }));
vi.mock('../secondary-panel/threadSecondaryPanelLogic.js', () => ({ loadWorkspaceMeta: vi.fn() }));

let items: Array<{ id: string; text: string; status: string; failureReason?: string }>;
let paused: boolean;
beforeEach(() => {
  vi.resetAllMocks();
  items = [
    { id: 'one', text: 'First queued message', status: 'queued' },
    { id: 'two', text: 'Second queued message', status: 'queued' }
  ];
  paused = false;
  api.nextTurn.mockImplementation(async () => ({ items: [...items], paused }));
  api.onUpdated.mockReturnValue(api.unsubscribe);
  api.sendNextTurn.mockImplementation(async (_threadId, id) => {
    items = items.filter((row) => row.id !== id);
    return { ok: true };
  });
  api.deleteNextTurn.mockImplementation(async (_threadId, id) => {
    items = items.filter((row) => row.id !== id);
    return { ok: true };
  });
});
afterEach(cleanup);

it.each([false, true])('shows a send action on every message (paused=%s) and sends only the clicked row', async (isPaused) => {
  paused = isPaused;
  const { unmount } = render(<QueuedMessagesCard threadId="thread-1" />);
  const sends = await screen.findAllByRole('button', { name: 'Send now' });
  expect(sends).toHaveLength(2);
  expect(screen.queryByRole('button', { name: 'Send all' }) !== null).toBe(isPaused);
  fireEvent.click(sends[1]!);
  await waitFor(() => expect(screen.queryByText('Second queued message')).toBeNull());
  expect(api.sendNextTurn).toHaveBeenCalledExactlyOnceWith('thread-1', 'two');
  expect(api.flushNextTurn).not.toHaveBeenCalled();
  expect(screen.getByText('First queued message')).toBeTruthy();
  expect(paused).toBe(isPaused);
  unmount();
  expect(api.unsubscribe).toHaveBeenCalledOnce();
});

it('keeps all queue actions from racing with a send and marks the selected button busy', async () => {
  let resolve!: () => void;
  api.sendNextTurn.mockImplementation(() => new Promise<void>((done) => { resolve = done; }));
  render(<QueuedMessagesCard threadId="thread-1" />);
  const sends = await screen.findAllByRole('button', { name: 'Send now' });
  fireEvent.click(sends[0]!);
  expect(sends[0]!.getAttribute('aria-busy')).toBe('true');
  for (const button of screen.getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(sends[0]!);
  fireEvent.click(sends[1]!);
  expect(api.sendNextTurn).toHaveBeenCalledOnce();
  items = items.slice(1);
  await act(async () => resolve());
  expect((screen.getByRole('button', { name: 'Send now' }) as HTMLButtonElement).disabled).toBe(false);
});

it.each([new Error('Host daemon is not connected'), 'unexpected'])('keeps failed sends visible and permits retry (%s)', async (error) => {
  api.sendNextTurn.mockRejectedValueOnce(error);
  render(<QueuedMessagesCard threadId="thread-1" />);
  fireEvent.click((await screen.findAllByRole('button', { name: 'Send now' }))[0]!);
  expect((await screen.findByRole('alert')).textContent).toBe(
    error instanceof Error ? error.message : 'Failed to send queued message'
  );
  expect(screen.getByText('First queued message')).toBeTruthy();
  await waitFor(() => expect((screen.getAllByRole('button', { name: 'Send now' })[0] as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getAllByRole('button', { name: 'Send now' })[0]!);
  await waitFor(() => expect(screen.queryByText('First queued message')).toBeNull());
  expect(screen.queryByRole('alert')).toBeNull();
});

it('disables in-flight rows but allows explicitly retrying failed rows', async () => {
  items[0]!.status = 'dispatching';
  items[1]!.status = 'failed';
  items[1]!.failureReason = 'Previous failure';
  render(<QueuedMessagesCard threadId="thread-1" />);
  const sends = await screen.findAllByRole('button', { name: 'Send now' });
  expect((sends[0] as HTMLButtonElement).disabled).toBe(true);
  expect((sends[1] as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByText('Previous failure')).toBeTruthy();
  fireEvent.click(sends[1]!);
  await waitFor(() => expect(api.sendNextTurn).toHaveBeenCalledExactlyOnceWith('thread-1', 'two'));
});

it('retains the separate paused-queue Send all action', async () => {
  paused = true;
  api.flushNextTurn.mockImplementation(async () => { items = []; });
  render(<QueuedMessagesCard threadId="thread-1" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Send all' }));
  await waitFor(() => expect(screen.queryByTestId('thread-queued-messages')).toBeNull());
  expect(api.flushNextTurn).toHaveBeenCalledExactlyOnceWith('thread-1', true);
  expect(api.sendNextTurn).not.toHaveBeenCalled();
});

it('still removes a selected row independently', async () => {
  render(<QueuedMessagesCard threadId="thread-1" />);
  const first = (await screen.findByText('First queued message')).closest('li')!;
  fireEvent.click(within(first).getByRole('button', { name: 'Remove queued message' }));
  await waitFor(() => expect(screen.queryByText('First queued message')).toBeNull());
  expect(api.deleteNextTurn).toHaveBeenCalledExactlyOnceWith('thread-1', 'one');
  expect(screen.getByText('Second queued message')).toBeTruthy();
});
