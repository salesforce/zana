// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { RemoteAccessView } from './RemoteAccessView.js';

vi.mock('./SharedPreviews.js', () => ({ SharedPreviews: () => <div>Shared previews</div> }));
const h = vi.hoisted(() => ({ desktop: true, mobile: { status: vi.fn(), browserAddress: vi.fn(), disconnectAccount: vi.fn(), enroll: vi.fn(), pollEnrollment: vi.fn(), cancelEnrollment: vi.fn() }, config: { set: vi.fn() } }));
vi.mock('../../lib/product-client.js', () => ({ product: { mobile: h.mobile, config: h.config } }));
vi.mock('../../lib/app-surface.js', () => ({ hasDesktopBridge: () => h.desktop }));
vi.mock('./ConnectCodePairing.js', () => ({ ConnectCodePairing: ({ onPaired }: any) => <button onClick={onPaired}>Pair computer</button> }));
const linked = { running: true, relayState: 'connected', connection: { mode: 'connect', accountUrl: 'https://zana-ide.com', publicUrl: 'https://s-abc.connect.zana-ide.com' } };
const draft = vi.fn();
async function toggle() {
  const control = screen.getByRole('switch', { name: 'Remote access' }) as HTMLButtonElement;
  await waitFor(() => expect(control.disabled).toBe(false));
  fireEvent.click(control);
}
const view = (enabled = true) => render(<MemoryRouter><RemoteAccessView config={{ mobileGatewayEnabled: enabled } as AppConfig} onConfigDraft={draft} /></MemoryRouter>);
beforeEach(() => {
  h.desktop = true;
  h.mobile.status.mockResolvedValue(linked);
  h.mobile.browserAddress.mockResolvedValue('https://my-name.zana-ide.com');
  h.config.set.mockImplementation(async patch => patch);
  h.mobile.disconnectAccount.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => {}) } });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.useRealTimers(); });

it('explains the desktop requirement without polling from a browser', () => {
  h.desktop = false; view();
  expect(screen.getByText('Remote access is managed on your computer')).toBeTruthy();
  expect(h.mobile.status).not.toHaveBeenCalled();
});
it('loads status and enables remote access after successful code pairing', async () => {
  h.mobile.status.mockResolvedValue({ running: false, connection: { mode: 'unconfigured' } });
  view(false);
  expect(screen.getByText('Checking connection…')).toBeTruthy();
  expect((await screen.findByRole('switch', { name: 'Remote access' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText('Pair computer'));
  await waitFor(() => expect(draft).toHaveBeenCalledWith({ mobileGatewayEnabled: true }));
  await waitFor(() => expect(h.mobile.status).toHaveBeenCalledTimes(2));
  expect(h.mobile.browserAddress).not.toHaveBeenCalled();
});
it('shows saved-connection recovery errors while allowing account pairing', async () => {
  h.mobile.status.mockResolvedValue({ running: false, error: 'Tailscale connections are no longer supported. Open Remote access to connect through Zana Connect.' });
  view();
  expect((await screen.findByRole('alert')).textContent).toContain('Zana Connect');
  expect(screen.getByText('Pair computer')).toBeTruthy();
  expect((screen.getByRole('switch', { name: 'Remote access' }) as HTMLButtonElement).disabled).toBe(true);
});
it('opens and copies the claimed URL and shows phone/account controls', async () => {
  view();
  expect((await screen.findByRole('link', { name: 'Open Zana' })).getAttribute('href')).toBe('https://my-name.zana-ide.com');
  expect(screen.getByText('Connected')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Add a phone' }).getAttribute('href')).toBe('/settings/phone');
  expect(screen.getByRole('link', { name: 'Manage account' }).getAttribute('href')).toBe('https://zana-ide.com/connect/');
  fireEvent.click(screen.getByRole('button', { name: 'Copy address' }));
  await screen.findByRole('button', { name: 'Copied' });
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://my-name.zana-ide.com');
});
it('shows clipboard errors without claiming the address was copied', async () => {
  vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('denied'));
  view(); fireEvent.click(await screen.findByRole('button', { name: 'Copy address' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Could not copy');
});
it('offers address claiming and picks up the new URL when the app regains focus', async () => {
  h.mobile.browserAddress.mockResolvedValueOnce(null); view();
  expect((await screen.findByRole('link', { name: 'Choose your address' })).getAttribute('href')).toBe('https://zana-ide.com/connect/');
  await waitFor(() => expect(h.mobile.browserAddress).toHaveBeenCalledOnce());
  fireEvent(window, new Event('focus'));
  expect(await screen.findByRole('link', { name: 'Open Zana' })).toBeTruthy();
});
it('clears a stale address on lookup failure and retries on focus', async () => {
  h.mobile.browserAddress.mockRejectedValueOnce(new Error('Sign in again'));
  view(); expect((await screen.findByRole('alert')).textContent).toBe('Sign in again');
  fireEvent(window, new Event('focus'));
  await screen.findByRole('link', { name: 'Open Zana' });
  expect(screen.queryByRole('alert')).toBeNull();
});
it('enables remote access through the persisted config and hides Open while off', async () => {
  view(false); await toggle();
  await waitFor(() => expect(draft).toHaveBeenCalledWith({ mobileGatewayEnabled: true }));
  expect(screen.getByText('Remote access is off')).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Open Zana' })).toBeNull();
});
it('turns access off and surfaces failed config writes', async () => {
  h.config.set.mockRejectedValueOnce(new Error('Could not save')).mockResolvedValueOnce({ mobileGatewayEnabled: false });
  view(); await toggle();
  expect((await screen.findByRole('alert')).textContent).toBe('Could not save');
  await toggle();
  await waitFor(() => expect(draft).toHaveBeenCalledWith({ mobileGatewayEnabled: false }));
});
it('supports canceling disconnect and disables the gateway before removing the account', async () => {
  const order: string[] = [];
  h.config.set.mockImplementation(async patch => { order.push('stop'); return patch; });
  h.mobile.disconnectAccount.mockImplementation(async () => { order.push('disconnect'); h.mobile.status.mockResolvedValue({ running: false, connection: { mode: 'unconfigured' } }); });
  view(); fireEvent.click(await screen.findByRole('button', { name: 'Disconnect…' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(h.mobile.disconnectAccount).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect…' }));
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect this computer' }));
  await screen.findByText('Pair computer');
  expect(screen.getByText('Remote access disconnected')).toBeTruthy();
  expect(order).toEqual(['stop', 'disconnect']);
  expect(screen.queryByRole('link', { name: 'Open Zana' })).toBeNull();
});
it('retains disconnect controls when the service is unreachable', async () => {
  h.mobile.disconnectAccount.mockRejectedValueOnce(new Error('Offline'));
  view(); fireEvent.click(await screen.findByRole('button', { name: 'Disconnect…' }));
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect this computer' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Offline');
  expect(screen.getByRole('button', { name: 'Disconnect this computer' })).toBeTruthy();
});
it('shows reconnecting and server startup errors without an Open action', async () => {
  h.mobile.status.mockResolvedValue({ ...linked, relayState: 'reconnecting', error: 'Port unavailable' });
  view(); await screen.findByText('Connection needs attention');
  expect(screen.getByRole('alert').textContent).toBe('Port unavailable');
  expect(screen.queryByRole('link', { name: 'Open Zana' })).toBeNull();
});
it('recovers from a failed status read', async () => {
  h.mobile.status.mockRejectedValueOnce(new Error('IPC unavailable'));
  view(); fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
  await screen.findByText('Connected'); expect(screen.queryByRole('alert')).toBeNull();
});
it('polls without overlapping requests and cleans up timers/listeners on unmount', async () => {
  vi.useFakeTimers(); h.mobile.status.mockResolvedValue({ ...linked, relayState: 'connecting' });
  let resolveAddress!: (value: string) => void;
  h.mobile.browserAddress.mockImplementationOnce(() => new Promise(resolve => { resolveAddress = resolve; }));
  const mounted = view(); await act(async () => {});
  expect(screen.getByText('Connecting…')).toBeTruthy();
  fireEvent(window, new Event('focus'));
  expect(h.mobile.browserAddress).toHaveBeenCalledOnce();
  await act(async () => { resolveAddress('https://my-name.zana-ide.com'); });
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(h.mobile.status.mock.calls.length).toBeGreaterThan(2);
  expect(h.mobile.browserAddress).toHaveBeenCalledTimes(2);
  mounted.unmount(); const count = h.mobile.status.mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  fireEvent(window, new Event('focus'));
  expect(h.mobile.status).toHaveBeenCalledTimes(count);
  expect(h.mobile.browserAddress).toHaveBeenCalledTimes(2);
});

it('shows a reconnecting state until the outbound tunnel recovers', async () => {
  h.mobile.status.mockResolvedValue({ ...linked, relayState: 'reconnecting' });
  view(); await screen.findByText('Reconnecting…');
  expect(screen.queryByRole('link', { name: 'Open Zana' })).toBeNull();
});
it('does not forget the account when stopping access fails', async () => {
  h.config.set.mockRejectedValueOnce('failure');
  view(); fireEvent.click(await screen.findByRole('button', { name: 'Disconnect…' }));
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect this computer' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Could not update remote access');
  expect(h.mobile.disconnectAccount).not.toHaveBeenCalled();
});

it('keeps a successfully paired account visible when enabling the gateway fails', async () => {
  h.mobile.status.mockResolvedValueOnce({ running: false, connection: { mode: 'unconfigured' } });
  h.config.set.mockRejectedValueOnce(new Error('Port unavailable'));
  view(false); fireEvent.click(await screen.findByText('Pair computer'));
  expect((await screen.findByRole('alert')).textContent).toBe('Port unavailable');
  await screen.findByText('Remote access is off');
});

it('puts computer registration before the separate existing-instance sign-in and hides premature enable errors', async () => {
  h.mobile.status.mockResolvedValue({ running: false, connection: { mode: 'unconfigured' }, error: 'Connect this computer before enabling phone access.' });
  view();
  const pairing = await screen.findByText('Pair computer');
  const existing = screen.getByText('Open an existing Zana instead');
  expect(pairing.compareDocumentPosition(existing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(existing.closest('details')?.open).toBe(false);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('shows a friendly revoked message and restarts sign-in without the IPC prefix', async () => {
  h.mobile.browserAddress.mockRejectedValue(new Error("Error invoking remote method 'mobile:browserAddress': Error: This computer's access was revoked. Sign in again to reconnect."));
  h.mobile.enroll.mockResolvedValue({ verificationUrl: 'https://zana-ide.com/connect/?code=abc', expiresAt: Date.now() + 60_000 });
  h.mobile.pollEnrollment.mockResolvedValue({ pending: true });
  vi.spyOn(window, 'open').mockReturnValue(null);
  view();
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toBe("This computer's access was revoked. Sign in again to reconnect.");
  expect(screen.queryByText(/Error invoking/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
  await waitFor(() => expect(h.mobile.enroll).toHaveBeenCalledWith('https://zana-ide.com'));
  expect(window.open).toHaveBeenCalledWith('https://zana-ide.com/connect/?code=abc', '_blank', 'noopener,noreferrer');
});
it('strips the IPC prefix from other address lookup failures', async () => {
  h.mobile.browserAddress.mockRejectedValue(new Error("Error invoking remote method 'mobile:browserAddress': Error: Connect returned 500."));
  view(); expect((await screen.findByRole('alert')).textContent).toBe('Connect returned 500.');
  expect(screen.queryByRole('button', { name: 'Sign in again' })).toBeNull();
});
