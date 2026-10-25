// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const client = vi.hoisted(() => ({ signIn: vi.fn(), list: vi.fn(), select: vi.fn() }));
vi.mock('../../lib/product-client.js', () => ({ product: { sharedClient: client } }));
import { SharedInstancePicker } from './SharedInstancePicker.js';
const owned = { id: 'owned', name: 'My Zana', url: 'https://owned.zana-ide.com', online: true };
beforeEach(() => { vi.resetAllMocks(); client.list.mockResolvedValue([owned]); });
afterEach(cleanup);
it('restores an existing browser session without asking to sign in again', async () => {
  const opened = vi.fn(); render(<SharedInstancePicker onOpened={opened} />);
  await screen.findByText('My Zana');
  expect(screen.queryByRole('button', { name: 'Sign in to browse Zanas' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open Zana' }));
  await waitFor(() => expect(client.select).toHaveBeenCalledWith('owned'));
  expect(opened).toHaveBeenCalledOnce();
});
it('shows one scoped sign-in action after an expired session and loads instances on approval', async () => {
  client.list.mockRejectedValueOnce(new Error("Error invoking remote method 'shared-client:list': Error: Sign in to your Zana account, then refresh the instances."));
  let complete!: () => void;
  client.signIn.mockImplementation(() => new Promise<void>(resolve => { complete = resolve; }));
  render(<SharedInstancePicker />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in to browse Zanas' }));
  expect(screen.getByRole('status').textContent).toContain('your browser');
  expect(screen.queryByRole('button', { name: 'Refresh instances' })).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  await act(async () => complete()); await screen.findByText('My Zana');
  expect(client.list).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('status')).toBeNull();
});
it('reports errors, supports retry, and explains an empty account', async () => {
  client.list.mockRejectedValueOnce(new Error('Connect unavailable')).mockResolvedValueOnce([]);
  render(<SharedInstancePicker />);
  expect((await screen.findByRole('alert')).textContent).toBe('Connect unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText(/No Zana instances found/);
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh instances' })); await screen.findByText('My Zana');
});
it('reports sign-in and selection failures and prevents opening offline instances', async () => {
  client.list.mockRejectedValueOnce(new Error('Sign in to your Zana account')).mockResolvedValue([owned, { ...owned, id: 'offline', name: 'Offline Zana', online: false }]);
  client.signIn.mockRejectedValueOnce('unavailable').mockResolvedValueOnce(undefined);
  client.select.mockRejectedValueOnce(new Error('Instance is unavailable'));
  render(<SharedInstancePicker />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in to browse Zanas' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Could not open another Zana. Try again.');
  fireEvent.click(screen.getByRole('button', { name: 'Sign in to browse Zanas' }));
  await screen.findByText('Offline Zana');
  const buttons = screen.getAllByRole('button', { name: 'Open Zana' }) as HTMLButtonElement[];
  expect(buttons[1].disabled).toBe(true);
  fireEvent.click(buttons[0]); await screen.findByText('Instance is unavailable');
});
it('ignores a list or sign-in result after the picker closes', async () => {
  let done!: (value: unknown) => void;
  client.list.mockImplementationOnce(() => new Promise(resolve => { done = resolve; }));
  const first = render(<SharedInstancePicker />); first.unmount(); await act(async () => done([owned]));
  client.list.mockRejectedValueOnce(new Error('Sign in to your Zana account'));
  let signedIn!: () => void;
  client.signIn.mockImplementationOnce(() => new Promise<void>(resolve => { signedIn = resolve; }));
  const second = render(<SharedInstancePicker />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in to browse Zanas' }));
  second.unmount(); await act(async () => signedIn());
  expect(client.list).toHaveBeenCalledTimes(2);
});
