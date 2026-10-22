// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installTestPluginRuntime } from '@zana-ai/zcc-plugin-sdk/testing/app';
import { PEER_CONNECTIONS_POLL_MS, PEER_PENDING_POLL_MS, PeerSettings, labelsOf, lifecycleText } from './PeerSettings.js';
import { createApi, type ConnectionView } from './api.js';
import { createHarness } from './test-harness.js';

afterEach(() => { vi.useRealTimers(); });

const fakePolling = () => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
const tick = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };

const EMPTY = { configured: false, repoId: 'database', replicaId: 'r-a', roster: null, members: [] as any[], jobs: [] as any[], setup: null as any,
  peers: [] as any[], enrolled: [] as any[], lifecycleAvailable: true, introductionsAvailable: true, installerAvailable: false };
const conn = (patch: Partial<ConnectionView> = {}): ConnectionView => ({ computerId: 'app-b', hostname: 'Laptop', state: 'connected', usedByThisPlugin: false,
  use: null, syncing: false, retiring: false, ...patch });
const used = (patch: Partial<ConnectionView> = {}) => conn({ usedByThisPlugin: true, syncing: true, ...patch });

function mount(rpc: Record<string, (args?: any) => unknown> = {}) {
  const harness = createHarness();
  const installed = installTestPluginRuntime({ deepLinkBase: null, rpc: { groupStatus: async () => EMPTY, connections: async () => [], ...rpc } });
  (globalThis as { __ZCC_PLUGIN_RUNTIME__: { toast: unknown } }).__ZCC_PLUGIN_RUNTIME__.toast = (message: string, kind = 'info') => { harness.toasts.push({ message, kind } as never); };
  harness.render(<PeerSettings />);
  return Object.assign(harness, { emitRealtime: installed.emitRealtime });
}

function withConfirm(answer: boolean) {
  const prior = window.confirm;
  const confirm = vi.fn(() => answer);
  window.confirm = confirm;
  return { confirm, restore: () => { window.confirm = prior; } };
}

describe('Peers screen: connected computers', () => {
  it('lists every connected computer, including never-used ones', async () => {
    mount({ connections: async () => [used({ computerId: 'app-a', hostname: 'Desk' }), conn({ computerId: 'app-b', hostname: 'Laptop' }), conn({ computerId: 'app-c', hostname: 'Studio', state: 'disconnected' })] });
    const list = await screen.findByRole('list', { name: 'Computers' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      'DeskConnectedStop using',
      'LaptopConnectedUse for Design Docs',
      'StudioDisconnectedUse for Design Docs'
    ]);
    expect(list.textContent).not.toMatch(/app-[abc]/);
    expect(screen.queryByRole('link', { name: /Not listed/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add peer|Join peer|Remove|Reconnect|Dismiss|Pause/ })).toBeNull();
  });

  it('says to connect a computer before enabling sync', async () => {
    mount();
    expect(await screen.findByText('No computers are connected. Connect a computer first to enable Design Docs sync with it.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect a computer' })).toHaveProperty('className', expect.stringContaining('dd-peers-connect'));
    expect(screen.getByText('No sync group configured.')).toBeTruthy();
  });

  it('disambiguates duplicate hostnames with a short id suffix and never labels with a bare id', async () => {
    mount({ connections: async () => [conn({ computerId: 'inst-1111', hostname: 'MacBook' }), conn({ computerId: 'inst-2222', hostname: 'macbook' }),
      conn({ computerId: 'inst-3333', hostname: '  ' }), conn({ computerId: 'inst-4444', hostname: 'Desk' })] });
    const list = await screen.findByRole('list', { name: 'Computers' });
    const names = within(list).getAllByRole('listitem').map((row) => row.querySelector('.dd-peers-card-name')!.textContent);
    expect(names).toEqual(['MacBook (1111)', 'macbook (2222)', 'Unnamed computer', 'Desk']);
    expect(labelsOf([conn({ computerId: 'x-1', hostname: '' }), conn({ computerId: 'x-2', hostname: '' })]).get('x-2')).toBe('Unnamed computer (x-2)');
  });

  it('badges: reconnecting, disconnected used computer, and being removed', async () => {
    mount({ connections: async () => [conn({ computerId: 'a', hostname: 'One', state: 'reconnecting' }),
      used({ computerId: 'b', hostname: 'Two', state: 'disconnected' }),
      used({ computerId: 'c', hostname: 'Three', retiring: true })] });
    const rows = within(await screen.findByRole('list', { name: 'Computers' })).getAllByRole('listitem');
    expect(rows[0]!.textContent).toBe('OneReconnectingUse for Design Docs');
    expect(rows[1]!.textContent).toBe('TwoDisconnectedStop usingSync resumes when the connection is back.');
    expect(rows[2]!.textContent).toBe('ThreeBeing removedStop usingWaiting for committed frontier; data sync disabled');
    expect(within(rows[2]!).getByRole('button', { name: 'Stop using' })).toHaveProperty('disabled', false);
    expect(within(rows[1]!).getByRole('button', { name: 'Stop using' }).className).toContain('dd-btn-remove');
  });
});

describe('Use for Design Docs', () => {
  it('Use goes pending (waiting text, button disabled, fast polling) then approved', async () => {
    let state: ConnectionView = conn();
    const use = vi.fn(async () => { state = conn({ use: 'pending' }); return { status: 'pending' }; });
    fakePolling();
    mount({ connections: async () => [state], useConnection: use });
    fireEvent.click(await screen.findByRole('button', { name: 'Use for Design Docs' }));
    expect(await screen.findByText('Requesting approval on both computers')).toBeTruthy();
    expect(use).toHaveBeenCalledExactlyOnceWith({ computerId: 'app-b' });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Use for Design Docs' }) as HTMLButtonElement).disabled).toBe(true));
    // Core's sheet approves it; the next fast poll shows the computer as used.
    state = used();
    await tick(PEER_PENDING_POLL_MS);
    expect(await screen.findByRole('button', { name: 'Stop using' })).toBeTruthy();
    expect(screen.queryByText('Requesting approval on both computers')).toBeNull();
  });

  it('polls slowly until a row is pending', async () => {
    const connections = vi.fn(async () => [conn()]);
    fakePolling();
    mount({ connections });
    await screen.findByText('Laptop');
    const before = connections.mock.calls.length;
    await tick(PEER_PENDING_POLL_MS);
    expect(connections.mock.calls.length).toBe(before);
    await tick(PEER_CONNECTIONS_POLL_MS);
    expect(connections.mock.calls.length).toBeGreaterThan(before);
  });

  it('shows denied (from the call or the next load) and lets the owner ask again', async () => {
    const use = vi.fn().mockResolvedValueOnce({ status: 'denied' }).mockResolvedValueOnce({ status: 'pending' });
    let state = conn();
    mount({ connections: async () => [state], useConnection: use });
    fireEvent.click(await screen.findByRole('button', { name: 'Use for Design Docs' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Use was denied. You can ask again.');
    state = conn({ use: 'pending' });
    fireEvent.click(screen.getByRole('button', { name: 'Use for Design Docs' }));
    await screen.findByText('Requesting approval on both computers');
    expect(screen.queryByText(/Use was denied/)).toBeNull();
    cleanup();
    mount({ connections: async () => [conn({ use: 'denied' })] });
    expect((await screen.findByRole('alert')).textContent).toBe('Use was denied. You can ask again.');
    expect((screen.getByRole('button', { name: 'Use for Design Docs' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('a failed Use request shows the error and keeps the row', async () => {
    mount({ connections: async () => [conn()], useConnection: async () => { throw new Error('Error: not connected'); } });
    fireEvent.click(await screen.findByRole('button', { name: 'Use for Design Docs' }));
    expect((await screen.findByRole('alert')).textContent).toBe('not connected');
    expect(screen.getByText('Laptop')).toBeTruthy();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Use for Design Docs' }) as HTMLButtonElement).disabled).toBe(false));
  });
});

describe('Stop using', () => {
  it('stops immediately through the core-owned action and reloads', async () => {
    let state: ConnectionView = used();
    const stop = vi.fn(async () => { state = conn(); return EMPTY; });
    mount({ connections: async () => [state], stopUsingConnection: stop });
    fireEvent.click(await screen.findByRole('button', { name: 'Stop using' }));
    await waitFor(() => expect(stop).toHaveBeenCalledExactlyOnceWith({ computerId: 'app-b' }));
    expect(await screen.findByRole('button', { name: 'Use for Design Docs' })).toBeTruthy();
  });

  it('a failed stop is reported and the row stays', async () => {
    mount({ connections: async () => [used()], stopUsingConnection: async () => { throw new Error('sync group busy'); } });
    fireEvent.click(await screen.findByRole('button', { name: 'Stop using' }));
    expect((await screen.findByRole('alert')).textContent).toBe('sync group busy');
    expect(screen.getByRole('button', { name: 'Stop using' })).toBeTruthy();
  });
});

describe('Repair and unsynced', () => {
  it('shows temporary capability reads as progress and recovers automatically', async () => {
    let status = { ...EMPTY, lifecycleAvailable: false, lifecycleChecking: true };
    fakePolling();
    mount({ connections: async () => [used({ syncing: false })], groupStatus: async () => status });
    expect(await screen.findByText('Checking sync status')).toBeTruthy();
    expect(screen.queryByText(/Database sync cannot start/)).toBeNull();
    expect(screen.queryByText(/Enable Database Sync stay off/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Repair' })).toBeNull();
    status = { ...EMPTY, lifecycleAvailable: true, lifecycleChecking: false };
    await tick(PEER_PENDING_POLL_MS);
    expect(await screen.findByRole('button', { name: 'Repair' })).toBeTruthy();
  });
  it('a used, connected computer that is not syncing says so and Repair retries setup', async () => {
    const repair = vi.fn(async () => ({ outcome: 'sync-enabled', detail: null, reason: null }));
    mount({ connections: async () => [used({ syncing: false })], repairPeer: repair });
    expect(await screen.findByText('Connected, sync not set up')).toBeTruthy();
    expect(screen.queryByText('Connected')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Repair' }));
    await waitFor(() => expect(repair).toHaveBeenCalledExactlyOnceWith({ peerId: 'app-b' }));
    await waitFor(() => expect(screen.getByTestId('repair-note').textContent).toBe('Sync set up'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a spinner while setup talks to the other computer, and holds Repair', async () => {
    mount({ connections: async () => [used({ syncing: false, settingUp: true })] });
    const card = await screen.findByRole('listitem');
    expect(within(card).getByText('Connected, setting up sync')).toBeTruthy();
    expect(within(card).getByTestId('setup-spinner')).toBeTruthy();
    expect(within(card).getByText(/Setting up database sync with this computer/)).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Repair' })).toHaveProperty('disabled', true);
    expect(within(card).queryByText('Connected, sync not set up')).toBeNull();
  });

  it('shows active setup instead of offering a second repair', async () => {
    const status = { ...EMPTY, setup: { peerId: 'app-b', repoId: 'database', state: 'pending' as const, error: null } };
    mount({ connections: async () => [used({ syncing: false })], groupStatus: async () => status });
    const card = await screen.findByRole('listitem');
    expect(within(card).getByText('Setting up sync')).toBeTruthy();
    expect(within(card).getByText('Waiting for the other computer to finish setup.')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Repair' })).toBeNull();
    expect(within(card).getByRole('button', { name: 'Stop using' })).toHaveProperty('disabled', true);
  });

  it('keeps connected computer setup details in its card, not a second global work list', async () => {
    const status = { ...EMPTY, setup: { peerId: 'app-b', repoId: 'database', state: 'pending' as const, error: 'waiting for the other computer' },
      jobs: [{ id: 'setup', kind: 'roster', peerId: 'app-b', state: 'blocked', attempts: 1, error: 'waiting for the other computer' }] };
    mount({ connections: async () => [used({ syncing: false })], groupStatus: async () => status });
    const card = await screen.findByRole('listitem');
    expect(within(card).getByText('Setting up sync')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Pending work' })).toBeNull();
    expect(screen.queryByText(/Setup pending:/)).toBeNull();
  });

  it('does not show stale sync work or Reset before Design Docs use is approved', async () => {
    const status = { ...EMPTY, jobs: [{ id: 'setup', kind: 'roster', peerId: 'app-b', state: 'blocked', attempts: 5, error: 'peer enrollment changed or revoked' }] };
    mount({ connections: async () => [conn()], groupStatus: async () => status });
    const card = await screen.findByRole('listitem');
    expect(within(card).getByRole('button', { name: 'Use for Design Docs' })).toBeTruthy();
    expect(screen.queryByText(/Sync setup waiting/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Reset sync/ })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Pending work' })).toBeNull();
  });

  it('an unused computer or a syncing one has no Repair', async () => {
    mount({ connections: async () => [conn({ syncing: false }), used({ computerId: 'app-c', hostname: 'Desk' })] });
    await screen.findByText('Desk');
    expect(screen.queryByRole('button', { name: 'Repair' })).toBeNull();
  });

  it('Repair outcomes: real cause, next step, pending state, already syncing, relinked, thrown error', async () => {
    const detail = 'The connection was re-linked, but the other computer has not reconnected yet. If it keeps failing, remove it in Settings → Peers.';
    const repair = vi.fn()
      .mockResolvedValueOnce({ outcome: 'unavailable', detail: null, reason: 'keychain-denied' })
      .mockResolvedValueOnce({ outcome: 'unavailable', detail: 'mutually enrolled peer unavailable', reason: null })
      .mockResolvedValueOnce({ outcome: 'unavailable', detail, reason: null })
      .mockResolvedValueOnce({ outcome: 'pending', detail: 'Sync setup started but has not finished: keychain locked', reason: null })
      .mockResolvedValueOnce({ outcome: 'relinked', detail: null, reason: null })
      .mockResolvedValueOnce({ outcome: 'already-synced', detail: null, reason: null })
      .mockRejectedValueOnce(new Error('no linked connection to that computer'));
    mount({ connections: async () => [used({ syncing: false })], repairPeer: repair });
    const click = async () => {
      const button = await screen.findByRole('button', { name: 'Repair' });
      await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(button);
    };
    await click();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Repair could not finish: .*Allow Zana access to the keychain/));
    await click();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/mutually enrolled peer unavailable.*Next step: remove this computer in Settings → Peers/));
    await click();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(`Repair could not finish: ${detail}`));
    await click();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/not set up yet\. Sync setup started but has not finished: keychain locked/));
    await click();
    await waitFor(() => expect(screen.getByTestId('repair-note').textContent).toBe('Connection re-linked and sync set up'));
    await click();
    await waitFor(() => expect(screen.getByTestId('repair-note').textContent).toBe('Already syncing'));
    await click();
    await waitFor(() => expect(screen.getByTestId('repair-note').textContent).toMatch(/Repair failed: no linked connection/));
  });

  it('unsynced detail names the real lifecycle cause when sync cannot start', async () => {
    const reasons = ['keychain-denied', 'encryption-unavailable', 'insecure-backend', 'storage-permissions', 'key-missing', 'key-corrupt', 'core-unsupported', null] as const;
    expect(new Set(reasons.map((reason) => lifecycleText(reason))).size).toBe(reasons.length);
    expect(lifecycleText('key-missing')).toMatch(/Settings → Peers/);
    mount({ connections: async () => [used({ syncing: false })], groupStatus: async () => ({ ...EMPTY, lifecycleAvailable: false, lifecycleReason: 'storage-permissions' }) });
    const card = await screen.findByRole('listitem');
    expect(within(card).getByText(/private to your user/)).toBeTruthy();
    expect(screen.getByText(/Using a computer and Enable Database Sync stay off/)).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Repair' })).toHaveProperty('disabled', false);
  });
});

describe('load failures and last good view', () => {
  it('connections failure on first load shows the error; groupStatus failure too', async () => {
    mount({ connections: async () => { throw new Error('core unavailable'); } });
    expect((await screen.findByRole('alert')).textContent).toBe('core unavailable');
    expect(screen.queryByRole('list', { name: 'Computers' })).toBeNull();
    cleanup();
    mount({ groupStatus: async () => { throw new Error('status down'); } });
    expect((await screen.findByRole('alert')).textContent).toBe('status down');
    expect(screen.queryByRole('button', { name: 'Enable Database Sync' })).toBeNull();
  });

  it('a failed refresh keeps the last good list', async () => {
    let fail = false;
    fakePolling();
    mount({ connections: async () => { if (fail) throw new Error('blip'); return [used()]; } });
    await screen.findByText('Laptop');
    fail = true;
    await tick(PEER_CONNECTIONS_POLL_MS);
    await settle();
    expect(screen.getByText('Laptop')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop using' })).toBeTruthy();
  });

  it('a slow earlier response cannot overwrite a newer one', async () => {
    const first = deferred<ConnectionView[]>();
    let calls = 0;
    fakePolling();
    mount({ connections: () => (++calls === 1 ? first.promise : Promise.resolve([conn({ hostname: 'Fresh' })])) });
    await tick(PEER_CONNECTIONS_POLL_MS);
    await screen.findByText('Fresh');
    first.resolve([conn({ hostname: 'Stale' })]);
    await settle();
    expect(screen.queryByText('Stale')).toBeNull();
    expect(screen.getByText('Fresh')).toBeTruthy();
  });

  it('async completions after unmount are ignored', async () => {
    const list = deferred<ConnectionView[]>(), sync = deferred<{ attempted: number; synced: number; blocked: number }>();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let first = true;
    const configured = { ...EMPTY, configured: true, roster: { rosterEpoch: 1 }, members: [{ replicaId: 'r-a', machineId: 'app-a', authorized: true, connected: true, retiring: false }] };
    mount({ connections: () => { if (first) { first = false; return Promise.resolve([conn()]); } return list.promise; },
      groupStatus: async () => configured, peersOutOfSync: async () => ({ outOfSync: true }), syncNow: () => sync.promise });
    fireEvent.click(await screen.findByRole('button', { name: 'Sync Now' }));
    cleanup();
    list.resolve([]); sync.reject(new Error('late failure'));
    await settle();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('group status, jobs and lifecycle', () => {
  it('shows honest installer blocker; enables a legacy enrolled peer that has no connection', async () => {
    const status = { ...EMPTY, enrolled: [{ id: 'app-b', name: 'Laptop', connected: true }, { id: 'app-z', name: 'Gone', connected: false }] };
    const enable = vi.fn(async () => ({ ...status, setup: { peerId: 'app-b', repoId: 'database', state: 'pending', error: 'bilateral database enablement required' }, jobs: [{ id: 'job0', peerId: 'app-b', state: 'pending' }] }));
    mount({ groupStatus: async () => status, enablePeer: enable });
    expect(await screen.findByText(/No sync group/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Sponsors|reserved seats|introductions/i);
    expect((screen.getByRole('button', { name: 'Enable Database Sync' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('option', { name: 'Gone - offline' })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Enrolled peer'), { target: { value: 'app-b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enable Database Sync' }));
    await screen.findByText(/Setup pending/);
    expect(enable).toHaveBeenCalledExactlyOnceWith({ peerId: 'app-b' });
    expect(screen.getByText(/Laptop: pending/)).toBeTruthy();
  });

  it('a connected computer is not offered through the legacy picker; missing storage disables enable and explains', async () => {
    mount({ connections: async () => [conn()], groupStatus: async () => ({ ...EMPTY, enrolled: [{ id: 'app-b', name: 'Laptop', connected: true }, { id: 'app-y', name: 'Old', connected: true }],
      lifecycleAvailable: false, lifecycleReason: 'keychain-denied', introductionsAvailable: false }) });
    await screen.findByText(/Allow Zana access to the keychain/);
    expect(screen.queryByText(/Automatic introductions are unavailable/)).toBeNull();
    expect(screen.queryByRole('option', { name: 'Laptop' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Enrolled peer'), { target: { value: 'app-y' } });
    expect(screen.getByRole('button', { name: 'Enable Database Sync' })).toHaveProperty('disabled', true);
  });

  it('explains missing introductions when lifecycle is ready', async () => {
    mount({ groupStatus: async () => ({ ...EMPTY, introductionsAvailable: false }) });
    expect(await screen.findByText(/Automatic introductions are unavailable/)).toBeTruthy();
  });

  it('enabling failure is reported', async () => {
    mount({ groupStatus: async () => ({ ...EMPTY, enrolled: [{ id: 'app-y', name: 'Old', connected: true }] }), enablePeer: async () => { throw new Error('enable failed'); } });
    fireEvent.change(await screen.findByLabelText('Enrolled peer'), { target: { value: 'app-y' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enable Database Sync' }));
    expect((await screen.findByRole('alert')).textContent).toBe('enable failed');
  });

  it('two computers show the group size and no Leave Group; three show Leave Group behind a confirm', async () => {
    const member = (n: string, extra = {}) => ({ replicaId: `r-${n}`, machineId: `app-${n}`, authorized: true, connected: true, retiring: false, ...extra });
    mount({ connections: async () => [used({ computerId: 'app-b' })], groupStatus: async () => ({ ...EMPTY, configured: true, roster: { rosterEpoch: 1 }, members: [member('a'), member('b')] }) });
    await screen.findByText('Sync group: 2 of 8 computers');
    expect(screen.queryByRole('button', { name: 'Leave Group' })).toBeNull();
    cleanup();
    const remove = vi.fn(async () => EMPTY);
    const { confirm, restore } = withConfirm(false);
    try {
      mount({ connections: async () => [used({ computerId: 'app-b' }), used({ computerId: 'app-c' })], groupStatus: async () => ({ ...EMPTY, configured: true, roster: { rosterEpoch: 3 }, members: [member('a'), member('b'), member('c')] }), removePeer: remove });
      await screen.findByText('Sync group: 3 of 8 computers');
      expect(document.body.textContent).not.toMatch(/sponsor|reserved|seal|epoch/i);
      fireEvent.click(screen.getByRole('button', { name: 'Leave Group' }));
      expect(confirm).toHaveBeenCalledWith('Leave the sync group? This computer stops syncing with every other computer in it. If they are offline, leaving finishes when they reconnect.');
      expect(remove).not.toHaveBeenCalled();
      confirm.mockReturnValue(true);
      fireEvent.click(screen.getByRole('button', { name: 'Leave Group' }));
      await waitFor(() => expect(remove).toHaveBeenCalledExactlyOnceWith({ replicaId: 'r-a' }));
    } finally { restore(); }
  });

  it('a retiring self has no Leave Group', async () => {
    const members = ['a', 'b', 'c'].map((n) => ({ replicaId: `r-${n}`, machineId: `app-${n}`, authorized: true, connected: true, retiring: n === 'a' }));
    mount({ connections: async () => [used({ computerId: 'app-b' }), used({ computerId: 'app-c' })], groupStatus: async () => ({ ...EMPTY, configured: true, roster: { rosterEpoch: 3 }, members }) });
    await screen.findByText('Sync group: 3 of 8 computers');
    expect(screen.queryByRole('button', { name: 'Leave Group' })).toBeNull();
  });

  it('stuck work reads as a sentence and Reset sync is confirmed, per computer, and keeps documents', async () => {
    const zod = '[\n  {\n    "expected": "object",\n    "code": "invalid_type",\n    "path": [],\n    "message": "Invalid input: expected object, received null"\n  }\n]';
    const jobs = [
      { id: 'roster', kind: 'roster', peerId: 'app-y', state: 'blocked', attempts: 5, error: zod },
      { id: 'revoke', kind: 'local-revoke', peerId: 'app-x', state: 'blocked', attempts: 2, error: 'waiting for removal roster delivery before link revocation' },
      { id: 'other', kind: 'roster', peerId: 'app-z', state: 'blocked', attempts: 1, error: 'peer offline' }
    ];
    const status = { ...EMPTY, jobs, setup: { peerId: 'app-y', repoId: 'database', state: 'pending', error: zod }, enrolled: [{ id: 'app-y', name: 'Desk' }] };
    const reset = vi.fn(async () => ({ discarded: 2, status: { ...status, jobs: [jobs[2]], setup: null } }));
    const { confirm, restore } = withConfirm(false);
    try {
      mount({ groupStatus: async () => status, resetPeerSync: reset });
      const list = await screen.findByRole('list', { name: 'Pending work' });
      expect(document.body.textContent).not.toMatch(/invalid_type|"expected"|received null/);
      expect(within(list).getAllByRole('listitem').map((row) => row.textContent)).toEqual([
        'Desk: blocked: the other computer sent a reply this computer cannot read; make sure both run the same Design Docs version',
        'This computer: blocked: waiting for removal roster delivery before link revocation',
        'Unnamed computer: blocked: peer offline'
      ]);
      fireEvent.click(screen.getByRole('button', { name: 'Reset sync with Desk' }));
      expect(confirm).toHaveBeenCalledWith("Reset sync with Desk? This discards this computer's undelivered sync work for Desk only. Documents and their history are not deleted. Afterwards, use Repair on Desk.");
      expect(reset).not.toHaveBeenCalled();
      confirm.mockReturnValue(true);
      fireEvent.click(screen.getByRole('button', { name: 'Reset sync with Desk' }));
      await waitFor(() => expect(reset).toHaveBeenCalledExactlyOnceWith({ peerId: 'app-y' }));
      await waitFor(() => expect(screen.queryByRole('button', { name: /Reset sync/ })).toBeNull());
    } finally { restore(); }
  });

  it('a failed job shows as stopped with the connection hostname; a Reset failure is reported without dropping the view; one item is singular', async () => {
    const status = { ...EMPTY, jobs: [{ id: 'roster', kind: 'roster', peerId: 'app-b', state: 'failed', attempts: 5, error: 'the other computer no longer keeps this sync group' }] };
    const reset = vi.fn().mockRejectedValueOnce(new Error('Error: sync setup is in progress; try again in a moment'))
      .mockResolvedValueOnce({ discarded: 1, status: { ...status, jobs: [] } }).mockResolvedValueOnce({ discarded: 0, status });
    const { restore } = withConfirm(true);
    try {
      const harness = mount({ connections: async () => [used({ hostname: 'Studio' })], groupStatus: async () => status, resetPeerSync: reset });
      expect(await screen.findByText('Sync setup stopped: the other computer no longer keeps this sync group')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Reset sync with Studio' }));
      expect((await screen.findByRole('alert')).textContent).toBe('sync setup is in progress; try again in a moment');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Reset sync with Studio' })).toHaveProperty('disabled', false));
      fireEvent.click(screen.getByRole('button', { name: 'Reset sync with Studio' }));
      await waitFor(() => expect(harness.toasts.at(-1)?.message).toBe('Discarded 1 stuck item for Studio'));
    } finally { restore(); }
  });

  it('cancelling an unfinished setup with no connection says so and cancels behind a confirm', async () => {
    const orphan = { ...EMPTY, setup: { peerId: 'app-b', repoId: 'database', state: 'pending' as const, error: 'mutual enrollment unavailable' } };
    const cancelled = vi.fn(async () => ({ discarded: 1, status: EMPTY }));
    const { confirm, restore } = withConfirm(false);
    try {
      const harness = mount({ groupStatus: async () => orphan, resetPeerSync: cancelled });
      expect(await screen.findByText('Setup pending: Unnamed computer: No connection to Unnamed computer. Cancel setup, or connect it in Settings → Peers.')).toBeTruthy();
      expect(document.body.textContent).not.toMatch(/mutual enrollment/);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel setup with Unnamed computer' }));
      expect(confirm).toHaveBeenCalledWith('Cancel the unfinished setup with Unnamed computer? Nothing is deleted: documents and their history stay. You can use Unnamed computer again afterwards.');
      expect(cancelled).not.toHaveBeenCalled();
      confirm.mockReturnValue(true);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel setup with Unnamed computer' }));
      await waitFor(() => expect(cancelled).toHaveBeenCalledExactlyOnceWith({ peerId: 'app-b' }));
      await waitFor(() => expect(screen.queryByText(/Setup pending/)).toBeNull());
      expect(harness.toasts.at(-1)?.message).toBe('Cancelled the setup with Unnamed computer');
    } finally { restore(); }
  });

  it('with a live connection the wording is a plain wait; a joining setup has no Cancel', async () => {
    const orphan = { ...EMPTY, setup: { peerId: 'app-b', repoId: 'database', state: 'pending' as const, error: 'mutual enrollment unavailable' } };
    mount({ groupStatus: async () => orphan, connections: async () => [used({ syncing: false })] });
    expect(await screen.findByText('Sync setup waiting: waiting for Laptop to connect; no link to this computer right now')).toBeTruthy();
    cleanup();
    mount({ groupStatus: async () => ({ ...EMPTY, setup: { ...orphan.setup, state: 'joining' as const, error: null } }) });
    await screen.findByText('Setup joining: Unnamed computer');
    expect(screen.queryByRole('button', { name: /Cancel setup/ })).toBeNull();
  });
});

describe('out of sync notice', () => {
  const configured = { ...EMPTY, configured: true, roster: { rosterEpoch: 1 }, members: ['a', 'b'].map((name) => ({ replicaId: `r-${name}`, machineId: `app-${name}`, authorized: true, connected: true })) };

  it('says only that the sides differ; Sync Now is explicit and then hides the notice', async () => {
    let differs = true;
    const sync = vi.fn(async () => { differs = false; return { attempted: 1, synced: 1, blocked: 0 }; });
    const harness = mount({ groupStatus: async () => configured, peersOutOfSync: async () => ({ outOfSync: differs }), syncNow: sync });
    const notice = await screen.findByText('This database and a paired peer are out of sync.');
    expect(notice.parentElement!.textContent).toBe('This database and a paired peer are out of sync.Sync NowCancel');
    expect(sync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Sync Now' }));
    await waitFor(() => expect(screen.queryByText(/out of sync/)).toBeNull());
    expect(harness.toasts.at(-1)?.message).toBe('Synced 1 peers');
  });

  it('a peer state push re-checks at once; ignored before a group exists', async () => {
    let differs = true;
    const runtime = mount({ groupStatus: async () => configured, peersOutOfSync: async () => ({ outOfSync: differs }) });
    await screen.findByText(/out of sync/);
    differs = false;
    await runtime.emitRealtime('peer-state', {});
    await waitFor(() => expect(screen.queryByText(/out of sync/)).toBeNull());
    cleanup();
    const check = vi.fn(async () => ({ outOfSync: true }));
    const idle = mount({ peersOutOfSync: check });
    await screen.findByText(/No sync group/);
    await idle.emitRealtime('peer-state', {});
    expect(check).not.toHaveBeenCalled();
  });

  it('Cancel hides the notice until the sides converge; later drift shows it again', async () => {
    let differs = true;
    const sync = vi.fn();
    const runtime = mount({ groupStatus: async () => configured, peersOutOfSync: async () => ({ outOfSync: differs }), syncNow: sync });
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await runtime.emitRealtime('peer-state', {});
    expect(screen.queryByText(/out of sync/)).toBeNull();
    differs = false;
    await runtime.emitRealtime('peer-state', {});
    differs = true;
    await runtime.emitRealtime('peer-state', {});
    await screen.findByText(/out of sync/);
    expect(sync).not.toHaveBeenCalled();
  });

  it('a failed Sync Now keeps the notice and shows the error; a partial sync is reported', async () => {
    mount({ groupStatus: async () => configured, peersOutOfSync: async () => ({ outOfSync: true }), syncNow: async () => { throw new Error('peer unavailable'); } });
    fireEvent.click(await screen.findByRole('button', { name: 'Sync Now' }));
    expect((await screen.findByRole('alert')).textContent).toBe('peer unavailable');
    expect(screen.getByText(/out of sync/)).toBeTruthy();
    cleanup();
    const harness = mount({ groupStatus: async () => configured, peersOutOfSync: async () => ({ outOfSync: true }), syncNow: async () => ({ attempted: 2, synced: 1, blocked: 1 }) });
    fireEvent.click(await screen.findByRole('button', { name: 'Sync Now' }));
    await waitFor(() => expect(harness.toasts.at(-1)?.message).toBe('Synced 1/2; 1 blocked'));
  });

  it('stays quiet when in sync or when the check fails', async () => {
    mount({ connections: async () => [used({ computerId: 'app-b' })], groupStatus: async () => configured, peersOutOfSync: async () => ({ outOfSync: false }) });
    await screen.findByText('Sync group: 2 of 8 computers');
    expect(screen.queryByText(/out of sync/)).toBeNull();
    cleanup();
    mount({ connections: async () => [used({ computerId: 'app-b' })], groupStatus: async () => configured, peersOutOfSync: async () => { throw new Error('x'); } });
    await screen.findByText('Sync group: 2 of 8 computers');
    expect(screen.queryByText(/out of sync/)).toBeNull();
  });
});

describe('typed API', () => {
  it('forwards connection and lifecycle identifiers only', async () => {
    const call = vi.fn(async () => ({}));
    const api = createApi(call);
    await api.groupStatus(); await api.enablePeer('app'); await api.removePeer('replica'); await api.resetPeerSync('app');
    expect(call.mock.calls).toEqual([['groupStatus', undefined], ['enablePeer', { peerId: 'app' }], ['removePeer', { replicaId: 'replica' }], ['resetPeerSync', { peerId: 'app' }]]);
  });
});
