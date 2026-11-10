// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PeerMessageReviews } from './PeerMessageReviews.js';
const api = vi.hoisted(() => ({ json: vi.fn(), send: vi.fn(), subscribe: vi.fn(() => vi.fn()) }));
vi.mock('../../../lib/product-client.js', () => ({ product: { threads: { sendNextTurn: api.send, onUpdated: api.subscribe } } }));
vi.mock('../../../lib/fetch-with-app-surface.js', () => ({ apiJson: api.json }));
const item = { id: 'peer_1', text: 'Please review parser.ts', updatedAt: 1, status: 'pending', from: 'Builder', senderThreadId: 'builder-id', to: 'Reviewer', recipientKind: 'thread' };
let items: typeof item[], enabled: boolean, paused: boolean;
beforeEach(() => {
  vi.clearAllMocks(); items = [{ ...item }]; enabled = true; paused = false;
  api.json.mockImplementation(async (_path, options) => {
    if (options?.method === 'DELETE') { items = []; return { ok: true }; }
    return { items: [...items], enabled, paused };
  });
  api.send.mockImplementation(async () => { items = []; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('shows pending content for review and invokes trusted delivery only on click', async () => {
  render(<PeerMessageReviews threadId="reviewer" />);
  await screen.findByText('Please review parser.ts');
  expect(api.send).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: 'Builder' }).getAttribute('href')).toBe('/threads/builder-id');
  fireEvent.click(screen.getByRole('button', { name: 'Deliver to thread' }));
  await waitFor(() => expect(api.send).toHaveBeenCalledWith('reviewer', 'peer_1'));
  await waitFor(() => expect(screen.queryByTestId('thread-peer-reviews')).toBeNull());
});
it('discards the exact revision without dispatching', async () => {
  render(<PeerMessageReviews threadId="reviewer" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
  await waitFor(() => expect(api.json).toHaveBeenCalledWith('/threads/reviewer/peer-messages/peer_1', { method: 'DELETE', body: JSON.stringify({ expectedUpdatedAt: 1 }) }));
  expect(api.send).not.toHaveBeenCalled();
});
it.each(['disabled', 'stopped'])('keeps delivery disabled while %s but allows discard', async reason => {
  enabled = reason !== 'disabled'; paused = reason === 'stopped';
  render(<PeerMessageReviews threadId="reviewer" />);
  const button = await screen.findByRole('button', { name: 'Deliver to thread' });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Discard' }) as HTMLButtonElement).disabled).toBe(false);
});
it('shows confirmation failure and leaves the pending message reviewable', async () => {
  api.send.mockRejectedValue(new Error('Delivery cancelled'));
  render(<PeerMessageReviews threadId="reviewer" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Deliver to thread' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Delivery cancelled');
  expect(screen.getByText('Please review parser.ts')).toBeTruthy();
});
it('renders CLI recipients, approved state, and releases subscription on unmount', async () => {
  items = [{ ...item, status: 'approved', senderThreadId: null as never, recipientKind: 'cli-agent' }];
  const stop = vi.fn(); api.subscribe.mockReturnValueOnce(stop);
  const { unmount } = render(<PeerMessageReviews threadId="reviewer" />);
  await screen.findByText('Reviewed · waiting for delivery');
  expect(screen.queryByRole('button', { name: /Deliver/ })).toBeNull();
  expect(screen.queryByRole('link')).toBeNull();
  unmount(); expect(stop).toHaveBeenCalledOnce();
});
it('does not carry another thread’s pending content across navigation', async () => {
  const { rerender } = render(<PeerMessageReviews threadId="one" />);
  await screen.findByText('Please review parser.ts');
  api.json.mockReturnValue(new Promise(() => {}));
  rerender(<PeerMessageReviews threadId="two" />);
  expect(screen.queryByText('Please review parser.ts')).toBeNull();
});
it('refreshes on this thread’s updates and renders pending CLI delivery', async () => {
  items = [{ ...item, recipientKind: 'cli-agent' }];
  render(<PeerMessageReviews threadId="reviewer" />);
  await screen.findByRole('button', { name: 'Deliver to CLI Agent' });
  const update = (api.subscribe.mock.calls as unknown as Array<[(value: unknown) => void]>)[0][0];
  const before = api.json.mock.calls.length;
  update({ id: 'another' }); expect(api.json.mock.calls.length).toBe(before);
  enabled = false; update({ id: 'reviewer' });
  await waitFor(() => expect((screen.getByRole('button', { name: 'Deliver to CLI Agent' }) as HTMLButtonElement).disabled).toBe(true));
});
