// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { RemoteAccessView } from './RemoteAccessView.js';

vi.mock('./SharedPreviews.js', () => ({ SharedPreviews: () => <div>Share a web preview</div> }));
vi.mock('../../hooks/useHosts.js', () => ({ useHosts: () => [{ isPrimary: true, name: 'MacBook Pro' }] }));
const h = vi.hoisted(() => ({ desktop: true, mobile: { status: vi.fn(), browserAddress: vi.fn(), disconnectAccount: vi.fn(), enroll: vi.fn(), pollEnrollment: vi.fn(), cancelEnrollment: vi.fn() }, config: { set: vi.fn() } }));
vi.mock('../../lib/product-client.js', () => ({ product: { mobile: h.mobile, config: h.config } }));
vi.mock('../../lib/app-surface.js', () => ({ hasDesktopBridge: () => h.desktop }));
vi.mock('./ConnectCodePairing.js', () => ({ ConnectCodePairing: ({ onPaired }: any) => <button onClick={onPaired}>Pair computer</button> }));
const linked = { running: true, relayState: 'connected', connection: { mode: 'connect', accountUrl: 'https://zana-ide.com', serverId: 'server', publicUrl: 'https://s-abc.connect.zana-ide.com' } };
const draft = vi.fn();
function Harness({ enabled }: { enabled: boolean }) {
  const [config, setConfig] = useState({ mobileGatewayEnabled: enabled } as AppConfig);
  return <RemoteAccessView config={config} onConfigDraft={next => { draft(next); setConfig(next); }} />;
}
const view = (enabled = true) => render(<MemoryRouter><Harness enabled={enabled} /></MemoryRouter>);
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name, exact: true }));
beforeEach(() => {
  h.desktop = true;
  h.mobile.status.mockResolvedValue(linked);
  h.mobile.browserAddress.mockResolvedValue('https://my-name.zana-ide.com');
  h.config.set.mockImplementation(async patch => patch);
  h.mobile.disconnectAccount.mockResolvedValue(undefined);
  h.mobile.cancelEnrollment.mockResolvedValue(undefined);
  vi.spyOn(window, 'open').mockReturnValue(null);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => {}) } });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.useRealTimers(); });

it('explains the desktop requirement without polling from a browser', () => {
  h.desktop = false; view();
  expect(screen.getByText('Remote access is managed on your computer')).toBeTruthy();
  expect(h.mobile.status).not.toHaveBeenCalled();
});
it('waits for status and address before showing setup or an address chooser', async () => {
  let status!: (value: unknown) => void, address!: (value: string | null) => void;
  h.mobile.status.mockImplementationOnce(() => new Promise(resolve => { status = resolve; }));
  h.mobile.browserAddress.mockImplementationOnce(() => new Promise(resolve => { address = resolve; }));
  view();
  expect(screen.getByText('Checking remote access…')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Set up remote access' })).toBeNull();
  await act(async () => status(linked));
  expect(screen.queryByRole('link', { name: 'Choose address' })).toBeNull();
  await act(async () => address(null));
  expect(screen.getByRole('link', { name: 'Choose address' }).getAttribute('href')).toBe('https://zana-ide.com/connect/?server=server#address');
  expect(screen.queryByRole('link', { name: 'Manage account' })).toBeNull();
});
it('leads setup with sign-in and retains code redemption as an alternative', async () => {
  h.mobile.status.mockResolvedValue({ running: false, connection: { mode: 'unconfigured' } });
  view(false);
  await screen.findByRole('button', { name: 'Set up remote access' });
  expect(screen.getByText('Have a connect code?')).toBeTruthy();
  click('Pair computer');
  await waitFor(() => expect(draft).toHaveBeenCalledWith({ mobileGatewayEnabled: true }));
  expect(h.mobile.browserAddress).not.toHaveBeenCalled();
});
it('shows saved-connection recovery errors alongside first-time setup', async () => {
  h.mobile.status.mockResolvedValue({ running: false, error: 'Local-network connections are no longer supported.' });
  view();
  expect((await screen.findByRole('alert')).textContent).toContain('Local-network');
  expect(screen.getByRole('button', { name: 'Set up remote access' })).toBeTruthy();
});
it('shows one address, inline phone instructions, and a single account destination', async () => {
  view();
  expect((await screen.findByRole('link', { name: 'Open in browser' })).getAttribute('href')).toBe('https://my-name.zana-ide.com');
  expect(screen.getByText('MacBook Pro')).toBeTruthy();
  expect(screen.getByText('Use on your phone')).toBeTruthy();
  expect(screen.getByRole('list', { name: 'Mobile browser setup', hidden: true }).textContent).toContain('same GitHub account');
  expect(screen.getAllByRole('link', { name: 'Manage account' })).toHaveLength(1);
  expect(screen.queryByRole('link', { name: 'Add a phone' })).toBeNull();
  expect(screen.queryByText('Open an existing Zana instead')).toBeNull();
  click('Copy address'); await screen.findByRole('button', { name: 'Copied' });
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://my-name.zana-ide.com');
});
it('reports clipboard failures without claiming success', async () => {
  vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('denied'));
  view(); fireEvent.click(await screen.findByRole('button', { name: 'Copy address' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Could not copy');
});
it('confirms a missing address and refreshes it on focus', async () => {
  h.mobile.browserAddress.mockResolvedValueOnce(null); view();
  await screen.findByRole('link', { name: 'Choose address' });
  fireEvent(window, new Event('focus'));
  await screen.findByRole('link', { name: 'Open in browser' });
});
it('gives lookup failures a retry instead of offering a new address', async () => {
  h.mobile.browserAddress.mockRejectedValueOnce(new Error('Service unavailable'));
  view(); await screen.findByText('We couldn’t load your address');
  expect(screen.queryByRole('link', { name: 'Choose address' })).toBeNull();
  expect(screen.getByRole('alert').textContent).toBe('Service unavailable');
  click('Try again'); await screen.findByRole('link', { name: 'Open in browser' });
});
it('removes an unverified address on later failure and recovers on focus', async () => {
  view(); await screen.findByRole('link', { name: 'Open in browser' });
  h.mobile.browserAddress.mockRejectedValueOnce(new Error('Unavailable'));
  fireEvent(window, new Event('focus')); await screen.findByText('We couldn’t load your address');
  expect(screen.queryByText('https://my-name.zana-ide.com')).toBeNull();
  fireEvent(window, new Event('focus')); await screen.findByRole('link', { name: 'Open in browser' });
});
it('turns access on through persisted config and does not expose an Open action while off', async () => {
  view(false); await screen.findByText('Remote access is off');
  expect(screen.queryByRole('link', { name: 'Open in browser' })).toBeNull();
  click('Turn on remote access');
  await screen.findByRole('link', { name: 'Open in browser' });
  expect(draft).toHaveBeenCalledWith({ mobileGatewayEnabled: true });
});
it('confirms turning off, supports cancellation, and preserves the account', async () => {
  view(); await screen.findByRole('link', { name: 'Open in browser' });
  click('Turn off'); click('Cancel');
  expect(h.config.set).not.toHaveBeenCalled();
  click('Turn off'); fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Turn off', exact: true }));
  await screen.findByText('Remote access is off');
  expect(h.mobile.disconnectAccount).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: 'Manage account' })).toBeTruthy();
});
it('reports failed config writes and leaves the confirmation available to retry', async () => {
  h.config.set.mockRejectedValueOnce(new Error('Could not save'));
  view(); await screen.findByRole('link', { name: 'Open in browser' }); click('Turn off');
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Turn off', exact: true }));
  expect((await screen.findByRole('alert')).textContent).toBe('Could not save');
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Turn off', exact: true }));
  await screen.findByText('Remote access is off');
});
it('stops the gateway before unlinking and returns to setup', async () => {
  const order: string[] = [];
  h.config.set.mockImplementation(async patch => { order.push('stop'); return patch; });
  h.mobile.disconnectAccount.mockImplementation(async () => { order.push('unlink'); h.mobile.status.mockResolvedValue({ running: false, connection: { mode: 'unconfigured' } }); });
  view(); await screen.findByRole('link', { name: 'Open in browser' });
  click('Unlink this computer…'); click('Cancel');
  expect(h.mobile.disconnectAccount).not.toHaveBeenCalled();
  click('Unlink this computer…'); click('Unlink computer');
  await screen.findByRole('button', { name: 'Set up remote access' });
  expect(screen.getByText('Computer unlinked. Your local work keeps running.')).toBeTruthy();
  expect(order).toEqual(['stop', 'unlink']);
});
it('does not forget the account when stopping access fails', async () => {
  h.config.set.mockRejectedValue(new Error('Could not stop'));
  view(); await screen.findByRole('link', { name: 'Open in browser' });
  click('Unlink this computer…'); click('Unlink computer'); await screen.findByText('Could not stop');
  expect(h.mobile.disconnectAccount).not.toHaveBeenCalled();
});
it('retains unlink controls after a service failure', async () => {
  h.mobile.disconnectAccount.mockRejectedValue(new Error('Offline'));
  view(); await screen.findByRole('link', { name: 'Open in browser' }); click('Unlink this computer…'); click('Unlink computer');
  await screen.findByText('Offline'); expect(screen.getByRole('button', { name: 'Unlink computer' })).toBeTruthy();
});
it('keeps network reconnection distinct from revoked authorization', async () => {
  h.mobile.status.mockResolvedValue({ ...linked, relayState: 'reconnecting', error: 'Port unavailable' });
  view(); await screen.findByText('Reconnecting…');
  expect(screen.getByRole('alert').textContent).toBe('Port unavailable');
  expect(screen.queryByRole('link', { name: 'Open in browser' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Sign in again' })).toBeNull();
});
it('recovers from a failed status read without flashing setup', async () => {
  h.mobile.status.mockRejectedValueOnce(new Error('IPC unavailable'));
  view(); await screen.findByText('We couldn’t check remote access');
  expect(screen.queryByRole('button', { name: 'Set up remote access' })).toBeNull();
  click('Try again'); await screen.findByRole('link', { name: 'Open in browser' });
});
it('preserves the off setting and refreshes the address after browser reauthorization', async () => {
  vi.useFakeTimers();
  h.mobile.browserAddress.mockRejectedValueOnce(new Error("Error invoking remote method 'mobile:browserAddress': Error: This computer's access was revoked. Sign in again to reconnect."));
  h.mobile.enroll.mockResolvedValue({ verificationUrl: 'https://zana-ide.com/connect/?code=approve', expiresAt: Date.now() + 60_000 });
  h.mobile.pollEnrollment.mockResolvedValue({ pending: false });
  view(false); await act(async () => {});
  expect(screen.queryByRole('link', { name: 'Choose address' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Turn on remote access' })).toBeNull();
  await act(async () => click('Sign in again'));
  expect(screen.getByRole('link', { name: 'Open sign-in' })).toBeTruthy();
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(screen.getByText('Remote access is off')).toBeTruthy();
  expect(h.config.set).not.toHaveBeenCalled();
  expect(h.mobile.browserAddress).toHaveBeenCalledTimes(2);
});
it('enables first-time browser setup after approval and surfaces a failed enable write', async () => {
  vi.useFakeTimers();
  h.mobile.status.mockResolvedValue({ running: false, connection: { mode: 'unconfigured' } });
  h.mobile.enroll.mockResolvedValue({ verificationUrl: 'https://zana-ide.com/connect/', expiresAt: Date.now() + 60_000 });
  h.mobile.pollEnrollment.mockImplementation(async () => { h.mobile.status.mockResolvedValue(linked); return { pending: false }; });
  h.config.set.mockRejectedValueOnce(new Error('Could not enable'));
  view(false); await act(async () => {});
  await act(async () => click('Set up remote access'));
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(h.config.set).toHaveBeenCalledWith({ mobileGatewayEnabled: true });
  expect(screen.getByText('Could not enable')).toBeTruthy();
  expect(screen.getByText('Remote access is off')).toBeTruthy();
});
it('does not overlap address lookups and releases timers and listeners', async () => {
  vi.useFakeTimers();
  let resolveAddress!: (value: string) => void;
  h.mobile.browserAddress.mockImplementationOnce(() => new Promise(resolve => { resolveAddress = resolve; }));
  const mounted = view(); await act(async () => {});
  fireEvent(window, new Event('focus')); expect(h.mobile.browserAddress).toHaveBeenCalledOnce();
  await act(async () => resolveAddress('https://my-name.zana-ide.com'));
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(h.mobile.browserAddress).toHaveBeenCalledTimes(2);
  mounted.unmount(); const count = h.mobile.status.mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(30_000)); fireEvent(window, new Event('focus'));
  expect(h.mobile.status).toHaveBeenCalledTimes(count); expect(h.mobile.browserAddress).toHaveBeenCalledTimes(2);
});
it('ignores an address returned for an old connection and a status returned after unmount', async () => {
  vi.useFakeTimers();
  let oldAddress!: (value: string) => void;
  h.mobile.browserAddress.mockImplementationOnce(() => new Promise(resolve => { oldAddress = resolve; }));
  const mounted = view(); await act(async () => {});
  h.mobile.status.mockResolvedValue({ ...linked, connection: { ...linked.connection, publicUrl: 'https://s-new.connect.zana-ide.com' } });
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  await act(async () => oldAddress('https://old.zana-ide.com'));
  expect(screen.queryByText('https://old.zana-ide.com')).toBeNull();
  let late!: (value: unknown) => void;
  h.mobile.status.mockImplementationOnce(() => new Promise(resolve => { late = resolve; }));
  await act(async () => vi.advanceTimersByTimeAsync(2000)); mounted.unmount();
  await act(async () => late(linked));
});
