// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PhoneAccountConnection } from './PhoneAccountConnection.js';
const mobile = vi.hoisted(() => ({ enroll: vi.fn(), pollEnrollment: vi.fn(), cancelEnrollment: vi.fn(), disconnectAccount: vi.fn() }));
vi.mock('../../lib/product-client.js', () => ({ product: { mobile } }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });
it('opens browser approval, polls through status rerenders and finishes without exposing secrets', async () => {
  vi.useFakeTimers(); vi.spyOn(window, 'open').mockReturnValue(null);
  mobile.enroll.mockResolvedValue({ verificationUrl: 'https://example.com/connect/?code=abc', expiresAt: Date.now() + 60_000 });
  mobile.pollEnrollment.mockResolvedValueOnce({ pending: true }).mockResolvedValueOnce({ pending: false });
  const saved = vi.fn(async () => {});
  const view = render(<PhoneAccountConnection status={null} onSaved={saved} />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign in and connect' })));
  expect(window.open).toHaveBeenCalledWith('https://example.com/connect/?code=abc', '_blank', 'noopener,noreferrer');
  view.rerender(<PhoneAccountConnection status={null} onSaved={async () => saved()} />);
  await act(async () => vi.advanceTimersByTimeAsync(6000));
  expect(saved).toHaveBeenCalledOnce(); expect(mobile.pollEnrollment).toHaveBeenCalledTimes(2);
});
it('supports cancel and surfaces a failed enrollment', async () => {
  vi.spyOn(window, 'open').mockReturnValue(null);
  mobile.enroll.mockResolvedValueOnce({ verificationUrl: 'https://example.com/connect/', expiresAt: Date.now() + 60_000 }).mockRejectedValueOnce(new Error('Service unavailable'));
  render(<PhoneAccountConnection status={null} onSaved={async () => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Sign in and connect' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' })); expect(mobile.cancelEnrollment).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in and connect' })); expect((await screen.findByRole('alert')).textContent).toContain('Service unavailable');
});
it('disconnects the account and reports revocation failures', async () => {
  mobile.disconnectAccount.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(undefined);
  const saved = vi.fn(async () => {});
  render(<PhoneAccountConnection status={{ running: true, relayState: 'connected', connection: { mode: 'connect', accountUrl: 'https://example.com' } } as any} onSaved={saved} />);
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect this computer' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Offline');
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect this computer' })); await waitFor(() => expect(saved).toHaveBeenCalledOnce());
});

it('offers browser access with service details tucked under advanced settings', async () => {
  vi.spyOn(window, 'open').mockReturnValue(null);
  mobile.enroll.mockResolvedValue({ verificationUrl: 'https://example.com/connect/', expiresAt: Date.now() + 60_000 });
  render(<PhoneAccountConnection status={null} onSaved={async () => {}} browserAccess />);
  expect(screen.getByText(/choose your personal browser address/)).toBeTruthy();
  expect(screen.queryByText(/Pair your phone once/)).toBeNull();
  fireEvent.click(screen.getByText('Advanced connection settings'));
  fireEvent.change(screen.getByLabelText('Connect service'), { target: { value: 'https://example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in and connect' }));
  await screen.findByRole('link', { name: 'Open sign-in' });
  expect(mobile.enroll).toHaveBeenCalledWith('https://example.com');
});

it('reports an expired browser approval without continuing to poll', async () => {
  vi.useFakeTimers(); vi.spyOn(window, 'open').mockReturnValue(null);
  mobile.enroll.mockResolvedValue({ verificationUrl: 'https://example.com/connect/', expiresAt: Date.now() + 1000 });
  render(<PhoneAccountConnection status={null} onSaved={async () => {}} browserAccess />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign in and connect' })));
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(screen.getByRole('alert').textContent).toContain('Sign-in expired');
  expect(mobile.pollEnrollment).not.toHaveBeenCalled();
});
it('shows account-linked and reconnecting states accurately', () => {
  const view = render(<PhoneAccountConnection status={{ running: false, connection: { mode: 'connect' } } as any} onSaved={async () => {}} />);
  expect(screen.getByRole('status').textContent).toContain('Account linked');
  view.rerender(<PhoneAccountConnection status={{ running: true, relayState: 'reconnecting', connection: { mode: 'connect' } } as any} onSaved={async () => {}} />);
  expect(screen.getByRole('status').textContent).toContain('Reconnecting');
});

it('shows only the revoked message and a sign-in action when access was revoked', () => {
  render(<PhoneAccountConnection status={{ running: true, relayState: 'connected', connection: { mode: 'connect', accountUrl: 'https://example.com' } } as any} onSaved={async () => {}} revoked />);
  expect(screen.getByRole('alert').textContent).toBe("This computer's access was revoked. Sign in again to reconnect.");
  expect(screen.queryByRole('button', { name: 'Disconnect this computer' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Sign in again' })).toBeTruthy();
});
