import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, upsertHost, type ZccDatabase } from '@zana-ai/zcc-db';
import { parsePluginApprovalRequest } from '../../http/plugin-approval-proof.js';
import { CORE_APPROVAL_PRINCIPAL, InvitationError } from './peer-invitation.js';
import { hostUseApproved } from './peer-uses.js';
import { PeerUseRequests, USE_APPROVE_ACTION, USE_DENY_COOLDOWN_MS, USE_REQUEST_TTL_MS, USE_STOP_ACTION, type UseRoute } from './peer-use-requests.js';

const A = 'a'.repeat(64), B = 'b'.repeat(64), PAIR = 'pair-1';
const opened: { db: ZccDatabase; dir: string }[] = [];
afterEach(() => { for (const { db, dir } of opened.splice(0)) { db.sqlite.close(); rmSync(dir, { recursive: true, force: true }); } });

function side(self: string, peer: string, name: string, plugins: Record<string, string> = { 'plugin-x': 'Plugin X' }) {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-use-requests-')), db = openDatabase(join(dir, 'zcc.db'));
  opened.push({ db, dir });
  const host = upsertHost(db, { name: `link-${self}`, hostKeyHash: `key-${self}`, enrollmentCapability: 'peer.forward' });
  const route: UseRoute = { pairingId: PAIR, hostId: host.id, peerName: name };
  let linked = true;
  const verify = vi.fn((token: unknown, principal: string, _binding: unknown) => token === 'good' && principal === CORE_APPROVAL_PRINCIPAL);
  const revoke = vi.fn(async () => undefined);
  const bridge = { useRequest: vi.fn(), useDecision: vi.fn() };
  let now = 1_000_000;
  let active = false;
  const uses = new PeerUseRequests({
    db, bridge,
    links: {
      useRoute: computer => linked && computer === peer ? route : undefined,
      useRouteFor: (sender, hostId, pairing) => linked && sender === peer && hostId === route.hostId && pairing === PAIR ? route : undefined
    },
    label: id => plugins[id], verify, revoke, now: () => now, isActive: () => active
  });
  return { uses, db, route, bridge, verify, revoke, setActive: (value: boolean) => { active = value; }, unlink: () => { linked = false; }, advance: (ms: number) => { now += ms; }, self, peer };
}

function pair() {
  const a = side(A, B, 'Bee Mac'), b = side(B, A, 'Ada Mac');
  a.bridge.useRequest.mockImplementation(async (_h, input) => b.uses.acceptRequest(A, b.route.hostId, input));
  a.bridge.useDecision.mockImplementation(async (_h, input) => b.uses.acceptDecision(A, b.route.hostId, input));
  b.bridge.useRequest.mockImplementation(async (_h, input) => a.uses.acceptRequest(B, a.route.hostId, input));
  b.bridge.useDecision.mockImplementation(async (_h, input) => a.uses.acceptDecision(B, a.route.hostId, input));
  return { a, b };
}
const signal = () => new AbortController().signal;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('PeerUseRequests', () => {
  it('needs both owners: pending until each approves on its own computer, then enforcement allows only that plugin', async () => {
    const { a, b } = pair();
    expect(await a.uses.request('plugin-x', B, signal())).toBe('pending');
    const mine = a.uses.prompts(), theirs = b.uses.prompts();
    expect(mine).toHaveLength(1); expect(theirs).toHaveLength(1);
    expect(hostUseApproved(a.db, a.route.hostId, 'plugin-x')).toBe(false);

    expect(await a.uses.decide(mine[0]!.id, true, 'good')).toBe('pending');
    await flush();
    expect(hostUseApproved(a.db, a.route.hostId, 'plugin-x')).toBe(true);
    expect(hostUseApproved(a.db, a.route.hostId, 'plugin-y')).toBe(false);
    expect(await a.uses.request('plugin-x', B, signal())).toBe('pending');
    expect(hostUseApproved(b.db, b.route.hostId, 'plugin-x')).toBe(false);

    expect(await b.uses.decide(theirs[0]!.id, true, 'good')).toBe('approved');
    await flush();
    expect(hostUseApproved(b.db, b.route.hostId, 'plugin-x')).toBe(true);
    expect(await a.uses.request('plugin-x', B, signal())).toBe('approved');
    expect(a.uses.has('plugin-x', B)).toBe(true);
    expect(a.uses.prompts()).toEqual([]);
  });

  it('builds plugin-neutral text itself from the registry label, a valid approval request bound to this request', async () => {
    const { a } = pair();
    await a.uses.request('plugin-x', B, signal());
    const prompt = a.uses.prompts()[0]!;
    expect(parsePluginApprovalRequest({ pluginId: 'plugin-x', ...prompt.request }).ok).toBe(true);
    expect(prompt.pluginId).toBe('plugin-x');
    expect(prompt.request.binding).toMatchObject({ action: USE_APPROVE_ACTION, target: PAIR, targetLabel: 'Bee Mac', subject: 'use:plugin-x', revision: prompt.id });
    expect(prompt.request.summary).toContain('Plugin X');
    expect(prompt.request.summary).toContain('Bee Mac');
    expect(prompt.request.details).toContain('Plugin: Plugin X');
  });

  it('strips control characters from a peer-chosen computer name', async () => {
    const a = side(A, B, 'Bee\u0007\nMac !');
    a.bridge.useRequest.mockResolvedValue({ accepted: true });
    await a.uses.request('plugin-x', B, signal());
    expect(a.uses.prompts()[0]!.request.binding.targetLabel).toBe('Bee Mac !');
  });

  it('rejects approval without a valid owner proof and writes no use', async () => {
    const { a } = pair();
    await a.uses.request('plugin-x', B, signal());
    const id = a.uses.prompts()[0]!.id;
    await expect(a.uses.decide(id, true, 'forged')).rejects.toMatchObject({ code: 'owner_proof_required' });
    await expect(a.uses.decide(id, true)).rejects.toMatchObject({ code: 'owner_proof_required' });
    expect(hostUseApproved(a.db, a.route.hostId, 'plugin-x')).toBe(false);
    expect(a.verify.mock.calls[0]![2]).toEqual(a.uses.prompts()[0]!.request.binding);
    expect(a.uses.prompts()).toHaveLength(1);
  });

  it('does not accept a decision for an unknown or already answered prompt', async () => {
    const { a } = pair();
    await expect(a.uses.decide('nope', false)).rejects.toMatchObject({ code: 'not_found' });
    await a.uses.request('plugin-x', B, signal());
    const id = a.uses.prompts()[0]!.id;
    await a.uses.decide(id, false);
    await expect(a.uses.decide(id, true, 'good')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('a denial on either side is final for the cooldown and tells the other side; asking again later re-prompts', async () => {
    const { a, b } = pair();
    await a.uses.request('plugin-x', B, signal());
    expect(await b.uses.decide(b.uses.prompts()[0]!.id, false)).toBe('denied');
    await flush();
    expect(a.uses.prompts()).toEqual([]);
    expect(await a.uses.request('plugin-x', B, signal())).toBe('denied');
    expect(hostUseApproved(b.db, b.route.hostId, 'plugin-x')).toBe(false);
    a.advance(USE_DENY_COOLDOWN_MS + 1); b.advance(USE_DENY_COOLDOWN_MS + 1);
    expect(await a.uses.request('plugin-x', B, signal())).toBe('pending');
    expect(a.uses.prompts()).toHaveLength(1);
  });

  it('skips the prompt on a computer that already approved this plugin and answers for it', async () => {
    const { a, b } = pair();
    await a.uses.request('plugin-x', B, signal());
    await b.uses.decide(b.uses.prompts()[0]!.id, true, 'good');
    await a.uses.decide(a.uses.prompts()[0]!.id, true, 'good');
    await flush();
    // The entries are lost (restart); the rows remain, so a fresh ask is answered without a second prompt.
    expect(a.uses.has('plugin-x', B)).toBe(true);
    a.advance(USE_REQUEST_TTL_MS + 1); b.advance(USE_REQUEST_TTL_MS + 1);
    expect(a.uses.prompts()).toEqual([]);
    const first = await a.uses.request('plugin-x', B, signal());
    await flush();
    expect(a.uses.prompts()).toEqual([]);
    expect(b.uses.prompts()).toEqual([]);
    expect(first === 'pending' || first === 'approved').toBe(true);
    expect(await a.uses.request('plugin-x', B, signal())).toBe('approved');
  });

  it('refuses a request for a plugin not installed here, a wrong pairing, a wrong host or an unlinked sender', async () => {
    const a = side(A, B, 'Bee Mac');
    expect(await a.uses.acceptRequest(B, a.route.hostId, { pairingId: PAIR, pluginId: 'plugin-missing' })).toEqual({ accepted: false });
    expect(await a.uses.acceptRequest(B, a.route.hostId, { pairingId: 'other', pluginId: 'plugin-x' })).toEqual({ accepted: false });
    expect(await a.uses.acceptRequest(B, 'host-other', { pairingId: PAIR, pluginId: 'plugin-x' })).toEqual({ accepted: false });
    expect(await a.uses.acceptRequest(A, a.route.hostId, { pairingId: PAIR, pluginId: 'plugin-x' })).toEqual({ accepted: false });
    expect(a.uses.prompts()).toEqual([]);
    expect(await a.uses.acceptRequest(B, a.route.hostId, { pairingId: PAIR, pluginId: 'plugin-x' })).toEqual({ accepted: true });
    expect(a.uses.prompts()).toHaveLength(1);
    // A duplicate while the first is open is accepted without a second prompt.
    expect(await a.uses.acceptRequest(B, a.route.hostId, { pairingId: PAIR, pluginId: 'plugin-x' })).toEqual({ accepted: true });
    expect(a.uses.prompts()).toHaveLength(1);
  });

  it('ignores a decision that matches no open request', async () => {
    const a = side(A, B, 'Bee Mac');
    expect(await a.uses.acceptDecision(B, a.route.hostId, { pairingId: PAIR, pluginId: 'plugin-x', approved: true })).toEqual({ accepted: false });
    expect(await a.uses.acceptDecision(A, a.route.hostId, { pairingId: PAIR, pluginId: 'plugin-x', approved: true })).toEqual({ accepted: false });
  });

  it('fails closed when the connection is unknown, the plugin is not installed, or the transport lacks the messages', async () => {
    const a = side(A, B, 'Bee Mac');
    await expect(a.uses.request('plugin-x', 'c'.repeat(64), signal())).rejects.toMatchObject({ code: 'unknown_connection' });
    await expect(a.uses.request('plugin-nope', B, signal())).rejects.toMatchObject({ code: 'unknown_connection' });
    const bare = new PeerUseRequests({ db: a.db, links: { useRoute: () => a.route, useRouteFor: () => a.route }, bridge: {}, label: () => 'X', verify: () => true, revoke: async () => undefined });
    await expect(bare.request('plugin-x', B, signal())).rejects.toBeInstanceOf(InvitationError);
    await expect(bare.request('plugin-x', B, signal())).rejects.toMatchObject({ code: 'use_unavailable' });
  });

  it('drops the request and reports use_unavailable when the peer cannot be reached; reports denied when it refuses', async () => {
    const a = side(A, B, 'Bee Mac');
    a.bridge.useRequest.mockRejectedValueOnce(new Error('offline'));
    await expect(a.uses.request('plugin-x', B, signal())).rejects.toMatchObject({ code: 'use_unavailable' });
    expect(a.uses.prompts()).toEqual([]);
    a.bridge.useRequest.mockResolvedValueOnce({ accepted: false });
    expect(await a.uses.request('plugin-x', B, signal())).toBe('denied');
    expect(a.uses.prompts()).toEqual([]);
  });

  it('resends an undelivered decision the next time the plugin asks', async () => {
    const { a, b } = pair();
    await a.uses.request('plugin-x', B, signal());
    a.bridge.useDecision.mockRejectedValueOnce(new Error('offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await a.uses.decide(a.uses.prompts()[0]!.id, true, 'good');
    await flush();
    expect(warn).toHaveBeenCalled();
    await b.uses.decide(b.uses.prompts()[0]!.id, true, 'good');
    await flush();
    expect(await a.uses.request('plugin-x', B, signal())).toBe('approved');
    await flush();
    expect(a.bridge.useDecision).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('Stop using removes the row at once, tells the peer, revokes grants and forgets the request', async () => {
    const { a, b } = pair();
    await a.uses.request('plugin-x', B, signal());
    await a.uses.decide(a.uses.prompts()[0]!.id, true, 'good');
    await b.uses.decide(b.uses.prompts()[0]!.id, true, 'good');
    await flush();
    await a.uses.stop('plugin-x', B);
    expect(hostUseApproved(a.db, a.route.hostId, 'plugin-x')).toBe(false);
    expect(hostUseApproved(b.db, b.route.hostId, 'plugin-x')).toBe(false);
    expect(a.revoke).toHaveBeenCalledWith('plugin-x', B);
    expect(b.revoke).toHaveBeenCalledWith('plugin-x', A);
    expect(a.uses.has('plugin-x', B)).toBe(false);
    expect(await b.uses.request('plugin-x', A, signal())).toBe('pending');
    // Stop on an unlinked computer is still safe and still revokes.
    a.unlink();
    await a.uses.stop('plugin-x', B);
    expect(a.revoke).toHaveBeenCalledTimes(2);
  });

  it('requires core confirmation before stopping an active use', async () => {
    const { a, b } = pair();
    await a.uses.request('plugin-x', B, signal());
    await a.uses.decide(a.uses.prompts()[0]!.id, true, 'good');
    await b.uses.decide(b.uses.prompts()[0]!.id, true, 'good');
    await flush();
    a.setActive(true);
    const waiting = a.uses.confirmStop('plugin-x', B, signal());
    const prompt = a.uses.prompts()[0]!;
    expect(prompt.request.binding).toMatchObject({ action: USE_STOP_ACTION, subject: 'use:plugin-x', target: PAIR, revision: prompt.id });
    expect(hostUseApproved(a.db, a.route.hostId, 'plugin-x')).toBe(true);
    await a.uses.decide(prompt.id, false);
    await expect(waiting).rejects.toMatchObject({ code: 'denied' });
    expect(hostUseApproved(a.db, a.route.hostId, 'plugin-x')).toBe(true);
    const accepted = a.uses.confirmStop('plugin-x', B, signal());
    const next = a.uses.prompts()[0]!;
    await a.uses.decide(next.id, true, 'good');
    await expect(accepted).resolves.toBeUndefined();
  });

  it('refuses an approval once the connection is gone and forgets requests for a removed computer', async () => {
    const { a } = pair();
    await a.uses.request('plugin-x', B, signal());
    const id = a.uses.prompts()[0]!.id;
    a.unlink();
    await expect(a.uses.decide(id, true, 'good')).rejects.toMatchObject({ code: 'unknown_connection' });
    const changed = vi.fn();
    a.uses.onChange(changed);
    a.uses.forget(B);
    expect(a.uses.prompts()).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(1);
    a.uses.forget(B);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('pushes a change signal for each new prompt and decision, and stops after dispose or unsubscribe', async () => {
    const { a } = pair();
    const listener = vi.fn(), off = a.uses.onChange(listener);
    await a.uses.request('plugin-x', B, signal());
    expect(listener).toHaveBeenCalled();
    const count = listener.mock.calls.length;
    await a.uses.decide(a.uses.prompts()[0]!.id, false);
    expect(listener.mock.calls.length).toBeGreaterThan(count);
    off();
    const after = listener.mock.calls.length;
    a.uses.forget(B);
    expect(listener.mock.calls.length).toBe(after);
    a.uses.onChange(() => { throw new Error('observer'); });
    a.uses.dispose();
    a.uses.forget(B);
  });

  it('hides a prompt whose plugin was uninstalled and one the peer already denied', async () => {
    const plugins: Record<string, string> = { 'plugin-x': 'Plugin X' };
    const a = side(A, B, 'Bee Mac', plugins);
    a.bridge.useRequest.mockResolvedValue({ accepted: true });
    await a.uses.request('plugin-x', B, signal());
    expect(a.uses.prompts()).toHaveLength(1);
    delete plugins['plugin-x'];
    expect(a.uses.prompts()).toEqual([]);
    plugins['plugin-x'] = 'Plugin X';
    await a.uses.acceptDecision(B, a.route.hostId, { pairingId: PAIR, pluginId: 'plugin-x', approved: false });
    expect(a.uses.prompts()).toEqual([]);
  });
});
