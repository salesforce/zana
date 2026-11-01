// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { product } from '../lib/product-client.js';
import { ComposerHostActionChip } from './ComposerHostActionChip.js';

vi.mock('../lib/product-client.js', () => ({ product: { hosts: { relaunchLocal: vi.fn() } } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const action = { kind: 'restart' as const, reason: 'Host daemon is offline. Running agents may be interrupted.' };

it('restarts through the authorized recovery API, prevents duplicate clicks and waits for host status', async () => {
  let resolve!: (result: { ok: true }) => void;
  vi.mocked(product.hosts.relaunchLocal).mockReturnValue(new Promise(done => { resolve = done; }));
  const onAction = vi.fn();
  const view = render(<ComposerHostActionChip action={action} onAction={onAction} />);
  const button = screen.getByRole('button', { name: 'Restart host daemon' });
  expect(button.title).toBe(action.reason);
  fireEvent.click(button);
  fireEvent.click(button);
  expect(screen.getByRole('button', { name: 'Restarting…' }).hasAttribute('disabled')).toBe(true);
  expect(product.hosts.relaunchLocal).toHaveBeenCalledOnce();
  expect(onAction).not.toHaveBeenCalled();
  await act(async () => { resolve({ ok: true }); });
  expect(screen.getByRole('status').textContent).toContain('Waiting for connection');
  view.rerender(<ComposerHostActionChip action={{ kind: 'ready' }} onAction={onAction} />);
  expect(screen.queryByRole('button')).toBeNull();
});

it.each(['result', 'error', 'string'])('shows %s failures inline and allows retry', async kind => {
  const request = vi.mocked(product.hosts.relaunchLocal);
  if (kind === 'result') request.mockResolvedValueOnce({ ok: false, message: 'Restart failed' });
  else request.mockRejectedValueOnce(kind === 'error' ? new Error('Restart failed') : 'Restart failed');
  render(<ComposerHostActionChip action={action} onAction={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Restart host daemon' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Restart failed'));
  request.mockResolvedValueOnce({ ok: true });
  fireEvent.click(screen.getByRole('button', { name: 'Restart host daemon' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Host daemon restarted'));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(request).toHaveBeenCalledTimes(2);
});
