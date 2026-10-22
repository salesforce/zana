// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ activity: vi.fn(), list: vi.fn(), removeUse: vi.fn(), removeLink: vi.fn(), disconnect: vi.fn(), reconnect: vi.fn(), repair: vi.fn(), leftovers: vi.fn(), forgetLeftover: vi.fn() }));
const conn = vi.hoisted(() => ({ list: vi.fn(), cancel: vi.fn(), checkRemoteLogin: vi.fn(), create: vi.fn(), join: vi.fn(), approve: vi.fn(), deny: vi.fn() }));
const hostsEvents = vi.hoisted(() => ({ listeners: new Set<() => void>() }));
vi.mock('../../lib/product-client.js', () => ({ peerLinks: api, peerConnections: conn, product: {
  pluginApps: { list: vi.fn(async () => []), onChanged: () => () => {} },
  hosts: { onChanged: (cb: () => void) => { hostsEvents.listeners.add(cb); return () => { hostsEvents.listeners.delete(cb); }; } }
} }));

import { PeersSettingsView } from './PeersSettingsView';

const link = (over: Record<string, unknown> = {}) => ({
  hostId: 'h1',
  peerInstanceId: 'p1',
  peerName: 'Studio laptop',
  state: 'linked',
  connected: true,
  uses: [
    { pluginId: 'a', label: 'Alpha plugin', scope: 'proj-1', since: 1_700_000_000_000 },
    { pluginId: 'b', label: 'Beta plugin', scope: 'proj-2', since: 1_700_000_000_000 }
  ],
  ...over
});

beforeEach(() => {
  conn.list.mockReset().mockResolvedValue({ connections: [] });
  conn.cancel.mockReset().mockResolvedValue({});
  api.activity.mockReset().mockResolvedValue({ active: [] });
  api.list.mockReset().mockResolvedValue({ links: [link()] });
  api.removeUse.mockReset().mockResolvedValue({ ok: true, linkRemoved: false });
  api.removeLink.mockReset().mockResolvedValue({ ok: true, linkRemoved: true });
  api.disconnect.mockReset().mockResolvedValue({ ok: true, paused: true });
  api.reconnect.mockReset().mockResolvedValue({ ok: true, paused: false });
  api.repair.mockReset().mockResolvedValue({ ok: true });
  api.leftovers.mockReset().mockResolvedValue({ leftovers: [] });
  api.forgetLeftover.mockReset().mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe('PeersSettingsView', () => {
  it('renders the Peers h3 heading the e2e fixture waits for', async () => {
    render(<PeersSettingsView />);
    expect(screen.getByRole('heading', { name: 'Peers', level: 3 })).toBeTruthy();
    await screen.findByText('Studio laptop');
  });

  it('reloads links when hosts change after the connection is already terminal', async () => {
    conn.list.mockResolvedValue({ connections: [{ invitationId: 'i1', state: 'cancelled' }] });
    const { unmount } = render(<PeersSettingsView />);
    await screen.findByText('Studio laptop');
    api.list.mockResolvedValue({ links: [] });
    act(() => { for (const cb of hostsEvents.listeners) cb(); });
    expect(await screen.findByText(/No installed plugin uses peers yet/)).toBeTruthy();
    unmount();
    expect(hostsEvents.listeners.size).toBe(0);
  });

  it('shows the empty state', async () => {
    api.list.mockResolvedValue({ links: [] });
    render(<PeersSettingsView />);
    expect(await screen.findByText(/No installed plugin uses peers yet.*You can add a computer now/)).toBeTruthy();
  });

  it('tolerates a malformed list body', async () => {
    api.list.mockResolvedValue({});
    render(<PeersSettingsView />);
    expect(await screen.findByText(/No installed plugin uses peers yet.*You can add a computer now/)).toBeTruthy();
  });

  it('lists links with state, connection, reason and uses', async () => {
    api.list.mockResolvedValue({ links: [link({ state: 'failed', reason: 'handshake refused', connected: false }), link({ hostId: 'h2', peerInstanceId: 'p2', peerName: 'Bare', uses: [], state: 'unclaimed', connected: false })] });
    render(<PeersSettingsView />);
    expect(await screen.findByText('Studio laptop')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.getByText("Pairing didn't finish on this computer.")).toBeTruthy();
    expect(screen.getByText('Alpha plugin')).toBeTruthy();
    expect(screen.getByText('Unclaimed')).toBeTruthy();
    expect(screen.getByText('No plugin uses this computer.')).toBeTruthy();
    expect(screen.getAllByTestId('peer-link')).toHaveLength(2);
    expect(screen.queryByText('Connected')).toBeNull();
  });

  it('stops syncing a single use with its scope and reloads', async () => {
    render(<PeersSettingsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Stop syncing Beta plugin' }));
    await waitFor(() => expect(api.removeUse).toHaveBeenCalledWith('h1', 'b', 'proj-2'));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Remove use')).toBeNull();
  });

  it('offers Stop syncing even for the last use (a zero-use link stays)', async () => {
    api.list.mockResolvedValue({ links: [link({ uses: [{ pluginId: 'a', label: 'Alpha plugin', scope: 'proj-1', since: 1 }] })] });
    render(<PeersSettingsView />);
    expect(await screen.findByText('Alpha plugin')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop syncing Alpha plugin' })).toBeTruthy();
  });

  it('puts connection controls in the computer header and plugin uses below it', async () => {
    render(<PeersSettingsView />);
    const header = (await screen.findByText('Studio laptop')).closest('.peers-link-header') as HTMLElement;
    expect(within(header).getByText('Connected')).toBeTruthy();
    // A linked computer shows a computer-level "Linked" badge in the header, outside the live-status group.
    expect(within(header).getByTestId('peer-linked').textContent).toBe('Linked');
    const statuses = header.querySelector('.peers-link-statuses') as HTMLElement;
    expect(within(statuses).queryByTestId('peer-linked')).toBeNull();
    expect(within(statuses).getAllByRole('status').map((el) => el.textContent)).toEqual(['Connected']);
    expect(within(statuses).queryByRole('button')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Used by' })).toBeTruthy();
    const actions = header.querySelector('.peers-link-actions') as HTMLElement;
    expect(within(actions).getByRole('button', { name: 'Pause' }).className).toContain('peers-btn-secondary');
    expect(within(actions).getByRole('button', { name: 'Remove computer' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
    fireEvent.click(within(actions).getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(api.disconnect).toHaveBeenCalledWith('h1'));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  it('offers confirmed removal for a healthy unused computer', async () => {
    api.list.mockResolvedValue({ links: [link({ uses: [] })] });
    render(<PeersSettingsView />);
    await screen.findByText('No plugin uses this computer.');
    fireEvent.click(screen.getByRole('button', { name: 'Remove computer' }));
    expect(api.removeLink).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.removeLink).toHaveBeenCalledWith('h1'));
  });

  it('groups links of one computer and disambiguates equal names', async () => {
    api.list.mockResolvedValue({ links: [
      link({ hostId: 'h1', peerInstanceId: 'aaaaaaaa-1111' }),
      link({ hostId: 'h2', peerInstanceId: 'aaaaaaaa-1111', uses: [{ pluginId: 'a', label: 'Alpha plugin', scope: 'x', since: 1 }] }),
      link({ hostId: 'h3', peerInstanceId: undefined, uses: [] })
    ] });
    render(<PeersSettingsView />);
    await screen.findAllByTestId('peer-computer');
    expect(screen.getAllByTestId('peer-computer')).toHaveLength(2);
    expect(screen.getAllByTestId('peer-link')).toHaveLength(3);
    expect(screen.getByText('Studio laptop (aaaaaaaa)')).toBeTruthy();
    expect(screen.getByText('Studio laptop (h3)')).toBeTruthy();
    expect(screen.getByText('No plugin uses this computer.')).toBeTruthy();
  });

  it('keeps the plain name when names differ', async () => {
    api.list.mockResolvedValue({ links: [link(), link({ hostId: 'h2', peerInstanceId: 'p2', peerName: 'Other' })] });
    render(<PeersSettingsView />);
    expect(await screen.findByText('Studio laptop')).toBeTruthy();
    expect(screen.getByText('Other')).toBeTruthy();
  });

  it('confirms Stop syncing only for an actively transferring plugin', async () => {
    api.activity.mockResolvedValue({ active: [{ pluginId: 'b', label: 'Beta plugin' }] });
    render(<PeersSettingsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Stop syncing Beta plugin' }));
    expect(await screen.findByText('Beta plugin is transferring with Studio laptop. Stop anyway?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep syncing' }));
    expect(api.removeUse).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Stop syncing Beta plugin' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop anyway' }));
    await waitFor(() => expect(api.removeUse).toHaveBeenCalledWith('h1', 'b', 'proj-2'));
  });

  it('stops syncing immediately when a different plugin is the active one', async () => {
    api.activity.mockResolvedValue({ active: [{ pluginId: 'a', label: 'Alpha plugin' }] });
    render(<PeersSettingsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Stop syncing Beta plugin' }));
    await waitFor(() => expect(api.removeUse).toHaveBeenCalledWith('h1', 'b', 'proj-2'));
  });

  it('shows Paused and Resume for a paused link, and a separate Reconnect repair when the connection is down', async () => {
    api.list.mockResolvedValue({ links: [link({ paused: true, connected: false }), link({ hostId: 'h2', peerInstanceId: 'p2', peerName: 'Other', connected: false })] });
    render(<PeersSettingsView />);
    expect(await screen.findByText('Paused')).toBeTruthy();
    expect(screen.queryByText('Connected')).toBeNull();
    const resume = screen.getByRole('button', { name: 'Resume' });
    const reconnect = screen.getByRole('button', { name: 'Reconnect' });
    expect(screen.getAllByRole('button', { name: 'Pause' })).toHaveLength(1);
    expect(screen.getByText("Can't reach Other. Check that both computers are on, running Zana, and on the same network.")).toBeTruthy();
    fireEvent.click(resume);
    await waitFor(() => expect(api.reconnect).toHaveBeenCalledWith('h1'));
    fireEvent.click(await screen.findByRole('button', { name: 'Reconnect' }));
    await waitFor(() => expect(api.repair).toHaveBeenCalledWith('h2'));
  });

  it('offers no ordinary actions for an unclaimed link', async () => {
    api.list.mockResolvedValue({ links: [link({ state: 'unclaimed', connected: false, uses: [] })] });
    render(<PeersSettingsView />);
    await screen.findByText('Unclaimed');
    expect(screen.queryByRole('button', { name: /Pause|Resume|Reconnect|Remove link|Remove\.\.\./ })).toBeNull();
  });

  it('surfaces a disconnect failure', async () => {
    api.disconnect.mockRejectedValueOnce(new Error('busy'));
    render(<PeersSettingsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    expect((await screen.findByRole('alert')).textContent).toBe('busy');
  });

  it('surfaces a list failure', async () => {
    api.list.mockRejectedValue(new Error('server down'));
    render(<PeersSettingsView />);
    expect((await screen.findByRole('alert')).textContent).toBe('server down');
  });

  it('surfaces a use-removal failure', async () => {
    api.removeUse.mockRejectedValueOnce(new Error('denied'));
    render(<PeersSettingsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Stop syncing Alpha plugin' }));
    expect((await screen.findByRole('alert')).textContent).toBe('denied');
  });

  it('renders a plugin-supplied note beside only that plugin use, amber for attention', async () => {
    const uses = [
      { pluginId: 'a', label: 'Alpha plugin', scope: 'proj-1', since: 1_700_000_000_000, note: { state: 'attention', label: 'Sync not set up', detail: 'Connected, but database sync is not set up.' } },
      { pluginId: 'b', label: 'Beta plugin', scope: 'proj-2', since: 1_700_000_000_000, note: { state: 'ok', label: 'Synced' } },
      { pluginId: 'c', label: 'Gamma plugin', scope: 'proj-3', since: 1_700_000_000_000 }
    ];
    api.list.mockResolvedValue({ links: [link({ uses })] });
    render(<PeersSettingsView />);
    const rows = await screen.findAllByTestId('peer-link-use');
    expect(within(rows[0]!).getByText('Sync not set up').getAttribute('data-state')).toBe('attention');
    expect(within(rows[0]!).getByText('Connected, but database sync is not set up.')).toBeTruthy();
    expect(within(rows[1]!).getByText('Synced').getAttribute('data-state')).toBe('ok');
    expect(within(rows[2]!).queryByTestId('peer-use-note')).toBeNull();
    // Healthy links expose the connection state only.
    expect(screen.getByText('Connected')).toBeTruthy();
  });

  describe('stuck states', () => {
    const stuck = (over: Record<string, unknown>) => api.list.mockResolvedValue({ links: [link({ connected: false, uses: [{ pluginId: 'a', label: 'Alpha plugin', scope: 's', since: 1 }], ...over })] });

    it('shows one header Remove for failed and unclaimed links', async () => {
      stuck({ state: 'failed' });
      const { unmount } = render(<PeersSettingsView />);
      expect(await screen.findByText("Pairing didn't finish on this computer.")).toBeTruthy();
      expect(screen.getAllByRole('button', { name: 'Remove computer' })).toHaveLength(1);
      expect(screen.queryByRole('button', { name: 'Remove anyway' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
      unmount();
      stuck({ state: 'unclaimed', uses: [] });
      render(<PeersSettingsView />);
      expect(await screen.findByText('No plugin owns this connection and nothing uses it.')).toBeTruthy();
    });

    it('Retry on a waiting link reloads without repair', async () => {
      stuck({ state: 'pre-consent' });
      render(<PeersSettingsView />);
      expect(await screen.findByText('Waiting for the other computer…')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
      expect(api.repair).not.toHaveBeenCalled();
    });

    it('Reconnect runs the repair route', async () => {
      stuck({});
      render(<PeersSettingsView />);
      fireEvent.click(await screen.findByRole('button', { name: 'Reconnect' }));
      await waitFor(() => expect(api.repair).toHaveBeenCalledWith('h1'));
    });

    it('offers forced removal only after plugin cleanup fails', async () => {
      stuck({});
      api.removeLink.mockResolvedValueOnce({ ok: false, hookFailures: [{ pluginId: 'a', label: 'Alpha plugin', reason: 'timeout' }] });
      render(<PeersSettingsView />);
      fireEvent.click(await screen.findByRole('button', { name: 'Remove computer' }));
      expect(screen.getByText(/Plugins using it: Alpha plugin/)).toBeTruthy();
      expect(api.removeLink).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Remove anyway' }));
      await waitFor(() => expect(api.removeLink).toHaveBeenCalledWith('h1', { force: true }));
      await waitFor(() => expect(api.leftovers).toHaveBeenCalledTimes(3));
    });

    it('can back out of removal, and a removal failure shows an error', async () => {
      stuck({ state: 'failed' });
      render(<PeersSettingsView />);
      fireEvent.click(await screen.findByRole('button', { name: 'Remove computer' }));
      fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
      expect(api.removeLink).not.toHaveBeenCalled();
      api.removeLink.mockRejectedValueOnce(new Error('nope'));
      fireEvent.click(screen.getByRole('button', { name: 'Remove computer' }));
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
      expect((await screen.findByRole('alert')).textContent).toBe('nope');
    });

    it('shows no stuck block for a healthy link', async () => {
      render(<PeersSettingsView />);
      await screen.findByText('Studio laptop');
      expect(screen.queryByTestId('peer-stuck')).toBeNull();
    });
  });

  describe('leftover access', () => {
    const leftover = { computerId: 'c1', name: 'Old laptop', plugins: [{ pluginId: 'a', label: 'Alpha plugin', reason: 'timeout' }, { pluginId: 'b', label: 'Beta plugin', reason: 'error' }] };

    it('is hidden when empty or malformed, and when the fetch fails', async () => {
      api.leftovers.mockResolvedValueOnce({});
      const { unmount } = render(<PeersSettingsView />);
      await screen.findByText('Studio laptop');
      expect(screen.queryByTestId('peer-leftovers')).toBeNull();
      unmount();
      api.leftovers.mockRejectedValue(new Error('x'));
      render(<PeersSettingsView />);
      await screen.findByText('Studio laptop');
      expect(screen.queryByTestId('peer-leftovers')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('lists records and forgets one after confirmation, then reloads', async () => {
      api.leftovers.mockResolvedValueOnce({ leftovers: [leftover] }).mockResolvedValue({ leftovers: [] });
      render(<PeersSettingsView />);
      expect(await screen.findByText('Old laptop: Alpha plugin, Beta plugin may still hold access from a removal that did not finish cleaning up.')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Forget leftover access' }));
      expect(api.forgetLeftover).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Confirm forget' }));
      await waitFor(() => expect(api.forgetLeftover).toHaveBeenCalledWith('c1'));
      await waitFor(() => expect(screen.queryByTestId('peer-leftovers')).toBeNull());
    });

    it('cancel keeps the record; a failed forget shows an error and keeps the row', async () => {
      api.leftovers.mockResolvedValue({ leftovers: [leftover] });
      api.forgetLeftover.mockRejectedValueOnce(new Error('cannot forget'));
      render(<PeersSettingsView />);
      fireEvent.click(await screen.findByRole('button', { name: 'Forget leftover access' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(api.forgetLeftover).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Forget leftover access' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm forget' }));
      expect((await screen.findByRole('alert')).textContent).toBe('cannot forget');
      expect(screen.getByTestId('peer-leftover')).toBeTruthy();
    });
  });

  it('opens Add and Join computer panels from the section buttons', async () => {
    conn.checkRemoteLogin.mockResolvedValue({ ok: false, reason: 'ssh_remote_login_off' });
    render(<PeersSettingsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Join computer' }));
    expect(screen.getByTestId('join-computer')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add computer' }));
    expect((await screen.findByRole('button', { name: 'Add computer' })).className).toContain('primary');
    expect(await screen.findByTestId('add-computer')).toBeTruthy();
    expect(screen.queryByTestId('join-computer')).toBeNull();
  });

  it('lists in-progress connections, cancels an open one, and polls only while active', async () => {
    vi.useFakeTimers();
    try {
      const open = { invitationId: '11111111-1111-4111-8111-111111111111', role: 'inviter', state: 'open', expiresAt: 1, awaitingApproval: false };
      conn.list.mockResolvedValue({ connections: [open] });
      render(<PeersSettingsView />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(screen.getAllByTestId('peer-connection')).toHaveLength(1);
      const before = conn.list.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
      expect(conn.list.mock.calls.length).toBeGreaterThan(before);
      conn.list.mockResolvedValue({ connections: [] });
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); await vi.advanceTimersByTimeAsync(0); });
      expect(conn.cancel).toHaveBeenCalledWith(open.invitationId);
      expect(screen.queryByTestId('peer-connection')).toBeNull();
      const settled = conn.list.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
      expect(conn.list.mock.calls.length).toBe(settled);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reloads the link list when a connection reaches a new state', async () => {
    vi.useFakeTimers();
    try {
      const id = '22222222-2222-4222-8222-222222222222';
      const base = { invitationId: id, role: 'inviter', expiresAt: 1, awaitingApproval: false };
      api.list.mockResolvedValue({ links: [] });
      conn.list.mockResolvedValue({ connections: [{ ...base, state: 'reserved' }] });
      render(<PeersSettingsView />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      const before = api.list.mock.calls.length;
      api.list.mockResolvedValue({ links: [link({ uses: [] })] });
      conn.list.mockResolvedValue({ connections: [{ ...base, state: 'ready' }] });
      await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
      expect(api.list.mock.calls.length).toBeGreaterThan(before);
      expect(screen.getByTestId('peer-link')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

});
