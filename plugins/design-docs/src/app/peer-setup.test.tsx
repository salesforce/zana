// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTestPluginRuntime } from '@zana-ai/zcc-plugin-sdk/testing/app';
import { INVITE_POLL_MS, INVITE_WAITING_POLL_MS, PeerSettings } from './PeerSettings.js';
import type { InviteItem, InviteView, PeerLink } from './api.js';
import { createHarness } from './test-harness.js';
import { createApi } from './api.js';
import { lifecycleText } from './PeerSettings.js';

afterEach(() => { vi.useRealTimers(); });
// These tests run without a link scheme, so the code is the one format; links are covered in invite-links.test.tsx.
/** Manual Refresh is gone: status reloads on the poll interval, so tests drive that interval. */
const fakePolling = () => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
const pollOnce = () => act(async () => { vi.advanceTimersByTime(INVITE_WAITING_POLL_MS); });

describe('database peer settings UI', () => {
  it('shows honest installer blocker; enables selected core peer and shows pending jobs', async () => {
    const harness = createHarness();
    const status = { configured: false, repoId: 'database', replicaId: 'r-a', roster: null, members: [], jobs: [], setup: null,
      peers: [], enrolled: [{ id: 'app-b', name: 'Laptop', connected: true }], lifecycleAvailable: true, introductionsAvailable: true, installerAvailable: false };
    const enable = vi.fn(async () => ({ ...status, setup: { peerId: 'app-b', repoId: 'database', state: 'pending', error: 'bilateral database enablement required' },
      jobs: [{ id: 'job0', peerId: 'app-b', state: 'pending' }] }));
    installTestPluginRuntime({ deepLinkBase: null, rpc: { groupStatus: async () => status, enablePeer: enable } });
    harness.render(<PeerSettings />);
    expect(await screen.findByText(/No sync group/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add peer' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Retry|Refresh/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/Sponsors|reserved seats|introductions/i);
    expect((screen.getByRole('button', { name: 'Enable Database Sync' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Enrolled peer'), { target: { value: 'app-b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enable Database Sync' }));
    await screen.findByText(/Setup pending/);
    expect(enable).toHaveBeenCalledExactlyOnceWith({ peerId: 'app-b' });
    expect(screen.getByText(/Laptop: pending/)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('no authorized links and failed setup never claim completion', async () => {
    const harness = createHarness();
    let fail = false;
    installTestPluginRuntime({ deepLinkBase: null, rpc: { groupStatus: async () => {
      if (fail) throw new Error('core unavailable');
      return { configured: false, repoId: 'database', members: [], jobs: [], peers: [], enrolled: [], setup: null, roster: null };
    } } });
    harness.render(<PeerSettings />);
    await screen.findByText(/No sync group/);
    expect(screen.queryByLabelText('Enrolled peer')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Enable Database Sync' })).toBeNull();
    fakePolling();
    cleanup();
    harness.render(<PeerSettings />);
    await screen.findByText(/No sync group/);
    fail = true; await pollOnce();
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'core unavailable');
    expect(screen.queryByText(/Group:/)).toBeNull();
  });

  it('typed API forwards lifecycle identifiers only', async () => {
    const call = vi.fn(async () => ({})); const api = createApi(call);
    await api.groupStatus(); await api.enablePeer('app'); await api.retryIntroductions(); await api.removePeer('replica'); await api.revokePeer('app');
    await api.resetPeerSync('app');
    expect(call.mock.calls).toEqual([['groupStatus', undefined], ['enablePeer', { peerId: 'app' }],
      ['retryIntroductions', undefined], ['removePeer', { replicaId: 'replica' }], ['revokePeer', { peerId: 'app' }], ['resetPeerSync', { peerId: 'app' }]]);
  });

  it('two computers: one card per computer, Remove ends the pairing (roster entry and link), and the group line disappears', async () => {
    const harness = createHarness();
    const members = ['a', 'b'].map((name) => ({ replicaId: `r-${name}`, machineId: `app-${name}`, authorized: true, connected: true, grantEpoch: 1, joinedAt: 1, sponsorReplicaId: null }));
    const status = { configured: true, repoId: 'database', replicaId: 'r-a', roster: { rosterEpoch: 1 },
      members, jobs: [], setup: null, peers: [], enrolled: [], lifecycleAvailable: true, introductionsAvailable: true, installerAvailable: false };
    const left = { ...status, configured: false, members };
    const revoke = vi.fn(), remove = vi.fn(async () => left);
    installTestPluginRuntime({ deepLinkBase: null, rpc: { groupStatus: async () => status, revokePeer: revoke, removePeer: remove } });
    const priorConfirm = window.confirm;
    const confirm = vi.fn(() => false); window.confirm = confirm;
    try {
      harness.render(<PeerSettings />);
      await screen.findByText('Sync group: 2 of 8 computers');
      const list = screen.getByRole('list', { name: 'Computers' });
      expect(within(list).getAllByRole('listitem').map((row) => row.textContent)).toEqual(['Unnamed computerConnectedRemove']);
      expect(screen.getByText('Unnamed computer').getAttribute('title')).toBe('Computer id app-b');
      expect(list.textContent).not.toContain('app-b');
      expect(screen.queryByRole('button', { name: /Remove Member|Leave Group|Disable Link/ })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
      expect(remove).not.toHaveBeenCalled();
      expect(confirm).toHaveBeenCalledWith('Remove Unnamed computer? This computer stops syncing with it and the pairing ends. To sync again, pair with Add peer.');
      confirm.mockReturnValue(true);
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
      await waitFor(() => expect(remove).toHaveBeenCalledExactlyOnceWith({ replicaId: 'r-b' }));
      expect(revoke).not.toHaveBeenCalled();
      // The roster entry is gone: no dead card, no group count.
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull());
      expect(screen.queryByText('Unnamed computer')).toBeNull();
      expect(screen.queryByText(/Sync group:/)).toBeNull();
      expect(screen.queryByText('Not syncing. Add peer to pair again.')).toBeNull();
    } finally { window.confirm = priorConfirm; }
  });

  it('three computers: Remove and Leave Group appear and remove through the roster; capacity wait stays visible', async () => {
    const harness = createHarness();
    const members = ['a', 'b', 'c'].map((name) => ({ replicaId: `r-${name}`, machineId: `app-${name}`, authorized: true, connected: true }));
    const status = { configured: true, repoId: 'database', replicaId: 'r-c', roster: { rosterEpoch: 3 }, members,
      jobs: [], peers: [], enrolled: [], lifecycleAvailable: true, introductionsAvailable: true,
      setup: { peerId: 'app-d', state: 'pending', error: 'waiting for reserved capacity' } };
    const remove = vi.fn(async () => status);
    installTestPluginRuntime({ deepLinkBase: null, rpc: { groupStatus: async () => status, removePeer: remove } });
    const priorConfirm = window.confirm; window.confirm = vi.fn(() => true);
    try {
      harness.render(<PeerSettings />);
      await screen.findByText(/Setup pending: Unnamed computer: waiting for reserved capacity/);
      expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(2);
      fireEvent.click(screen.getByRole('button', { name: 'Leave Group' }));
      await waitFor(() => expect(remove).toHaveBeenCalledExactlyOnceWith({ replicaId: 'r-c' }));
      expect(window.confirm).toHaveBeenLastCalledWith('Leave the sync group? This computer stops syncing with every other computer in it. If they are offline, leaving finishes when they reconnect.');
      fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]!);
      await waitFor(() => expect(remove).toHaveBeenLastCalledWith({ replicaId: 'r-a' }));
      expect(window.confirm).toHaveBeenLastCalledWith('Remove Unnamed computer from the sync group for everyone? Syncing with it stops on this computer now. If it is offline, removal finishes when it reconnects.');
    } finally { window.confirm = priorConfirm; }
  });

  it('missing protected storage disables lifecycle actions and reports introductions unavailable', async () => {
    const harness = createHarness();
    installTestPluginRuntime({ deepLinkBase: null, rpc: { groupStatus: async () => ({ configured: false, repoId: 'database', replicaId: 'r-a', roster: null,
      members: [], jobs: [], setup: null, peers: [], enrolled: [{ id: 'app-b', name: 'Laptop', connected: true }],
      lifecycleAvailable: false, lifecycleReason: 'keychain-denied', introductionsAvailable: false, installerAvailable: false }) } });
    harness.render(<PeerSettings />);
    await screen.findByText(/Allow Zana access to the keychain \(or unlock it\), then restart Zana/);
    expect(screen.queryByText(/Automatic introductions are unavailable/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Enrolled peer'), { target: { value: 'app-b' } });
    expect(screen.getByRole('button', { name: 'Enable Database Sync' })).toHaveProperty('disabled', true);
  });

  it('pending retirement keeps member visible without data authorization or removal controls', async () => {
    const harness = createHarness();
    const members = ['a', 'b', 'c'].map((name) => ({ replicaId: `r-${name}`, machineId: `app-${name}`,
      retiring: name === 'b', authorized: name !== 'b', connected: name !== 'b' }));
    const status = { configured: true, repoId: 'database', replicaId: 'r-a', roster: { rosterEpoch: 4 }, members,
      jobs: [{ id: 'retire', kind: 'retire', peerId: 'app-b', state: 'blocked', error: 'waiting for committed frontier' }],
      peers: [], enrolled: [], setup: null, lifecycleAvailable: true, introductionsAvailable: true };
    installTestPluginRuntime({ deepLinkBase: null, rpc: { groupStatus: async () => status } });
    harness.render(<PeerSettings />);
    await screen.findByText('Sync group: 3 of 8 computers');
    expect(screen.getByText('Waiting for committed frontier; data sync disabled')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
    expect(screen.getByText(/Unnamed computer: blocked: waiting for committed frontier/)).toBeTruthy();
    // Waiting is not stuck: no Reset offered.
    expect(screen.queryByRole('button', { name: /Reset sync/ })).toBeNull();
  });

  it('stuck work reads as a sentence (never a JSON dump) and Reset sync is confirmed, per computer, and keeps documents', async () => {
    const harness = createHarness();
    const zod = '[\n  {\n    "expected": "object",\n    "code": "invalid_type",\n    "path": [],\n    "message": "Invalid input: expected object, received null"\n  }\n]';
    const jobs = [
      { id: 'roster', kind: 'roster', peerId: 'app-y', state: 'blocked', attempts: 5, error: zod },
      { id: 'revoke', kind: 'local-revoke', peerId: 'app-x', state: 'blocked', attempts: 2, error: 'waiting for removal roster delivery before link revocation' },
      { id: 'other', kind: 'roster', peerId: 'app-z', state: 'blocked', attempts: 1, error: 'peer offline' },
    ];
    const status = { configured: false, repoId: 'database', replicaId: 'r-x', roster: null, members: [], jobs,
      setup: { peerId: 'app-y', repoId: 'database', state: 'pending', error: zod }, peers: [], enrolled: [{ id: 'app-y', name: 'Desk' }],
      lifecycleAvailable: true, introductionsAvailable: true, installerAvailable: false };
    const reset = vi.fn(async () => ({ discarded: 2, status: { ...status, jobs: [jobs[2]], setup: null } }));
    installTestPluginRuntime({ deepLinkBase: null, rpc: { groupStatus: async () => status, resetPeerSync: reset } });
    const priorConfirm = window.confirm;
    const confirm = vi.fn(() => false); window.confirm = confirm;
    try {
      harness.render(<PeerSettings />);
      const list = await screen.findByRole('list', { name: 'Pending work' });
      expect(document.body.textContent).not.toMatch(/invalid_type|"expected"|received null/);
      expect(within(list).getAllByRole('listitem').map((row) => row.textContent)).toEqual([
        'Desk: blocked: the other computer sent a reply this computer cannot read; make sure both run the same Design Docs version',
        'This computer: blocked: waiting for removal roster delivery before link revocation',
        'Unnamed computer: blocked: peer offline',
      ]);
      expect(screen.getByText(/Setup pending: Desk: the other computer sent a reply/)).toBeTruthy();
      // Only the computer whose work stopped making progress gets a Reset.
      expect(screen.getAllByRole('button', { name: /Reset sync/ }).map((button) => button.textContent)).toEqual(['Reset sync with Desk']);
      fireEvent.click(screen.getByRole('button', { name: 'Reset sync with Desk' }));
      expect(confirm).toHaveBeenCalledWith("Reset sync with Desk? This discards this computer's undelivered sync work for Desk only. Documents and their history are not deleted. Afterwards, use Repair on Desk.");
      expect(reset).not.toHaveBeenCalled();
      confirm.mockReturnValue(true);
      fireEvent.click(screen.getByRole('button', { name: 'Reset sync with Desk' }));
      await waitFor(() => expect(reset).toHaveBeenCalledExactlyOnceWith({ peerId: 'app-y' }));
      await waitFor(() => expect(screen.queryByRole('button', { name: /Reset sync/ })).toBeNull());
      expect(within(screen.getByRole('list', { name: 'Pending work' })).getAllByRole('listitem')).toHaveLength(1);
    } finally { window.confirm = priorConfirm; }
  });

  it('a failed job shows as stopped and a Reset failure is reported without dropping the view', async () => {
    const harness = createHarness();
    const status = { configured: false, repoId: 'database', replicaId: 'r-x', roster: null, members: [], setup: null, peers: [{ id: 'app-y', name: 'Studio', scope: 's', connected: true, grantEpoch: 1 }], enrolled: [],
      jobs: [{ id: 'roster', kind: 'roster', peerId: 'app-y', state: 'failed', attempts: 5, error: 'the other computer no longer keeps this sync group' }],
      lifecycleAvailable: true, introductionsAvailable: true, installerAvailable: false };
    const reset = vi.fn(async () => { throw new Error('Error: sync setup with this computer is in progress; try again in a moment'); });
    installTestPluginRuntime({ deepLinkBase: null, rpc: { groupStatus: async () => status, resetPeerSync: reset } });
    const priorConfirm = window.confirm; window.confirm = vi.fn(() => true);
    try {
      harness.render(<PeerSettings />);
      expect(await screen.findByText('Studio: stopped: the other computer no longer keeps this sync group')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Reset sync with Studio' }));
      expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'sync setup with this computer is in progress; try again in a moment');
      expect(screen.getByRole('button', { name: 'Reset sync with Studio' })).toHaveProperty('disabled', false);
    } finally { window.confirm = priorConfirm; }
  });

  it('leads with copy/paste pairing and never requires Settings or Machines', async () => {
    const harness = createHarness();
    installTestPluginRuntime({ deepLinkBase: null, rpc: { groupStatus: async () => ({ configured: false, repoId: 'database', replicaId: 'r-a', roster: null,
      members: [], jobs: [{ id: 'done', peerId: 'app-b', state: 'done', error: null }], setup: null, peers: [], enrolled: [],
      lifecycleAvailable: true, introductionsAvailable: true, installerAvailable: false }) } });
    harness.render(<PeerSettings />);
    const section = await screen.findByRole('region', { name: 'Database sync peers' });
    expect(section.hasAttribute('data-plugin-setting-key')).toBe(false);
    expect(screen.getByRole('heading', { name: 'Pair another computer' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add peer' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Join peer' })).toHaveProperty('disabled', true);
    await screen.findByText(/No sync group/);
    expect(section.textContent).not.toMatch(/Machines|Add a machine/);
    expect(screen.queryByRole('list', { name: 'Members' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Pending work' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Pairing' })).toBeNull();
    expect(screen.queryByText(/Database sync cannot start/)).toBeNull();
    expect(screen.queryByText(/Automatic introductions are unavailable/)).toBeNull();
  });

  it('explains missing introductions when lifecycle is ready; offline enrolled peers cannot be chosen', async () => {
    const harness = createHarness();
    installTestPluginRuntime({ deepLinkBase: null, rpc: { groupStatus: async () => ({ configured: false, repoId: 'database', replicaId: 'r-a', roster: null,
      members: [], jobs: [], setup: { peerId: 'app-b', repoId: 'database', state: 'joining', error: null }, peers: [],
      enrolled: [{ id: 'app-b', name: 'Desk', connected: false }], lifecycleAvailable: true, introductionsAvailable: false, installerAvailable: false }) } });
    harness.render(<PeerSettings />);
    await screen.findByText(/Automatic introductions are unavailable on this app/);
    expect(screen.getByRole('status').textContent).toBe('Setup joining: Desk');
    const option = screen.getByRole('option', { name: 'Desk - offline' }) as HTMLOptionElement;
    expect(option.disabled).toBe(true);
    expect(screen.queryByText(/No enrolled peer is online yet/)).toBeNull();
  });

  it('initial load failure shows the error and shows no lifecycle buttons', async () => {
    const harness = createHarness();
    const groupStatus = vi.fn(async () => { throw new Error('database group setup is unavailable'); });
    installTestPluginRuntime({ deepLinkBase: null, rpc: { groupStatus } });
    harness.render(<PeerSettings />);
    expect((await screen.findByRole('alert')).textContent).toBe('database group setup is unavailable');
    expect(screen.queryByText('Loading peers')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Enable Database Sync' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Refresh|Retry/ })).toBeNull();
  });

  it('cancelled retirement confirmation leaves membership untouched', async () => {
    const harness = createHarness();
    const members = ['a', 'b', 'c'].map((name) => ({ replicaId: `r-${name}`, machineId: `app-${name}`, authorized: true, connected: true }));
    const remove = vi.fn();
    installTestPluginRuntime({ deepLinkBase: null, rpc: { groupStatus: async () => ({ configured: true, repoId: 'database', replicaId: 'r-a', roster: { rosterEpoch: 2 },
      members, jobs: [], peers: [], enrolled: [], setup: null, lifecycleAvailable: true, introductionsAvailable: true }), removePeer: remove } });
    const priorConfirm = window.confirm; window.confirm = vi.fn(() => false);
    try {
      harness.render(<PeerSettings />);
      await screen.findByText('Sync group: 3 of 8 computers');
      fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]!);
      expect(window.confirm).toHaveBeenCalledOnce();
      expect(remove).not.toHaveBeenCalled();
    } finally { window.confirm = priorConfirm; }
  });

  it('typed API forwards invitation actions with identifiers and the pasted token only', async () => {
    const call = vi.fn(async () => ({})); const api = createApi(call);
    await api.inviteState(); await api.createInvitation(); await api.openInvitation(); await api.redeemInvitation('zccinv1.x'); await api.invitationApproval('i');
    await api.decideInvitation({ invitationId: 'i', decision: 'approved', ownerProof: 'p' }); await api.decideInvitation({ invitationId: 'i', decision: 'denied', ownerProof: undefined });
    await api.cancelInvitation('i'); await api.dismissInvitation('i'); await api.reconnectPeer('app'); await api.repairPeer('app'); await api.peersOutOfSync();
    expect(call.mock.calls).toEqual([['inviteState', undefined], ['createInvitation', undefined], ['openInvitation', undefined], ['redeemInvitation', { token: 'zccinv1.x' }],
      ['invitationApproval', { invitationId: 'i' }], ['decideInvitation', { invitationId: 'i', decision: 'approved', ownerProof: 'p' }],
      ['decideInvitation', { invitationId: 'i', decision: 'denied' }], ['cancelInvitation', { invitationId: 'i' }], ['dismissInvitation', { invitationId: 'i' }],
      ['reconnectPeer', { peerId: 'app' }], ['repairPeer', { peerId: 'app' }], ['peersOutOfSync', undefined]]);
  });
});

const EMPTY = { configured: false, repoId: 'database', replicaId: 'r-a', roster: null, members: [] as unknown[], jobs: [], setup: null, peers: [],
  enrolled: [] as Array<{ id: string; name: string; connected: boolean }>, lifecycleAvailable: true, introductionsAvailable: true, installerAvailable: false };
const item = (over: Partial<InviteItem> = {}): InviteItem => ({ invitationId: 'inv-1', role: 'inviter', state: 'open', reason: null, peer: null, localFingerprint: 'LOCAL-0001',
  myDecision: 'pending', theirDecision: 'pending', awaitingMyApproval: false, expiresAt: Date.now() + 600_000, consentExpiresAt: null, ...over });
const view = (over: Partial<InviteView> = {}): InviteView => ({ available: true, reason: null, invitations: [], links: [], enableError: null, ...over });
const peer = { instanceId: 'app-b', name: 'Laptop', fingerprint: 'ABCD-1234' };
const lnk = (over: Partial<PeerLink> = {}): PeerLink => ({ pairingId: 'pair-1', peerInstanceId: 'app-b', scope: 'database', role: 'inviter', phase: 'linked', state: 'connected', ...over });
function mount(rpc: Record<string, (args?: any) => unknown>, props: Parameters<typeof PeerSettings>[0] = {}) {
  const harness = createHarness();
  installTestPluginRuntime({ deepLinkBase: null, rpc: { groupStatus: async () => EMPTY, inviteState: async () => view(), ...rpc } });
  return harness.render(<PeerSettings {...props} />);
}

describe('invitation pairing UI', () => {
  it.each([
    ['ssh_remote_login_off', /Remote Login is turned off/, /System Settings > General > Sharing/],
    ['ssh_unreachable', /cannot be reached/, /same Wi-Fi or wired network/],
    ['ssh_auth_refused', /would not accept the connection/, /authorized_keys/],
    ['ssh_forwarding_refused', /does not allow the connection Zana needs/, /TCP forwarding/],
    ['ssh_host_key_mismatch', /not the one that made the invitation/, /new invitation/]
  ] as const)('Add peer failing with %s shows a guided setup card with steps', async (code, title, step) => {
    const harness = createHarness();
    installTestPluginRuntime({ deepLinkBase: null, rpc: { groupStatus: async () => EMPTY, inviteState: async () => view(),
      createInvitation: async () => { throw new Error(code); } } });
    harness.render(<PeerSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add peer' }));
    const alert = await screen.findByText(title);
    expect(alert.closest('[role="alert"]')?.textContent).toMatch(step);
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0);
  });

  it('tells owners both computers must be on the same network and where Remote Login lives', async () => {
    const harness = createHarness();
    installTestPluginRuntime({ deepLinkBase: null, rpc: { groupStatus: async () => EMPTY, inviteState: async () => view() } });
    harness.render(<PeerSettings />);
    expect(await screen.findByText(/Both computers must be on the same network/)).toBeTruthy();
    expect(screen.getByText(/System Settings > General > Sharing > Remote Login/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Zana Connect/);
  });

  it('Add peer copies a one-time invitation, shows time left and issues a replacement on demand', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const create = vi.fn().mockResolvedValueOnce({ invitationId: 'inv-1', token: 'zccinv1.first', expiresAt: Date.now() + 9 * 60_000 + 30_000 })
      .mockResolvedValueOnce({ invitationId: 'inv-2', token: 'zccinv1.second', expiresAt: Date.now() + 30_000 });
    const cancel = vi.fn(async () => undefined);
    let state = view();
    fakePolling();
    mount({ createInvitation: create, cancelInvitation: cancel, inviteState: async () => state });
    expect(await screen.findByText(/An invitation works once and must be pasted on the other computer within 10 minutes\./)).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Add peer' }));
    expect(await screen.findByText(/Expires in 9:30/)).toBeTruthy();
    expect((screen.getByLabelText('Invitation') as HTMLInputElement).value).toBe('zccinv1.first');
    expect(writeText).toHaveBeenCalledWith('zccinv1.first');
    await screen.findByRole('button', { name: 'Copy code' });
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(writeText).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'New invitation' }));
    await waitFor(() => expect((screen.getByLabelText('Invitation') as HTMLInputElement).value).toBe('zccinv1.second'));
    expect(cancel).toHaveBeenCalledExactlyOnceWith({ invitationId: 'inv-1' });
    expect(screen.getByText(/Expires in 0:\d\d/)).toBeTruthy();
    // Once the other computer redeems it, the token is gone from the screen.
    state = view({ invitations: [item({ invitationId: 'inv-2', state: 'reserved', peer })] });
    await pollOnce();
    await waitFor(() => expect(screen.queryByLabelText('Invitation')).toBeNull());
    expect(document.body.textContent).not.toContain('zccinv1');
  });

  it('shows an expired invitation without its token and lets the owner cancel one', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => undefined) }, configurable: true });
    const cancel = vi.fn(async () => undefined);
    mount({ createInvitation: async () => ({ invitationId: 'inv-1', token: 'zccinv1.old', expiresAt: Date.now() - 1 }), cancelInvitation: cancel });
    fireEvent.click(await screen.findByRole('button', { name: 'Add peer' }));
    expect(await screen.findByText(/Invitation expired\./)).toBeTruthy();
    expect(screen.queryByLabelText('Invitation')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy code' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel invitation' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'New invitation' })).toBeNull());
    expect(cancel).toHaveBeenCalledWith({ invitationId: 'inv-1' });
  });

  it('keeps the invitation visible with a manual-copy message when the clipboard is blocked, and reports exact create errors', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => { throw new Error('denied'); }) }, configurable: true });
    const create = vi.fn().mockResolvedValueOnce({ invitationId: 'inv-1', token: 'zccinv1.manual', expiresAt: Date.now() + 600_000 })
      .mockRejectedValueOnce(new Error('Could not create the invitation.'));
    mount({ createInvitation: create, cancelInvitation: async () => undefined });
    fireEvent.click(await screen.findByRole('button', { name: 'Add peer' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Copy failed/);
    expect((screen.getByLabelText('Invitation') as HTMLInputElement).value).toBe('zccinv1.manual');
    fireEvent.focus(screen.getByLabelText('Invitation'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    fireEvent.click(screen.getByRole('button', { name: 'New invitation' }));
    expect((await screen.findByText('Could not create the invitation.'))).toBeTruthy();
  });

  it('copies through the legacy path when the desktop denies navigator.clipboard', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => { throw new Error('denied'); }) }, configurable: true });
    const exec = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    mount({ createInvitation: async () => ({ invitationId: 'inv-1', token: 'zccinv1.legacy', expiresAt: Date.now() + 600_000 }) });
    fireEvent.click(await screen.findByRole('button', { name: 'Add peer' }));
    expect(await screen.findByRole('button', { name: 'Copy code' })).toBeTruthy();
    expect(exec).toHaveBeenCalledWith('copy');
    expect(screen.queryByText(/Copy failed/)).toBeNull();
    Object.defineProperty(document, 'execCommand', { value: undefined, configurable: true });
  });

  it('Join peer redeems the pasted invitation once and clears the field', async () => {
    const redeem = vi.fn().mockResolvedValueOnce(item({ role: 'redeemer', state: 'redeeming' })).mockRejectedValueOnce(new Error('This invitation was already used'));
    mount({ redeemInvitation: redeem });
    const field = await screen.findByLabelText('Paste invitation') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '  zccinv1.pasted  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join peer' }));
    await waitFor(() => expect(redeem).toHaveBeenCalledExactlyOnceWith({ token: 'zccinv1.pasted' }));
    await waitFor(() => expect(field.value).toBe(''));
    fireEvent.change(field, { target: { value: 'zccinv1.again' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join peer' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This invitation was already used');
    expect(field.value).toBe('zccinv1.again');
  });

  it('Dismiss uses the secondary button style and is disabled while busy', async () => {
    mount({ inviteState: async () => view({ invitations: [item({ state: 'denied', reason: 'denied', peer })] }) });
    const dismiss = await screen.findByRole('button', { name: 'Dismiss' });
    expect(dismiss.className).toBe('btn dd-btn-secondary');
  });

  it('Dismiss is disabled while a panel action is in flight and enabled again once it settles', async () => {
    let finish!: (value: InviteItem) => void;
    const redeem = vi.fn(() => new Promise<InviteItem>((resolve) => { finish = resolve; }));
    mount({ inviteState: async () => view({ invitations: [item({ state: 'denied', reason: 'denied', peer })] }), redeemInvitation: redeem });
    const dismiss = await screen.findByRole('button', { name: 'Dismiss' }) as HTMLButtonElement;
    expect(dismiss.disabled).toBe(false);
    fireEvent.change(await screen.findByLabelText('Paste invitation'), { target: { value: 'zccinv1.pending' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join peer' }));
    await waitFor(() => expect(redeem).toHaveBeenCalledOnce());
    expect((screen.getByRole('button', { name: 'Dismiss' }) as HTMLButtonElement).disabled).toBe(true);
    finish(item({ role: 'redeemer', state: 'redeeming' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Dismiss' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('keeps a still-open invitation when cancelling it fails, instead of issuing a second live token', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => undefined) }, configurable: true });
    const create = vi.fn(async () => ({ invitationId: 'inv-1', token: 'zccinv1.first', expiresAt: Date.now() + 600_000 }));
    const cancel = vi.fn(async () => { throw new Error('host busy'); });
    mount({ createInvitation: create, cancelInvitation: cancel });
    fireEvent.click(await screen.findByRole('button', { name: 'Add peer' }));
    await screen.findByRole('button', { name: 'New invitation' });
    fireEvent.click(screen.getByRole('button', { name: 'New invitation' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect((await screen.findByRole('alert')).textContent).toContain('Could not cancel the current invitation, so no new one was created: host busy');
    expect(create).toHaveBeenCalledOnce();
    expect((screen.getByLabelText('Invitation') as HTMLInputElement).value).toBe('zccinv1.first');
  });

  it('older hosts: only the new action is blocked, with the stable reason; an existing group still renders and syncs', async () => {
    const members = ['a', 'b'].map((name) => ({ replicaId: `r-${name}`, machineId: `app-${name}`, authorized: true, connected: true }));
    mount({ inviteState: async () => view({ available: false, reason: 'host cannot invite peers' }),
      groupStatus: async () => ({ ...EMPTY, configured: true, roster: { rosterEpoch: 1 }, members }) });
    expect(await screen.findByText(/Host cannot invite peers\. Your existing sync group keeps working/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add peer' })).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('Paste invitation')).toHaveProperty('disabled', true);
    expect(await screen.findByText('Sync group: 2 of 8 computers')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
  });

  it('inviteState failure leaves pairing actions usable and shows no invitation list', async () => {
    mount({ inviteState: async () => { throw new Error('rpc down'); } });
    await screen.findByText(/No sync group/);
    expect(screen.getByRole('button', { name: 'Add peer' })).toHaveProperty('disabled', false);
    expect(screen.queryByRole('list', { name: 'Pairing' })).toBeNull();
  });

  it.each([
    ['open', {}, /Pending: waiting for the other computer/, true],
    ['redeeming', {}, /Pending: contacting the other computer/, true],
    ['consented', { peer }, /Approved\. Connecting to Laptop/, false],
    ['connecting', { peer }, /Approved\. Connecting to Laptop/, false],
    ['ready', { peer }, /Ready: paired with Laptop/, false]
  ] as const)('shows %s as a pending/ready step', async (state, extra, text, cancellable) => {
    mount({ inviteState: async () => view({ invitations: [item({ state, ...extra })] }) });
    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel' }) !== null).toBe(cancellable);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it.each([
    ['denied', 'denied', /Pairing was declined/],
    ['cancelled', null, /Pairing was cancelled/],
    ['expired', null, /expired\. Start a new invitation/],
    ['failed', 'ssh_remote_login_off', /Remote Login is turned off/],
    ['failed', 'ssh_host_key_mismatch', /not the one that made the invitation/],
    ['failed', 'own_invitation', /created on this computer/],
    ['failed', 'unreachable', /^The other computer is not reachable yet; retrying\. Keep both computers open and online\.$/],
    ['failed', 'unavailable', /^Pairing is unavailable right now\. Check that both computers/],
    ['failed', null, /^Pairing failed\. Start a new invitation\.$/],
    ['expired', 'expired', /expired\. Start a new invitation/],
    ['failed', 'identity_mismatch', /did not prove the identity/]
  ] as const)('blocks %s/%s with the exact reason and lets the owner dismiss it', async (state, reason, text) => {
    mount({ inviteState: async () => view({ invitations: [item({ state, reason: reason as InviteItem['reason'] })] }) });
    expect((await screen.findByRole('alert')).textContent).toMatch(text);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Pairing' })).toBeNull());
  });

  it.each(['unavailable', 'unreachable'])('%s never claims an account mismatch', async (reason) => {
    mount({ inviteState: async () => view({ invitations: [item({ state: 'failed', reason: reason as InviteItem['reason'] })] }) });
    expect((await screen.findByRole('alert')).textContent).not.toMatch(/same Zana Connect account/);
  });

  it('unknown reasons fall back to a generic blocked message', async () => {
    mount({ inviteState: async () => view({ invitations: [item({ state: 'blocked' as never, reason: 'zzz' as never })] }) });
    expect((await screen.findByRole('alert')).textContent).toBe('Pairing could not continue.');
  });

  it.each([
    ['expired', null], ['expired', 'expired'], ['failed', 'attempt_limit'], ['failed', 'already_redeemed']
  ] as const)('offers a one-click new invitation for %s/%s', async (state, reason) => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => undefined) }, configurable: true });
    const create = vi.fn(async () => ({ invitationId: 'inv-2', token: 'zccinv1.fresh', expiresAt: Date.now() + 600_000 }));
    mount({ inviteState: async () => view({ invitations: [item({ role: 'redeemer', state, reason: reason as InviteItem['reason'] })] }), createInvitation: create });
    expect((await screen.findByRole('alert')).textContent).toMatch(/Start a new invitation/);
    fireEvent.click(screen.getByRole('button', { name: 'Start new invitation' }));
    await waitFor(() => expect((screen.getByLabelText('Invitation') as HTMLInputElement).value).toBe('zccinv1.fresh'));
    expect(create).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Start new invitation' })).toBeNull();
  });

  it.each([['denied', 'denied'], ['cancelled', null], ['failed', 'ssh_remote_login_off'], ['failed', 'unreachable']] as const)('does not offer renewal for %s/%s', async (state, reason) => {
    mount({ inviteState: async () => view({ invitations: [item({ state, reason: reason as InviteItem['reason'] })] }) });
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'Start new invitation' })).toBeNull();
  });

  it('disables renewal when the host cannot invite', async () => {
    mount({ inviteState: async () => view({ available: false, reason: 'host cannot invite peers', invitations: [item({ state: 'expired' })] }) });
    expect(await screen.findByRole('button', { name: 'Start new invitation' })).toHaveProperty('disabled', true);
  });

  it('shows the consent deadline as approve by HH:MM on a reserved pairing', async () => {
    const at = new Date(2026, 9, 14, 9, 5).getTime();
    mount({ inviteState: async () => view({ invitations: [item({ state: 'reserved', peer, awaitingMyApproval: true, consentExpiresAt: at })] }) });
    expect(await screen.findByText(/Approve by 09:05\./)).toBeTruthy();
  });

  it('backs invitation polling off from 5 s to 30 s while every live pairing waits on an owner', async () => {
    fakePolling();
    const spy = vi.spyOn(globalThis, 'setInterval');
    const polls = () => spy.mock.calls.map((call) => call[1]).filter((ms) => ms === INVITE_POLL_MS || ms === INVITE_WAITING_POLL_MS);
    let next = view({ invitations: [item({ state: 'redeeming' })] });
    try {
      mount({ inviteState: async () => next });
      await screen.findByText(/Pending: contacting the other computer/);
      expect(polls()).toEqual([INVITE_POLL_MS]);
      next = view({ invitations: [item({ state: 'reserved', peer }), item({ invitationId: 'inv-0', state: 'expired' })] });
      await pollOnce();
      await screen.findByText(/Awaiting the other owner's approval/);
      await waitFor(() => expect(polls().at(-1)).toBe(INVITE_WAITING_POLL_MS));
      next = view({ invitations: [item({ state: 'consented', peer })] });
      await pollOnce();
      await screen.findByText(/Approved\. Connecting/);
      await waitFor(() => expect(polls().at(-1)).toBe(INVITE_POLL_MS));
    } finally { spy.mockRestore(); }
  });

  it('asks the owner to confirm the fingerprint and approve database sync only; the other side waits', async () => {
    const { rerender } = { rerender: null };
    void rerender;
    let next = view({ invitations: [item({ state: 'reserved', peer, awaitingMyApproval: true })] });
    fakePolling();
    mount({ inviteState: async () => next });
    expect(await screen.findByText(/Approve pairing with Laptop/)).toBeTruthy();
    expect(screen.getByText('ABCD-1234')).toBeTruthy();
    expect(screen.getByText(/Confirm this matches the other machine's screen/)).toBeTruthy();
    expect(screen.getByText(/Design Docs database sync with this peer only/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
    next = view({ invitations: [item({ state: 'reserved', peer, myDecision: 'approved' })] });
    await pollOnce();
    expect(await screen.findByText(/Awaiting the other owner's approval for Laptop/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.getByText('ABCD-1234')).toBeTruthy();
  });

  it('Approve opens the core approval sheet and sends only its owner proof; Deny needs none; Cancel needs none', async () => {
    const sheet = { binding: { action: 'x', target: 't', targetLabel: 'l', subject: 's' }, title: 'Pair with Laptop' };
    const decide = vi.fn(async () => item({ state: 'consented' })), cancel = vi.fn(async () => undefined);
    const requestApproval = vi.fn(async () => ({ approved: true as const, token: 'owner-proof', expiresAt: 1 }));
    mount({ inviteState: async () => view({ invitations: [item({ state: 'reserved', peer, awaitingMyApproval: true })] }), invitationApproval: async () => sheet,
      decideInvitation: decide, cancelInvitation: cancel }, { requestApproval });
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(decide).toHaveBeenCalledExactlyOnceWith({ invitationId: 'inv-1', decision: 'approved', ownerProof: 'owner-proof' }));
    expect(requestApproval).toHaveBeenCalledExactlyOnceWith('design-docs', sheet);
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(decide).toHaveBeenLastCalledWith({ invitationId: 'inv-1', decision: 'denied' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledExactlyOnceWith({ invitationId: 'inv-1' }));
  });

  it.each([
    ['cancelled', null],
    ['unavailable', 'Approval needs the Zana desktop app on this computer.'],
    ['busy', 'Another approval is already open on this window.'],
    ['invalid', 'The approval could not be shown. Refresh and try again.']
  ] as const)('an approval sheet that ends %s never decides', async (reason, message) => {
    const decide = vi.fn();
    mount({ inviteState: async () => view({ invitations: [item({ state: 'reserved', peer, awaitingMyApproval: true })] }),
      invitationApproval: async () => ({ binding: { action: 'x', target: 't', targetLabel: 'l', subject: 's' }, title: 't' }), decideInvitation: decide },
      { requestApproval: async () => ({ approved: false, reason }) });
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    if (message) expect((await screen.findByRole('alert')).textContent).toBe(message);
    else await waitFor(() => expect(screen.getByRole('button', { name: 'Approve' })).toHaveProperty('disabled', false));
    expect(decide).not.toHaveBeenCalled();
    if (!message) expect(screen.queryByRole('alert')).toBeNull();
  });

  it('without a host that can draw the sheet, Approve fails closed', async () => {
    const decide = vi.fn();
    mount({ inviteState: async () => view({ invitations: [item({ state: 'reserved', peer, awaitingMyApproval: true })] }),
      invitationApproval: async () => ({ binding: { action: 'x', target: 't', targetLabel: 'l', subject: 's' }, title: 't' }), decideInvitation: decide });
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/desktop app/);
    expect(decide).not.toHaveBeenCalled();
  });

  it('shows one card per computer: name, one status line with the exact reason, and Reconnect only where it can work', async () => {
    const reconnect = vi.fn(async () => [lnk({ state: 'reconnecting' })]);
    const links = [lnk({ peerName: 'Laptop' }), lnk({ pairingId: 'p2', peerInstanceId: 'app-c', peerName: 'Desk', state: 'reconnecting', reason: 'peer-offline' }),
      lnk({ pairingId: 'p3', peerInstanceId: 'app-d', peerName: 'Studio', state: 'disconnected', reason: 'credential-expired' }),
      lnk({ pairingId: 'p4', peerInstanceId: 'app-e', peerName: 'Mini', state: 'disconnected', reason: 'ssh-down' }),
      lnk({ pairingId: 'p5', peerInstanceId: 'app-f', peerName: 'Old', state: 'disconnected', reason: 'revoked' }),
      lnk({ pairingId: 'p6', peerInstanceId: 'app-g', peerName: 'Tower', state: 'disconnected' }),
      lnk({ pairingId: 'p10', peerInstanceId: 'app-j', peerName: 'Pad', state: 'disconnected', reason: 'paused' }),
      lnk({ pairingId: 'p7', peerInstanceId: 'app-h', phase: 'removed', state: 'disconnected' }),
      // A declined or replayed attempt never linked: not shown, and it never shadows the live link to the same peer.
      lnk({ pairingId: 'p8', peerInstanceId: 'app-i', phase: 'failed', state: 'disconnected', reason: 'peer-offline' }),
      lnk({ pairingId: 'p9', peerInstanceId: 'app-b', phase: 'failed', state: 'disconnected', reason: 'peer-offline' })];
    mount({ inviteState: async () => view({ links }), reconnectPeer: reconnect });
    const list = await screen.findByRole('list', { name: 'Computers' });
    const rows = within(list).getAllByRole('listitem').map((row) => row.textContent);
    expect(rows).toEqual([
      'LaptopConnected, sync not set upRepairRemoveThe connection works but database sync is not set up with this computer. Repair retries setup.', 'DeskReconnectingReconnectRemoveThe other computer is offline',
      'StudioDisconnectedReconnectRemoveThe link credential expired. Sync resumes when the link is back.',
      'MiniDisconnectedReconnectRemoveThe secure connection to the other computer is down. Sync resumes when the link is back.',
      'OldDisconnectedRemoveThe link was revoked. Add peer to pair again.', 'TowerDisconnectedReconnectRemoveSync resumes when the link is back.',
      'PadPausedRemoveDisconnected on this computer. Reconnect from Settings → Peers.']);
    // The red banner is gone: the status line carries the state.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(list.textContent).not.toMatch(/app-[a-j]/);
    fireEvent.click(within(list).getAllByRole('button', { name: 'Reconnect' })[1]!);
    await waitFor(() => expect(reconnect).toHaveBeenCalledExactlyOnceWith({ peerId: 'app-d' }));
  });

  it('Repair on a linked computer outside the sync group retries setup and reports success', async () => {
    const repair = vi.fn(async () => ({ outcome: 'sync-enabled', detail: null, reason: null }));
    mount({ inviteState: async () => view({ links: [lnk({ peerName: 'Laptop' })] }), repairPeer: repair });
    expect(await screen.findByText('Connected, sync not set up')).toBeTruthy();
    expect(screen.queryByText('Connected')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Repair' }));
    await waitFor(() => expect(repair).toHaveBeenCalledExactlyOnceWith({ peerId: 'app-b' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Repair' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('repair-note').textContent).toBe('Sync set up');
  });

  it('Repair that cannot finish shows the real cause and next step; a thrown error is shown too', async () => {
    const repair = vi.fn()
      .mockResolvedValueOnce({ outcome: 'unavailable', detail: null, reason: 'keychain-denied' })
      .mockResolvedValueOnce({ outcome: 'unavailable', detail: 'mutually enrolled peer unavailable', reason: null })
      .mockRejectedValueOnce(new Error('no linked connection to that computer'));
    mount({ inviteState: async () => view({ links: [lnk()] }), repairPeer: repair });
    const click = async () => { fireEvent.click(await screen.findByRole('button', { name: 'Repair' })); };
    await click();
    expect((await screen.findByRole('alert')).textContent).toMatch(/Repair could not finish: .*Allow Zana access to the keychain/);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Repair' }) as HTMLButtonElement).disabled).toBe(false));
    await click();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/mutually enrolled peer unavailable.*Next step: use Reconnect/));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Repair' }) as HTMLButtonElement).disabled).toBe(false));
    await click();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/no linked connection/));
  });

  it('a Repair cause that already names its next step is not given a second, contradicting one', async () => {
    const detail = 'The connection was re-linked, but the other computer has not reconnected on the new link yet. Keep Zana open on both computers, wait a few seconds, then press Repair again. If it keeps failing, remove this computer and add the peer again.';
    mount({ inviteState: async () => view({ links: [lnk()] }), repairPeer: vi.fn(async () => ({ outcome: 'unavailable', detail, reason: null })) });
    fireEvent.click(await screen.findByRole('button', { name: 'Repair' }));
    expect((await screen.findByRole('alert')).textContent).toBe(`Repair could not finish: ${detail}`);
  });

  it('Repair that leaves sync pending shows the concrete state instead of success; unenrolled link says to pair again', async () => {
    const repair = vi.fn()
      .mockResolvedValueOnce({ outcome: 'pending', detail: 'Sync setup started but has not finished: keychain locked', reason: null })
      .mockResolvedValueOnce({ outcome: 'unavailable', detail: 'never fully enrolled. Remove it, then use Add peer to pair again.', reason: null });
    mount({ inviteState: async () => view({ links: [lnk()] }), repairPeer: repair });
    fireEvent.click(await screen.findByRole('button', { name: 'Repair' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/not set up yet\. Sync setup started but has not finished: keychain locked/);
    expect(screen.getByTestId('repair-note').textContent).toMatch(/keychain locked/);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Repair' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Repair' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Add peer to pair again\.$/));
  });

  it('lifecycle failure explains the real cause on the card and in the hint; a group member keeps Connected', async () => {
    const reasons = ['keychain-denied', 'encryption-unavailable', 'insecure-backend', 'storage-permissions', 'key-missing', 'key-corrupt', 'core-unsupported', null] as const;
    for (const reason of reasons) {
      expect(lifecycleText(reason)).toMatch(/\w/);
    }
    expect(new Set(reasons.map((reason) => lifecycleText(reason))).size).toBe(reasons.length);
    mount({ inviteState: async () => view({ links: [lnk()] }), groupStatus: async () => ({ ...EMPTY, lifecycleAvailable: false, lifecycleReason: 'storage-permissions' }) });
    const card = await screen.findByRole('listitem');
    expect(within(card).getByText('Connected, sync not set up')).toBeTruthy();
    expect(within(card).getByText(/private to your user/)).toBeTruthy();
    cleanup();
    const members = [{ replicaId: 'r-a', machineId: 'app-a', joinedAt: 1, sponsorReplicaId: null, retiring: false, connected: true, authorized: true, grantEpoch: null },
      { replicaId: 'r-b', machineId: 'app-b', joinedAt: 2, sponsorReplicaId: 'r-a', retiring: false, connected: true, authorized: true, grantEpoch: 1 }];
    mount({ inviteState: async () => view({ links: [lnk()] }), groupStatus: async () => ({ ...EMPTY, configured: true, roster: { rosterEpoch: 1 }, members }) });
    expect(await screen.findByText('Connected')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Repair' })).toBeNull();
  });

  it('a connected link to a rostered computer without a database grant is not shown as synced (same rule as Repair)', async () => {
    const members = [{ replicaId: 'r-a', machineId: 'app-a', joinedAt: 1, sponsorReplicaId: null, retiring: false, connected: true, authorized: true, grantEpoch: null },
      { replicaId: 'r-b', machineId: 'app-b', joinedAt: 2, sponsorReplicaId: 'r-a', retiring: false, connected: true, authorized: false, grantEpoch: null }];
    mount({ inviteState: async () => view({ links: [lnk()] }), groupStatus: async () => ({ ...EMPTY, replicaId: 'r-a', configured: true, roster: { rosterEpoch: 1 }, members }) });
    const card = await screen.findByRole('listitem');
    expect(within(card).getByText('Connected, sync not set up')).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Repair' })).toBeTruthy();
  });

  it('name falls back from the link to the enrolled name, the invitation and finally Unnamed computer; an id is never a label', async () => {
    const links = [lnk({ peerName: 'From link' }), lnk({ pairingId: 'p2', peerInstanceId: 'app-c' }), lnk({ pairingId: 'p3', peerInstanceId: 'app-d' }),
      lnk({ pairingId: 'p4', peerInstanceId: '3f32cd8a-1111-4222-8333-444455556666' })];
    mount({ inviteState: async () => view({ links, invitations: [item({ invitationId: 'i2', state: 'ready', peer: { instanceId: 'app-d', name: 'From invite', fingerprint: 'F' } })] }),
      groupStatus: async () => ({ ...EMPTY, enrolled: [{ id: 'app-c', name: 'Enrolled', connected: true }, { id: 'app-b', name: 'Shadowed', connected: true }] }) });
    const list = await screen.findByRole('list', { name: 'Computers' });
    expect(within(list).getAllByRole('listitem').map((row) => row.querySelector('strong')?.textContent)).toEqual(['From link', 'Enrolled', 'From invite', 'Unnamed computer']);
    expect(list.textContent).not.toContain('3f32cd8a');
    expect(within(list).getAllByText('Unnamed computer')[0]!.getAttribute('title')).toBe('Computer id 3f32cd8a-1111-4222-8333-444455556666');
  });

  it('joins a link and its group member on the instance id into a single card with the link name and status', async () => {
    const members = ['a', 'b'].map((name) => ({ replicaId: `r-${name}`, machineId: `app-${name}`, authorized: true, connected: false }));
    mount({ inviteState: async () => view({ links: [lnk({ peerName: 'Laptop', state: 'disconnected', reason: 'peer-offline' })] }),
      groupStatus: async () => ({ ...EMPTY, configured: true, roster: { rosterEpoch: 1 }, members }) });
    const list = await screen.findByRole('list', { name: 'Computers' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual(['LaptopDisconnectedReconnectRemoveThe other computer is offline. Sync resumes when the link is back.']);
    expect(document.body.textContent).not.toMatch(/Unnamed computer|Members|Disable Link/);
  });

  it('a legacy enrolled member without a link keeps a card with its enrolled name, and Remove clears the roster entry', async () => {
    const members = ['a', 'b'].map((name) => ({ replicaId: `r-${name}`, machineId: `app-${name}`, authorized: true, connected: name === 'a' }));
    const remove = vi.fn(async () => ({ ...EMPTY, configured: false }));
    mount({ groupStatus: async () => ({ ...EMPTY, configured: true, roster: { rosterEpoch: 1 }, members, enrolled: [{ id: 'app-b', name: 'Desk', connected: false }] }), removePeer: remove });
    const row = (await screen.findByText('Desk')).closest('li')!;
    expect(row.textContent).toBe('DeskOfflineRemove');
    expect(within(row).queryByRole('button', { name: 'Reconnect' })).toBeNull();
    const priorConfirm = window.confirm; window.confirm = vi.fn(() => true);
    try {
      fireEvent.click(within(row).getByRole('button', { name: 'Remove' }));
      await waitFor(() => expect(remove).toHaveBeenCalledExactlyOnceWith({ replicaId: 'r-b' }));
    } finally { window.confirm = priorConfirm; }
  });

  it('a rostered computer with no live link and no grant keeps a Remove card instead of a dead tombstone', async () => {
    const members = ['a', 'b'].map((name) => ({ replicaId: `r-${name}`, machineId: `app-${name}`, authorized: name === 'a', connected: false }));
    mount({ groupStatus: async () => ({ ...EMPTY, configured: true, roster: { rosterEpoch: 1 }, members }) });
    const row = (await screen.findByText('Unnamed computer')).closest('li')!;
    expect(within(row).getByRole('button', { name: 'Remove' })).toBeTruthy();
  });

  it('a leftover roster after leaving the group shows no computers and no group line', async () => {
    const members = ['a', 'b'].map((name) => ({ replicaId: `r-${name}`, machineId: `app-${name}`, authorized: false, connected: false }));
    mount({ groupStatus: async () => ({ ...EMPTY, configured: false, replicaId: 'r-a', roster: { rosterEpoch: 2 }, members }) });
    await screen.findByText(/No sync group/);
    expect(screen.queryByText('Unnamed computer')).toBeNull();
  });

  it('a computer card shows a bordered badge row, a danger Remove and a labelled group summary instead of a bare This computer line', async () => {
    const members = ['a', 'b', 'c'].map((name) => ({ replicaId: `r-${name}`, machineId: `app-${name}`, authorized: true, connected: true }));
    mount({ groupStatus: async () => ({ ...EMPTY, configured: true, replicaId: 'r-a', roster: { rosterEpoch: 1 }, members }) });
    const cards = await screen.findAllByRole('listitem');
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card.className).toContain('dd-peers-card');
      expect(within(card).getByRole('status').getAttribute('data-state')).toBe('connected');
      expect(within(card).getByRole('button', { name: 'Remove' }).className).toContain('dd-btn-remove');
    }
    expect(screen.queryByText('This computer')).toBeNull();
    const summary = screen.getByText('Sync group: 3 of 8 computers').parentElement!;
    expect(summary.textContent).toContain('includes this computer');
    expect(within(summary).getByRole('button', { name: 'Leave Group' })).toBeTruthy();
  });

  it('an open invitation has one Cancel invitation and no duplicate Cancel in the pending row', async () => {
    mount({ createInvitation: async () => ({ invitationId: 'inv-1', token: 'zccinv1.t', expiresAt: Date.now() + 600_000 }),
      inviteState: async () => view({ invitations: [item({ invitationId: 'inv-1', state: 'open' })] }) });
    fireEvent.click(await screen.findByRole('button', { name: 'Add peer' }));
    await screen.findByRole('button', { name: 'Cancel invitation' });
    expect(screen.getByText(/Pending: waiting for the other computer/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('a failed Remove reports the error and keeps the card', async () => {
    const priorConfirm = window.confirm; window.confirm = vi.fn(() => true);
    try {
      mount({ inviteState: async () => view({ links: [lnk({ peerName: 'Laptop' })] }), revokePeer: async () => { throw new Error('database revocation already running'); } });
      fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
      expect((await screen.findByRole('alert')).textContent).toBe('database revocation already running');
      expect(screen.getByText('Laptop')).toBeTruthy();
    } finally { window.confirm = priorConfirm; }
  });

  it('disables Remove while core peer lifecycle is unavailable', async () => {
    const members = ['a', 'b'].map((name) => ({ replicaId: `r-${name}`, machineId: `app-${name}`, authorized: true, connected: true }));
    mount({ groupStatus: async () => ({ ...EMPTY, configured: true, roster: { rosterEpoch: 1 }, members, lifecycleAvailable: false }) });
    expect(await screen.findByRole('button', { name: 'Remove' })).toHaveProperty('disabled', true);
  });

  it('a finished pairing clears itself once its link exists; failed, denied and expired rows keep Dismiss', async () => {
    mount({ inviteState: async () => view({ links: [lnk({ peerName: 'Laptop' })], invitations: [item({ state: 'ready', peer })] }) });
    await screen.findByRole('list', { name: 'Computers' });
    expect(screen.queryByRole('list', { name: 'Pairing' })).toBeNull();
    expect(screen.queryByText(/Ready: paired with/)).toBeNull();
    cleanup();
    // A removed link also stays cleared; only a ready pairing with no link at all remains, so it cannot get stuck.
    mount({ inviteState: async () => view({ links: [lnk({ phase: 'removed', state: 'disconnected', reason: 'revoked' })], invitations: [item({ state: 'ready', peer })] }) });
    await screen.findByText(/No sync group/);
    expect(screen.queryByText(/Ready: paired with/)).toBeNull();
    cleanup();
    mount({ inviteState: async () => view({ invitations: [item({ state: 'ready', peer })] }) });
    expect(await screen.findByText(/Ready: paired with Laptop/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
    cleanup();
    mount({ inviteState: async () => view({ invitations: [item({ state: 'denied', reason: 'denied', peer })] }) });
    expect(await screen.findByText(/Pairing was declined/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
    cleanup();
    // A stale terminal attempt next to a live linked connection to the same computer is history and is hidden.
    for (const state of ['denied', 'cancelled', 'expired', 'failed'] as const) {
      mount({ inviteState: async () => view({ links: [lnk()], invitations: [item({ state, reason: state === 'denied' ? 'denied' : null, peer })] }) });
      await screen.findByText(/No sync group/);
      expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
      expect(screen.queryByRole('list', { name: 'Pairing' })).toBeNull();
      cleanup();
    }
    // A terminal attempt with no peer attached is history too once any live linked connection exists.
    mount({ inviteState: async () => view({ links: [lnk()], invitations: [item({ state: 'cancelled', peer: null })] }) });
    await screen.findByText(/No sync group/);
    expect(screen.queryByText(/Pairing was cancelled/)).toBeNull();
    cleanup();
    // Without a live link it stays, and Dismiss is persisted on the server.
    const dismiss = vi.fn(async () => undefined);
    mount({ inviteState: async () => view({ invitations: [item({ state: 'cancelled', peer: null })] }), dismissInvitation: dismiss });
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(dismiss).toHaveBeenCalledOnce());
    expect(screen.queryByText(/Pairing was cancelled/)).toBeNull();
    cleanup();
    // A failed link does not count as live, so its attempt keeps Dismiss.
    mount({ inviteState: async () => view({ links: [lnk({ phase: 'failed', state: 'disconnected' })], invitations: [item({ state: 'failed', peer })] }) });
    expect(await screen.findByRole('button', { name: 'Dismiss' })).toBeTruthy();
  });

  it('reports a failed reconnect', async () => {
    mount({ inviteState: async () => view({ links: [lnk({ state: 'disconnected', reason: 'peer-offline' })] }), reconnectPeer: async () => { throw new Error('Pairing is not ready for that action'); } });
    fireEvent.click(await screen.findByRole('button', { name: 'Reconnect' }));
    await waitFor(() => expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toContain('Pairing is not ready for that action'));
  });

  it('Enable Database Sync is only for peers enrolled without an invitation; invited peers enable themselves', async () => {
    const enrolled = [{ id: 'app-b', name: 'Laptop', connected: true }, { id: 'app-legacy', name: 'Desk', connected: true }];
    const enable = vi.fn(async () => EMPTY);
    mount({ inviteState: async () => view({ links: [lnk()] }), groupStatus: async () => ({ ...EMPTY, enrolled }), enablePeer: enable });
    const select = await screen.findByLabelText('Enrolled peer');
    expect(within(select).queryByRole('option', { name: 'Laptop' })).toBeNull();
    expect(within(select).getByRole('option', { name: 'Desk' })).toBeTruthy();
    fireEvent.change(select, { target: { value: 'app-legacy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enable Database Sync' }));
    await waitFor(() => expect(enable).toHaveBeenCalledExactlyOnceWith({ peerId: 'app-legacy' }));
  });

  it('with only invitation-founded peers there is no Enable button', async () => {
    mount({ inviteState: async () => view({ links: [lnk()] }), groupStatus: async () => ({ ...EMPTY, enrolled: [{ id: 'app-b', name: 'Laptop', connected: true }] }) });
    await screen.findByText(/No sync group/);
    expect(screen.queryByRole('button', { name: 'Enable Database Sync' })).toBeNull();
    expect(screen.queryByLabelText('Enrolled peer')).toBeNull();
  });

  it('surfaces an automatic enable failure', async () => {
    mount({ inviteState: async () => view({ enableError: 'mutually enrolled peer unavailable' }) });
    expect((await screen.findByRole('alert')).textContent).toBe('mutually enrolled peer unavailable');
  });

  describe('out of sync notice', () => {
    const configured = { ...EMPTY, configured: true, roster: { rosterEpoch: 1 }, members: ['a', 'b'].map((name) => ({ replicaId: `r-${name}`, machineId: `app-${name}`, authorized: true, connected: true })) };

    it('says only that the sides differ; Sync Now is explicit and then hides the notice', async () => {
      let differs = true;
      const sync = vi.fn(async () => { differs = false; return { attempted: 1, synced: 1, blocked: 0 }; });
      const harness = mountWith({ groupStatus: async () => configured, peersOutOfSync: async () => ({ outOfSync: differs }), syncNow: sync });
      const notice = await screen.findByText('This database and a paired peer are out of sync.');
      expect(notice.parentElement!.textContent).toBe('This database and a paired peer are out of sync.Sync NowCancel');
      expect(sync).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Sync Now' }));
      await waitFor(() => expect(screen.queryByText(/out of sync/)).toBeNull());
      expect(sync).toHaveBeenCalledOnce();
      expect(harness.toasts.at(-1)?.message).toBe('Synced 1 peers');
    });

    it('Sync Now re-checks and keeps the notice while the sides still differ', async () => {
      const check = vi.fn(async () => ({ outOfSync: true }));
      mountWith({ groupStatus: async () => configured, peersOutOfSync: check, syncNow: async () => ({ attempted: 1, synced: 1, blocked: 0 }) });
      await screen.findByText(/out of sync/);
      const before = check.mock.calls.length;
      fireEvent.click(screen.getByRole('button', { name: 'Sync Now' }));
      await waitFor(() => expect(check.mock.calls.length).toBeGreaterThan(before));
      expect(screen.getByText(/out of sync/)).toBeTruthy();
    });

    it('a peer state push re-checks at once and clears the notice on the receiving side', async () => {
      let differs = true;
      const check = vi.fn(async () => ({ outOfSync: differs }));
      const runtime = mountWith({ groupStatus: async () => configured, peersOutOfSync: check });
      await screen.findByText(/out of sync/);
      differs = false;
      await runtime.emitRealtime('peer-state', {});
      await waitFor(() => expect(screen.queryByText(/out of sync/)).toBeNull());
    });

    it('ignores a peer state push before a group exists', async () => {
      const check = vi.fn(async () => ({ outOfSync: true }));
      const runtime = mountWith({ peersOutOfSync: check });
      await screen.findByText(/No sync group/);
      await runtime.emitRealtime('peer-state', {});
      expect(check).not.toHaveBeenCalled();
    });

    it('Cancel hides the notice until the sides converge; later drift shows it again', async () => {
      let differs = true;
      const runtime = mountWith({ groupStatus: async () => configured, peersOutOfSync: async () => ({ outOfSync: differs }) });
      fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
      await runtime.emitRealtime('peer-state', {});
      expect(screen.queryByText(/out of sync/)).toBeNull();
      differs = false;
      await runtime.emitRealtime('peer-state', {});
      differs = true;
      await runtime.emitRealtime('peer-state', {});
      await screen.findByText(/out of sync/);
    });

    it('Cancel leaves documents untouched and keeps the notice away', async () => {
      const sync = vi.fn();
      mountWith({ groupStatus: async () => configured, peersOutOfSync: async () => ({ outOfSync: true }), syncNow: sync });
      fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByText(/out of sync/)).toBeNull());
      expect(sync).not.toHaveBeenCalled();
    });

    it('a failed Sync Now keeps the notice and shows the error', async () => {
      mountWith({ groupStatus: async () => configured, peersOutOfSync: async () => ({ outOfSync: true }), syncNow: async () => { throw new Error('peer unavailable'); } });
      fireEvent.click(await screen.findByRole('button', { name: 'Sync Now' }));
      expect((await screen.findByRole('alert')).textContent).toBe('peer unavailable');
      expect(screen.getByText(/out of sync/)).toBeTruthy();
    });

    it('reports a partially blocked sync and never checks before a group exists', async () => {
      const check = vi.fn(async () => ({ outOfSync: false }));
      const harness = mountWith({ groupStatus: async () => configured, peersOutOfSync: async () => ({ outOfSync: true }), syncNow: async () => ({ attempted: 2, synced: 1, blocked: 1 }) });
      fireEvent.click(await screen.findByRole('button', { name: 'Sync Now' }));
      await waitFor(() => expect(harness.toasts.at(-1)?.message).toBe('Synced 1/2; 1 blocked'));
      cleanup();
      mountWith({ peersOutOfSync: check });
      await screen.findByText(/No sync group/);
      expect(check).not.toHaveBeenCalled();
    });

    it('stays quiet when in sync or when the check fails', async () => {
      mountWith({ groupStatus: async () => configured, peersOutOfSync: async () => ({ outOfSync: false }) });
      await screen.findByText('Sync group: 2 of 8 computers');
      expect(screen.queryByText(/out of sync/)).toBeNull();
      cleanup();
      mountWith({ groupStatus: async () => configured, peersOutOfSync: async () => { throw new Error('x'); } });
      await screen.findByText('Sync group: 2 of 8 computers');
      expect(screen.queryByText(/out of sync/)).toBeNull();
    });

    function mountWith(rpc: Record<string, (args?: any) => unknown>) {
      const harness = createHarness();
      const installed = installTestPluginRuntime({ deepLinkBase: null, rpc: { groupStatus: async () => EMPTY, inviteState: async () => view(), ...rpc } });
      (globalThis as { __ZCC_PLUGIN_RUNTIME__: { toast: unknown } }).__ZCC_PLUGIN_RUNTIME__.toast = (message: string, kind = 'info') => { harness.toasts.push({ message, kind } as never); };
      harness.render(<PeerSettings />);
      return Object.assign(harness, { emitRealtime: installed.emitRealtime });
    }
  });
});

describe('invitation pairing UI robustness', () => {
  const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };

  it('re-shows the still-open invitation token after a remount and never for another invitation', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const open = vi.fn(async () => ({ invitationId: 'inv-1', token: 'zccinv1.again', expiresAt: Date.now() + 600_000 }));
    mount({ inviteState: async () => view({ invitations: [item()] }), openInvitation: open });
    await waitFor(() => expect((screen.getByLabelText('Invitation') as HTMLInputElement).value).toBe('zccinv1.again'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('zccinv1.again'));
    cleanup();
    mount({ inviteState: async () => view({ invitations: [item({ invitationId: 'inv-9' })] }), openInvitation: open });
    await screen.findByText(/Pending: waiting for the other computer/);
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    expect(screen.queryByLabelText('Invitation')).toBeNull();
    cleanup();
    mount({ inviteState: async () => view({ invitations: [item()] }), openInvitation: async () => null });
    await screen.findByText(/Pending: waiting for the other computer/);
    expect(screen.queryByLabelText('Invitation')).toBeNull();
    cleanup();
    mount({ inviteState: async () => view({ invitations: [item()] }), openInvitation: async () => { throw new Error('gone'); } });
    await screen.findByText(/Pending: waiting for the other computer/);
    expect(screen.queryByLabelText('Invitation')).toBeNull();
  });

  it('a slow earlier invite response cannot overwrite a newer one', async () => {
    const slow = deferred<InviteView>();
    const replies = [() => slow.promise, async () => view({ available: false, reason: 'host cannot invite peers' })];
    let call = 0;
    fakePolling();
    mount({ inviteState: () => (replies[Math.min(call++, 1)] ?? replies[1]!)() });
    await waitFor(() => expect(call).toBe(1));
    await pollOnce();
    await screen.findByRole('note');
    slow.resolve(view());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.getByRole('note').textContent).toMatch(/Host cannot invite peers/);
    expect((screen.getByRole('button', { name: 'Add peer' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps the last good invite view when a refresh fails', async () => {
    let fail = false;
    fakePolling();
    mount({ inviteState: async () => { if (fail) throw new Error('flaky'); return view({ available: false, reason: 'host cannot invite peers' }); } });
    await screen.findByRole('note');
    fail = true;
    await pollOnce();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.getByRole('note').textContent).toMatch(/Host cannot invite peers/);
    expect((screen.getByRole('button', { name: 'Add peer' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('async completions after unmount are ignored', async () => {
    const status = deferred<typeof EMPTY>(), sync = deferred<{ attempted: number; synced: number; blocked: number }>(), reconnect = deferred<PeerLink[]>();
    const configured = { ...EMPTY, configured: true, roster: { rosterEpoch: 1 }, members: [{ replicaId: 'r-a', machineId: 'app-a', authorized: true, connected: true, retiring: false }],
      enrolled: [], lifecycleAvailable: true };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let first = true;
    fakePolling();
    mount({ groupStatus: () => { if (first) { first = false; return Promise.resolve(configured); } return status.promise; },
      inviteState: async () => view({ links: [lnk({ state: 'disconnected', reason: 'peer-offline' })] }), peersOutOfSync: async () => ({ outOfSync: true }),
      syncNow: () => sync.promise, reconnectPeer: () => reconnect.promise });
    fireEvent.click(await screen.findByRole('button', { name: 'Sync Now' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reconnect' }));
    await pollOnce();
    cleanup();
    status.resolve(EMPTY); sync.resolve({ attempted: 1, synced: 1, blocked: 0 }); reconnect.resolve([]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('rejected sync after unmount does not set state', async () => {
    const sync = deferred<never>();
    const configured = { ...EMPTY, configured: true, roster: { rosterEpoch: 1 }, members: ['a', 'b'].map((n) => ({ replicaId: `r-${n}`, machineId: `app-${n}`, authorized: true, connected: true, retiring: false })) };
    mount({ groupStatus: async () => configured, peersOutOfSync: async () => ({ outOfSync: true }), syncNow: () => sync.promise });
    fireEvent.click(await screen.findByRole('button', { name: 'Sync Now' }));
    cleanup();
    sync.reject(new Error('late failure'));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it('never renders the Retry/Refresh buttons or the membership paragraph, even with three members', async () => {
    const members = ['a', 'b', 'c'].map((n) => ({ replicaId: `r-${n}`, machineId: `app-${n}`, authorized: true, connected: true, retiring: false }));
    mount({ groupStatus: async () => ({ ...EMPTY, configured: true, roster: { rosterEpoch: 1 }, lifecycleAvailable: true, members }) });
    await screen.findByText('Sync group: 3 of 8 computers');
    expect(screen.queryByRole('button', { name: /Retry|Refresh/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/sponsor|reserved|seal|epoch|introduction/i);
  });

  it('explains the invitation is only for setup and the connection reconnects by itself', async () => {
    mount({});
    expect(await screen.findByText(/This invitation is only for setting up the pairing\. Once paired, the connection stays up and reconnects by itself\./)).toBeTruthy();
  });

  it('a link that is reconnecting says so and still offers Reconnect', async () => {
    mount({ inviteState: async () => view({ links: [lnk({ state: 'reconnecting' })] }) });
    const list = await screen.findByRole('list', { name: 'Computers' });
    expect(list.textContent).toBe('Unnamed computerReconnectingReconnectRemove');
  });

  it('a revoked link has no Reconnect and points at Add peer', async () => {
    mount({ inviteState: async () => view({ links: [lnk({ state: 'disconnected', reason: 'revoked' })] }) });
    const list = await screen.findByRole('list', { name: 'Computers' });
    expect(list.textContent).toBe('Unnamed computerDisconnectedRemoveThe link was revoked. Add peer to pair again.');
  });

  it('a reconnect failing with an ssh_* reason shows the guidance card', async () => {
    mount({ inviteState: async () => view({ links: [lnk({ state: 'disconnected', reason: 'ssh-down' })] }), reconnectPeer: async () => { throw new Error('ssh_remote_login_off'); } });
    fireEvent.click(await screen.findByRole('button', { name: 'Reconnect' }));
    expect(await screen.findByText(/Remote Login is turned off/)).toBeTruthy();
  });

  it('counts down the invitation and offers Create new invitation once it expires', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => undefined) }, configurable: true });
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    try {
      const create = vi.fn()
        .mockResolvedValueOnce({ invitationId: 'inv-1', token: 'zccinv1.timed', expiresAt: Date.now() + 65_000 })
        .mockResolvedValueOnce({ invitationId: 'inv-2', token: 'zccinv1.next', expiresAt: Date.now() + 600_000 });
      mount({ createInvitation: create, cancelInvitation: async () => undefined });
      fireEvent.click(await screen.findByRole('button', { name: 'Add peer' }));
      expect(await screen.findByText(/Expires in 1:05/)).toBeTruthy();
      await act(async () => { vi.advanceTimersByTime(5000); });
      expect(screen.getByText(/Expires in 1:00/)).toBeTruthy();
      await act(async () => { vi.advanceTimersByTime(60_000); });
      expect(screen.getByText(/Invitation expired\./)).toBeTruthy();
      expect(screen.queryByLabelText('Invitation')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Create new invitation' }));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(await screen.findByText(/Expires in 8:55/)).toBeTruthy();
      expect(create).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('setup pending with no connection', () => {
  const orphan = { ...EMPTY, setup: { peerId: 'app-b', repoId: 'database', state: 'pending' as const, error: 'mutual enrollment unavailable' } };

  it('says there is no connection, offers Cancel setup behind a confirm, and cancels per computer', async () => {
    const cancelled = vi.fn(async () => ({ discarded: 1, status: EMPTY }));
    const priorConfirm = window.confirm; const confirm = vi.fn(() => false); window.confirm = confirm;
    try {
      mount({ groupStatus: async () => orphan, resetPeerSync: cancelled });
      expect(await screen.findByText('Setup pending: Unnamed computer: No connection to Unnamed computer. Cancel setup, or pair again.')).toBeTruthy();
      expect(document.body.textContent).not.toMatch(/mutual enrollment/);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel setup with Unnamed computer' }));
      expect(confirm).toHaveBeenCalledWith('Cancel the unfinished setup with Unnamed computer? Nothing is deleted: documents and their history stay. You can pair with Unnamed computer again afterwards.');
      expect(cancelled).not.toHaveBeenCalled();
      confirm.mockReturnValue(true);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel setup with Unnamed computer' }));
      await waitFor(() => expect(cancelled).toHaveBeenCalledExactlyOnceWith({ peerId: 'app-b' }));
      await waitFor(() => expect(screen.queryByText(/Setup pending/)).toBeNull());
      expect(screen.queryByRole('button', { name: /Cancel setup/ })).toBeNull();
    } finally { window.confirm = priorConfirm; }
  });

  it('with a live link the wording is a plain wait, still cancellable; a failed cancel is reported', async () => {
    const priorConfirm = window.confirm; window.confirm = vi.fn(() => true);
    try {
      mount({ groupStatus: async () => orphan, inviteState: async () => view({ links: [lnk({ peerName: 'Laptop' })] }),
        resetPeerSync: async () => { throw new Error('database lifecycle action already running'); } });
      expect(await screen.findByText('Setup pending: Laptop: waiting for Laptop to connect; no link to this computer right now')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel setup with Laptop' }));
      expect((await screen.findByRole('alert')).textContent).toBe('database lifecycle action already running');
    } finally { window.confirm = priorConfirm; }
  });

  it('a joining setup has no Cancel, and an unrelated reason keeps its own wording', async () => {
    mount({ groupStatus: async () => ({ ...EMPTY, setup: { ...orphan.setup, state: 'joining' as const, error: null } }) });
    await screen.findByText('Setup joining: Unnamed computer');
    expect(screen.queryByRole('button', { name: /Cancel setup/ })).toBeNull();
  });
});
