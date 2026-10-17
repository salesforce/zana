// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ list: vi.fn(), removeUse: vi.fn(), removeLink: vi.fn(), disconnect: vi.fn(), reconnect: vi.fn() }));
vi.mock('../../lib/product-client.js', () => ({ peerLinks: api }));

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
  api.list.mockReset().mockResolvedValue({ links: [link()] });
  api.removeUse.mockReset().mockResolvedValue({ ok: true, linkRemoved: false });
  api.removeLink.mockReset().mockResolvedValue({ ok: true, linkRemoved: true });
  api.disconnect.mockReset().mockResolvedValue({ ok: true, paused: true });
  api.reconnect.mockReset().mockResolvedValue({ ok: true, paused: false });
});
afterEach(cleanup);

describe('PeersSettingsView', () => {
  it('shows the empty state', async () => {
    api.list.mockResolvedValue({ links: [] });
    render(<PeersSettingsView />);
    expect(await screen.findByText(/No peer links yet/)).toBeTruthy();
  });

  it('tolerates a malformed list body', async () => {
    api.list.mockResolvedValue({});
    render(<PeersSettingsView />);
    expect(await screen.findByText(/No peer links yet/)).toBeTruthy();
  });

  it('lists links with state, connection, reason and uses', async () => {
    api.list.mockResolvedValue({ links: [link({ state: 'failed', reason: 'handshake refused', connected: false }), link({ hostId: 'h2', peerName: 'Bare', uses: [], state: 'unclaimed', connected: false })] });
    render(<PeersSettingsView />);
    expect(await screen.findByText('Studio laptop')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.getByText('handshake refused')).toBeTruthy();
    expect(screen.getByText('Alpha plugin')).toBeTruthy();
    expect(screen.getByText('Unclaimed')).toBeTruthy();
    expect(screen.getByText('No plugin uses this link.')).toBeTruthy();
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

  it('shows Stop syncing only when the machine has more than one plugin', async () => {
    api.list.mockResolvedValue({ links: [link({ uses: [{ pluginId: 'a', label: 'Alpha plugin', scope: 'proj-1', since: 1 }] })] });
    render(<PeersSettingsView />);
    expect(await screen.findByText('Alpha plugin')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Stop syncing/ })).toBeNull();
  });

  it('puts Disconnect and Remove link in the machine header, not the card bottom', async () => {
    render(<PeersSettingsView />);
    const header = (await screen.findByText('Studio laptop')).closest('.peers-link-header') as HTMLElement;
    expect(within(header).getByRole('button', { name: 'Disconnect' })).toBeTruthy();
    expect(within(header).getByRole('button', { name: 'Remove link' })).toBeTruthy();
    expect(within(header).getByText('Connected')).toBeTruthy();
    const statuses = header.querySelector('.peers-link-statuses') as HTMLElement;
    const actions = header.querySelector('.peers-link-actions') as HTMLElement;
    expect(within(statuses).getAllByRole('status').map((el) => el.textContent)).toEqual(['Linked', 'Connected']);
    expect(within(statuses).getByText('Connected').classList.contains('peers-state')).toBe(true);
    expect(within(statuses).queryByRole('button')).toBeNull();
    expect(statuses.contains(actions)).toBe(false);
    expect(within(actions).getByRole('button', { name: 'Disconnect' }).className).toContain('peers-btn-secondary');
    expect(within(actions).getByRole('button', { name: 'Remove link' }).className).toContain('peers-btn-remove');
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
    fireEvent.click(within(header).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(api.disconnect).toHaveBeenCalledWith('h1'));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  it('shows Paused and Reconnect for a paused link, and Reconnect when the connection is down', async () => {
    api.list.mockResolvedValue({ links: [link({ paused: true, connected: false }), link({ hostId: 'h2', peerName: 'Other', connected: false })] });
    render(<PeersSettingsView />);
    expect(await screen.findByText('Paused')).toBeTruthy();
    expect(screen.queryByText('Connected')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
    const buttons = screen.getAllByRole('button', { name: 'Reconnect' });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]!);
    await waitFor(() => expect(api.reconnect).toHaveBeenCalledWith('h1'));
  });

  it('offers no Disconnect or Reconnect for an unclaimed link', async () => {
    api.list.mockResolvedValue({ links: [link({ state: 'unclaimed', connected: false, uses: [] })] });
    render(<PeersSettingsView />);
    expect(await screen.findByRole('button', { name: 'Remove link' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Disconnect|Reconnect/ })).toBeNull();
  });

  it('surfaces a disconnect failure', async () => {
    api.disconnect.mockRejectedValueOnce(new Error('busy'));
    render(<PeersSettingsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    expect((await screen.findByRole('alert')).textContent).toBe('busy');
  });

  it('requires confirmation before removing a link, and can back out', async () => {
    render(<PeersSettingsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove link' }));
    expect(screen.getByText(/Delete this link for all plugins and remove this machine's access/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Keep link' }));
    expect(api.removeLink).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove' }));
    await waitFor(() => expect(api.removeLink).toHaveBeenCalledWith('h1'));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  it('surfaces a list failure', async () => {
    api.list.mockRejectedValue(new Error('server down'));
    render(<PeersSettingsView />);
    expect((await screen.findByRole('alert')).textContent).toBe('server down');
  });

  it('surfaces a removal failure and a non-Error rejection', async () => {
    api.removeUse.mockRejectedValueOnce(new Error('denied'));
    render(<PeersSettingsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Stop syncing Alpha plugin' }));
    expect((await screen.findByRole('alert')).textContent).toBe('denied');
    api.removeLink.mockRejectedValueOnce('boom');
    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Request failed'));
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
    // The link-level badges are unchanged.
    expect(screen.getByText('Linked')).toBeTruthy();
    expect(screen.getByText('Connected')).toBeTruthy();
  });
});
