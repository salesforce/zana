import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { publicKeyLine } from '@zana-ai/zcc-host-daemon/ssh-keys';
import {
  CORE_APPROVAL_PRINCIPAL, INVITATION_LIMITS, INVITATION_REASONS, INVITATION_TOKEN_PREFIX, InvitationError, PeerInvitations,
  consentDigestOf, invitationFingerprint, offerDigest, parseInvitationToken, sealTokenOffer, sshKeyFingerprint, terminalInvitationReason,
  type ConsentedPairing, type InvitationLinkRef, type InvitationLinks, type InvitationReason, type InvitationTransport,
  type InvitationTransportResponse, type PairingFence, type PeerInvitationsOptions, type PublicInvitationStatus
} from './peer-invitation.js';
import { PAIRING_CODE_MISMATCH_LIMIT, pairingCodeOf } from './pairing-code.js';

const PLUGIN = 'sync-plugin';
const SCOPE = 'repo:alpha';
const TEST_CODE = 'ABCD-2345';
const keyProvider = { getKey: async () => Buffer.alloc(32, 9) };
const roots: string[] = [];
const services: PeerInvitations[] = [];

afterEach(async () => {
  for (const service of services.splice(0)) { service.dispose(); await service.whenIdle(); }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function approvals() {
  const issued = new Map<string, { pluginId: string; binding: string }>();
  return {
    sign(pluginId: string, binding: unknown) { const token = randomUUID(); issued.set(token, { pluginId, binding: JSON.stringify(binding) }); return token; },
    verify(token: unknown, pluginId: string, binding: unknown) {
      const entry = typeof token === 'string' ? issued.get(token) : undefined;
      if (!entry || entry.pluginId !== pluginId || entry.binding !== JSON.stringify(binding)) return false;
      issued.delete(token as string);
      return true;
    }
  };
}

const joinCode = () => 'zcde_' + randomBytes(18).toString('base64url');
/** A syntactically valid `ssh-ed25519 <b64>` line (68 base64 chars). */
const sshPub = () => 'ssh-ed25519 ' + Buffer.concat([Buffer.from([0, 0, 0, 11]), Buffer.from('ssh-ed25519'), Buffer.from([0, 0, 0, 32]), randomBytes(32)]).toString('base64');
const sshOffer = () => ({
  v: 1, endpoint: { host: 'inviter-mac.local', port: 22, user: 'alice', hostKey: sshPub() }, bootstrapSeed: randomBytes(32).toString('base64url'),
  listenPort: 40123, targetPort: 40124, hostId: randomUUID(), joinCode: joinCode()
});
const code = (promise: Promise<unknown>) => promise.then(() => 'resolved', (error: unknown) => error instanceof InvitationError ? error.code : String(error));
const decodeToken = (token: string): Record<string, unknown> => JSON.parse(Buffer.from(token.slice(INVITATION_TOKEN_PREFIX.length), 'base64url').toString('utf8'));
const encodeToken = (payload: Record<string, unknown>) => INVITATION_TOKEN_PREFIX + Buffer.from(JSON.stringify(payload)).toString('base64url');
const fenceOf = (p: PairingFence): PairingFence => ({ invitationId: p.invitationId, pairingId: p.pairingId, consentDigest: p.consentDigest, generation: p.generation });

interface Node {
  name: string;
  svc: PeerInvitations;
  opts: PeerInvitationsOptions;
  id: string;
  links: { create: ReturnType<typeof vi.fn>; redeem: ReturnType<typeof vi.fn> };
  refs: Map<string, InvitationLinkRef>;
  terminated: [string, string, string][];
  consented: ConsentedPairing[];
  changed: string[];
  founding: { pairing: ConsentedPairing; op: string }[];
  /** Redeemer-side hook to rewrite/replace the bootstrap response. */
  intercept?: (kind: string, body: unknown, real: () => Promise<InvitationTransportResponse>) => Promise<InvitationTransportResponse>;
  sent: { kind: string; body: unknown }[];
  offline: boolean;
}

const linkKeys = new Map<string, string>();
const keyFor = (id: string) => { let key = linkKeys.get(id); if (!key) linkKeys.set(id, key = sshPub()); return key; };

async function world() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'peer-invitation-')));
  roots.push(root);
  const clock = { now: 1_800_000_000_000 };
  const owner = approvals();
  const byId = new Map<string, Node>();

  const make = (name: string, over: Partial<PeerInvitationsOptions> & { id?: string; dir?: string; noLinks?: boolean } = {}): Node => {
    const id = over.id ?? randomUUID();
    const node: Node = {
      name, id, refs: new Map(), terminated: [], consented: [], changed: [], founding: [], sent: [], offline: false,
      links: {
        create: vi.fn(async () => ({ offer: sshOffer(), expiresAt: clock.now + 60 * 60_000 })),
        redeem: vi.fn(async () => undefined)
      }
    } as unknown as Node;
    const links: InvitationLinks = { create: input => node.links.create(input), redeem: (input, signal) => node.links.redeem(input, signal) };
    const transport: InvitationTransport = {
      post: async (link, kind, invitationId, body, signal) => {
        expect(signal).toBeInstanceOf(AbortSignal);
        node.sent.push({ kind, body });
        const real = async (): Promise<InvitationTransportResponse> => {
          if (node.offline) throw new Error('offline');
          const inviter = byId.get(link.recipientId);
          if (!inviter) throw new Error('no route');
          try {
            const reply = kind === 'redeem'
              ? await inviter.svc.acceptRedeem(body, { redeemerId: node.id, serverId: 'server-' + node.id })
              : await inviter.svc.acceptExchange(body, { redeemerId: node.id });
            return { status: 200, body: reply };
          } catch (error) {
            if (!(error instanceof InvitationError)) throw error;
            return { status: error.code === 'expired' ? 410 : 403, body: { error: error.code } };
          }
        };
        return node.intercept ? node.intercept(kind, body, real) : real();
      }
    };
    node.opts = {
      directory: over.dir ?? join(root, name), instanceId: id, keyProvider, now: () => clock.now, localName: () => `Computer ${name}`,
      verifyOwnerApproval: (token, pluginId, binding) => owner.verify(token, pluginId, binding),
      links: over.noLinks ? undefined : links, linkKey: async () => keyFor(id), transport, linkRef: invitationId => node.refs.get(invitationId) ?? null,
      onTerminated: (invitationId, role, reason) => node.terminated.push([invitationId, role, reason]),
      onConsented: pairing => node.consented.push(pairing), onChanged: plugin => node.changed.push(plugin),
      onFounding: async (pairing, message) => { node.founding.push({ pairing, op: message.op }); },
      ...over
    };
    delete (node.opts as { id?: string }).id; delete (node.opts as { dir?: string }).dir; delete (node.opts as { noLinks?: boolean }).noLinks;
    node.svc = new PeerInvitations(node.opts);
    services.push(node.svc);
    byId.set(id, node);
    return node;
  };

  /** Inviter: owner approval with proof. Redeemer: no approval exists (pasting the invitation is consent); just flush its implicit decision. */
  const approve = async (node: Node, invitationId: string) => {
    if ((await node.svc.status({ pluginId: PLUGIN, invitationId })).role === 'redeemer') return node.svc.poll({ pluginId: PLUGIN, invitationId });
    const request = await node.svc.approvalRequest({ pluginId: PLUGIN, invitationId });
    return node.svc.decide({ pluginId: PLUGIN, invitationId, decision: 'approved', ownerProof: owner.sign(PLUGIN, request.binding) });
  };

  /** inviter creates, redeemer pastes, link store "connects back", redeemer delivers redeem -> both reserved. */
  const reserve = async (inviter: Node, redeemer: Node) => {
    const created = await inviter.svc.create({ pluginId: PLUGIN, scope: SCOPE });
    const first = await redeemer.svc.redeem({ pluginId: PLUGIN, token: created.token, code: created.code });
    redeemer.refs.set(created.invitationId, { hostId: randomUUID(), recipientId: inviter.id });
    await redeemer.svc.nudge(created.invitationId);
    // The redeemer's implicit decision is queued as soon as it is reserved; flush it instead of waiting for the pump timer.
    await redeemer.svc.poll({ pluginId: PLUGIN, invitationId: created.invitationId });
    return { created, first, view: () => redeemer.svc.status({ pluginId: PLUGIN, invitationId: created.invitationId }) };
  };

  /** full bilateral consent; returns fences for both sides. */
  const consent = async (inviter: Node, redeemer: Node) => {
    const r = await reserve(inviter, redeemer);
    const invitationId = r.created.invitationId;
    await approve(inviter, invitationId);
    await approve(redeemer, invitationId);
    const [onInviter] = await inviter.svc.listConsented();
    const [onRedeemer] = await redeemer.svc.listConsented();
    return { ...r, invitationId, onInviter: onInviter!, onRedeemer: onRedeemer! };
  };

  const status = (n: Node, invitationId: string) => n.svc.status({ pluginId: PLUGIN, invitationId });
  return { root, clock, owner, make, approve, reserve, consent, status, byId };
}

/** A syntactically valid token from a made-up inviter (never reachable). */
function fakeToken(over: Record<string, unknown> = {}, now = 1_800_000_000_000): string {
  const ed = randomBytes(32).toString('base64url');
  const id = (over.id as string) ?? randomUUID();
  return encodeToken({
    v: 3, id, inviter: randomUUID(), name: 'Fake', fp: invitationFingerprint(ed), ed, x: randomBytes(32).toString('base64url'),
    plugin: PLUGIN, scope: SCOPE, exp: now + INVITATION_LIMITS.ttlMs, s: randomBytes(32).toString('base64url'),
    link: sealTokenOffer(sshOffer(), TEST_CODE, id), ...over
  });
}

describe('PeerInvitations v3', () => {
  describe('ssh transport', () => {
    it('does not return bootstrap private key material to the plugin in the invitation', async () => {
      const w = await world();
      const inv = w.make('inv');
      const offer = sshOffer();
      inv.links.create.mockResolvedValueOnce({ offer, expiresAt: w.clock.now + INVITATION_LIMITS.ttlMs });
      const created = await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE });

      expect(JSON.stringify({ ...created, token: decodeToken(created.token) })).not.toContain(offer.bootstrapSeed);
    });

    it('does not serialize a bootstrap private key field into the pasted wire token', async () => {
      const w = await world();
      const inv = w.make('inv');
      const created = await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE });

      expect(decodeToken(created.token).link).not.toHaveProperty('bootstrapSeed');
    });

    it('does not let an intercepted token reconstruct the authorized bootstrap SSH identity', async () => {
      const w = await world();
      const inv = w.make('inv');
      const offer = sshOffer();
      inv.links.create.mockResolvedValueOnce({ offer, expiresAt: w.clock.now + INVITATION_LIMITS.ttlMs });
      const created = await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE });
      const intercepted = decodeToken(created.token).link as { bootstrapSeed?: string };
      const recoveredIdentity = intercepted.bootstrapSeed ? publicKeyLine(intercepted.bootstrapSeed) : null;

      expect(recoveredIdentity).not.toBe(publicKeyLine(offer.bootstrapSeed));
    });

    it('round-trips a v3 token under the size cap and rejects v2 or malformed ssh offers', async () => {
      const w = await world();
      const inv = w.make('inv');
      const { token } = await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE });
      expect(Buffer.byteLength(token)).toBeLessThan(INVITATION_LIMITS.tokenBytes);
      const parsed = parseInvitationToken(token);
      expect(parsed.v).toBe(3);
      expect(parsed.link.endpoint.hostKey).toMatch(/^ssh-ed25519 /);
      const payload = decodeToken(token);
      for (const bad of [{ ...payload, v: 2 }, { ...payload, v: 2, link: { code: 'ABCD-1234-ABCD-1234-ABCD-1234-ABCD-1234', accountUrl: 'https://x.example', serverId: randomUUID(), hostId: randomUUID() } },
        { ...payload, link: { ...(payload.link as object), joinCode: 'ABCD-1234' } }, { ...payload, link: { ...(payload.link as object), listenPort: 22 } },
        { ...payload, link: { ...(payload.link as object), endpoint: { host: '-oProxyCommand=x', port: 22, user: 'a', hostKey: sshPub() } } }]) {
        expect(() => parseInvitationToken(encodeToken(bad))).toThrow(InvitationError);
      }
    });

    it('signs the redeemer link key into the offer, consent digest and approval details', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red');
      const { onInviter, onRedeemer, invitationId } = await w.consent(inv, red);
      const key = keyFor(red.id);
      expect(onInviter.remote.sshKey).toBe(key);
      expect(onRedeemer.remote.sshKey).toBeUndefined();
      expect(onInviter.consentDigest).toBe(onRedeemer.consentDigest);
      expect(await code(inv.svc.approvalRequest({ pluginId: PLUGIN, invitationId }))).toBe('not_ready');
      const b = w.make('b'), a = w.make('a');
      const created = await a.svc.create({ pluginId: PLUGIN, scope: SCOPE });
      await b.svc.redeem({ pluginId: PLUGIN, token: created.token, code: created.code });
      b.refs.set(created.invitationId, { hostId: randomUUID(), recipientId: a.id });
      await b.svc.nudge(created.invitationId);
      const details = (await a.svc.approvalRequest({ pluginId: PLUGIN, invitationId: created.invitationId })).details;
      expect(details).toContain(`SSH key: ${sshKeyFingerprint(keyFor(b.id))}`);
      expect(sshKeyFingerprint(keyFor(b.id))).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
    });

    it('binds the redeemer sshKey into the offer digest and the consent digest', () => {
      const endpoint = { instanceId: randomUUID(), name: 'R', fingerprint: 'f', ed: 'e', x: 'x' };
      const key = sshPub();
      const offer = (sshKey?: string) => ({ invitationId: 'inv', inviterId: 'iid', inviterFingerprint: 'ifp', pluginId: PLUGIN, scope: SCOPE,
        redeemer: { ...endpoint, ...(sshKey ? { sshKey } : {}) }, nonce: 'n' });
      expect(offerDigest(offer(key), 's')).toBe(offerDigest(offer(key), 's'));
      expect(offerDigest(offer(key), 's')).not.toBe(offerDigest(offer(sshPub()), 's'));
      expect(offerDigest(offer(key), 's')).not.toBe(offerDigest(offer(), 's'));
      const rec = (sshKey?: string) => ({ id: 'inv', pluginId: PLUGIN, scope: SCOPE, pairingId: 'pid', inviter: endpoint, redeemer: { ...endpoint, ...(sshKey ? { sshKey } : {}) } });
      expect(consentDigestOf(rec(key))).not.toBe(consentDigestOf(rec(sshPub())));
      expect(consentDigestOf(rec(key))).not.toBe(consentDigestOf(rec()));
    });

    it('fails the redeem as unavailable when the link key cannot be created', async () => {
      const w = await world();
      const inv = w.make('inv');
      const red = w.make('red', { linkKey: async () => { throw new Error('no key'); } });
      const { token, code: tokenCode } = await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE });
      expect(await code(red.svc.redeem({ pluginId: PLUGIN, token, code: tokenCode }))).toBe('unavailable');
      const bad = w.make('bad', { linkKey: async () => 'ssh-rsa nope' });
      expect(await code(bad.svc.redeem({ pluginId: PLUGIN, token, code: tokenCode }))).toBe('unavailable');
    });

    it('mints no link key for a redeem that is refused before the record is created', async () => {
      const w = await world();
      const inv = w.make('inv');
      const linkKey = vi.fn(async () => sshPub());
      const red = w.make('red', { linkKey });
      const { token, code: tokenCode } = await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE });
      const payload = decodeToken(token);
      // own invitation, already redeemed (different secret on an existing record), and a valid first redeem: only the last mints.
      const ownKey = vi.fn(async () => sshPub());
      const own = w.make('own', { linkKey: ownKey });
      const ownCreated = await own.svc.create({ pluginId: PLUGIN, scope: SCOPE });
      const ownToken = ownCreated.token;
      expect(await code(own.svc.redeem({ pluginId: PLUGIN, token: ownToken, code: ownCreated.code }))).toBe('own_invitation');
      expect(await code(red.svc.redeem({ pluginId: 'other', token, code: tokenCode }))).toBe('wrong_plugin');
      expect(ownKey).not.toHaveBeenCalled();
      expect(linkKey).not.toHaveBeenCalled();
      await red.svc.redeem({ pluginId: PLUGIN, token, code: tokenCode });
      expect(linkKey).toHaveBeenCalledTimes(1);
      // Re-pasting the same token resumes the same attempt without another mint.
      await red.svc.redeem({ pluginId: PLUGIN, token, code: tokenCode });
      expect(await code(red.svc.redeem({ pluginId: PLUGIN, token: encodeToken({ ...payload, s: randomBytes(32).toString('base64url') }), code: tokenCode }))).toBe('already_redeemed');
      expect(linkKey).toHaveBeenCalledTimes(1);
    });

    it('carries every ssh reason with a fixed message', () => {
      for (const reason of ['ssh_remote_login_off', 'ssh_unreachable', 'ssh_auth_refused', 'ssh_forwarding_refused', 'ssh_host_key_mismatch'] as const) {
        expect(INVITATION_REASONS).toContain(reason);
        expect(new InvitationError(reason).message).toMatch(/\S/);
      }
      expect(INVITATION_REASONS).not.toContain('connect_required');
      expect(INVITATION_REASONS).not.toContain('cross_account');
    });
  });

  it('pairs through consent, founding offer/ack and ready on both sides', async () => {
    const w = await world();
    const inv = w.make('inv'), red = w.make('red');
    const created = await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE });
    expect(created.expiresAt).toBe(w.clock.now + INVITATION_LIMITS.ttlMs);
    expect(inv.links.create).toHaveBeenCalledWith({ invitationId: created.invitationId, pluginId: PLUGIN, scope: SCOPE });
    expect(inv.changed).toContain(PLUGIN);
    const parsed = parseInvitationToken(`  ${created.token}\n`);
    expect(parsed.v).toBe(3);
    expect(parsed.inviter).toBe(inv.id);

    const redeemed = await red.svc.redeem({ pluginId: PLUGIN, token: created.token, code: created.code });
    expect(red.links.redeem).toHaveBeenCalledTimes(1);
    expect(red.links.redeem.mock.calls[0]![0]).toMatchObject({ invitationId: created.invitationId, inviterId: inv.id, inviterName: 'Computer inv', pluginId: PLUGIN, scope: SCOPE,
      link: expect.objectContaining({ v: 1, joinCode: expect.stringMatching(/^zcde_/), endpoint: expect.objectContaining({ host: 'inviter-mac.local' }) }) });
    // Link redeemed, still waiting for the inviter to connect back.
    expect(redeemed.state).toBe('redeeming');
    expect(red.sent).toHaveLength(0);

    red.refs.set(created.invitationId, { hostId: randomUUID(), recipientId: inv.id });
    await red.svc.nudge(created.invitationId);
    await red.svc.poll({ pluginId: PLUGIN, invitationId: created.invitationId });
    const reservedRed = await w.status(red, created.invitationId);
    const reservedInv = await w.status(inv, created.invitationId);
    expect(reservedRed).toMatchObject({ role: 'redeemer', state: 'reserved', peer: { instanceId: inv.id, name: 'Computer inv' } });
    expect(reservedInv).toMatchObject({ role: 'inviter', state: 'reserved', peer: { instanceId: red.id }, pairingId: reservedRed.pairingId, consentDigest: reservedRed.consentDigest });
    expect(reservedInv.consentExpiresAt).toBe(w.clock.now + INVITATION_LIMITS.consentWindowMs);
    expect(await inv.svc.listConsented()).toEqual([]);
    // The redeemer pasted the invitation: that is its consent, so it has no approval to give and no sheet to show.
    expect(reservedRed).toMatchObject({ redeemerDecision: 'approved', inviterDecision: 'pending' });
    expect(reservedInv.redeemerDecision).toBe('approved');
    expect(await code(red.svc.approvalRequest({ pluginId: PLUGIN, invitationId: created.invitationId }))).toBe('not_ready');
    expect(await code(red.svc.decide({ pluginId: PLUGIN, invitationId: created.invitationId, decision: 'approved', ownerProof: w.owner.sign(PLUGIN, { action: 'peer.invitation.approve' }) }))).toBe('not_ready');

    // Approve needs an owner proof bound to this record.
    expect(await code(inv.svc.decide({ pluginId: PLUGIN, invitationId: created.invitationId, decision: 'approved' }))).toBe('owner_proof_required');
    const request = await inv.svc.approvalRequest({ pluginId: PLUGIN, invitationId: created.invitationId });
    expect(request.binding).toMatchObject({ action: 'peer.invitation.approve', target: reservedInv.pairingId, subject: `inviter:${PLUGIN}` });
    expect(request.summary).toContain('Computer red');
    const forged = w.owner.sign(PLUGIN, { ...request.binding, revision: 'other' });
    expect(await code(inv.svc.decide({ pluginId: PLUGIN, invitationId: created.invitationId, decision: 'approved', ownerProof: forged }))).toBe('owner_proof_required');
    const proof = w.owner.sign(PLUGIN, request.binding);
    expect((await inv.svc.decide({ pluginId: PLUGIN, invitationId: created.invitationId, decision: 'approved', ownerProof: proof })).inviterDecision).toBe('approved');
    expect(await code(inv.svc.decide({ pluginId: PLUGIN, invitationId: created.invitationId, decision: 'approved', ownerProof: proof }))).toBe('not_ready');
    // The redeemer's implicit decision was already delivered, so the inviter's approval completes consent on its own side.
    expect((await w.status(inv, created.invitationId)).state).toBe('consented');

    // Redeemer polls and learns the inviter approved; it never approves anything itself.
    const done = await red.svc.poll({ pluginId: PLUGIN, invitationId: created.invitationId });
    expect(done).toMatchObject({ state: 'consented', inviterDecision: 'approved', redeemerDecision: 'approved' });
    expect((await w.status(inv, created.invitationId)).state).toBe('consented');
    expect(inv.consented).toHaveLength(1);
    expect(red.consented).toHaveLength(1);

    const [pi] = await inv.svc.listConsented();
    const [pr] = await red.svc.listConsented();
    expect(pi).toMatchObject({ role: 'inviter', state: 'consented', pluginId: PLUGIN, scope: SCOPE, generation: 1, local: { instanceId: inv.id }, remote: { instanceId: red.id } });
    expect(pr).toMatchObject({ role: 'redeemer', pairingId: pi!.pairingId, consentDigest: pi!.consentDigest, remote: { instanceId: inv.id } });
    expect((await inv.svc.fence(fenceOf(pi!))).state).toBe('consented');
    expect(await code(inv.svc.fence({ ...fenceOf(pi!), generation: 2 }))).toBe('fenced');
    expect(await code(inv.svc.fence({ ...fenceOf(pi!), consentDigest: 'x'.repeat(43) }))).toBe('fenced');
    expect(await code(inv.svc.fence({ ...fenceOf(pi!), pairingId: 'nope' }))).toBe('fenced');

    // Founding: redeemer -> inviter over the exchange kind; onFounding runs for each op.
    await red.svc.founding(fenceOf(pr!), { op: 'offer' });
    await inv.svc.markConnecting(fenceOf(pi!));
    expect((await inv.svc.fence(fenceOf(pi!))).state).toBe('connecting');
    await red.svc.markConnecting(fenceOf(pr!));
    await red.svc.founding(fenceOf(pr!), { op: 'ack' });
    expect(inv.founding.map(f => f.op)).toEqual(['offer', 'ack']);
    expect(inv.founding[0]!.pairing).toMatchObject({ role: 'inviter', pairingId: pi!.pairingId });
    expect(red.sent.at(-1)!.kind).toBe('exchange');
    await inv.svc.markReady(fenceOf(pi!));
    await red.svc.markReady(fenceOf(pr!));
    expect((await w.status(inv, created.invitationId)).state).toBe('ready');
    expect((await w.status(red, created.invitationId)).state).toBe('ready');
    expect(await code(inv.svc.fence(fenceOf(pi!)))).toBe('fenced');
    expect(await inv.svc.listConsented()).toEqual([]);
    // ready is not an "end": no termination events.
    expect(inv.terminated).toEqual([]);
    expect(red.terminated).toEqual([]);
  });

  it('never leaks code, credentials or secrets in projections, bodies, errors or storage', async () => {
    const w = await world();
    const inv = w.make('inv'), red = w.make('red');
    const offer = sshOffer();
    inv.links.create.mockResolvedValueOnce({ offer, expiresAt: w.clock.now + INVITATION_LIMITS.ttlMs });
    const created = await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE });
    const payload = decodeToken(created.token);
    const link = { ...(payload.link as { joinCode: string; hostId: string }), bootstrapSeed: offer.bootstrapSeed };
    const secret = payload.s as string;
    expect(Object.keys(payload).sort()).toEqual(['ed', 'exp', 'fp', 'id', 'inviter', 'link', 'name', 'plugin', 's', 'scope', 'v', 'x']);
    expect(payload).not.toHaveProperty('d');
    await red.svc.redeem({ pluginId: PLUGIN, token: created.token, code: created.code });
    red.refs.set(created.invitationId, { hostId: randomUUID(), recipientId: inv.id });
    await red.svc.nudge(created.invitationId);
    await w.approve(inv, created.invitationId);
    await w.approve(red, created.invitationId);
    const views = JSON.stringify([
      ...await inv.svc.list({ pluginId: PLUGIN }), ...await red.svc.list({ pluginId: PLUGIN, limit: 0 }),
      await inv.svc.listConsented(), await red.svc.listConsented(), await red.svc.approvalRequest({ pluginId: PLUGIN, invitationId: created.invitationId }).catch(() => 'n/a')
    ]);
    for (const needle of [secret, link.joinCode, link.bootstrapSeed, link.hostId]) expect(views).not.toContain(needle);
    expect(views).not.toMatch(/enrollToken|credential|"code"|"secret"/);
    for (const name of ['inv', 'red']) {
      for (const file of await readdir(join(w.root, name))) {
        const bytes = await readFile(join(w.root, name, file));
        for (const needle of [secret, link.joinCode, link.bootstrapSeed, PLUGIN]) expect(bytes.includes(Buffer.from(needle))).toBe(false);
      }
    }
    for (const sent of [...red.sent]) {
      const text = JSON.stringify(sent.body);
      expect(text).not.toContain(secret);
      expect(text).not.toContain(link.joinCode);
      expect(text).not.toContain(link.bootstrapSeed);
    }
    const error = await red.svc.redeem({ pluginId: 'other-plugin', token: created.token, code: created.code }).catch(e => e as Error);
    expect(error.message).toBe('This invitation is for a different plugin');
    for (const reason of INVITATION_REASONS) expect(new InvitationError(reason).message).not.toMatch(/[A-F0-9]{4}-[A-F0-9]{4}/);
    expect(await code(inv.svc.status({ pluginId: 'other-plugin', invitationId: created.invitationId }))).toBe('not_found');
  });

  describe('create', () => {
    it('validates arguments and requires links', async () => {
      const w = await world();
      const inv = w.make('inv');
      expect(await code(inv.svc.create({ pluginId: 'Bad Plugin', scope: SCOPE }))).toBe('invalid_invitation');
      expect(await code(inv.svc.create({ pluginId: PLUGIN, scope: '' }))).toBe('invalid_invitation');
      expect(await code(inv.svc.create(undefined as never))).toBe('invalid_invitation');
      expect(await code(w.make('nolinks', { noLinks: true }).svc.create({ pluginId: PLUGIN, scope: SCOPE }))).toBe('unavailable');
      expect(inv.links.create).not.toHaveBeenCalled();
    });

    it('surfaces link store failures and tells onTerminated once', async () => {
      const w = await world();
      const inv = w.make('inv');
      inv.links.create.mockRejectedValueOnce(new InvitationError('ssh_remote_login_off'));
      const error = await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE }).catch(e => e as InvitationError);
      expect(error.code).toBe('ssh_remote_login_off');
      expect(error.message).toBe('Zana on the computer that created the invitation could not start its connection service');
      expect(inv.terminated).toHaveLength(1);
      expect(inv.terminated[0]).toEqual([expect.any(String), 'inviter', 'unavailable']);
      inv.links.create.mockRejectedValueOnce(new Error('boom secret=hunter2'));
      const generic = await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE }).catch(e => e as InvitationError);
      expect(generic.code).toBe('unavailable');
      expect(generic.message).not.toContain('hunter2');
      expect(inv.terminated).toHaveLength(2);
      expect(await inv.svc.list({ pluginId: PLUGIN })).toEqual([]);
    });

    it('rejects malformed or already-expired mints and notifies teardown', async () => {
      const w = await world();
      const inv = w.make('inv');
      const good = sshOffer();
      const ok = (offer: unknown) => ({ offer, expiresAt: w.clock.now + 1000 });
      for (const bad of [ok({ ...good, joinCode: 'nope' }), ok({ ...good, endpoint: { ...good.endpoint, hostKey: 'ssh-rsa AAAA' } }),
        ok({ ...good, listenPort: 80 }), ok({ ...good, extra: 1 }), { offer: good, expiresAt: w.clock.now }, { offer: good, expiresAt: 1.5 }, undefined]) {
        inv.links.create.mockResolvedValueOnce(bad);
        expect(await code(inv.svc.create({ pluginId: PLUGIN, scope: SCOPE }))).toBe('unavailable');
      }
      expect(inv.terminated).toHaveLength(7);
      expect(inv.terminated.every(row => row[1] === 'inviter' && row[2] === 'unavailable')).toBe(true);
    });

    it('caps expiry at the join code expiry and bounds live invitations', async () => {
      const w = await world();
      const inv = w.make('inv');
      inv.links.create.mockResolvedValueOnce({ offer: sshOffer(), expiresAt: w.clock.now + 5000 });
      expect((await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE })).expiresAt).toBe(w.clock.now + 5000);
      for (let i = 1; i < INVITATION_LIMITS.live; i++) await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE });
      expect(await code(inv.svc.create({ pluginId: PLUGIN, scope: SCOPE }))).toBe('capacity');
      // capacity is checked before minting a link.
      expect(inv.links.create).toHaveBeenCalledTimes(INVITATION_LIMITS.live);
    });

    it('retains a bounded number of terminal records', async () => {
      const w = await world();
      const inv = w.make('inv');
      const ids: string[] = [];
      for (let i = 0; i < INVITATION_LIMITS.terminal + 6; i++) {
        const { invitationId } = await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE });
        ids.push(invitationId);
        w.clock.now += 1;
        await inv.svc.cancel({ pluginId: PLUGIN, invitationId });
      }
      expect(await code(w.status(inv, ids[0]!))).toBe('not_found');
      expect((await w.status(inv, ids.at(-1)!)).state).toBe('cancelled');
      expect((await inv.svc.list({ pluginId: PLUGIN, limit: 1000 })).length).toBe(INVITATION_LIMITS.listMax);
      expect((await inv.svc.list({ pluginId: PLUGIN, limit: 3 })).map(s => s.invitationId)).toEqual(ids.slice(-3).reverse());
    });
  });

  describe('token validation', () => {
    it('rejects malformed, tampered, foreign, own and expired tokens before allocating', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red');
      const { token, invitationId, code: tokenCode } = await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE });
      const payload = decodeToken(token);
      const link = payload.link as Record<string, unknown>;
      const v1 = { ...payload, v: 1 };
      for (const bad of [42, undefined, '', 'zccinv2.abc', `${INVITATION_TOKEN_PREFIX}***`, `${INVITATION_TOKEN_PREFIX}${'A'.repeat(5000)}`,
        `${INVITATION_TOKEN_PREFIX}bm90LWpzb24`, encodeToken({ ...payload, extra: 1 }), encodeToken({ ...payload, fp: 'A'.repeat(43) }),
        encodeToken(v1), encodeToken({ ...payload, link: { ...link, code: 'lowercase' } }), encodeToken({ ...payload, link: { ...link, accountUrl: 'http://x.example' } }),
        encodeToken({ ...payload, link: { ...link, accountUrl: 'https://x.example/path' } }), encodeToken({ ...payload, link: undefined }),
        encodeToken({ ...payload, name: 'bad\u0007name' })]) {
        expect(() => parseInvitationToken(bad)).toThrow(InvitationError);
      }
      expect(await code(inv.svc.redeem({ pluginId: PLUGIN, token, code: tokenCode }))).toBe('own_invitation');
      expect(await code(red.svc.redeem({ pluginId: 'other', token, code: tokenCode }))).toBe('wrong_plugin');
      expect(await code(red.svc.redeem({ pluginId: PLUGIN, token: encodeToken({ ...payload, fp: 'A'.repeat(43) }), code: tokenCode }))).toBe('invalid_invitation');
      expect(await code(red.svc.redeem({ pluginId: PLUGIN, token: encodeToken({ ...payload, exp: w.clock.now + 2 * INVITATION_LIMITS.ttlMs }), code: tokenCode }))).toBe('expired');
      expect(await code(red.svc.redeem({ pluginId: PLUGIN, token: undefined as never, code: tokenCode }))).toBe('invalid_invitation');
      w.clock.now += INVITATION_LIMITS.ttlMs;
      expect(await code(red.svc.redeem({ pluginId: PLUGIN, token, code: tokenCode }))).toBe('expired');
      expect(await red.svc.list({ pluginId: PLUGIN })).toEqual([]);
      expect(red.links.redeem).not.toHaveBeenCalled();
      expect(await w.status(inv, invitationId)).toMatchObject({ state: 'expired', reason: 'expired' });
      expect(inv.terminated).toEqual([[invitationId, 'inviter', 'expired']]);
    });

    it('requires links to redeem and rejects a token minted by an identical key (own fingerprint)', async () => {
      const w = await world();
      const inv = w.make('inv');
      const { token, code: tokenCode } = await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE });
      expect(await code(w.make('nolinks', { noLinks: true }).svc.redeem({ pluginId: PLUGIN, token, code: tokenCode }))).toBe('unavailable');
      // Same storage directory, different instance id: sealed to the original identity so it fails closed.
      const clone = w.make('clone', { dir: inv.opts.directory });
      expect(await code(clone.svc.redeem({ pluginId: PLUGIN, token: fakeToken(), code: TEST_CODE }))).toContain('peer storage corrupt or key mismatch');
    });

    it('terminalInvitationReason only maps known terminal refusals', () => {
      for (const c of ['expired', 'cancelled', 'already_redeemed', 'attempt_limit', 'not_found', 'invalid_invitation', 'identity_mismatch']) {
        expect(terminalInvitationReason(c)).toBe(c);
      }
      expect(terminalInvitationReason('cross_account')).toBeNull();
      expect(terminalInvitationReason('unavailable')).toBeNull();
      expect(terminalInvitationReason(5)).toBeNull();
    });
  });

  describe('redeem', () => {
    it('is idempotent for the same token and conflicts on a different secret', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red');
      const { token, invitationId, code: tokenCode } = await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE });
      const first = await red.svc.redeem({ pluginId: PLUGIN, token, code: tokenCode });
      const second = await red.svc.redeem({ pluginId: PLUGIN, token, code: tokenCode });
      expect(second.invitationId).toBe(first.invitationId);
      expect(red.links.redeem).toHaveBeenCalledTimes(1);
      const payload = decodeToken(token);
      expect(await code(red.svc.redeem({ pluginId: PLUGIN, token: encodeToken({ ...payload, s: randomBytes(32).toString('base64url') }), code: tokenCode }))).toBe('already_redeemed');
      expect((await red.svc.list({ pluginId: PLUGIN })).map(s => s.invitationId)).toEqual([invitationId]);
    });

    it('enforces the pending-record bound', async () => {
      const w = await world();
      const red = w.make('red');
      for (let i = 0; i < INVITATION_LIMITS.pending; i++) await red.svc.redeem({ pluginId: PLUGIN, token: fakeToken({}, w.clock.now), code: TEST_CODE });
      expect(await code(red.svc.redeem({ pluginId: PLUGIN, token: fakeToken({}, w.clock.now), code: TEST_CODE }))).toBe('capacity');
      expect(red.links.redeem).toHaveBeenCalledTimes(INVITATION_LIMITS.pending);
    });

    it('treats link-store refusals as terminal reasons (ssh_host_key_mismatch, ssh_auth_refused, expired, identity_mismatch)', async () => {
      const w = await world();
      const red = w.make('red');
      for (const reason of ['ssh_host_key_mismatch', 'identity_mismatch', 'attempt_limit', 'already_connected'] as InvitationReason[]) {
        red.links.redeem.mockRejectedValueOnce(new InvitationError(reason));
        const status = await red.svc.redeem({ pluginId: PLUGIN, token: fakeToken({}, w.clock.now), code: TEST_CODE });
        expect(status).toMatchObject({ state: 'failed', reason });
        expect(red.terminated.at(-1)).toEqual([status.invitationId, 'redeemer', reason]);
      }
      // The join code's `expired` answer near the token's own expiry reads as expired...
      red.links.redeem.mockRejectedValueOnce(new InvitationError('expired'));
      expect(await red.svc.redeem({ pluginId: PLUGIN, token: fakeToken({ exp: w.clock.now + INVITATION_LIMITS.clockSkewMs }, w.clock.now), code: TEST_CODE }))
        .toMatchObject({ state: 'expired', reason: 'expired' });
      // ...but well inside the token's window the code was consumed: the invitation was already used.
      red.links.redeem.mockRejectedValueOnce(new InvitationError('expired'));
      const used = await red.svc.redeem({ pluginId: PLUGIN, token: fakeToken({}, w.clock.now), code: TEST_CODE });
      expect(used).toMatchObject({ state: 'failed', reason: 'already_redeemed' });
      expect(red.terminated.at(-1)).toEqual([used.invitationId, 'redeemer', 'already_redeemed']);
      expect(red.terminated).toHaveLength(6);
      expect(new InvitationError('ssh_host_key_mismatch').message).toContain('different SSH host key');
    });

    it('restarts after ssh_unreachable and retries unreachable with backoff', async () => {
      const w = await world();
      const red = w.make('red');
      const token = fakeToken({}, w.clock.now);
      red.links.redeem.mockRejectedValueOnce(new InvitationError('ssh_unreachable'));
      const failed = await red.svc.redeem({ pluginId: PLUGIN, token, code: TEST_CODE });
      expect(failed).toMatchObject({ state: 'failed', reason: 'ssh_unreachable' });
      // Re-pasting starts over until the token expires.
      const again = await red.svc.redeem({ pluginId: PLUGIN, token, code: TEST_CODE });
      expect(again.state).toBe('redeeming');
      expect(red.links.redeem).toHaveBeenCalledTimes(2);
      expect(again.reason).toBeUndefined();

      const other = fakeToken({}, w.clock.now);
      red.links.redeem.mockRejectedValueOnce(new InvitationError('unreachable')).mockRejectedValueOnce(new Error('network'));
      const flaky = await red.svc.redeem({ pluginId: PLUGIN, token: other, code: TEST_CODE });
      expect(flaky).toMatchObject({ state: 'redeeming', reason: 'unreachable' });
      expect(red.terminated).toHaveLength(1);
      // refresh forces a delivery (owed + unreachable), then throttles within refreshMinMs.
      w.clock.now += 5_000;
      expect(await red.svc.refresh({ pluginId: PLUGIN, invitationId: flaky.invitationId })).toMatchObject({ reason: 'unreachable' });
      expect(red.links.redeem).toHaveBeenCalledTimes(4);
      await red.svc.refresh({ pluginId: PLUGIN, invitationId: flaky.invitationId });
      expect(red.links.redeem).toHaveBeenCalledTimes(4);
      w.clock.now += INVITATION_LIMITS.refreshMinMs + 1;
      await red.svc.refresh({ pluginId: PLUGIN, invitationId: flaky.invitationId });
      expect(red.links.redeem).toHaveBeenCalledTimes(5);
      expect((await w.status(red, flaky.invitationId)).reason).toBeUndefined();
    });

    it('waits for the reverse link without burning an attempt, then is nudged', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red');
      const { token, invitationId, code: tokenCode } = await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE });
      await red.svc.redeem({ pluginId: PLUGIN, token, code: tokenCode });
      const calls = vi.fn();
      red.opts.linkRef = calls;
      await red.svc.nudge(invitationId);
      await red.svc.nudge('unknown-invitation');
      expect(red.sent).toHaveLength(0);
      expect((await w.status(red, invitationId)).state).toBe('redeeming');
    });
  });

  describe('owner decisions and termination', () => {
    it('inviter deny ends the attempt, bumps generation and propagates to the redeemer once', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red');
      const r = await w.reserve(inv, red);
      const id = r.created.invitationId;
      const denied = await inv.svc.decide({ pluginId: PLUGIN, invitationId: id, decision: 'denied' });
      expect(denied).toMatchObject({ state: 'denied', reason: 'denied', inviterDecision: 'denied', generation: 2 });
      expect(inv.terminated).toEqual([[id, 'inviter', 'denied']]);
      expect(await code(inv.svc.decide({ pluginId: PLUGIN, invitationId: id, decision: 'approved' }))).toBe('denied');
      // Bootstrap abort (link store) or the next poll reaches the redeemer with the signed terminal receipt.
      const polled = await red.svc.poll({ pluginId: PLUGIN, invitationId: id });
      expect(polled).toMatchObject({ state: 'denied', reason: 'denied' });
      expect(red.terminated).toEqual([[id, 'redeemer', 'denied']]);
      await red.svc.poll({ pluginId: PLUGIN, invitationId: id });
      expect(red.terminated).toHaveLength(1);
    });

    it('redeemer cancel ends locally, remote abort ends the inviter once, extra aborts are no-ops', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red');
      const r = await w.reserve(inv, red);
      const id = r.created.invitationId;
      const sent = red.sent.length;
      // Pasting the invitation already consented, so a redeemer-side deny is not offered: cancel is its way out.
      expect(await code(red.svc.decide({ pluginId: PLUGIN, invitationId: id, decision: 'denied' }))).toBe('not_ready');
      const cancelled = await red.svc.cancel({ pluginId: PLUGIN, invitationId: id });
      expect(cancelled).toMatchObject({ state: 'cancelled', reason: 'cancelled' });
      expect(red.terminated).toEqual([[id, 'redeemer', 'cancelled']]);
      expect(red.sent.length).toBe(sent);
      await inv.svc.terminateRemote(id, 'cancelled');
      expect(await w.status(inv, id)).toMatchObject({ state: 'cancelled', reason: 'cancelled' });
      await inv.svc.terminateRemote(id, 'denied');
      await inv.svc.terminateRemote('missing', 'cancelled');
      expect(inv.terminated).toEqual([[id, 'inviter', 'cancelled']]);
    });

    it('cancel is owner-local, idempotent, and the redeemer learns the real reason from a stale decision', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red');
      const open = await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE });
      expect(await inv.svc.cancel({ pluginId: PLUGIN, invitationId: open.invitationId })).toMatchObject({ state: 'cancelled', reason: 'cancelled' });
      await inv.svc.cancel({ pluginId: PLUGIN, invitationId: open.invitationId });
      expect(inv.terminated).toEqual([[open.invitationId, 'inviter', 'cancelled']]);
      expect(await code(inv.svc.cancel({ pluginId: 'other', invitationId: open.invitationId }))).toBe('not_found');

      const r = await w.reserve(inv, red);
      const id = r.created.invitationId;
      await inv.svc.cancel({ pluginId: PLUGIN, invitationId: id });
      // Redeemer still thinks reserved: its approval delivery is answered with the signed cancelled receipt.
      const after = await w.approve(red, id);
      expect(after).toMatchObject({ state: 'cancelled', reason: 'cancelled' });
      expect(red.terminated).toEqual([[id, 'redeemer', 'cancelled']]);
      expect(inv.terminated).toHaveLength(2);
    });

    it('rejects decisions that are not allowed', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red');
      const created = await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE });
      const id = created.invitationId;
      expect(await code(inv.svc.decide({ pluginId: PLUGIN, invitationId: id, decision: 'maybe' as never }))).toBe('not_ready');
      expect(await code(inv.svc.decide(undefined as never))).toBe('not_ready');
      expect(await code(inv.svc.decide({ pluginId: PLUGIN, invitationId: id, decision: 'denied' }))).toBe('not_ready');
      expect(await code(inv.svc.approvalRequest({ pluginId: PLUGIN, invitationId: id }))).toBe('not_ready');
      expect(await code(inv.svc.decide({ pluginId: PLUGIN, invitationId: 'missing', decision: 'denied' }))).toBe('not_found');
      void red;
    });

    it('fail() ends with the given reason; expired maps to the expired state', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red');
      const a = await red.svc.redeem({ pluginId: PLUGIN, token: fakeToken({}, w.clock.now), code: TEST_CODE });
      await red.svc.fail(a.invitationId, 'ssh_remote_login_off');
      expect(await w.status(red, a.invitationId)).toMatchObject({ state: 'failed', reason: 'ssh_remote_login_off' });
      await red.svc.fail(a.invitationId, 'unreachable');
      await red.svc.fail('missing', 'unreachable');
      expect(red.terminated).toEqual([[a.invitationId, 'redeemer', 'ssh_remote_login_off']]);
      const b = await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE });
      await inv.svc.fail(b.invitationId, 'expired');
      expect(await w.status(inv, b.invitationId)).toMatchObject({ state: 'expired', reason: 'expired' });
    });

    it('survives throwing observers', async () => {
      const w = await world();
      const boom = () => { throw new Error('observer'); };
      const inv = w.make('inv', { onChanged: boom, onTerminated: boom, onConsented: boom }), red = w.make('red', { onChanged: boom, onConsented: boom });
      const c = await w.consent(inv, red);
      expect(c.onInviter.state).toBe('consented');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await inv.svc.cancel({ pluginId: PLUGIN, invitationId: c.invitationId });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('onTerminated observer failed'));
      warn.mockRestore();
    });
  });

  describe('expiry', () => {
    it('open invitation expires at the token TTL and reports once', async () => {
      const w = await world();
      const inv = w.make('inv');
      const { invitationId } = await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE });
      w.clock.now += INVITATION_LIMITS.ttlMs - 1;
      expect((await w.status(inv, invitationId)).state).toBe('open');
      w.clock.now += 1;
      expect(await w.status(inv, invitationId)).toMatchObject({ state: 'expired', reason: 'expired' });
      await inv.svc.sweep();
      expect(inv.terminated).toEqual([[invitationId, 'inviter', 'expired']]);
    });

    it('a reserved attempt expires at the consent window on both sides', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red');
      const r = await w.reserve(inv, red);
      const id = r.created.invitationId;
      const reserved = await w.status(inv, id);
      w.clock.now = reserved.consentExpiresAt! - 1;
      expect((await w.status(red, id)).state).toBe('reserved');
      w.clock.now = reserved.consentExpiresAt!;
      expect(await w.status(inv, id)).toMatchObject({ state: 'expired', reason: 'expired' });
      expect(await w.status(red, id)).toMatchObject({ state: 'expired', reason: 'expired' });
      expect(inv.terminated).toEqual([[id, 'inviter', 'expired']]);
      expect(red.terminated).toEqual([[id, 'redeemer', 'expired']]);
    });

    it('a redeeming attempt dies with the token while the link is unredeemed, and gets the consent window afterwards', async () => {
      const w = await world();
      const red = w.make('red');
      red.links.redeem.mockRejectedValue(new Error('down'));
      const stuck = await red.svc.redeem({ pluginId: PLUGIN, token: fakeToken({}, w.clock.now), code: TEST_CODE });
      red.links.redeem.mockReset().mockResolvedValue(undefined);
      const linked = await red.svc.redeem({ pluginId: PLUGIN, token: fakeToken({}, w.clock.now), code: TEST_CODE });
      expect(linked.state).toBe('redeeming');
      w.clock.now += INVITATION_LIMITS.ttlMs;
      expect(await w.status(red, stuck.invitationId)).toMatchObject({ state: 'expired', reason: 'expired' });
      expect((await w.status(red, linked.invitationId)).state).toBe('redeeming');
      w.clock.now += INVITATION_LIMITS.consentWindowMs;
      expect(await w.status(red, linked.invitationId)).toMatchObject({ state: 'expired' });
      expect(red.terminated.map(row => row[2])).toEqual(['expired', 'expired']);
    });

    it('a consented attempt whose founding never finishes fails with expired at the founding window', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red');
      const c = await w.consent(inv, red);
      const end = c.view ? (await w.status(inv, c.invitationId)).consentExpiresAt! : 0;
      w.clock.now = end + INVITATION_LIMITS.foundingMs + INVITATION_LIMITS.clockSkewMs - 1;
      expect((await w.status(inv, c.invitationId)).state).toBe('consented');
      w.clock.now += 1;
      expect(await w.status(inv, c.invitationId)).toMatchObject({ state: 'failed', reason: 'expired' });
      expect(await w.status(red, c.invitationId)).toMatchObject({ state: 'failed', reason: 'expired' });
      expect(inv.terminated).toEqual([[c.invitationId, 'inviter', 'expired']]);
      expect(await inv.svc.listConsented()).toEqual([]);
    });

    it('a connecting attempt also expires at the founding window', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red');
      const c = await w.consent(inv, red);
      await inv.svc.markConnecting(fenceOf(c.onInviter));
      const end = (await w.status(inv, c.invitationId)).consentExpiresAt!;
      w.clock.now = end + INVITATION_LIMITS.foundingMs + INVITATION_LIMITS.clockSkewMs;
      expect(await w.status(inv, c.invitationId)).toMatchObject({ state: 'failed', reason: 'expired' });
    });
  });

  describe('bootstrap plane (inviter side)', () => {
    it('rejects malformed bodies, unknown invitations and mismatched attested identity', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red');
      const r = await w.reserve(inv, red);
      const good = await red.svc.redeemWire(r.created.invitationId) as { invitationId: string };
      expect(await code(inv.svc.acceptRedeem({ nope: 1 }, { redeemerId: red.id }))).toBe('invalid_invitation');
      expect(await code(inv.svc.acceptRedeem(good, undefined as never))).toBe('invalid_invitation');
      expect(await code(inv.svc.acceptRedeem({ ...good, invitationId: 'unknown' }, { redeemerId: red.id }))).toBe('not_found');
      // Attested instance differs from the signed offer's redeemer.
      expect(await code(inv.svc.acceptRedeem(good, { redeemerId: randomUUID() }))).toBe('identity_mismatch');
      // Exact retransmission by the right redeemer is answered idempotently.
      const a = await inv.svc.acceptRedeem(good, { redeemerId: red.id });
      expect(a).toMatchObject({ v: 1 });
      expect(await code(inv.svc.acceptExchange({ v: 1, invitationId: 'unknown', sealed: 'AAAA' }, { redeemerId: red.id }))).toBe('not_found');
      expect(await code(inv.svc.acceptExchange({ bad: 1 }, { redeemerId: red.id }))).toBe('invalid_invitation');
      expect(await code(inv.svc.acceptExchange({ v: 1, invitationId: r.created.invitationId, sealed: 'AAAA' }, { redeemerId: randomUUID() }))).toBe('identity_mismatch');
      expect(await code(inv.svc.acceptExchange({ v: 1, invitationId: r.created.invitationId, sealed: 'AAAA' }, { redeemerId: red.id }))).toBe('identity_mismatch');
    });

    it('second redeemer is refused with already_redeemed and ends locally as failed', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red'), late = w.make('late');
      const r = await w.reserve(inv, red);
      const id = r.created.invitationId;
      const token = r.created.token;
      await late.svc.redeem({ pluginId: PLUGIN, token, code: r.created.code });
      late.refs.set(id, { hostId: randomUUID(), recipientId: inv.id });
      await late.svc.nudge(id);
      expect(await w.status(late, id)).toMatchObject({ state: 'failed', reason: 'already_redeemed' });
      expect(late.terminated).toEqual([[id, 'redeemer', 'already_redeemed']]);
      expect((await w.status(inv, id)).peer?.instanceId).toBe(red.id);
    });

    it('rejects replayed exchanges and answers stale-generation for non-terminal fence', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red');
      const r = await w.reserve(inv, red);
      await w.approve(inv, r.created.invitationId);
      await red.svc.poll({ pluginId: PLUGIN, invitationId: r.created.invitationId });
      const statusMsg = red.sent.filter(s => s.kind === 'exchange').at(-1)!;
      expect(await code(inv.svc.acceptExchange(statusMsg.body, { redeemerId: red.id }))).toBe('replay');
    });

    it('locks after the attempt budget and tells the legitimate redeemer', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red');
      const created = await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE });
      const junk = { v: 1, invitationId: created.invitationId, redeemerX: randomBytes(32).toString('base64url'), sealed: 'AAAAAAAA' };
      for (let i = 0; i < INVITATION_LIMITS.attemptsPerInvitation; i++) expect(await code(inv.svc.acceptRedeem(junk, { redeemerId: red.id }))).toBe('invalid_invitation');
      expect(await w.status(inv, created.invitationId)).toMatchObject({ state: 'cancelled', reason: 'attempt_limit' });
      expect(await code(inv.svc.acceptRedeem(junk, { redeemerId: red.id }))).toBe('attempt_limit');
      await red.svc.redeem({ pluginId: PLUGIN, token: created.token, code: created.code });
      red.refs.set(created.invitationId, { hostId: randomUUID(), recipientId: inv.id });
      await red.svc.nudge(created.invitationId);
      expect(await w.status(red, created.invitationId)).toMatchObject({ state: 'failed', reason: 'attempt_limit' });
    });

    it('tells a redeemer reaching an expired or cancelled invitation the real reason', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red'), red2 = w.make('red2');
      const a = await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE });
      await red.svc.redeem({ pluginId: PLUGIN, token: a.token, code: a.code });
      await inv.svc.cancel({ pluginId: PLUGIN, invitationId: a.invitationId });
      red.refs.set(a.invitationId, { hostId: randomUUID(), recipientId: inv.id });
      await red.svc.nudge(a.invitationId);
      expect(await w.status(red, a.invitationId)).toMatchObject({ state: 'failed', reason: 'cancelled' });
      const b = await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE });
      await red2.svc.redeem({ pluginId: PLUGIN, token: b.token, code: b.code });
      await red2.svc.redeemWire(b.invitationId);
      w.clock.now += INVITATION_LIMITS.ttlMs;
      red2.refs.set(b.invitationId, { hostId: randomUUID(), recipientId: inv.id });
      await red2.svc.nudge(b.invitationId);
      expect(await w.status(red2, b.invitationId)).toMatchObject({ state: 'expired', reason: 'expired' });
    });

    it('acceptRedeem takes the attested serverId (enforced by the link store, not here)', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red');
      const r = await w.reserve(inv, red);
      const wire = await red.svc.redeemWire(r.created.invitationId);
      // peer-invitation.ts ignores attested.serverId: a mismatching one is still accepted (see report).
      await expect(inv.svc.acceptRedeem(wire, { redeemerId: red.id, serverId: 'another-server' })).resolves.toMatchObject({ v: 1 });
    });
  });

  describe('redeemWire', () => {
    it('only serves live redeemer records with a deterministic body', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red');
      const r = await w.reserve(inv, red);
      const id = r.created.invitationId;
      const one = await red.svc.redeemWire(id) as Record<string, unknown>;
      const two = await red.svc.redeemWire(id) as Record<string, unknown>;
      expect(one).toMatchObject({ v: 1, invitationId: id });
      expect(two).toMatchObject({ v: 1, invitationId: id, redeemerX: one.redeemerX });
      expect(JSON.stringify(one)).not.toContain(decodeToken(r.created.token).s as string);
      expect(await code(inv.svc.redeemWire(id))).toBe('not_found');
      expect(await code(red.svc.redeemWire('missing'))).toBe('not_found');
      await red.svc.fail(id, 'unreachable');
      expect(await code(red.svc.redeemWire(id))).toBe('not_found');
    });
  });

  describe('fencing and state advance', () => {
    it('markFailed terminates with unreachable and notifies once; stale fences are refused', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red');
      const c = await w.consent(inv, red);
      expect(await code(red.svc.markReady({ ...fenceOf(c.onRedeemer), generation: 9 }))).toBe('fenced');
      await red.svc.markFailed(fenceOf(c.onRedeemer));
      expect(await w.status(red, c.invitationId)).toMatchObject({ state: 'failed', reason: 'unreachable' });
      expect(red.terminated).toEqual([[c.invitationId, 'redeemer', 'unreachable']]);
      expect(await code(red.svc.markReady(fenceOf(c.onRedeemer)))).toBe('fenced');
      expect(await code(inv.svc.fence(undefined as never))).toBe('fenced');
    });

    it('a cancel after consent bumps the generation so old fences fail', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red');
      const c = await w.consent(inv, red);
      await inv.svc.cancel({ pluginId: PLUGIN, invitationId: c.invitationId });
      expect(await code(inv.svc.fence(fenceOf(c.onInviter)))).toBe('fenced');
      expect((await w.status(inv, c.invitationId)).generation).toBe(2);
    });
  });

  describe('founding (redeemer)', () => {
    it('validates op, role, link and transport failures', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red');
      const c = await w.consent(inv, red);
      const f = fenceOf(c.onRedeemer);
      expect(await code(red.svc.founding(f, { op: 'bogus' as never }))).toBe('not_ready');
      expect(await code(red.svc.founding(f, undefined as never))).toBe('not_ready');
      expect(await code(red.svc.founding({ ...f, generation: 5 }, { op: 'offer' }))).toBe('fenced');
      expect(await code(inv.svc.founding(fenceOf(c.onInviter), { op: 'offer' }))).toBe('fenced');
      red.refs.delete(c.invitationId);
      expect(await code(red.svc.founding(f, { op: 'offer' }))).toBe('unreachable');
      red.refs.set(c.invitationId, { hostId: randomUUID(), recipientId: inv.id });
      red.offline = true;
      expect(await code(red.svc.founding(f, { op: 'offer' }))).toBe('unreachable');
      red.offline = false;
      red.opts.linkRef = () => { throw new Error('boom'); };
      expect(await code(red.svc.founding(f, { op: 'offer' }))).toBe('unreachable');
      const ctl = new AbortController();
      await red.svc.founding(f, { op: 'offer' }, ctl.signal).catch(() => undefined);
      expect(inv.founding).toEqual([]);
    });

    it('maps inviter refusals and bad receipts onto terminal or retryable outcomes', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red');
      const c = await w.consent(inv, red);
      const f = fenceOf(c.onRedeemer);
      red.intercept = async () => ({ status: 500, body: { error: 'boom' } });
      expect(await code(red.svc.founding(f, { op: 'offer' }))).toBe('unreachable');
      red.intercept = async () => ({ status: 200, body: { v: 1, sealed: 'AAAA' } });
      expect(await code(red.svc.founding(f, { op: 'offer' }))).toBe('fenced');
      expect(await w.status(red, c.invitationId)).toMatchObject({ state: 'failed', reason: 'identity_mismatch' });
    });

    it('maps a 410 expired and a 403 cancelled refusal', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red'), red2 = w.make('red2'), inv2 = w.make('inv2');
      const c = await w.consent(inv, red);
      red.intercept = async () => ({ status: 410, body: { error: 'expired' } });
      expect(await code(red.svc.founding(fenceOf(c.onRedeemer), { op: 'offer' }))).toBe('fenced');
      expect(await w.status(red, c.invitationId)).toMatchObject({ state: 'expired', reason: 'expired' });
      const d = await w.consent(inv2, red2);
      red2.intercept = async () => ({ status: 403, body: { error: 'stale_generation' } });
      expect(await code(red2.svc.founding(fenceOf(d.onRedeemer), { op: 'offer' }))).toBe('fenced');
      expect(await w.status(red2, d.invitationId)).toMatchObject({ state: 'failed', reason: 'stale_generation' });
    });

    it('learns a terminal outcome from the inviter receipt and stops', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red');
      const c = await w.consent(inv, red);
      await inv.svc.cancel({ pluginId: PLUGIN, invitationId: c.invitationId });
      expect(await code(red.svc.founding(fenceOf(c.onRedeemer), { op: 'offer' }))).toBe('fenced');
      expect(await w.status(red, c.invitationId)).toMatchObject({ state: 'cancelled', reason: 'cancelled' });
      expect(inv.founding).toEqual([]);
    });

    it('founding(): a terminal receipt ends the redeemer and fires onTerminated once', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red');
      const c = await w.consent(inv, red);
      await inv.svc.cancel({ pluginId: PLUGIN, invitationId: c.invitationId });
      expect(await code(red.svc.founding(fenceOf(c.onRedeemer), { op: 'offer' }))).toBe('fenced');
      expect(red.terminated).toEqual([[c.invitationId, 'redeemer', 'cancelled']]);
    });

    it('acceptRedeem(): attempt budget lockout fires onTerminated once', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red');
      const created = await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE });
      const junk = { v: 1, invitationId: created.invitationId, redeemerX: randomBytes(32).toString('base64url'), sealed: 'AAAAAAAA' };
      for (let i = 0; i < INVITATION_LIMITS.attemptsPerInvitation + 2; i++) await code(inv.svc.acceptRedeem(junk, { redeemerId: red.id }));
      expect(inv.terminated).toEqual([[created.invitationId, 'inviter', 'attempt_limit']]);
      expect(await w.status(inv, created.invitationId)).toMatchObject({ state: 'cancelled', reason: 'attempt_limit' });
    });

    it('onFounding failures: fenced is answered, anything else is unavailable (retryable)', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red');
      const c = await w.consent(inv, red);
      const f = fenceOf(c.onRedeemer);
      inv.opts.onFounding = async () => { throw new InvitationError('fenced'); };
      await red.svc.founding(f, { op: 'offer' });
      inv.opts.onFounding = async () => { throw new Error('store down'); };
      expect(await code(red.svc.founding(f, { op: 'offer' }))).toBe('unreachable');
      expect((await w.status(red, c.invitationId)).state).toBe('consented');
    });

    it('without onFounding the receipt alone is returned', async () => {
      const w = await world();
      const inv = w.make('inv', { onFounding: undefined }), red = w.make('red');
      const c = await w.consent(inv, red);
      await red.svc.founding(fenceOf(c.onRedeemer), { op: 'ack' });
      expect(inv.founding).toEqual([]);
    });
  });

  describe('redeemer delivery settle branches', () => {
    it('maps inviter refusals, bad receipts and transient failures', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red');
      const created = await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE });
      await red.svc.redeem({ pluginId: PLUGIN, token: created.token, code: created.code });
      const id = created.invitationId;
      red.refs.set(id, { hostId: randomUUID(), recipientId: inv.id });
      red.offline = true;
      await red.svc.nudge(id);
      expect(await w.status(red, id)).toMatchObject({ state: 'redeeming', reason: 'unreachable' });
      red.offline = false;
      red.intercept = async () => ({ status: 500, body: null });
      w.clock.now += 60_000;
      await red.svc.nudge(id);
      expect((await w.status(red, id)).reason).toBe('unreachable');
      red.intercept = async () => ({ status: 200, body: { v: 1, sealed: 'AAAA' } });
      w.clock.now += 60_000;
      await red.svc.nudge(id);
      expect(await w.status(red, id)).toMatchObject({ state: 'failed', reason: 'identity_mismatch' });
    });

    it('a 410 expired on redeem expires; a 403 cancelled fails; stale_generation falls back to a status poll', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red');
      const a = await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE });
      await red.svc.redeem({ pluginId: PLUGIN, token: a.token, code: a.code });
      red.refs.set(a.invitationId, { hostId: randomUUID(), recipientId: inv.id });
      red.intercept = async () => ({ status: 410, body: { error: 'expired' } });
      await red.svc.nudge(a.invitationId);
      expect(await w.status(red, a.invitationId)).toMatchObject({ state: 'expired', reason: 'expired' });

      const b = await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE });
      await red.svc.redeem({ pluginId: PLUGIN, token: b.token, code: b.code });
      red.refs.set(b.invitationId, { hostId: randomUUID(), recipientId: inv.id });
      red.intercept = async () => ({ status: 403, body: { error: 'cancelled' } });
      await red.svc.nudge(b.invitationId);
      expect(await w.status(red, b.invitationId)).toMatchObject({ state: 'failed', reason: 'cancelled' });

      red.intercept = undefined;
      const c = await w.reserve(inv, red);
      red.intercept = async kind => (kind === 'exchange' ? { status: 403, body: { error: 'stale_generation' } } : { status: 500, body: null });
      await w.approve(red, c.created.invitationId);
      expect((await w.status(red, c.created.invitationId)).state).toBe('reserved');
      red.intercept = undefined;
      await red.svc.refresh({ pluginId: PLUGIN, invitationId: c.created.invitationId });
      expect((await w.status(red, c.created.invitationId)).state).toBe('reserved');
      expect(await code(red.svc.refresh({ pluginId: PLUGIN, invitationId: 'missing' }))).toBe('not_found');
    });

    it('an undelivered implicit decision is requeued and ends in consent after the inviter catches up', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red');
      red.intercept = async (kind, _body, real) => (kind === 'exchange' ? { status: 500, body: null } : real());
      const c = await w.reserve(inv, red);
      const id = c.created.invitationId;
      const pending = await red.svc.poll({ pluginId: PLUGIN, invitationId: id });
      expect(pending).toMatchObject({ state: 'reserved', redeemerDecision: 'approved', reason: 'unreachable' });
      expect((await w.status(inv, id)).redeemerDecision).toBe('pending');
      await w.approve(inv, id);
      red.intercept = undefined;
      w.clock.now += 60_000;
      const after = await red.svc.poll({ pluginId: PLUGIN, invitationId: id });
      expect(after.state).toBe('consented');
      expect((await w.status(inv, id)).state).toBe('consented');
    });
  });

  describe('lifecycle', () => {
    it('resumes pending deliveries after a restart from the same directory', async () => {
      const w = await world();
      const inv = w.make('inv');
      const red = w.make('red');
      const created = await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE });
      await red.svc.redeem({ pluginId: PLUGIN, token: created.token, code: created.code });
      red.refs.set(created.invitationId, { hostId: randomUUID(), recipientId: inv.id });
      red.offline = true;
      await red.svc.nudge(created.invitationId);
      red.svc.dispose();
      await red.svc.whenIdle();
      w.clock.now += 60_000;
      const reborn = w.make('red-again', { id: red.id, dir: red.opts.directory });
      reborn.refs.set(created.invitationId, { hostId: randomUUID(), recipientId: inv.id });
      reborn.svc.start();
      await vi.waitFor(async () => { expect((await w.status(reborn, created.invitationId)).state).toBe('reserved'); }, { timeout: 5000 });
      expect((await w.status(inv, created.invitationId)).state).toBe('reserved');
      expect(await reborn.svc.list({ pluginId: PLUGIN })).toHaveLength(1);
      reborn.svc.dispose();
    });

    it('dispose stops timers, deliveries and new operations', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red');
      const created = await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE });
      await red.svc.redeem({ pluginId: PLUGIN, token: created.token, code: created.code });
      red.refs.set(created.invitationId, { hostId: randomUUID(), recipientId: inv.id });
      const clear = vi.spyOn(globalThis, 'clearTimeout');
      red.svc.start();
      red.svc.dispose();
      expect(clear).toHaveBeenCalled();
      clear.mockRestore();
      red.svc.dispose();
      red.svc.start();
      await red.svc.nudge(created.invitationId);
      await red.svc.sweep();
      await red.svc.whenIdle();
      expect(red.sent).toHaveLength(0);
      expect(await code(red.svc.create({ pluginId: PLUGIN, scope: SCOPE }))).toBe('unavailable');
      expect(await code(red.svc.status({ pluginId: PLUGIN, invitationId: created.invitationId }))).toBe('unavailable');
      expect(await code(red.svc.founding({ invitationId: 'x', pairingId: 'y', consentDigest: 'z', generation: 1 }, { op: 'offer' }))).toBe('unavailable');
    });

    it('sanitizes the advertised local name', async () => {
      const w = await world();
      const a = w.make('a', { localName: () => '  \u0007bad\nname  ' }), b = w.make('b', { localName: () => undefined as never }), c = w.make('c', { localName: () => '\u0001\u0002' });
      expect(decodeToken((await a.svc.create({ pluginId: PLUGIN, scope: SCOPE })).token).name).toBe('bad name');
      expect(decodeToken((await b.svc.create({ pluginId: PLUGIN, scope: SCOPE })).token).name).toBe('Zana');
      expect(decodeToken((await c.svc.create({ pluginId: PLUGIN, scope: SCOPE })).token).name).toBe('Zana');
    });

    it('list is newest first, per plugin, and bounded', async () => {
      const w = await world();
      const inv = w.make('inv');
      const one = await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE });
      w.clock.now += 10;
      const two = await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE });
      await inv.svc.create({ pluginId: 'other-plugin', scope: SCOPE });
      const rows: PublicInvitationStatus[] = await inv.svc.list({ pluginId: PLUGIN });
      expect(rows.map(r => r.invitationId)).toEqual([one.invitationId, two.invitationId].reverse());
      expect(await inv.svc.list({ pluginId: PLUGIN, limit: 1 })).toHaveLength(1);
      expect(createHash('sha256').update(JSON.stringify(rows)).digest('hex')).toHaveLength(64);
    });
  });
  describe('core connection (no plugin, no scope)', () => {
    const CORE = { pluginId: undefined } as const;

    it('creates a token without plugin or scope and pairs through consent and founding', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red');
      const created = await inv.svc.create({});
      expect(inv.links.create).toHaveBeenCalledWith({ invitationId: created.invitationId });
      const payload = decodeToken(created.token);
      expect(payload).not.toHaveProperty('plugin');
      expect(payload).not.toHaveProperty('scope');
      expect(parseInvitationToken(created.token)).toMatchObject({ v: 3, inviter: inv.id });

      const redeemed = await red.svc.redeem({ token: created.token, code: created.code });
      expect(redeemed).not.toHaveProperty('pluginId');
      expect(redeemed).not.toHaveProperty('scope');
      expect(red.links.redeem.mock.calls[0]![0]).not.toHaveProperty('pluginId');
      expect(red.links.redeem.mock.calls[0]![0]).not.toHaveProperty('scope');
      red.refs.set(created.invitationId, { hostId: randomUUID(), recipientId: inv.id });
      await red.svc.nudge(created.invitationId);
      await red.svc.poll({ invitationId: created.invitationId });
      expect(await inv.svc.status({ invitationId: created.invitationId })).toMatchObject({ role: 'inviter', state: 'reserved' });

      const request = await inv.svc.approvalRequest({ invitationId: created.invitationId });
      expect(request.binding).toMatchObject({ subject: 'inviter:core' });
      expect(request.summary).toContain('Computer red');
      expect(request.summary).not.toMatch(/undefined|sync/);
      const { pairingCode } = await red.svc.status({ invitationId: created.invitationId });
      expect(pairingCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
      // A plugin-signed approval cannot stand in for the core principal.
      expect(await code(inv.svc.decide({ invitationId: created.invitationId, decision: 'approved', pairingCode, ownerProof: w.owner.sign(PLUGIN, request.binding) }))).toBe('owner_proof_required');
      const decided = await inv.svc.decide({ invitationId: created.invitationId, decision: 'approved', pairingCode: pairingCode!.toLowerCase().replace('-', ''),
        ownerProof: w.owner.sign(CORE_APPROVAL_PRINCIPAL, request.binding) });
      expect(decided.inviterDecision).toBe('approved');
      expect(decided.state).toBe('consented');
      await red.svc.poll({ invitationId: created.invitationId });

      const [pi] = await inv.svc.listConsented();
      const [pr] = await red.svc.listConsented();
      expect(pi).not.toHaveProperty('pluginId');
      expect(pi).toMatchObject({ role: 'inviter', state: 'consented', remote: { instanceId: red.id } });
      expect(pr).toMatchObject({ role: 'redeemer', pairingId: pi!.pairingId, consentDigest: pi!.consentDigest });
      await red.svc.founding(fenceOf(pr!), { op: 'offer' });
      await inv.svc.markConnecting(fenceOf(pi!));
      await red.svc.markConnecting(fenceOf(pr!));
      await red.svc.founding(fenceOf(pr!), { op: 'ack' });
      await inv.svc.markReady(fenceOf(pi!));
      await red.svc.markReady(fenceOf(pr!));
      expect((await inv.svc.status({ invitationId: created.invitationId })).state).toBe('ready');
      expect((await red.svc.status({ invitationId: created.invitationId })).state).toBe('ready');
      expect(inv.changed).toContain(undefined);
    });

    it('keeps core and plugin records apart and never raises wrong_plugin for a core pair', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red'), red2 = w.make('red2');
      const core = await inv.svc.create({});
      const scoped = await inv.svc.create({ pluginId: PLUGIN, scope: SCOPE });
      expect((await inv.svc.list({})).map(row => row.invitationId)).toEqual([core.invitationId]);
      expect((await inv.svc.list({ pluginId: PLUGIN })).map(row => row.invitationId)).toEqual([scoped.invitationId]);
      expect(await code(inv.svc.status({ pluginId: PLUGIN, invitationId: core.invitationId }))).toBe('not_found');
      expect(await code(inv.svc.status({ invitationId: scoped.invitationId }))).toBe('not_found');
      // A core caller cannot redeem a plugin invitation and a plugin cannot redeem a core one.
      expect(await code(red.svc.redeem({ token: scoped.token, code: scoped.code }))).toBe('wrong_plugin');
      expect(await code(red2.svc.redeem({ pluginId: PLUGIN, token: core.token, code: core.code }))).toBe('wrong_plugin');
      expect(await code(red.svc.redeem({ token: core.token, code: core.code }))).toBe('resolved');
    });

    it('rejects a half-specified plugin/scope pair and tokens that carry one', async () => {
      const w = await world();
      const inv = w.make('inv');
      expect(await code(inv.svc.create({ pluginId: PLUGIN }))).toBe('invalid_invitation');
      expect(await code(inv.svc.create({ scope: SCOPE }))).toBe('invalid_invitation');
      const { token } = await inv.svc.create({});
      expect(() => parseInvitationToken(encodeToken({ ...decodeToken(token), plugin: PLUGIN }))).toThrow(InvitationError);
      expect(() => parseInvitationToken(encodeToken({ ...decodeToken(token), scope: SCOPE }))).toThrow(InvitationError);
    });

    it('binds the plugin and scope into the consent digest so a core digest differs from a scoped one', () => {
      const endpoint = (n: number) => ({ instanceId: `id${n}`, name: 'n', fingerprint: 'f'.repeat(43), ed: 'e'.repeat(43), x: 'x'.repeat(43) });
      const base = { id: 'inv1', pairingId: 'pair1', inviter: endpoint(1), redeemer: endpoint(2) };
      const core = consentDigestOf(base);
      expect(consentDigestOf({ ...base, pluginId: PLUGIN, scope: SCOPE })).not.toBe(core);
      expect(consentDigestOf({ ...base, pluginId: PLUGIN, scope: 'repo:beta' })).not.toBe(consentDigestOf({ ...base, pluginId: PLUGIN, scope: SCOPE }));
      expect(consentDigestOf({ ...base })).toBe(core);
    });

    /** Core inviter + redeemer reserved; returns the code the redeemer shows. */
    const reserveCore = async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red');
      const created = await inv.svc.create({});
      const redeemed = await red.svc.redeem({ token: created.token, code: created.code });
      expect(redeemed).not.toHaveProperty('pairingCode');
      red.refs.set(created.invitationId, { hostId: randomUUID(), recipientId: inv.id });
      await red.svc.nudge(created.invitationId);
      await red.svc.poll({ invitationId: created.invitationId });
      const invitationId = created.invitationId;
      const shown = (await red.svc.status({ invitationId })).pairingCode!;
      const proof = async () => w.owner.sign(CORE_APPROVAL_PRINCIPAL, (await inv.svc.approvalRequest({ invitationId })).binding);
      return { w, inv, red, invitationId, shown, proof };
    };

    it('shows the pairing code only to the redeemer, derived from the consent digest both sides hold', async () => {
      const { inv, red, invitationId, shown } = await reserveCore();
      const inviterView = await inv.svc.status({ invitationId });
      expect(inviterView).not.toHaveProperty('pairingCode');
      expect(shown).toBe(pairingCodeOf(Buffer.from(inviterView.consentDigest!, 'base64url')));
      expect((await red.svc.list({}))[0]!.pairingCode).toBe(shown);
    });

    it('requires the typed code to approve, without consuming the owner proof on a wrong code', async () => {
      const { inv, invitationId, shown, proof } = await reserveCore();
      const token = await proof();
      expect(await code(inv.svc.decide({ invitationId, decision: 'approved', ownerProof: token }))).toBe('identity_mismatch');
      const wrong = shown.startsWith('0') ? '1' + shown.slice(1) : '0' + shown.slice(1);
      expect(await code(inv.svc.decide({ invitationId, decision: 'approved', pairingCode: wrong, ownerProof: token }))).toBe('identity_mismatch');
      expect(await code(inv.svc.decide({ invitationId, decision: 'approved', pairingCode: 'not a code', ownerProof: token }))).toBe('identity_mismatch');
      expect((await inv.svc.status({ invitationId })).state).toBe('reserved');
      // The same proof still works: a wrong code is refused before the single-use proof is checked.
      const decided = await inv.svc.decide({ invitationId, decision: 'approved', pairingCode: ` ${shown.toLowerCase()} `, ownerProof: token });
      expect(decided.inviterDecision).toBe('approved');
    });

    it('burns the invitation after the mismatch limit, independent of the redeem attempt counter', async () => {
      const { inv, red, invitationId, shown, proof } = await reserveCore();
      const wrong = shown.startsWith('0') ? '1' + shown.slice(1) : '0' + shown.slice(1);
      for (let i = 1; i < PAIRING_CODE_MISMATCH_LIMIT; i++) {
        expect(await code(inv.svc.decide({ invitationId, decision: 'approved', pairingCode: wrong, ownerProof: await proof() }))).toBe('identity_mismatch');
      }
      expect(await code(inv.svc.decide({ invitationId, decision: 'approved', pairingCode: wrong, ownerProof: await proof() }))).toBe('attempt_limit');
      expect(await inv.svc.status({ invitationId })).toMatchObject({ state: 'cancelled', reason: 'attempt_limit' });
      expect(inv.terminated).toContainEqual([invitationId, 'inviter', 'attempt_limit']);
      // Even the right code cannot revive it, and the redeemer learns it ended.
      expect(await code(inv.svc.decide({ invitationId, decision: 'approved', pairingCode: shown, ownerProof: 'x' }))).toBe('attempt_limit');
      await red.svc.poll({ invitationId });
      expect((await red.svc.status({ invitationId })).state).toBe('cancelled');
    });

    it('denies without a code and leaves plugin approvals unchanged', async () => {
      const { inv, invitationId } = await reserveCore();
      expect((await inv.svc.decide({ invitationId, decision: 'denied' })).state).toBe('denied');
      const w = await world();
      const pinv = w.make('pinv'), pred = w.make('pred');
      const { created } = await w.reserve(pinv, pred);
      expect((await w.approve(pinv, created.invitationId)).inviterDecision).toBe('approved');
    });

    it('a signed offer for a core invitation is refused when it names a plugin', async () => {
      const w = await world();
      const inv = w.make('inv'), red = w.make('red');
      const created = await inv.svc.create({});
      await red.svc.redeem({ token: created.token, code: created.code });
      red.refs.set(created.invitationId, { hostId: randomUUID(), recipientId: inv.id });
      const wire = await red.svc.redeemWire(created.invitationId);
      // Tamper: the inviter's record is core, so any wire not built for a core offer must not pair.
      expect(await code(inv.svc.acceptRedeem({ ...wire, sealed: 'AAAA' }, { redeemerId: red.id }))).toBe('invalid_invitation');
      expect(await code(inv.svc.acceptRedeem(wire, { redeemerId: red.id }))).toBe('resolved');
    });
  });
});
