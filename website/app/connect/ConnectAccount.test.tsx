// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ConnectAccount } from './ConnectAccount';
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });
function stubFetch(fetcher: any) { vi.stubGlobal('fetch', (path: string, ...args: any[]) => path.startsWith('/api/connect/slack/') ? Promise.resolve(Response.json({ links: [] })) : fetcher(path, ...args)); }
const account = { user: { name: 'Alice' }, servers: [{ id: 'mac', name: 'MacBook', live: true, revoked: false }], devices: [{ id: 'phone', label: 'iPhone', revoked: false }] };
it('uses the top Refresh action to reload every expanded machine list and retry failures', async () => {
  let revision = 0;
  const fetcher = vi.fn(async (path: string) => {
    if (path.includes('/account/hosts/')) {
      const id = new URL(path, 'https://example.com').searchParams.get('serverId');
      if (revision === 1 && id === 'mac') return new Response(null, { status: 503 });
      return Response.json({ machines: [{ id, name: `${id} version ${revision}`, revoked: false }] });
    }
    return Response.json({ ...account, servers: [...account.servers, { id: 'studio', name: 'Studio', live: true, revoked: false }] });
  });
  stubFetch(fetcher); render(<ConnectAccount />);
  const refresh = await screen.findByRole('button', { name: 'Refresh' });
  expect(screen.queryByRole('link', { name: 'Connect a computer' })).toBeNull();
  for (const summary of screen.getAllByText('Execution machines', { selector: 'summary' })) fireEvent.click(summary);
  await screen.findByText('mac version 0 · Enrolled');
  await screen.findByText('studio version 0 · Enrolled');
  expect(screen.queryByRole('button', { name: /execution machines/i })).toBeNull();
  revision = 1; fireEvent.click(refresh);
  await screen.findByText('studio version 1 · Enrolled');
  expect((await screen.findByRole('alert')).textContent).toContain('Use Refresh above');
  revision = 2; fireEvent.click(refresh);
  await screen.findByText('mac version 2 · Enrolled');
  await screen.findByText('studio version 2 · Enrolled');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(fetcher.mock.calls.filter(([path]) => path.includes('/account/hosts/'))).toHaveLength(6);
});
it('preserves desktop sign-in through GitHub and shows its approval instead of computer enrollment', async () => {
  const code = 'd'.repeat(22); window.history.replaceState({}, '', `/connect/?desktop=${code}`);
  stubFetch(vi.fn(async () => new Response('', { status: 401 })));
  const view = render(<ConnectAccount />);
  expect((await screen.findByRole('link', { name: 'Sign in with GitHub' })).getAttribute('href')).toContain(encodeURIComponent(`/connect/?desktop=${code}`));
  view.unmount();
  stubFetch(vi.fn(async path => Response.json(path.includes('/desktop/info/') ? { approved: false, denied: false } : account)));
  render(<ConnectAccount />);
  await screen.findByRole('button', { name: 'Approve desktop sign-in' });
  expect(screen.queryByRole('heading', { name: 'Connect your first computer' })).toBeNull();
});
it('sends signed-out users through GitHub with the approval return path', async () => {
  window.history.replaceState({}, '', `/connect/?code=${'x'.repeat(22)}`);
  stubFetch( vi.fn(async () => new Response('', { status: 401 })));
  render(<ConnectAccount />);
  const link = await screen.findByRole('link', { name: 'Sign in with GitHub' });
  expect(link.getAttribute('href')).toContain(encodeURIComponent(`/connect/?code=${'x'.repeat(22)}`));
});
it('requires explicit approval and keeps the continuation focused on this computer', async () => {
  const code = 'x'.repeat(22); window.history.replaceState({}, '', `/connect/?code=${code}`);
  let approved = false;
  const fetcher = vi.fn(async (path: string, init: RequestInit) => {
    if (path.startsWith('/api/connect/device/approve/')) { approved = true; return Response.json({}); }
    if (path.startsWith('/api/connect/device/info/')) return Response.json({ name: 'MacBook', approved, serverId: approved ? 'mac' : undefined });
    return Response.json(account);
  }); stubFetch( fetcher);
  render(<ConnectAccount />);
  const approve = await screen.findByRole('button', { name: 'Approve computer' });
  expect(fetcher).not.toHaveBeenCalledWith('/api/connect/device/approve/', expect.anything());
  fireEvent.click(approve); await screen.findByRole('heading', { name: 'Account connected' });
  expect(fetcher).toHaveBeenCalledWith('/api/connect/device/approve/', expect.objectContaining({ method: 'POST', body: JSON.stringify({ code, approved: true }), credentials: 'same-origin' }));
  expect(screen.queryByRole('region', { name: 'Zana instances' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Revoke phone iPhone' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Approve computer' })).toBeNull();
  expect(screen.getByRole('list', { name: 'Remote access setup progress' }).querySelector('[aria-current="step"]')?.textContent).toContain('Choose address');
});
it('continues address setup for the requested computer and refreshes until it is ready', async () => {
  vi.useFakeTimers();
  window.history.replaceState({}, '', '/connect/?server=mac#address');
  let live = false;
  const fetcher = vi.fn(async () => Response.json({ ...account, servers: [{ ...account.servers[0], browserUrl: 'https://work.example.com', live }] }));
  stubFetch(fetcher);
  await act(async () => { render(<ConnectAccount />); });
  expect(screen.getByText(/Waiting for this computer to come online/)).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Zana instances' })).toBeNull();
  live = true;
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(screen.getByRole('heading', { name: 'MacBook is ready' })).toBeTruthy();
  expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('stops automatic setup refresh after an error and cancels it on unmount', async () => {
  vi.useFakeTimers();
  window.history.replaceState({}, '', '/connect/?server=mac');
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ ...account, servers: [{ ...account.servers[0], browserUrl: 'https://work.example.com', live: false }] })).mockRejectedValue(new Error('Connection lost'));
  stubFetch(fetcher);
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<ConnectAccount />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(screen.getByRole('alert').textContent).toContain('Connection lost');
  await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
  expect(fetcher).toHaveBeenCalledTimes(2);
  view.unmount();
  fetcher.mockResolvedValue(Response.json({ ...account, servers: [{ ...account.servers[0], browserUrl: 'https://work.example.com', live: false }] }));
  await act(async () => { view = render(<ConnectAccount />); });
  view.unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it('does not expose other computers when a scoped setup target is missing or revoked', async () => {
  window.history.replaceState({}, '', '/connect/?server=missing');
  stubFetch(vi.fn(async () => Response.json(account)));
  render(<ConnectAccount />);
  await screen.findByRole('heading', { name: 'This computer is no longer available' });
  expect(screen.queryByRole('region', { name: 'Zana instances' })).toBeNull();
});
it('shows setup guidance and useful service/expired-approval errors', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ user: { name: 'Alice' }, servers: [], devices: [] })).mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(new Response('', { status: 410 }));
  stubFetch( fetcher); render(<ConnectAccount />);
  await screen.findByText(/In the desktop app/);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); expect((await screen.findByRole('alert')).textContent).toContain('not available');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('expired'));
});

it.each(['Refresh', 'Revoke phone iPhone'])('returns to sign-in when the browser session expires during %s', async button => {
  stubFetch( vi.fn().mockResolvedValueOnce(Response.json(account)).mockResolvedValueOnce(new Response(null, { status: 401 })));
  render(<ConnectAccount />);
  await screen.findByRole('button', { name: 'Sign out' });
  fireEvent.click(screen.getByRole('button', { name: button }));
  await screen.findByRole('link', { name: 'Sign in with GitHub' });
  expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Revoke phone iPhone' })).toBeNull();
});

it('clears a transient service error after refreshing successfully', async () => {
  stubFetch( vi.fn().mockResolvedValueOnce(Response.json(account)).mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(Response.json(account)));
  render(<ConnectAccount />);
  fireEvent.click(await screen.findByRole('button', { name: 'Refresh' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});

it('shows a loading state, then accurate counts and statuses excluding revoked devices', async () => {
  let resolve!: (value: Response) => void;
  stubFetch( vi.fn(() => new Promise<Response>(done => { resolve = done; })));
  render(<ConnectAccount />);
  expect(screen.getByRole('status').textContent).toContain('Loading your devices');
  resolve(Response.json({ ...account,
    servers: [...account.servers, { id: 'offline', name: 'Studio Mac', live: false }, { id: 'revoked', name: 'Old Mac', live: true, revoked: true }],
    devices: [...account.devices, { id: 'old-phone', label: 'Old phone', revoked: true }],
  }));
  const computers = await screen.findByRole('region', { name: 'Zana instances' });
  expect(within(computers).getAllByRole('listitem')).toHaveLength(2);
  expect(within(computers).getByText('Online')).toBeTruthy();
  expect(within(computers).getByText('Offline')).toBeTruthy();
  expect(screen.queryByText('Old Mac')).toBeNull();
  expect(screen.queryByText('Old phone')).toBeNull();
  expect(screen.queryByText('Loading your devices…')).toBeNull();
  const overview = screen.getByLabelText('Device overview');
  expect([...overview.querySelectorAll('dd')].map(el => el.firstChild?.textContent)).toEqual(['2', '1', '1']);
  expect(within(screen.getByRole('region', { name: 'Paired phones' })).getByText('Paired')).toBeTruthy();
  const signOut = screen.getByRole('button', { name: 'Sign out' }).closest('form');
  expect(signOut?.getAttribute('method')).toBe('post');
  expect(signOut?.getAttribute('action')).toBe('/api/auth/logout/');
  expect(screen.queryByText('Signed in as')).toBeNull();
  expect(screen.queryByText('Alice')).toBeNull();
  expect(screen.queryByText('Your account / Overview')).toBeNull();
  expect(document.querySelector('.wrap h1')?.textContent).toBe('Your Zana');
});

it.each([
  { live: true, paired: true, status: 'Online' },
  { live: false, paired: true, status: 'Offline' },
  { live: false, paired: false, status: 'Not connected yet' },
])('makes the actual personal address the primary heading while $status', async ({ live, paired, status }) => {
  const browserUrl = 'https://alice-personal.zana-ide.com/';
  stubFetch(vi.fn(async () => Response.json({ ...account, domain: 'different.example.com', servers: [{ ...account.servers[0], name: 'long-internal-machine-hostname.example.com', browserUrl, live, paired }] })));
  render(<ConnectAccount />);
  const heading = await screen.findByRole('heading', { name: 'alice-personal.zana-ide.com', level: 3 });
  const address = within(heading).getByRole('link', { name: 'alice-personal.zana-ide.com' });
  expect(address.getAttribute('href')).toBe(browserUrl);
  expect(screen.queryByRole('heading', { name: 'long-internal-machine-hostname.example.com' })).toBeNull();
  expect(screen.getByText('long-internal-machine-hostname.example.com')).toBeTruthy();
  const instances = screen.getByRole('region', { name: 'Zana instances' });
  expect(within(instances).getByText(status)).toBeTruthy();
  for (const secondary of [screen.getByLabelText('Device overview'), screen.getByRole('region', { name: 'Paired phones' })]) {
    expect(instances.compareDocumentPosition(secondary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
});

it('lists each owned instance under its own address and excludes revoked addresses', async () => {
  stubFetch(vi.fn(async () => Response.json({ ...account, servers: [
    { ...account.servers[0], browserUrl: 'https://alice-work.zana-ide.com' },
    { id: 'home', name: 'Home Mac', browserUrl: 'https://alice-home.zana-ide.com', live: false, revoked: false },
    { id: 'old', name: 'Old Mac', browserUrl: 'https://alice-old.zana-ide.com', live: false, revoked: true },
  ] })));
  render(<ConnectAccount />);
  const instances = await screen.findByRole('region', { name: 'Zana instances' });
  expect(within(instances).getAllByRole('heading', { level: 3 }).map(heading => heading.textContent)).toEqual(['alice-work.zana-ide.com', 'alice-home.zana-ide.com']);
  expect(screen.queryByRole('link', { name: 'alice-old.zana-ide.com' })).toBeNull();
});

it('opens setup guidance from the computer and phone empty states', async () => {
  stubFetch( vi.fn(async () => Response.json({ user: account.user, servers: [], devices: [] })));
  render(<ConnectAccount />);
  await screen.findByRole('heading', { name: 'Connect your first computer', level: 3 });
  const guide = document.getElementById('connect-setup') as HTMLDetailsElement;
  expect(guide.open).toBe(false);
  for (const name of ['See how to connect', 'How to pair a phone']) {
    fireEvent.click(screen.getByRole('link', { name }));
    expect(guide.open).toBe(true);
    guide.open = false;
    fireEvent(guide, new Event('toggle'));
    await waitFor(() => expect(guide.open).toBe(false));
  }
});

it('keeps separate-instance setup collapsed for connected accounts and lets the user expand it', async () => {
  stubFetch(vi.fn(async () => Response.json(account)));
  render(<ConnectAccount />);
  const summary = await screen.findByText('Create a separate Zana instance', { selector: 'summary' });
  const disclosure = summary.closest('details')!;
  expect(disclosure.open).toBe(false);
  fireEvent.click(summary);
  expect(disclosure.open).toBe(true);
  expect(within(disclosure).getByRole('textbox', { name: 'Your address' })).toBeTruthy();
});

it('keeps an unfinished computer connection visible when an account already has a connected computer', async () => {
  stubFetch(vi.fn(async () => Response.json({ ...account, servers: [...account.servers, { id: 'pending', name: 'New Mac', paired: false, live: false, revoked: false }] })));
  render(<ConnectAccount />);
  const setup = await screen.findByRole('region', { name: 'Connect your computer' });
  expect(setup.closest('details')).toBeNull();
  expect(within(setup).getByRole('button', { name: 'Get a connect code' })).toBeTruthy();
});

it('declines an enrollment explicitly and shows its completed state', async () => {
  const code = 'x'.repeat(22); window.history.replaceState({}, '', `/connect/?code=${code}`);
  let denied = false;
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.includes('/approve/')) { denied = true; expect(JSON.parse(init?.body as string)).toEqual({ code, approved: false }); return Response.json({}); }
    if (path.includes('/info/')) return Response.json({ name: 'Office Mac', approved: false, denied });
    return Response.json(account);
  });
  stubFetch( fetcher);
  render(<ConnectAccount />);
  fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
  await screen.findByRole('heading', { name: 'Computer declined' });
  expect(screen.queryByRole('button', { name: 'Approve computer' })).toBeNull();
});

it('disables device actions during refresh and keeps the last successful list on a network failure', async () => {
  let reject!: (reason: Error) => void;
  stubFetch( vi.fn().mockResolvedValueOnce(Response.json(account)).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; })));
  render(<ConnectAccount />);
  fireEvent.click(await screen.findByRole('button', { name: 'Refresh' }));
  expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Disconnect computer MacBook' }) as HTMLButtonElement).disabled).toBe(true);
  reject(new Error('Network unavailable'));
  expect((await screen.findByRole('alert')).textContent).toContain('Network unavailable');
  expect(screen.getByRole('heading', { name: 'MacBook' })).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(false);
});

it.each([500, 409])('shows actionable errors for an unsuccessful device action (%i)', async status => {
  stubFetch( vi.fn().mockResolvedValueOnce(Response.json(account)).mockResolvedValueOnce(new Response(null, { status })));
  render(<ConnectAccount />);
  fireEvent.click(await screen.findByRole('button', { name: 'Disconnect computer MacBook' }));
  expect((await screen.findByRole('alert')).textContent).toContain(status === 409 ? 'expired' : 'Please try again');
  expect(screen.getByRole('heading', { name: 'MacBook' })).toBeTruthy();
});

it('can retry an initial non-Error failure without being stuck on an empty screen', async () => {
  stubFetch( vi.fn().mockRejectedValueOnce(null).mockResolvedValueOnce(Response.json(account)));
  render(<ConnectAccount />);
  expect((await screen.findByRole('alert')).textContent).toContain('Could not complete this action.');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByRole('heading', { name: 'MacBook' });
  expect(screen.queryByRole('alert')).toBeNull();
});

it('keeps phone sign-in separate from computer enrollment and preserves it through GitHub', async () => {
  const code = 'p'.repeat(22); window.history.replaceState({}, '', `/connect/?phone=${code}`);
  stubFetch(vi.fn(async () => new Response('', { status: 401 })));
  const view = render(<ConnectAccount />);
  expect((await screen.findByRole('link', { name: 'Sign in with GitHub' })).getAttribute('href')).toContain(encodeURIComponent(`/connect/?phone=${code}`));
  view.unmount();
  stubFetch(vi.fn(async path => Response.json(path.includes('/phone/info/') ? { name: 'iPhone', approved: false } : account)));
  render(<ConnectAccount />);
  await screen.findByRole('button', { name: 'Approve phone' });
  expect(screen.queryByRole('button', { name: 'Approve computer' })).toBeNull();
  expect(screen.queryByText('Connect a computer')).toBeNull();
});

it('retries phone approval details after a transient failure', async () => {
  window.history.replaceState({}, '', `/connect/?phone=${'p'.repeat(22)}`);
  let fail = true;
  stubFetch(vi.fn(async path => {
    if (path.includes('/phone/info/')) { if (fail) return new Response(null, { status: 503 }); return Response.json({ name: 'iPhone' }); }
    return Response.json(account);
  }));
  render(<ConnectAccount />);
  await screen.findByRole('alert'); fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByRole('button', { name: 'Approve phone' });
  expect(screen.queryByRole('alert')).toBeNull();
});
