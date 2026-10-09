// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SharedPreviews } from './SharedPreviews.js';
const h = vi.hoisted(() => ({ api: vi.fn(), desktop: true, detach: vi.fn() }));
vi.mock('../../lib/fetch-with-app-surface.js', () => ({ apiJson: h.api }));
vi.mock('../../lib/app-surface.js', () => ({ hasDesktopBridge: () => h.desktop }));
vi.mock('../../lib/desktop-browser.js', () => ({ getDesktopBrowserApi: () => ({ detach: h.detach }) }));
vi.mock('../../components/thread/secondary-panel/ThreadBrowserTab.js', () => ({ ThreadBrowserTab: ({ initialUrl }: any) => <div data-testid="in-app-preview">{initialUrl}</div> }));
const share = { hostId: 'local', hostName: 'Laptop', port: 5173, status: 'ready', url: 'https://alice--5173.example.com', expiresAt: Date.now() + 60000, leases: 1 };
let data: any;
beforeEach(() => {
  vi.clearAllMocks(); h.desktop = true; data = { enabled: true, shares: [] };
  h.api.mockImplementation(async (path, opts) => {
    if (path === '/hosts') return [{ id: 'primary', name: 'laptop.local', isPrimary: true }, { id: 'remote', name: 'Remote' }];
    if (opts?.method === 'POST') data.shares = [share];
    if (opts?.method === 'DELETE') data.shares = [];
    return { ...data };
  });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => {}) } });
});
afterEach(cleanup);
it('shares on the selected machine, copies, opens in-app and revokes', async () => {
  render(<SharedPreviews />); await screen.findByText('No shared previews.');
  fireEvent.change(screen.getByLabelText('Machine'), { target: { value: 'remote' } });
  fireEvent.change(screen.getByLabelText('Port'), { target: { value: '5173' } });
  fireEvent.click(screen.getByText('Share preview'));
  await screen.findByText('Laptop:5173');
  expect(h.api).toHaveBeenCalledWith('/previews', { method: 'POST', body: JSON.stringify({ port: 5173, hostId: 'remote' }) });
  fireEvent.click(screen.getByText('Copy address')); await screen.findByText('Copied'); expect(navigator.clipboard.writeText).toHaveBeenCalledWith(share.url);
  fireEvent.click(screen.getByText('Open preview')); expect(screen.getByTestId('in-app-preview').textContent).toBe(share.url);
  fireEvent.click(screen.getByText('Close preview')); expect(h.detach).toHaveBeenCalledWith(`shared-preview:${share.url}`);
  fireEvent.click(screen.getByText('Stop sharing 5173')); await screen.findByText('No shared previews.');
});
it('lists the primary host once, as the Zana computer default', async () => {
  render(<SharedPreviews />); await screen.findByText('No shared previews.');
  const options = Array.from((screen.getByLabelText('Machine') as HTMLSelectElement).options).map(o => [o.value, o.textContent]);
  expect(options).toEqual([['', 'Zana computer (laptop.local)'], ['remote', 'Remote']]);
  fireEvent.change(screen.getByLabelText('Port'), { target: { value: '5173' } });
  fireEvent.click(screen.getByText('Share preview')); await screen.findByText('Laptop:5173');
  expect(h.api).toHaveBeenCalledWith('/previews', { method: 'POST', body: JSON.stringify({ port: 5173 }) });
});
it('keeps the plain default label when no primary host is enrolled', async () => {
  h.api.mockImplementation(async path => path === '/hosts' ? [{ id: 'remote', name: 'Remote' }] : { ...data });
  render(<SharedPreviews />); await screen.findByText('No shared previews.');
  expect(screen.getByRole('option', { name: 'Zana computer' })).toBeTruthy();
});
it('allows web/mobile management, offers private links and explains missing addresses', async () => {
  h.desktop = false; data.shares = [share]; render(<SharedPreviews />);
  expect((await screen.findByRole('link', { name: 'Open preview' })).getAttribute('href')).toBe(share.url);
  cleanup(); data.shares = [{ ...share, url: null, message: 'Reconnect machine', status: 'offline' }]; render(<SharedPreviews />);
  await screen.findByText('Machine offline'); expect(screen.getByText('Reconnect machine')).toBeTruthy(); expect(screen.getByText(/Choose a browser address/)).toBeTruthy();
});
it('disables new sharing when remote access is off and reports request and clipboard failures', async () => {
  data = { enabled: false, shares: [share] }; render(<SharedPreviews />);
  await screen.findByText('Laptop:5173'); expect((screen.getByText('Share preview') as HTMLButtonElement).disabled).toBe(true);
  vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'));
  fireEvent.click(screen.getByText('Copy address')); await screen.findByRole('alert');
  h.api.mockRejectedValueOnce(new Error('Cannot stop')); fireEvent.click(screen.getByText('Stop sharing 5173')); await screen.findByText('Cannot stop');
});
it('reports initial load failure without enabling a share', async () => {
  h.api.mockRejectedValue(new Error('Unavailable')); render(<SharedPreviews />); await screen.findByText('Unavailable');
  expect(screen.queryByText('Share preview')).toBeNull();
});
