import { createHash, randomBytes } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { z } from 'zod';
import { addHostLinkUse, destroyHost, getHost, removeHostLinkUse, type ZccDatabase } from '@zana-ai/zcc-db';
import { generateSeed, publicKeyLine } from '@zana-ai/zcc-host-daemon/ssh-keys';
import type { HostHub } from '../../http/host-hub.js';
import type { JoinCodeStore } from '../hosts/join-codes.js';
import type { PeerLinkDirectory } from '../hosts/peer-link-view.js';
import type { EnrolledPeerChannels } from './enrolled-peer-channels.js';
import { defaultInstallerConnector, type InstallerConnection, type InstallerConnector } from './introduction-installer.js';
import { PEER_ID, PEER_TOKEN, PrivatePeerStorage, validScope, type PeerKeyProvider } from './peer-auth.js';
import {
  BOOTSTRAP_LIMITS, BootstrapRejection, createBootstrapSender, type BootstrapLinkRecord, type BootstrapSend, type ExchangeReply,
  type PeerLinkPhase, type PeerLinksControlPort, type PullReply
} from './peer-link-bootstrap.js';
import type { RelinkReply } from './peer-control-protocol.js';
import {
  INVITATION_LIMITS, InvitationError, type ConsentedPairing, type FoundingOp, type InvitationLinkMint,
  type InvitationLinkRef, type InvitationLinks, type InvitationReason, type InvitationSshOffer, type InvitationTransport, type PairingFence,
  type PeerInvitations
} from './peer-invitation.js';
import { SSH_REASONS, type PeerSshTransport, type PeerSshTunnel, type SshReason } from './peer-ssh-contract.js';

/**
 * Invitation-founded peer links over an SSH tunnel between the two computers (plan-ssh-peer-transport).
 *
 * One mutual `peer.forward` link per app pair. B (the redeemer) opens one ssh to A's (the inviter's) OS sshd: `-L`
 * reaches A's peer forwarder, `-R` lets A reach B's. Each side mints its own inbound forward-only host (a local join
 * code) and the other side enrolls and connects into it over loopback http:
 * - inviter A mints H (the token carries the code); redeemer B tunnels in, enrolls into H and connects;
 * - A sees B's connector on H, pulls B's sealed redeem and B's lazily minted reverse code for H' over the bootstrap
 *   plane, enrolls into H' through the `-R` port and connects; B's invitation then talks to A over H'.
 * Before both owners consented and the founding `ack` committed, a link is never plugin-usable: `isLinkUsable` is false
 * for its hosts, the mutual control path rejects it, and only bootstrap messages flow. Consent activates it.
 *
 * Keys: A authorizes a throwaway bootstrap key (in the token) for the tunnel only; at the founding `offer` it adds B's
 * per-link key and at activation drops the bootstrap line. Teardown removes A's lines and releases the forwarder, so
 * nothing listens or stays authorized once no link exists.
 *
 * Every record is sealed at rest; codes, seeds and keys never appear in logs, errors or projections.
 * Writes are serialized per invitation (lane) and transactional in storage; timers are unref'd and released on dispose.
 */

export const PEER_LINK_MAX_RECORDS = 32;
/** An activation that has not linked by then is abandoned (mirrors INVITATION_LIMITS.foundingMs). */
export const PEER_LINK_FOUNDING_MS = INVITATION_LIMITS.foundingMs;
/** A pre-consent link older than the consent window plus the founding deadline is abandoned. */
export const PEER_LINK_PRE_CONSENT_MAX_MS = INVITATION_LIMITS.consentWindowMs + INVITATION_LIMITS.foundingMs;
/** sshd `expiry-time` skew allowance beyond the invitation token's own expiry. */
export const PEER_LINK_BOOTSTRAP_SKEW_MS = 60_000;
export const PEER_LINK_RETRY_MIN_MS = 1_000;
export const PEER_LINK_RETRY_MAX_MS = 30_000;
/** A link down this long is reported `disconnected: peer-offline` and may ask the peer to relink even without its session. */
export const PEER_OFFLINE_AFTER_MS = 60_000;
/**
 * Own connector down this long (since it went down or was opened) while the peer's connector into this app is live: the
 * route to the peer is stale (e.g. it was reinstalled and lost the enrollment), so ask it to relink now.
 */
export const PEER_RELINK_AFTER_MS = 10_000;
/** Relink request pacing per link: doubles from the minimum per consecutive attempt up to the cap; reset once connected. */
export const PEER_RELINK_MIN_INTERVAL_MS = 15_000;
export const PEER_RELINK_INTERVAL_MS = 5 * 60_000;
/** Destination: minimum spacing between relink codes minted for one link (a refused or failed mint does not count). */
export const PEER_RELINK_ACCEPT_INTERVAL_MS = 10_000;
/** Scheduled re-keying of the own inbound host. */
export const PEER_LINK_ROTATION_MS = 30 * 24 * 60 * 60_000;
/** Inviter pull pacing: the receiver's channel registration may lag its connector's hub session. */
const PULL_DELAYS_MS = [2_000, 2_000, 5_000, 15_000];
/** An inviter's link `authorized_keys` line lives this long past the joiner's last successful connect. */
export const LINK_LINE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ENROLL_BUDGET_MS = 45_000, NOTICE_MS = 5_000, REPLY_DELAY_MS = 1_000, CONTROL_MS = 16_000, ENDPOINT_MS = 30_000, TUNNEL_MS = 40_000;
const LABEL_MAX = 80;

export type PeerLinkState = 'connected' | 'reconnecting' | 'disconnected';
export type PeerLinkReason = 'ssh-down' | 'peer-offline' | 'paused' | 'revoked';
export type PeerLinkFailure = 'expired' | 'fenced' | 'conflict' | 'unreachable';
export type PeerLinkViewPhase = 'pending' | 'exchanged' | 'enrolled' | 'linked' | 'failed' | 'removed';

/** Platform-internal, secret-free view: no code, key or host key. */
export interface PeerLinkView {
  pairingId: string; peerInstanceId: string; pluginId?: string; scope?: string; role: 'inviter' | 'redeemer';
  phase: PeerLinkViewPhase; state: PeerLinkState; reason?: PeerLinkReason; failure?: PeerLinkFailure;
  retryInMs?: number; capability: 'peer.forward';
  /** The peer's display name learned while pairing; absent on records written before names were kept. */
  peerName?: string;
}

type Bridge = {
  peerRotate?(hostId: string, input: { recipientInstanceId: string; hostId: string; code: string; expiresAt: number }, signal: AbortSignal): Promise<{ accepted: boolean }>;
  peerRelink?(hostId: string, input: { recipientInstanceId: string; hostId: string }, signal: AbortSignal): Promise<RelinkReply>;
  peerRemove?(hostId: string, input: { recipientInstanceId: string; pairingId: string; hostId: string }, signal: AbortSignal): Promise<{ accepted: boolean }>;
  useRequest?(hostId: string, input: { recipientInstanceId: string; pairingId: string; pluginId: string }, signal: AbortSignal): Promise<{ accepted: boolean }>;
  useDecision?(hostId: string, input: { recipientInstanceId: string; pairingId: string; pluginId: string; approved: boolean; revoke?: true }, signal: AbortSignal): Promise<{ accepted: boolean }>;
};

export type PeerLinksInvitations = Pick<PeerInvitations, 'fence' | 'listConsented' | 'markConnecting' | 'markReady' | 'markFailed' | 'founding' |
  'nudge' | 'terminateRemote' | 'fail' | 'redeemWire' | 'acceptRedeem' | 'acceptExchange'>;

export interface PeerLinksOptions {
  directory: string; instanceId: string; keyProvider: PeerKeyProvider; localAppDataDir: string;
  db: ZccDatabase; hostHub: Pick<HostHub, 'getSession' | 'detach' | 'callHostOnlineRpc'>; joinCodes: JoinCodeStore; channels: EnrolledPeerChannels;
  /** SSH transport: sshd endpoint, forwarder lease, authorized_keys lines and the redeemer's tunnel. */
  ssh: PeerSshTransport;
  /** Late-bound: PeerInvitations is constructed with this store's hooks. */
  invitations: () => PeerLinksInvitations | undefined;
  send?: BootstrapSend;
  bridge?: Bridge;
  connector?: InstallerConnector;
  /** Registry display name for a plugin's link use (never plugin input). */
  pluginLabel?(pluginId: string): string | undefined;
  /** A peer's link was removed locally: revoke its pair grants and clear plugin link notes. */
  onRemoved?(peerInstanceId: string): void | Promise<void>;
  /** Owner removal is about to tear the peer's links down: lets plugins clean up first. Bounded by the caller; a failure never vetoes. */
  onRemoving?(peerInstanceId: string): void | Promise<void>;
  onChanged?(): void;
  now?(): number;
}

const id = z.string().regex(PEER_ID), uuid = z.string().uuid(), int = z.number().int().nonnegative();
const joinCode = z.string().regex(/^zcde_[A-Za-z0-9_-]{24}$/);
const seed = z.string().regex(/^[\w-]{43}$/);
const sshPub = z.string().regex(/^ssh-ed25519 [A-Za-z0-9+/]{68}$/);
const port = z.number().int().min(1024).max(65535);
const loopbackUrl = z.string().max(64).regex(/^http:\/\/127\.0\.0\.1:\d{1,5}\/$/);
const sshSchema = z.object({
  /** `server`: A, whose sshd carries the tunnel. `client`: B, which opens it. */
  side: z.enum(['server', 'client']),
  /** B only: A's pinned sshd endpoint. */
  endpoint: z.object({ host: z.string().min(1).max(253), port: z.number().int().min(1).max(65535), user: z.string().min(1).max(64),
    hostKey: z.string().min(32).max(600) }).strict().optional(),
  /** A's loopback port `-R` listens on (`permitlisten`) and A's forwarder port `-L` reaches (`permitopen`). */
  listenPort: port, targetPort: port,
  /** B only: the stable local `-L` port, so the connector's URL survives reconnects and restarts. */
  localPort: port.optional(),
  /** B only, until activation: the token's throwaway seed. */
  bootstrapSeed: seed.optional(),
  /** A only, until activation: the bootstrap line's public key. */
  throwawayPub: sshPub.optional(),
  /** A only: the redeemer's per-link public key. */
  linkPub: sshPub.optional(),
  /** B only: the tunnel now authenticates with this link's own key. */
  identity: z.literal('link').optional()
}).strict();
const recordSchema = z.object({
  invitationId: id, role: z.enum(['inviter', 'redeemer']),
  /** Both absent on a core connection (no plugin, no scope). */
  pluginId: z.string().regex(PEER_TOKEN).optional(), scope: z.string().refine(validScope).optional(),
  /** The other app. Redeemer: the token's inviter. Inviter: the instance its inbound session claimed at the first pull. */
  peer: id.optional(), peerName: z.string().max(256).optional(),
  phase: z.enum(['pre-consent', 'activating', 'linked', 'removed', 'failed']),
  failure: z.enum(['expired', 'fenced', 'conflict', 'unreachable']).optional(), removal: z.enum(['removed', 'revoked']).optional(),
  createdAt: int, updatedAt: int, deadline: int.optional(),
  pairingId: id.optional(), consentDigest: z.string().max(128).optional(), generation: z.number().int().min(1).optional(),
  ssh: sshSchema,
  /** This app's own forward-only host for the peer; the code is kept (sealed) only until the peer enrolled with it (redeemer). */
  inbound: z.object({ hostId: uuid, code: joinCode.optional(), expiresAt: int.optional() }).strict().optional(),
  /** Inviter only, until enrolled: the redeemer's reverse code for H'. */
  reverse: z.object({ hostId: uuid, code: joinCode, expiresAt: int }).strict().optional(),
  /** This app's enrollment at the peer (`url` is the loopback end of the tunnel). The host id is kept for phase lookups. */
  outbound: z.object({ hostId: uuid, hostKey: z.string().min(32).max(512).optional(), url: loopbackUrl.optional() }).strict().optional(),
  /** A rotated code for the outbound host, received from the peer, applied until it expires. */
  pendingRotate: z.object({ code: joinCode, expiresAt: int }).strict().optional(),
  /** Destination side: last scheduled rotation of the own inbound host. */
  lastRotatedAt: int.optional(),
  /** Owner Disconnect: the record and keys stay, but nothing connects, heals or rotates until Reconnect. Missing means false. */
  paused: z.boolean().optional()
}).strict().refine(rec => (rec.pluginId === undefined) === (rec.scope === undefined), { message: 'pluginId and scope go together' });
type Rec = z.infer<typeof recordSchema>;
const stateSchema = z.object({ version: z.literal(1), records: z.array(recordSchema).max(PEER_LINK_MAX_RECORDS) }).strict();
type State = z.infer<typeof stateSchema>;

const TERMINAL = new Set<PeerLinkPhase>(['failed', 'removed']);
const LIVE_PHASES = new Set<PeerLinkPhase>(['pre-consent', 'activating']);
const backoff = (attempts: number) => Math.min(PEER_LINK_RETRY_MAX_MS, PEER_LINK_RETRY_MIN_MS * 2 ** Math.min(Math.max(0, attempts), 5));
const fenceOf = (rec: Rec): PairingFence | undefined => rec.pairingId && rec.consentDigest && rec.generation
  ? { invitationId: rec.invitationId, pairingId: rec.pairingId, consentDigest: rec.consentDigest, generation: rec.generation } : undefined;
const isFenced = (error: unknown) => error instanceof InvitationError && error.code === 'fenced';

const SSH_REASON_SET: ReadonlySet<string> = new Set(SSH_REASONS);
const sshReasonOf = (error: unknown): SshReason | undefined => {
  const message = error instanceof Error ? error.message : undefined;
  return message !== undefined && SSH_REASON_SET.has(message) ? message as SshReason : undefined;
};

/** Transport failures as stable, secret-free invitation reasons; anything else stays a plain error (retried). */
function mapTransportError(error: unknown): Error {
  if (error instanceof InvitationError) return error;
  // Never forward a foreign message: it may embed a key or code.
  const reason = sshReasonOf(error);
  return reason ? new InvitationError(reason) : new Error('peer link step failed');
}

/** A free loopback port, for A's `-R` listen port. */
function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (address && typeof address === 'object' ? resolve(address.port) : reject(new Error('no loopback port'))));
    });
  });
}

const joinCodeId = (value: string): string => createHash('sha256').update(value).digest('hex');
const loopbackOf = (value: number): string => `http://127.0.0.1:${value}/`;

interface Live { connection: InstallerConnection; connected: boolean; downSince?: number; openedAt: number }
/** B's ssh tunnel; `up` follows the transport's reconnect loop. */
interface TunnelEntry { tunnel: PeerSshTunnel; up: boolean; downSince?: number; failure?: SshReason }

export class PeerLinks implements PeerLinksControlPort {
  private readonly storage: PrivatePeerStorage<State>;
  /** Secret-bearing mirror of the persisted records (memory only), refreshed after every committed write; drives the sync reads. */
  private mirror = new Map<string, Rec>();
  private loaded = false;
  private readonly live = new Map<string, Live>();
  private readonly tunnels = new Map<string, TunnelEntry>();
  private readonly lanes = new Map<string, Promise<unknown>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly retries = new Map<string, number>();
  /** Inviter: the redeemer's pulled `wireRedeem` (memory only; re-pulled after a restart). */
  private readonly wires = new Map<string, Record<string, unknown>>();
  /** Invitations the peer aborted: torn down without echoing an abort back. */
  private readonly silenced = new Set<string>();
  /** Destination: last successful relink mint per invitation. */
  private readonly relinked = new Map<string, number>();
  /** Source: last relink request per invitation and consecutive attempts since the link was last connected. */
  private readonly relinkPace = new Map<string, { at: number; attempts: number }>();
  /** Last time the peer's connector attached to this app's inbound host of a linked link. */
  private readonly inboundSeen = new Map<string, number>();
  /** Due time of each armed heal timer (by the injected clock). */
  private readonly healAt = new Map<string, number>();
  private readonly tasks = new Set<Promise<unknown>>();
  private readonly controller = new AbortController();
  private readonly send: BootstrapSend;
  /** Inviter links whose forwarder port F could not be kept (a squatter holds it): fail closed, their authorized_keys lines are gone. */
  private readonly forwarderBlocked = new Set<string>();
  private sweeping: Promise<void> | undefined;
  private disposed = false;

  /** `InvitationLinks` hooks for PeerInvitations. */
  readonly invitationLinks: InvitationLinks = {
    create: input => this.createInvitationLink(input),
    redeem: (input, signal) => this.redeemInvitationLink(input, signal)
  };

  /** Redeemer -> inviter over this app's own inbound H' (the inviter's connector into it). */
  readonly transport: InvitationTransport = {
    post: async (link, kind, invitationId, body, signal) => {
      const reply = await this.send(link.hostId, link.recipientId,
        { op: 'bootstrap.exchange', invitationId, kind, wire: body as Record<string, unknown> }, signal);
      const error = (reply as { error?: unknown }).error;
      if (typeof error === 'string') return { status: error === 'expired' ? 410 : 403, body: { error } };
      return { status: 200, body: reply };
    }
  };

  /** Core Peers-hub view of the hosts this store owns. */
  readonly directory: PeerLinkDirectory = {
    describe: hostId => {
      const rec = this.byInbound(hostId);
      if (!rec?.peer) return undefined;
      return { peerInstanceId: rec.peer, peerName: rec.peerName || 'Peer', state: rec.phase,
        ...(rec.paused && !TERMINAL.has(rec.phase) ? { paused: true } : {}),
        ...(rec.failure ? { reason: rec.failure } : rec.removal ? { reason: rec.removal } : {}) };
    },
    release: async (hostId, pluginId, scope) => {
      const rec = this.byInbound(hostId);
      if (!rec || rec.phase !== 'linked' || !rec.peer) return undefined;
      // A zero-use link is normal: dropping the last use never removes it. Only an explicit owner removal does.
      removeHostLinkUse(this.options.db, hostId, pluginId, scope);
      this.changed();
      return { linkRemoved: false };
    },
    remove: async (hostId, options) => {
      // An unloaded mirror would miss the record and leave the caller's generic teardown to orphan it (still linked, channel enrolled).
      if (!this.loaded) await this.load();
      const rec = this.byInbound(hostId);
      if (!rec?.peer || TERMINAL.has(rec.phase)) return undefined;
      await this.remove(rec.peer, 'removed', options);
      return { linkRemoved: true };
    },
    pause: async hostId => {
      const rec = this.byInbound(hostId);
      if (!rec?.peer || rec.phase !== 'linked') return undefined;
      return (await this.pause(rec.peer)) ? { paused: true } : undefined;
    },
    resume: async hostId => {
      const rec = this.byInbound(hostId);
      if (!rec?.peer || rec.phase !== 'linked') return undefined;
      return (await this.unpause(rec.peer)) ? { paused: false } : undefined;
    },
    repair: async hostId => {
      const rec = this.byInbound(hostId);
      if (!rec?.peer || rec.phase !== 'linked' || rec.paused) return undefined;
      await this.rotate(rec.peer);
      return { repaired: true };
    }
  };

  constructor(private readonly options: PeerLinksOptions) {
    this.storage = new PrivatePeerStorage(options.directory, 'links-v2', options.keyProvider, options.instanceId,
      () => ({ version: 1, records: [] }), value => {
        const state = stateSchema.parse(value);
        if (new Set(state.records.map(rec => rec.invitationId)).size !== state.records.length) throw new Error('invalid peer link state');
        return state;
      });
    this.send = options.send ?? createBootstrapSender({ instanceId: options.instanceId, db: options.db, hub: options.hostHub });
  }

  private get connector(): InstallerConnector { return this.options.connector ?? defaultInstallerConnector; }
  private invitations(): PeerLinksInvitations {
    const invitations = this.options.invitations();
    if (!invitations) throw new InvitationError('unavailable');
    return invitations;
  }
  private now(): number { return this.options.now?.() ?? Date.now(); }
  private assertLive(): void { if (this.disposed) throw new Error('peer links disposed'); }
  private changed(): void { try { this.options.onChanged?.(); } catch { /* observer only */ } }
  private signal(ms: number): AbortSignal { return AbortSignal.any([this.controller.signal, AbortSignal.timeout(ms)]); }

  private track<T>(work: Promise<T>): Promise<T> {
    this.tasks.add(work);
    void work.then(() => this.tasks.delete(work), () => this.tasks.delete(work));
    return work;
  }

  /** Serializes all logic for one invitation; network work runs inside, storage locks never span it. */
  private lane<T>(key: string, run: () => Promise<T>): Promise<T> {
    const previous = this.lanes.get(key) ?? Promise.resolve();
    const next = previous.then(run, run);
    const settled = next.catch(() => undefined);
    this.lanes.set(key, settled);
    void settled.then(() => { if (this.lanes.get(key) === settled) this.lanes.delete(key); });
    return next;
  }

  private timer(key: string, delay: number, run: () => Promise<unknown>): void {
    if (this.disposed) return;
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(key);
      if (!this.disposed) void this.track(run().catch(() => undefined));
    }, delay);
    timer.unref?.();
    this.timers.set(key, timer);
  }

  private refresh(state: State): void {
    this.mirror = new Map(state.records.map(rec => [rec.invitationId, structuredClone(rec)]));
    this.loaded = true;
  }

  private async load(): Promise<void> { await this.storage.transaction(async state => { this.refresh(state); }); }

  private get(invitationId: string): Rec | undefined { const rec = this.mirror.get(invitationId); return rec ? structuredClone(rec) : undefined; }

  private async update(invitationId: string, change: (rec: Rec) => void): Promise<Rec> {
    return this.storage.transaction(async (state, save) => {
      const rec = state.records.find(entry => entry.invitationId === invitationId);
      if (!rec) throw new InvitationError('not_found');
      change(rec); rec.updatedAt = this.now(); recordSchema.parse(rec);
      await save();
      this.refresh(state);
      return structuredClone(rec);
    });
  }

  private records(): Rec[] { return [...this.mirror.values()].map(rec => structuredClone(rec)); }
  private byInbound(hostId: string): Rec | undefined {
    const matches = this.records().filter(rec => rec.inbound?.hostId === hostId);
    return matches.find(rec => !TERMINAL.has(rec.phase)) ?? matches[0];
  }
  private linkedFor(peer: string): Rec | undefined { return this.records().find(rec => rec.peer === peer && rec.phase === 'linked'); }

  private daemonDir(invitationId: string): string {
    // Sibling of the storage directory: PrivatePeerStorage refuses foreign entries in its own directory.
    return join(`${this.options.directory}-daemons`, createHash('sha256').update(invitationId).digest('hex').slice(0, 32));
  }

  // ---------- Sync reads (bootstrap plane, authority, control API) ----------

  phase(peerInstanceId: string, hostId?: string): PeerLinkPhase | undefined {
    const matches = [...this.mirror.values()].filter(rec => rec.peer === peerInstanceId &&
      (hostId === undefined || rec.inbound?.hostId === hostId || rec.outbound?.hostId === hostId));
    return (matches.find(rec => !TERMINAL.has(rec.phase)) ?? matches[0])?.phase;
  }

  async bootstrapLink(peerInstanceId: string, hostId: string): Promise<BootstrapLinkRecord | undefined> {
    const rec = [...this.mirror.values()].find(entry => entry.peer === peerInstanceId && entry.outbound?.hostId === hostId && !TERMINAL.has(entry.phase));
    return rec ? { invitationId: rec.invitationId, role: rec.role, phase: rec.phase } : undefined;
  }

  /**
   * False for any host of an invitation-founded link that has not reached `linked`. Before the store loaded, every live
   * non-primary forward-only host is conservatively unusable (the authority treats it as not enrolled; nothing is destroyed).
   */
  isLinkUsable(hostId: string): boolean {
    if (!this.loaded) {
      const host = getHost(this.options.db, hostId);
      return !(host && !host.destroyedAt && !host.isPrimary && host.enrollmentCapability === 'peer.forward');
    }
    const rec = [...this.mirror.values()].find(entry => entry.inbound?.hostId === hostId || entry.outbound?.hostId === hostId);
    return !rec || rec.phase === 'linked';
  }

  /** Redeemer: the bootstrap link to the inviter (its connector into this app's H'), only while that session is live. */
  linkRef(invitationId: string): InvitationLinkRef | null {
    const rec = this.mirror.get(invitationId);
    if (!rec || rec.role !== 'redeemer' || !rec.peer || !rec.inbound || TERMINAL.has(rec.phase)) return null;
    const session = this.options.hostHub.getSession(rec.inbound.hostId);
    if (!session || session.instanceId !== rec.peer) return null;
    return { hostId: rec.inbound.hostId, recipientId: rec.peer };
  }

  async foundedFor(peerInstanceId: string, channelHostId: string, pluginId: string): Promise<boolean> {
    if (this.disposed) return false;
    const rec = [...this.mirror.values()].find(entry => entry.phase === 'linked' && entry.peer === peerInstanceId && entry.outbound?.hostId === channelHostId);
    if (!rec) return false;
    if (rec.pluginId === pluginId) return true;
    const host = rec.inbound ? getHost(this.options.db, rec.inbound.hostId) : null;
    return !!host && host.purpose.kind === 'plugin-link' && host.purpose.uses.some(use => use.pluginId === pluginId);
  }

  // ---------- Invitation hooks ----------

  /**
   * Inviter: reserve F and P, authorize a throwaway bootstrap key, mint H (a local forward-only join code) and return
   * the offer the token carries. Every step is undone in reverse on failure, so a failed Add peer leaves nothing
   * listening or authorized.
   */
  private async createInvitationLink(input: { invitationId: string; pluginId?: string; scope?: string }): Promise<InvitationLinkMint> {
    this.assertLive();
    const ssh = this.options.ssh;
    const linkId = input.invitationId;
    const undo: Array<() => Promise<unknown> | unknown> = [];
    try {
      const endpoint = await ssh.localEndpoint(this.signal(ENDPOINT_MS));
      const targetPort = await ssh.forwarder.acquire(linkId);
      undo.push(() => ssh.forwarder.release(linkId));
      const listenPort = await freeLoopbackPort();
      const bootstrapSeed = generateSeed(), pub = publicKeyLine(bootstrapSeed);
      try {
        await this.insert({ invitationId: linkId, role: 'inviter', ...(input.pluginId !== undefined ? { pluginId: input.pluginId, scope: input.scope } : {}), phase: 'pre-consent',
          createdAt: this.now(), updatedAt: this.now(), ssh: { side: 'server', listenPort, targetPort, throwawayPub: pub } });
      } catch (error) {
        // A duplicate id means the forwarder hold belongs to the existing link: leave it.
        if (error instanceof InvitationError && error.code === 'already_redeemed') undo.length = 0;
        throw error;
      }
      undo.push(() => this.drop(linkId));
      const issued = this.options.joinCodes.mintForwardOnly(this.now());
      undo.push(() => this.options.joinCodes.invalidateHost(issued.hostId));
      const expiresAt = Math.min(issued.expiresAt, this.now() + INVITATION_LIMITS.ttlMs);
      // The token's own expiry plus a little skew: sshd drops the line on its own if Zana crashes. A redeem that actually arrives extends it (extendBootstrap).
      await ssh.authorizedKeys.upsert({ linkId, kind: 'bootstrap', pub, listenPort, targetPort, expiresAt: expiresAt + PEER_LINK_BOOTSTRAP_SKEW_MS });
      undo.push(() => ssh.authorizedKeys.remove(linkId, 'bootstrap'));
      await this.update(linkId, rec => { rec.inbound = { hostId: issued.hostId }; });
      this.changed();
      const offer: InvitationSshOffer = { v: 1, endpoint, bootstrapSeed, listenPort, targetPort, hostId: issued.hostId, joinCode: issued.joinCode };
      return { offer, expiresAt };
    } catch (error) {
      for (const step of undo.reverse()) await Promise.resolve().then(step).catch(() => undefined);
      const mapped = mapTransportError(error);
      throw mapped instanceof InvitationError ? mapped : new InvitationError('unavailable');
    }
  }

  /** Bounded insert: ≤4 links before consent, ≤16 linked connections (each core or plugin connection counts once), one link per app pair; evicts the oldest terminal record. */
  private async insert(rec: Rec): Promise<void> {
    await this.storage.transaction(async (state, save) => {
      if (state.records.some(entry => entry.invitationId === rec.invitationId)) throw new InvitationError('already_redeemed');
      if (state.records.filter(entry => LIVE_PHASES.has(entry.phase)).length >= BOOTSTRAP_LIMITS.preConsentLinksPerApp ||
        state.records.filter(entry => entry.phase === 'linked').length >= BOOTSTRAP_LIMITS.pluginLinksPerApp) throw new InvitationError('capacity');
      if (rec.peer && state.records.some(entry => entry.peer === rec.peer && !TERMINAL.has(entry.phase))) throw new InvitationError('already_connected');
      if (state.records.length >= PEER_LINK_MAX_RECORDS) {
        const evictable = state.records.filter(entry => TERMINAL.has(entry.phase)).sort((a, b) => a.updatedAt - b.updatedAt)[0];
        if (!evictable) throw new InvitationError('capacity');
        state.records.splice(state.records.indexOf(evictable), 1);
      }
      state.records.push(recordSchema.parse(rec));
      await save();
      this.refresh(state);
    });
  }

  private async drop(invitationId: string): Promise<void> {
    await this.storage.transaction(async (state, save) => {
      const index = state.records.findIndex(entry => entry.invitationId === invitationId);
      if (index >= 0) { state.records.splice(index, 1); await save(); }
      this.refresh(state);
    }).catch(() => undefined);
  }

  /** Redeemer: open the tunnel with the token's bootstrap key, enroll forward-only into H through it and connect. */
  private async redeemInvitationLink(input: { invitationId: string; inviterId: string; inviterName: string; pluginId?: string; scope?: string;
    link: InvitationSshOffer }, signal: AbortSignal): Promise<void> {
    this.assertLive();
    const offer = input.link;
    await this.lane(input.invitationId, async () => {
      let rec = this.get(input.invitationId);
      if (rec && (rec.role !== 'redeemer' || TERMINAL.has(rec.phase))) throw new InvitationError('already_redeemed');
      if (rec?.outbound?.hostKey) { if (!this.live.has(rec.invitationId)) await this.open(rec); return; }
      if (!rec) {
        await this.dropOrphans(input.inviterId);
        let channel = await this.options.channels.remote(input.inviterId);
        // A channel this store minted for a link that is already gone is a leftover, not a connection.
        if (channel && this.ownsStaleChannel(input.inviterId, channel.hostId)) {
          await this.options.channels.unregister(input.inviterId, channel.hostId).catch(() => false);
          channel = await this.options.channels.remote(input.inviterId);
        }
        if (channel) throw new InvitationError('already_connected');
        await this.insert({ invitationId: input.invitationId, role: 'redeemer', ...(input.pluginId !== undefined ? { pluginId: input.pluginId, scope: input.scope } : {}),
          peer: input.inviterId, peerName: input.inviterName, phase: 'pre-consent', createdAt: this.now(), updatedAt: this.now(),
          ssh: { side: 'client', endpoint: offer.endpoint, listenPort: offer.listenPort, targetPort: offer.targetPort, bootstrapSeed: offer.bootstrapSeed },
          outbound: { hostId: offer.hostId } });
        rec = this.get(input.invitationId)!;
      }
      signal.throwIfAborted(); this.assertLive();
      let tunnel: TunnelEntry;
      try { tunnel = await this.ensureTunnel(rec, signal); }
      catch (error) { throw mapTransportError(error); }
      const budget = AbortSignal.any([signal, this.signal(ENROLL_BUDGET_MS)]);
      let enrolled;
      try {
        enrolled = await this.abortable(this.connector.enroll({ serverUrl: tunnel.tunnel.url, joinCode: offer.joinCode, hostName: this.hostName(),
          signal: budget, instanceId: this.options.instanceId }), budget);
      } catch { throw new Error('peer link enrollment failed'); }
      if (enrolled.hostId !== offer.hostId) { await this.closeTunnel(rec.invitationId); throw new InvitationError('identity_mismatch'); }
      rec = await this.update(rec.invitationId, entry => {
        entry.outbound = { hostId: enrolled.hostId, hostKey: enrolled.hostKey, url: tunnel.tunnel.url };
        entry.ssh.localPort = tunnel.tunnel.localPort;
      });
      await this.open(rec);
      this.changed();
    });
  }

  private hostName(): string { return `Peer ${this.options.instanceId.slice(0, 8)}`; }

  /** Hub `onHostConnected`, for every host (called before the execution-only gate). */
  onInboundConnected(hostId: string): void {
    if (this.disposed || !this.loaded) return;
    const rec = this.byInbound(hostId);
    if (!rec || TERMINAL.has(rec.phase)) return;
    const session = this.options.hostHub.getSession(hostId);
    if (!session || !PEER_ID.test(session.instanceId) || session.instanceId === this.options.instanceId) return;
    if (rec.peer && rec.peer !== session.instanceId) return;
    if (rec.paused) {
      // Not serving while paused. A plain close (not 4003, which is permanent) keeps the peer's connector retrying until we resume.
      try { session.socket.close(1001, 'peer-paused'); } catch { /* already closing */ }
      return;
    }
    if (rec.phase === 'linked') {
      // The peer's connector (re)attached: it is reachable now, so a dead own connector heals with fresh pacing.
      // A peer that just (re)started gets the same grace for its side to come up before this app asks it to relink.
      this.inboundSeen.set(rec.invitationId, this.now());
      // The inviter's link line expires unless the joiner keeps connecting: each successful connect renews it. A lapsed line is needs-Reconnect.
      if (rec.ssh.side === 'server' && rec.ssh.linkPub) {
        void this.options.ssh.authorizedKeys.upsert({ linkId: rec.invitationId, kind: 'link', pub: rec.ssh.linkPub, listenPort: rec.ssh.listenPort,
          targetPort: rec.ssh.targetPort, expiresAt: this.now() + LINK_LINE_TTL_MS }).catch(() => undefined);
      }
      const entry = this.live.get(rec.invitationId);
      if (entry && !entry.connected) { this.relinkPace.delete(rec.invitationId); this.armHeal(rec.invitationId, PEER_RELINK_AFTER_MS, true); }
      return;
    }
    if (rec.role === 'redeemer') {
      if (rec.phase === 'pre-consent') void this.track(this.invitations().nudge(rec.invitationId).catch(() => undefined));
      else if (rec.phase === 'activating') this.kickFounding(rec.invitationId, 0);
      return;
    }
    if (rec.phase !== 'pre-consent') return;
    if (rec.outbound?.hostKey) { if (!this.live.has(rec.invitationId)) void this.track(this.lane(rec.invitationId, () => this.open(this.get(rec.invitationId)!)).catch(() => undefined)); return; }
    this.retries.delete(`pull:${rec.invitationId}`);
    this.kickPull(rec.invitationId, PULL_DELAYS_MS[0]!);
  }

  private kickPull(invitationId: string, delay: number): void {
    this.timer(`pull:${invitationId}`, delay, () => this.lane(invitationId, () => this.pull(invitationId)));
  }

  /** Inviter: pull the redeemer's offer and reverse code over H, redeem it, enroll into H' and connect. */
  private async pull(invitationId: string): Promise<void> {
    const rec = this.get(invitationId);
    if (!rec || rec.role !== 'inviter' || rec.phase !== 'pre-consent' || !rec.inbound || this.disposed) return;
    if (rec.outbound?.hostKey) { if (!this.live.has(invitationId)) await this.open(rec); return; }
    const session = this.options.hostHub.getSession(rec.inbound.hostId);
    if (!session) return;
    const claim = session.instanceId;
    if (!PEER_ID.test(claim) || claim === this.options.instanceId || (rec.peer && rec.peer !== claim)) return;
    try {
      await this.pullOnce(rec, claim);
      this.retries.delete(`pull:${invitationId}`);
    } catch (error) {
      if (this.disposed) return;
      if (error instanceof InvitationError) { await this.invitations().fail(invitationId, error.code).catch(() => undefined); return; }
      const attempts = (this.retries.get(`pull:${invitationId}`) ?? 0) + 1;
      this.retries.set(`pull:${invitationId}`, attempts);
      if (this.now() < rec.createdAt + PEER_LINK_PRE_CONSENT_MAX_MS) this.kickPull(invitationId, PULL_DELAYS_MS[attempts] ?? backoff(attempts));
    }
  }

  private async pullOnce(initial: Rec, claim: string): Promise<void> {
    let rec = initial;
    const inbound = rec.inbound!;
    let wire = this.wires.get(rec.invitationId);
    if (!rec.reverse || !wire || rec.reverse.expiresAt <= this.now()) {
      const reply: PullReply = await this.send(inbound.hostId, claim, { op: 'bootstrap.pull', invitationId: rec.invitationId,
        nonce: randomBytes(24).toString('hex') }, this.signal(BOOTSTRAP_LIMITS.timeoutMs));
      rec = await this.update(rec.invitationId, entry => { entry.peer = claim; entry.reverse = reply.reverse; });
      wire = reply.redeem;
      this.wires.set(rec.invitationId, wire);
    }
    const reverse = rec.reverse!;
    // Reserves the invitation for the redeemer whose hub claim this is; an InvitationError ends it (teardown via onTerminated).
    await this.invitations().acceptRedeem(wire, { redeemerId: claim });
    this.assertLive();
    // The redeem arrived: the owners now need time to consent, and the redeemer's tunnel may reconnect on the bootstrap key meanwhile.
    await this.extendBootstrap(rec);
    // The redeemer's forwarder is reached through the tunnel's `-R` port on this app's loopback.
    const url = loopbackOf(rec.ssh.listenPort);
    const budget = this.signal(ENROLL_BUDGET_MS);
    let enrolled;
    try {
      enrolled = await this.abortable(this.connector.enroll({ serverUrl: url, joinCode: reverse.code, hostName: this.hostName(), signal: budget,
        instanceId: this.options.instanceId }), budget);
    } catch (error) {
      // The reply may have been lost after the peer redeemed the code: ask for a fresh one on the next attempt.
      await this.update(rec.invitationId, entry => { delete entry.reverse; }).catch(() => undefined);
      this.wires.delete(rec.invitationId);
      throw error;
    }
    if (enrolled.hostId !== reverse.hostId) throw new InvitationError('identity_mismatch');
    rec = await this.update(rec.invitationId, entry => {
      entry.outbound = { hostId: enrolled.hostId, hostKey: enrolled.hostKey, url };
      delete entry.reverse;
    });
    this.wires.delete(rec.invitationId);
    await this.open(rec);
    this.changed();
  }

  /** Inviter: keep the bootstrap line valid through consent and founding (never beyond the record's own pre-consent lifetime plus skew). */
  private async extendBootstrap(rec: Rec): Promise<void> {
    if (rec.ssh.side !== 'server' || !rec.ssh.throwawayPub) return;
    await this.options.ssh.authorizedKeys.upsert({ linkId: rec.invitationId, kind: 'bootstrap', pub: rec.ssh.throwawayPub,
      listenPort: rec.ssh.listenPort, targetPort: rec.ssh.targetPort, expiresAt: rec.createdAt + PEER_LINK_PRE_CONSENT_MAX_MS + PEER_LINK_BOOTSTRAP_SKEW_MS });
  }

  /** Redeemer: answer the inviter's pull over H with the sealed redeem and the lazily minted reverse code for H'. */
  async answerPull(invitationId: string, hostId: string, signal: AbortSignal): Promise<PullReply> {
    this.assertLive();
    return this.lane(invitationId, async () => {
      let rec = this.get(invitationId);
      if (!rec || rec.role !== 'redeemer' || rec.phase !== 'pre-consent' || rec.outbound?.hostId !== hostId || !rec.peer) {
        throw new BootstrapRejection(404, 'peer bootstrap pull unavailable');
      }
      // A code the peer redeemed without ever attaching means its enroll reply was lost: that code can never be used again.
      const spent = (): boolean => {
        if (!rec?.inbound?.code) return false;
        const status = this.options.joinCodes.status(joinCodeId(rec.inbound.code), this.now());
        return !status || (status.redeemedAt !== null && !this.options.hostHub.getSession(rec.inbound.hostId));
      };
      const reusable = rec.inbound?.code && rec.inbound.expiresAt !== undefined && rec.inbound.expiresAt > this.now() + 60_000 && !spent();
      if (!reusable) {
        if (rec.inbound) {
          this.removeInbound(rec.inbound.hostId);
          rec = await this.update(invitationId, entry => { delete entry.inbound; });
        }
        signal.throwIfAborted();
        let issued;
        try { issued = this.options.joinCodes.mintForwardOnly(this.now()); }
        catch { throw new BootstrapRejection(404, 'peer bootstrap pull unavailable'); }
        rec = await this.update(invitationId, entry => { entry.inbound = { hostId: issued.hostId, code: issued.joinCode, expiresAt: issued.expiresAt }; });
      }
      const redeem = await this.invitations().redeemWire(invitationId);
      const inbound = rec.inbound!;
      return { redeem, reverse: { hostId: inbound.hostId, code: inbound.code!, expiresAt: inbound.expiresAt! } };
    });
  }

  /** Inviter: a redeem/exchange from the redeemer over this app's connector H' into it. Not laned (onFounding runs inside). */
  async acceptExchange(invitationId: string, peerInstanceId: string, hostId: string, kind: 'redeem' | 'exchange',
    wire: Record<string, unknown>, _signal: AbortSignal): Promise<ExchangeReply> {
    this.assertLive();
    const rec = this.get(invitationId);
    if (!rec || rec.role !== 'inviter' || rec.peer !== peerInstanceId || rec.outbound?.hostId !== hostId) {
      throw new BootstrapRejection(404, 'peer bootstrap exchange unavailable');
    }
    try {
      const reply = kind === 'redeem'
        ? await this.invitations().acceptRedeem(wire, { redeemerId: peerInstanceId })
        : await this.invitations().acceptExchange(wire, { redeemerId: peerInstanceId });
      return reply as ExchangeReply;
    } catch (error) {
      if (error instanceof InvitationError) return { error: error.code };
      throw error;
    }
  }

  /** The peer aborted its side: end ours too without echoing an abort, after the reply has left. */
  async acceptAbort(invitationId: string, peerInstanceId: string, hostId: string, reason: 'denied' | 'cancelled' | 'expired'): Promise<void> {
    this.assertLive();
    const rec = this.get(invitationId);
    if (!rec || rec.peer !== peerInstanceId || rec.outbound?.hostId !== hostId || rec.phase === 'linked' || TERMINAL.has(rec.phase)) return;
    this.silenced.add(invitationId);
    await this.invitations().terminateRemote(invitationId, reason).catch(() => undefined);
    this.timer(`abort:${invitationId}`, REPLY_DELAY_MS, () => this.lane(invitationId, async () => {
      const current = this.get(invitationId);
      if (current && current.phase !== 'linked' && !TERMINAL.has(current.phase)) await this.teardown(current, { failure: 'fenced' });
    }));
  }

  /** PeerInvitations `onTerminated`: any non-linked link of the attempt is torn down locally (local host, ssh lines, tunnel). */
  onTerminated(invitationId: string, _role: 'inviter' | 'redeemer', reason: InvitationReason): void {
    if (this.disposed || this.silenced.has(invitationId)) return;
    void this.track(this.lane(invitationId, async () => {
      const rec = this.get(invitationId);
      if (!rec || rec.phase === 'linked' || TERMINAL.has(rec.phase)) return;
      const abort = reason === 'denied' || reason === 'cancelled' || reason === 'expired' ? reason : 'cancelled';
      await this.teardown(rec, { abort, failure: reason === 'expired' ? 'expired' : reason === 'unreachable' ? 'unreachable' : 'fenced' });
    }).catch(() => undefined));
  }

  /**
   * PeerInvitations `onConsented`: bind the pairing; the redeemer starts the founding. The inviter nudges the redeemer
   * over H: when the inviter approved last, the redeemer otherwise learns of consent only on its next status poll.
   */
  onConsented(pairing: ConsentedPairing): void {
    if (this.disposed) return;
    void this.track(this.lane(pairing.invitationId, () => this.bind(pairing)).then(async rec => {
      if (rec?.role === 'redeemer') this.kickFounding(rec.invitationId, 0);
      else if (rec?.role === 'inviter' && rec.phase === 'pre-consent' && rec.inbound && rec.peer && this.options.hostHub.getSession(rec.inbound.hostId)) {
        await this.send(rec.inbound.hostId, rec.peer, { op: 'bootstrap.nudge', invitationId: rec.invitationId }, this.signal(BOOTSTRAP_LIMITS.timeoutMs));
      }
    }).catch(() => undefined));
  }

  /** Redeemer: the inviter (over H, this app's connector into it) reports both approvals; poll it now. */
  async acceptNudge(invitationId: string, peerInstanceId: string, hostId: string): Promise<void> {
    this.assertLive();
    const rec = this.get(invitationId);
    if (!rec || rec.role !== 'redeemer' || rec.peer !== peerInstanceId || rec.outbound?.hostId !== hostId || rec.phase !== 'pre-consent') return;
    // Not awaited: the poll's exchange travels over H' and must not hold this reply open.
    void this.track(this.invitations().nudge(invitationId).catch(() => undefined));
  }

  private async bind(pairing: ConsentedPairing): Promise<Rec | undefined> {
    const rec = this.get(pairing.invitationId);
    const ref: PairingFence = { invitationId: pairing.invitationId, pairingId: pairing.pairingId, consentDigest: pairing.consentDigest, generation: pairing.generation };
    if (!rec || TERMINAL.has(rec.phase) || rec.role !== pairing.role || rec.peer !== pairing.remote.instanceId ||
      (rec.pairingId && (rec.pairingId !== pairing.pairingId || rec.consentDigest !== pairing.consentDigest || rec.generation !== pairing.generation))) {
      await this.invitations().markFailed(ref).catch(() => undefined);
      return undefined;
    }
    if (rec.pairingId) return rec;
    return this.update(rec.invitationId, entry => {
      entry.pairingId = pairing.pairingId; entry.consentDigest = pairing.consentDigest; entry.generation = pairing.generation;
      entry.peerName = pairing.remote.name;
    });
  }

  private kickFounding(invitationId: string, delay: number): void {
    this.timer(`found:${invitationId}`, delay, () => this.lane(invitationId, () => this.found(invitationId)));
  }

  /** Redeemer: offer, then ack; each step fenced by the inviter's signed receipt. */
  private async found(invitationId: string): Promise<void> {
    let rec = this.get(invitationId);
    if (!rec || rec.role !== 'redeemer' || this.disposed || (rec.phase !== 'pre-consent' && rec.phase !== 'activating')) return;
    const ref = fenceOf(rec);
    if (!ref) return;
    try {
      if (rec.phase === 'pre-consent') {
        await this.invitations().markConnecting(ref);
        await this.invitations().founding(ref, { op: 'offer' }, this.signal(CONTROL_MS));
        rec = await this.update(invitationId, entry => { entry.phase = 'activating'; entry.deadline = this.now() + PEER_LINK_FOUNDING_MS; });
      }
      // The inviter authorized this link's own key when it received the offer: move the tunnel off the bootstrap key before acking.
      rec = await this.swapToLinkKey(rec);
      await this.invitations().founding(ref, { op: 'ack' }, this.signal(CONTROL_MS));
      await this.activate(rec, ref);
      this.retries.delete(`found:${invitationId}`);
    } catch (error) {
      if (this.disposed) return;
      const latest = this.get(invitationId) ?? rec;
      if (isFenced(error) || (error instanceof InvitationError && error.code !== 'unreachable') ||
        (latest.deadline !== undefined && this.now() >= latest.deadline)) {
        if (!TERMINAL.has(latest.phase) && latest.phase !== 'linked') {
          await this.teardown(latest, { abort: 'cancelled', failure: isFenced(error) ? 'fenced' : 'expired' });
          await this.invitations().fail(invitationId, isFenced(error) ? 'fenced' : 'expired').catch(() => undefined);
        }
        return;
      }
      const attempts = (this.retries.get(`found:${invitationId}`) ?? 0) + 1;
      this.retries.set(`found:${invitationId}`, attempts);
      this.kickFounding(invitationId, backoff(attempts - 1));
    }
  }

  /** Redeemer: reopen the tunnel with this link's own key on the same local port (idempotent; also restores a missing tunnel). */
  private async swapToLinkKey(rec: Rec): Promise<Rec> {
    if (rec.ssh.side !== 'client') return rec;
    let current = rec;
    if (current.ssh.identity !== 'link') {
      await this.closeTunnel(current.invitationId);
      current = await this.update(current.invitationId, entry => { entry.ssh.identity = 'link'; });
    }
    try { await this.ensureTunnel(current); } catch { throw new Error('peer ssh tunnel not ready'); }
    return current;
  }

  /** Inviter: the bootstrap line served its purpose. A failed removal is retried by the supervisor (sshd also expires it). */
  private async dropBootstrap(invitationId: string): Promise<void> {
    const rec = this.get(invitationId);
    if (!rec?.ssh.throwawayPub) return;
    try { await this.options.ssh.authorizedKeys.remove(invitationId, 'bootstrap'); } catch { return; }
    await this.update(invitationId, entry => { delete entry.ssh.throwawayPub; }).catch(() => undefined);
  }

  /** Records the plugin use on the own inbound host, commits `linked`, then marks the invitation ready. */
  private async activate(rec: Rec, ref: PairingFence): Promise<void> {
    if (!rec.inbound) throw new Error('peer link inbound missing');
    // A core connection records no plugin use: it is a link nothing but core owns.
    if (rec.pluginId !== undefined && rec.scope !== undefined) {
      const label = (this.options.pluginLabel?.(rec.pluginId) || rec.pluginId).slice(0, LABEL_MAX);
      addHostLinkUse(this.options.db, rec.inbound.hostId, { pluginId: rec.pluginId, scope: rec.scope, label });
    }
    const linked = await this.update(rec.invitationId, entry => {
      entry.phase = 'linked'; delete entry.deadline;
      if (entry.inbound) entry.inbound = { hostId: entry.inbound.hostId };
      if (entry.role === 'redeemer') delete entry.ssh.bootstrapSeed;
      entry.lastRotatedAt = this.now();
    });
    if (linked.role === 'inviter') await this.dropBootstrap(linked.invitationId);
    this.changed();
    try { await this.invitations().markReady(ref); }
    catch (error) {
      if (isFenced(error)) { await this.removeLinked(linked, 'revoked', true); return; }
      throw error;
    }
  }

  /** PeerInvitations `onFounding` (inviter): `offer` arms the activation, `ack` links. Idempotent on retries. */
  async onFounding(pairing: ConsentedPairing, message: { op: FoundingOp }): Promise<void> {
    this.assertLive();
    if (pairing.role !== 'inviter') throw new InvitationError('fenced');
    await this.lane(pairing.invitationId, async () => {
      let rec = await this.bind(pairing);
      if (!rec) throw new InvitationError('fenced');
      const ref = fenceOf(rec)!;
      if (rec.phase === 'linked') return;
      if (message.op === 'offer') {
        if (rec.phase === 'activating') return;
        if (!rec.outbound?.hostKey || !rec.inbound || !this.live.get(rec.invitationId)?.connected ||
          !this.options.hostHub.getSession(rec.inbound.hostId)) throw new Error('peer link not established yet');
        // Both owners approved the redeemer's per-link key (it is part of the consent digest): authorize it next to the bootstrap key.
        const linkPub = pairing.remote.sshKey;
        if (!linkPub) throw new InvitationError('fenced');
        await this.options.ssh.authorizedKeys.upsert({ linkId: rec.invitationId, kind: 'link', pub: linkPub, listenPort: rec.ssh.listenPort,
          targetPort: rec.ssh.targetPort, expiresAt: this.now() + LINK_LINE_TTL_MS });
        await this.update(rec.invitationId, entry => { entry.ssh.linkPub = linkPub; });
        rec = await this.update(rec.invitationId, entry => { entry.phase = 'activating'; entry.deadline = this.now() + PEER_LINK_FOUNDING_MS; });
        await this.invitations().markConnecting(ref);
        return;
      }
      if (rec.phase !== 'activating') throw new Error('peer link founding out of order');
      await this.activate(rec, ref);
    });
  }

  // ---------- Linked lifecycle ----------

  /** Destination: re-mint the join code of the own inbound host and hand it to the peer over that host. */
  private async rotateOwn(invitationId: string): Promise<boolean> {
    const rec = this.get(invitationId);
    if (!rec || rec.phase !== 'linked' || !rec.inbound || !rec.peer || !this.options.bridge?.peerRotate || this.disposed) return false;
    const issued = this.options.joinCodes.mintForwardOnlyForHost(rec.inbound.hostId, this.now());
    const reply = await this.options.bridge.peerRotate(rec.inbound.hostId, { recipientInstanceId: rec.peer, hostId: rec.inbound.hostId,
      code: issued.joinCode, expiresAt: issued.expiresAt }, this.signal(CONTROL_MS));
    if (!reply.accepted) return false;
    await this.update(invitationId, entry => { entry.lastRotatedAt = this.now(); });
    return true;
  }

  /** Peer side of `peer.rotate`: the destination re-minted the code for this app's outbound host. */
  async acceptRotate(senderId: string, hostId: string, rotate: { code: string; expiresAt: number }, _signal: AbortSignal): Promise<{ accepted: boolean }> {
    this.assertLive();
    const rec = [...this.mirror.values()].find(entry => entry.phase === 'linked' && entry.peer === senderId && entry.outbound?.hostId === hostId);
    if (!rec || rec.paused || !joinCode.safeParse(rotate?.code).success || !Number.isSafeInteger(rotate.expiresAt) || rotate.expiresAt <= this.now()) return { accepted: false };
    await this.lane(rec.invitationId, () => this.update(rec.invitationId, entry => {
      entry.pendingRotate = { code: rotate.code, expiresAt: rotate.expiresAt };
    }));
    // The notice arrived over the connection being re-keyed; apply only after the reply has left.
    this.timer(`apply:${rec.invitationId}`, REPLY_DELAY_MS, () => this.lane(rec.invitationId, () => this.applyRotate(rec.invitationId)));
    return { accepted: true };
  }

  /**
   * Enrolls again at the peer with a rotated code and reconnects. The old connector is closed only once the code is in hand
   * (the hub replaces a same-instance session with 4004); a failed enroll keeps the pending code until it expires.
   */
  private async applyRotate(invitationId: string): Promise<boolean> {
    const rec = this.get(invitationId);
    const pending = rec?.pendingRotate;
    if (!rec || !pending || rec.phase !== 'linked' || rec.paused || !rec.outbound?.url || !rec.peer || this.disposed) return false;
    if (pending.expiresAt <= this.now()) { await this.update(invitationId, entry => { delete entry.pendingRotate; }); return false; }
    await this.closeConnection(invitationId);
    const budget = this.signal(ENROLL_BUDGET_MS);
    const enrolled = await this.abortable(this.connector.enroll({ serverUrl: rec.outbound.url, joinCode: pending.code, hostName: this.hostName(),
      signal: budget, instanceId: this.options.instanceId }), budget);
    if (enrolled.hostId !== rec.outbound.hostId) {
      await this.update(invitationId, entry => { delete entry.pendingRotate; });
      throw new Error('peer link rotation mismatch');
    }
    const next = await this.update(invitationId, entry => {
      entry.outbound = { ...entry.outbound!, hostKey: enrolled.hostKey };
      delete entry.pendingRotate;
    });
    await this.open(next);
    this.changed();
    return true;
  }

  /** Destination side of `peer.relink` (sessionless): the peer's connector into this app's host was rejected. */
  async acceptRelink(senderId: string, hostId: string, _signal: AbortSignal): Promise<RelinkReply> {
    this.assertLive();
    const rec = [...this.mirror.values()].find(entry => entry.phase === 'linked' && entry.peer === senderId && entry.inbound?.hostId === hostId);
    if (!rec?.peer || !rec.inbound || rec.paused) return { accepted: false };
    const key = `relinked-in:${rec.invitationId}`;
    if (this.now() - (this.relinked.get(key) ?? 0) < PEER_RELINK_ACCEPT_INTERVAL_MS) return { accepted: false };
    try {
      return await this.lane(rec.invitationId, async () => {
        // Re-checked inside the lane: concurrent requests queue here and must not each mint (each mint replaces the last).
        if (this.now() - (this.relinked.get(key) ?? 0) < PEER_RELINK_ACCEPT_INTERVAL_MS) return { accepted: false as const };
        const issued = this.options.joinCodes.mintForwardOnlyForHost(rec.inbound!.hostId, this.now());
        // Only a successful mint paces: a refused or failed one must not hold back the retry.
        this.relinked.set(key, this.now());
        await this.update(rec.invitationId, entry => { entry.lastRotatedAt = this.now(); });
        return { accepted: true as const, code: issued.joinCode, expiresAt: issued.expiresAt };
      });
    } catch { return { accepted: false }; }
  }

  /** Redeemer: own connector into the peer is dead; ask the peer (over the own inbound host) for a fresh code. */
  private async relink(rec: Rec): Promise<boolean> {
    if (!this.options.bridge?.peerRelink || !rec.inbound || !rec.outbound || !rec.peer) return false;
    const pace = this.relinkPace.get(rec.invitationId);
    this.relinkPace.set(rec.invitationId, { at: this.now(), attempts: (pace?.attempts ?? 0) + 1 });
    const reply = await this.options.bridge.peerRelink(rec.inbound.hostId, { recipientInstanceId: rec.peer, hostId: rec.outbound.hostId }, this.signal(CONTROL_MS));
    if (!reply.accepted) return false;
    await this.update(rec.invitationId, entry => { entry.pendingRotate = { code: reply.code, expiresAt: reply.expiresAt }; });
    return this.applyRotate(rec.invitationId);
  }

  /** Remaining wait before the next relink request for this link may go out (0 = due). */
  private relinkWait(invitationId: string, now: number): number {
    const pace = this.relinkPace.get(invitationId);
    if (!pace) return 0;
    const interval = Math.min(PEER_RELINK_INTERVAL_MS, PEER_RELINK_MIN_INTERVAL_MS * 2 ** Math.min(Math.max(0, pace.attempts - 1), 8));
    return Math.max(0, pace.at + interval - now);
  }

  /** `replace` reschedules; otherwise an already armed heal is only ever brought forward, never pushed out. */
  private armHeal(invitationId: string, delay: number, replace: boolean): void {
    const key = `heal:${invitationId}`, at = this.now() + delay;
    if (!replace && this.timers.has(key) && (this.healAt.get(invitationId) ?? Infinity) <= at) return;
    this.healAt.set(invitationId, at);
    this.timer(key, delay, () => { this.healAt.delete(invitationId); return this.lane(invitationId, () => this.supervise(invitationId)); });
  }

  /**
   * A linked link whose own connector stays down asks the peer to relink (a fresh code for the own outbound host):
   * promptly when the peer's connector into this app is live (the peer is up, so this route is stale, e.g. it signed
   * back in to Connect under a new server), otherwise only after the offline threshold. `force` (owner Reconnect)
   * skips the grace and the pacing. Re-arms itself while the link stays down and the peer stays reachable.
   * Runs inside the invitation lane. Returns whether a relink was applied.
   */
  private async relinkIfStale(invitationId: string, force = false): Promise<boolean> {
    const rec = this.get(invitationId);
    const entry = this.live.get(invitationId);
    // Only the redeemer: it owns the tunnel, and a down tunnel is not a stale code (the ssh reconnect loop heals that).
    if (!rec || rec.role !== 'redeemer' || rec.phase !== 'linked' || rec.paused || this.disposed || !rec.inbound || !rec.peer || !entry || entry.connected ||
      !this.tunnels.get(invitationId)?.up) return false;
    const now = this.now();
    const since = Math.max(entry.downSince ?? entry.openedAt, entry.openedAt, this.inboundSeen.get(invitationId) ?? 0);
    const reachable = this.options.hostHub.getSession(rec.inbound.hostId)?.instanceId === rec.peer;
    if (!reachable && now - since < PEER_OFFLINE_AFTER_MS) return false; // its connector re-attaching re-arms healing
    const wait = force ? 0 : Math.max(since + PEER_RELINK_AFTER_MS - now, this.relinkWait(invitationId, now));
    if (wait > 0) { if (reachable) this.armHeal(invitationId, wait, true); return false; }
    const applied = await this.relink(rec).catch(() => false);
    if (reachable && !this.live.get(invitationId)?.connected) this.armHeal(invitationId, Math.max(REPLY_DELAY_MS, this.relinkWait(invitationId, this.now())), true);
    return applied;
  }

  /** The linked, unpaused connection to a peer, for per-plugin use approval. */
  useRoute(peerInstanceId: string): { pairingId: string; hostId: string; peerName: string } | undefined {
    const rec = this.linkedFor(peerInstanceId);
    if (!rec?.inbound || rec.paused) return undefined;
    return { pairingId: rec.pairingId ?? rec.invitationId, hostId: rec.inbound.hostId, peerName: rec.peerName ?? 'Computer' };
  }

  /** Local revocation needs the persisted host even while a paused link cannot carry traffic. */
  useRouteForStop(peerInstanceId: string): { pairingId: string; hostId: string; peerName: string } | undefined {
    const rec = this.linkedFor(peerInstanceId);
    if (!rec?.inbound) return undefined;
    return { pairingId: rec.pairingId ?? rec.invitationId, hostId: rec.inbound.hostId, peerName: rec.peerName ?? 'Computer' };
  }

  /** Incoming `use.*`: sender, the receiving inbound host and the pairing must all name the same linked connection. */
  useRouteFor(senderId: string, hostId: string, pairingId: string): { pairingId: string; hostId: string; peerName: string } | undefined {
    const route = this.useRoute(senderId);
    return route && route.hostId === hostId && route.pairingId === pairingId ? route : undefined;
  }

  /** Either side of `peer.remove`: run local cleanup, then drop and revoke after the reply has left. */
  async acceptRemoval(senderId: string, hostId: string, ref: { pairingId: string; hostId: string }): Promise<{ accepted: boolean }> {
    this.assertLive();
    const rec = [...this.mirror.values()].find(entry => !TERMINAL.has(entry.phase) && entry.peer === senderId && entry.inbound?.hostId === hostId &&
      entry.outbound?.hostId === ref?.hostId && (entry.pairingId ?? entry.invitationId) === ref?.pairingId);
    if (!rec) return { accepted: false };
    this.timer(`removal:${rec.invitationId}`, REPLY_DELAY_MS, () => this.lane(rec.invitationId, async () => {
      const current = this.get(rec.invitationId);
      if (current && !TERMINAL.has(current.phase)) {
        try { await this.options.onRemoving?.(senderId); } catch { /* cleanup never blocks removal */ }
        await this.removeLinked(current, 'revoked', false);
        // Peer-initiated removal must revoke local grants and forget use state too.
        await this.options.onRemoved?.(senderId);
      }
    }));
    return { accepted: true };
  }

  /** Re-keys the link with a peer still linked: rotates this app's own inbound and reopens the own connection. */
  async rotate(peerInstanceId: string): Promise<PeerLinkView[]> {
    this.assertLive();
    const rec = this.linkedFor(peerInstanceId);
    if (!rec) throw new Error('peer is not linked');
    if (rec.paused) return this.links(peerInstanceId);
    await this.lane(rec.invitationId, async () => {
      this.retries.delete(`open:${rec.invitationId}`);
      // Own connector down: re-keying the peer's side alone cannot help; ask the peer for a fresh code first, now.
      let healed = false;
      if (this.get(rec.invitationId)?.pendingRotate) healed = await this.applyRotate(rec.invitationId).catch(() => false);
      if (!healed) { this.relinkPace.delete(rec.invitationId); healed = await this.relinkIfStale(rec.invitationId, true); }
      await this.rotateOwn(rec.invitationId).catch(() => false);
      const latest = this.get(rec.invitationId);
      if (!healed && latest?.phase === 'linked' && latest.outbound?.hostKey) { await this.closeConnection(latest.invitationId); await this.open(latest); }
    });
    this.changed();
    return this.links(peerInstanceId);
  }

  /** One plugin scope released: drops its use on the own inbound host. The link stays, even with no uses left. */
  async release(peerInstanceId: string, pluginId: string, scope: string): Promise<boolean> {
    this.assertLive();
    let released = false;
    for (const rec of this.records().filter(entry => entry.peer === peerInstanceId && LIVE_PHASES.has(entry.phase) &&
      entry.pluginId === pluginId && entry.scope === scope)) {
      await this.invitations().fail(rec.invitationId, 'cancelled').catch(() => undefined);
      released = true;
    }
    const rec = this.linkedFor(peerInstanceId);
    if (rec?.inbound) {
      const host = getHost(this.options.db, rec.inbound.hostId);
      const used = !!host && host.purpose.kind === 'plugin-link' && host.purpose.uses.some(use => use.pluginId === pluginId && use.scope === scope);
      if (used) {
        released = true;
        removeHostLinkUse(this.options.db, rec.inbound.hostId, pluginId, scope);
      }
    }
    if (released) this.changed();
    return released;
  }

  /**
   * Owner removal (or revocation): local-first. A linked record is torn down at once, outside its lane (a long lane step must
   * not delay it), while the peer notice is sent without being awaited. Then pair grants and plugin notes for the peer are dropped.
   */
  async remove(peerInstanceId: string, removal: 'removed' | 'revoked' = 'removed', options?: { hooksRan?: boolean }): Promise<boolean> {
    this.assertLive();
    const recs = this.records().filter(entry => entry.peer === peerInstanceId && !TERMINAL.has(entry.phase));
    // `hooksRan`: the owner's removal already ran the plugin handlers and revoked the uses (Retry / Remove anyway).
    if (!options?.hooksRan && recs.some(entry => entry.phase === 'linked')) {
      try { await this.options.onRemoving?.(peerInstanceId); } catch { /* plugin cleanup never vetoes a removal */ }
    }
    for (const rec of recs) {
      if (rec.phase === 'linked') {
        await this.removeLinked(rec, removal, true);
        continue;
      }
      await this.lane(rec.invitationId, async () => {
        const current = this.get(rec.invitationId);
        if (!current || TERMINAL.has(current.phase)) return;
        if (current.phase === 'linked') await this.removeLinked(current, removal, true);
        else {
          await this.teardown(current, { abort: 'cancelled', failure: 'fenced' });
          await this.invitations().fail(current.invitationId, 'cancelled').catch(() => undefined);
        }
      });
    }
    if (recs.length) {
      try { await this.options.onRemoved?.(peerInstanceId); } catch { /* grants/notes cleanup is best effort; a later revoke retries */ }
      this.changed();
    }
    return recs.length > 0;
  }

  /**
   * Owner Disconnect: keeps the record and keys but closes this side's connector (and, for the redeemer, the ssh tunnel),
   * stops the heal/rotate loops and refuses the peer's connector on the own inbound host. The peer just sees this app go
   * offline (never `revoked`) and heals once Reconnect runs. Persisted, so a restart stays paused.
   */
  async pause(peerInstanceId: string): Promise<boolean> {
    this.assertLive();
    const rec = this.linkedFor(peerInstanceId);
    if (!rec) return false;
    await this.lane(rec.invitationId, async () => {
      const current = this.get(rec.invitationId);
      if (!current || current.phase !== 'linked') return;
      if (!current.paused) await this.update(current.invitationId, entry => { entry.paused = true; });
      for (const key of ['heal', 'apply', 'rotate']) {
        const timer = this.timers.get(`${key}:${current.invitationId}`);
        if (timer) { clearTimeout(timer); this.timers.delete(`${key}:${current.invitationId}`); }
      }
      this.healAt.delete(current.invitationId); this.relinkPace.delete(current.invitationId); this.inboundSeen.delete(current.invitationId);
      await this.closeConnection(current.invitationId);
      if (current.ssh.side === 'client') await this.closeTunnel(current.invitationId);
      if (current.inbound) {
        try { this.options.hostHub.getSession(current.inbound.hostId)?.socket.close(1001, 'peer-paused'); } catch { /* already closing */ }
      }
    });
    this.changed();
    return true;
  }

  /** Owner Reconnect: clears the pause and reopens the tunnel and connector now; the peer's connector heals on its own. */
  async unpause(peerInstanceId: string): Promise<boolean> {
    this.assertLive();
    const rec = this.linkedFor(peerInstanceId);
    if (!rec) return false;
    await this.lane(rec.invitationId, async () => {
      const current = this.get(rec.invitationId);
      if (!current || current.phase !== 'linked') return;
      if (current.paused) await this.update(current.invitationId, entry => { delete entry.paused; });
      this.relinkPace.delete(current.invitationId);
      await this.supervise(current.invitationId);
    });
    this.changed();
    return true;
  }

  private async removeLinked(rec: Rec, removal: 'removed' | 'revoked', notify: boolean): Promise<void> {
    // Local-first: the notice is initiated before the inbound host is destroyed (it travels over that host's session) but never
    // awaited, so an offline or slow peer cannot delay teardown. A peer that misses it sees the closed connector (4003) or a lapsed link line.
    if (notify && this.options.bridge?.peerRemove && rec.inbound && rec.peer) {
      try {
        void Promise.resolve(this.options.bridge.peerRemove(rec.inbound.hostId, { recipientInstanceId: rec.peer, pairingId: rec.pairingId ?? rec.invitationId,
          hostId: rec.inbound.hostId }, this.signal(NOTICE_MS))).catch(() => undefined);
      } catch { /* best effort */ }
    }
    await this.teardown(rec, { removal });
  }

  /**
   * Tears down only what this record owns: aborts the peer (pre-consent), closes the own connector, destroys the own
   * forward-only inbound host, releases the SSH side (A: authorized_keys lines and forwarder; B: tunnel and key) and scrubs every secret.
   */
  private async teardown(rec: Rec, how: { abort?: 'denied' | 'cancelled' | 'expired'; failure?: Rec['failure']; removal?: Rec['removal'] }): Promise<void> {
    const silenced = this.silenced.has(rec.invitationId);
    if (how.abort && !silenced && rec.inbound && rec.peer && this.options.hostHub.getSession(rec.inbound.hostId)) {
      await this.send(rec.inbound.hostId, rec.peer, { op: 'bootstrap.abort', invitationId: rec.invitationId, reason: how.abort },
        this.signal(NOTICE_MS)).catch(() => undefined);
    }
    this.relinkPace.delete(rec.invitationId); this.healAt.delete(rec.invitationId); this.inboundSeen.delete(rec.invitationId);
    for (const key of ['pull', 'found', 'rotate', 'apply', 'heal', 'abort', 'removal']) {
      const timer = this.timers.get(`${key}:${rec.invitationId}`);
      if (timer && !(key === 'abort' || key === 'removal')) { clearTimeout(timer); this.timers.delete(`${key}:${rec.invitationId}`); }
    }
    await this.closeConnection(rec.invitationId);
    if (rec.outbound && rec.peer) await this.options.channels.unregister(rec.peer, rec.outbound.hostId).catch(() => false);
    if (rec.inbound) this.removeInbound(rec.inbound.hostId);
    await this.releaseTransport(rec);
    await rm(this.daemonDir(rec.invitationId), { recursive: true, force: true }).catch(() => undefined);
    this.wires.delete(rec.invitationId);
    this.silenced.delete(rec.invitationId);
    await this.update(rec.invitationId, entry => {
      entry.phase = how.removal ? 'removed' : 'failed';
      if (how.failure) entry.failure = how.failure;
      if (how.removal) entry.removal = how.removal;
      if (entry.inbound) entry.inbound = { hostId: entry.inbound.hostId };
      if (entry.outbound) entry.outbound = { hostId: entry.outbound.hostId };
      delete entry.reverse; delete entry.pendingRotate; delete entry.deadline;
      delete entry.ssh.bootstrapSeed; delete entry.ssh.throwawayPub; delete entry.ssh.linkPub; delete entry.ssh.endpoint;
    }).catch(() => undefined);
    this.changed();
  }

  /** Removes a forward-only host this store minted. An execution host is never touched. */
  private removeInbound(hostId: string): void {
    this.options.joinCodes.invalidateHost(hostId);
    const host = getHost(this.options.db, hostId);
    if (!host || host.destroyedAt || host.enrollmentCapability !== 'peer.forward') return;
    this.options.hostHub.getSession(hostId)?.socket.close(4003, 'host-removed');
    this.options.hostHub.detach(hostId, 'removed');
    destroyHost(this.options.db, hostId);
  }

  /**
   * Best effort and idempotent: a failed line removal is finished by `reconcile` at the next start or sweep (a record in a terminal phase
   * is not live), and a bootstrap line also expires on its own.
   */
  private async releaseTransport(rec: Rec): Promise<void> {
    const ssh = this.options.ssh;
    this.forwarderBlocked.delete(rec.invitationId);
    if (rec.ssh.side === 'server') {
      await ssh.authorizedKeys.remove(rec.invitationId).catch(() => undefined);
      await ssh.forwarder.release(rec.invitationId).catch(() => undefined);
    } else {
      await this.closeTunnel(rec.invitationId);
      await ssh.dropLinkKey(rec.invitationId).catch(() => undefined);
    }
  }

  private abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(new Error('peer link step cancelled or timed out'));
      if (signal.aborted) { abort(); return; }
      signal.addEventListener('abort', abort, { once: true });
      work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }

  // ---------- Connections ----------

  private async closeConnection(invitationId: string): Promise<void> {
    const current = this.live.get(invitationId);
    this.live.delete(invitationId);
    await current?.connection.close().catch(() => undefined);
  }

  /** Redeemer: the ssh tunnel to the inviter, opened once per link and kept by the transport's reconnect loop. */
  private async ensureTunnel(rec: Rec, signal: AbortSignal = this.controller.signal): Promise<TunnelEntry> {
    const existing = this.tunnels.get(rec.invitationId);
    if (existing) return existing;
    const { endpoint, bootstrapSeed, identity } = rec.ssh;
    if (rec.ssh.side !== 'client' || !endpoint || (identity !== 'link' && !bootstrapSeed)) throw new Error('peer ssh tunnel unavailable');
    const entry = { up: false } as TunnelEntry;
    const id = rec.invitationId;
    const onState = (up: boolean, failure?: SshReason): void => {
      if (this.tunnels.get(id) !== entry && entry.tunnel) return;
      entry.up = up;
      if (up) { delete entry.downSince; delete entry.failure; }
      else { entry.downSince ??= this.now(); if (failure) entry.failure = failure; }
      this.changed();
    };
    const opening = this.options.ssh.openTunnel(id, {
      endpoint, identity: identity === 'link' ? { linkKey: true } : { seed: bootstrapSeed! },
      listenPort: rec.ssh.listenPort, targetPort: rec.ssh.targetPort, ...(rec.ssh.localPort ? { localPort: rec.ssh.localPort } : {})
    }, onState);
    let tunnel: PeerSshTunnel;
    try { tunnel = await this.abortable(opening, signal); }
    catch (error) { void opening.then(late => late.close(), () => undefined).catch(() => undefined); throw error; }
    if (this.disposed || signal.aborted) { await tunnel.close().catch(() => undefined); throw new Error('peer link step cancelled or timed out'); }
    entry.tunnel = tunnel;
    this.tunnels.set(id, entry);
    return entry;
  }

  private async closeTunnel(invitationId: string): Promise<void> {
    const entry = this.tunnels.get(invitationId);
    this.tunnels.delete(invitationId);
    await entry?.tunnel.close().catch(() => undefined);
  }

  private async open(rec: Rec): Promise<void> {
    const outbound = rec.outbound;
    if (!outbound?.hostKey || !outbound.url || !rec.peer) throw new Error('peer enrollment incomplete');
    this.assertLive();
    if (this.mirror.get(rec.invitationId)?.paused) return;
    const previous = this.live.get(rec.invitationId);
    await this.closeConnection(rec.invitationId);
    const daemonDir = this.daemonDir(rec.invitationId);
    await mkdir(daemonDir, { recursive: true, mode: 0o700 });
    const entry = { connected: false, downSince: previous?.downSince ?? this.now(), openedAt: this.now() } as Live;
    entry.connection = this.connector.connect({ serverUrl: outbound.url, hostId: outbound.hostId, hostKey: outbound.hostKey,
      expectedRemoteInstanceId: rec.peer, daemonDir, localAppDataDir: this.options.localAppDataDir, instanceId: this.options.instanceId,
      onConnectionChange: connected => {
        if (this.live.get(rec.invitationId) !== entry) return;
        entry.connected = connected;
        if (connected) { delete entry.downSince; this.relinkPace.delete(rec.invitationId); }
        else {
          entry.downSince ??= this.now();
          // Not replacing: a connector reporting every failed retry must not keep pushing the heal out.
          if (this.mirror.get(rec.invitationId)?.phase === 'linked') this.armHeal(rec.invitationId, PEER_RELINK_AFTER_MS, false);
        }
        this.changed();
      } });
    this.live.set(rec.invitationId, entry);
    if (rec.phase === 'linked') this.armHeal(rec.invitationId, PEER_RELINK_AFTER_MS, false);
    void entry.connection.ready.catch(() => undefined);
  }

  // ---------- Views ----------

  async links(peerInstanceId?: string): Promise<PeerLinkView[]> {
    this.assertLive();
    if (!this.loaded) await this.load();
    return this.records().filter(rec => rec.peer && (!peerInstanceId || rec.peer === peerInstanceId)).map(rec => this.project(rec));
  }

  private project(rec: Rec): PeerLinkView {
    const phase: PeerLinkViewPhase = rec.phase === 'pre-consent' ? 'pending' : rec.phase === 'activating' ? 'enrolled' : rec.phase;
    const base = { pairingId: rec.pairingId ?? rec.invitationId, peerInstanceId: rec.peer!, ...(rec.pluginId !== undefined ? { pluginId: rec.pluginId, scope: rec.scope } : {}), role: rec.role,
      phase, capability: 'peer.forward' as const, ...(rec.failure ? { failure: rec.failure } : {}),
      ...(rec.peerName ? { peerName: rec.peerName } : {}) };
    if (rec.phase === 'removed') return { ...base, state: 'disconnected', reason: 'revoked' };
    if (rec.phase === 'failed') return { ...base, state: 'disconnected', reason: 'peer-offline' };
    if (rec.phase !== 'linked') {
      const attempts = this.retries.get(`found:${rec.invitationId}`) ?? this.retries.get(`pull:${rec.invitationId}`);
      return { ...base, state: 'reconnecting', ...(attempts ? { retryInMs: backoff(attempts - 1) } : {}) };
    }
    if (this.forwarderBlocked.has(rec.invitationId)) return { ...base, state: 'disconnected', reason: 'ssh-down' };
    // The owner disconnected this link: plugins see `paused` (not an error, not retried); the other computer only sees this one offline.
    if (rec.paused) return { ...base, state: 'disconnected', reason: 'paused' };
    const entry = this.live.get(rec.invitationId);
    if (entry?.connected) return { ...base, state: 'connected' };
    // The redeemer's tunnel is down: the connector cannot recover until ssh does (a brief blip is only reconnecting).
    const tunnel = this.tunnels.get(rec.invitationId);
    if (rec.ssh.side === 'client' && (!tunnel || !tunnel.up)) {
      if (tunnel?.downSince !== undefined && this.now() - tunnel.downSince < PEER_OFFLINE_AFTER_MS) return { ...base, state: 'reconnecting', retryInMs: backoff(0) };
      return { ...base, state: 'disconnected', reason: 'ssh-down' };
    }
    if (entry && entry.downSince !== undefined && this.now() - entry.downSince < PEER_OFFLINE_AFTER_MS) {
      return { ...base, state: 'reconnecting', retryInMs: backoff(0) };
    }
    return { ...base, state: 'disconnected', reason: 'peer-offline' };
  }

  // ---------- Startup, sweep, shutdown ----------

  /** Reopens what a restart dropped: A re-acquires the forwarder lease, B reopens its tunnel; then the connector. */
  private async resume(invitationId: string): Promise<void> {
    const rec = this.get(invitationId);
    if (!rec || TERMINAL.has(rec.phase) || !rec.outbound?.hostKey || rec.paused) return;
    if (rec.ssh.side === 'client') {
      // A failed tunnel does not block the connector: it retries against the stable local port and the sweep reopens the tunnel.
      await this.ensureTunnel(rec).catch(() => undefined);
    }
    await this.open(this.get(invitationId) ?? rec);
  }

  /** Startup (once, at context init): load, reopen connections and resume unfinished steps. */
  start(): Promise<void> {
    this.assertLive();
    return this.track((async () => {
      await this.load();
      await this.reconcileTransport();
      for (const rec of this.records()) {
        if (this.disposed) return;
        if (TERMINAL.has(rec.phase)) continue;
        if (rec.ssh.side === 'server' && !(await this.bindForwarder(rec))) continue;
        // No use is re-added here: `activate` recorded the founding use once, and a stopped use must not come back on restart.
        if (rec.outbound?.hostKey) await this.lane(rec.invitationId, () => this.resume(rec.invitationId)).catch(() => undefined);
        if (rec.inbound && this.options.hostHub.getSession(rec.inbound.hostId)) this.onInboundConnected(rec.inbound.hostId);
        if (rec.role === 'redeemer' && rec.phase === 'activating') this.kickFounding(rec.invitationId, 0);
      }
      for (const pairing of await this.options.invitations()?.listConsented().catch(() => [] as ConsentedPairing[]) ?? []) {
        const rec = this.mirror.get(pairing.invitationId);
        if (rec && !rec.pairingId) this.onConsented(pairing);
      }
      await this.sweep();
    })());
  }

  /**
   * Inviter, at startup: re-take the forwarder lease and require it to be on exactly the F this link's authorized_keys
   * `permitopen` and the redeemer's `-L` target name. Anything else (F busy, a different port) fails closed: B would
   * otherwise reach whatever else listens on the old F.
   */
  private async bindForwarder(rec: Rec): Promise<boolean> {
    const ssh = this.options.ssh;
    try {
      const port = await ssh.forwarder.acquire(rec.invitationId);
      if (port !== rec.ssh.targetPort) { await ssh.forwarder.release(rec.invitationId).catch(() => undefined); throw new Error('forwarder port moved'); }
    } catch {
      await this.blockForwarder(rec);
      return false;
    }
    // Idempotent: restores the link line removed while this link was blocked and the squatter has since gone.
    if (rec.phase === 'linked' && rec.ssh.linkPub) {
      await ssh.authorizedKeys.upsert({ linkId: rec.invitationId, kind: 'link', pub: rec.ssh.linkPub, listenPort: rec.ssh.listenPort,
        targetPort: rec.ssh.targetPort, expiresAt: this.now() + LINK_LINE_TTL_MS }).catch(() => undefined);
    }
    return true;
  }

  /** An unfinished attempt is failed outright; an established link stays (so the owner can remove it) but is `ssh-down` and unauthorized. */
  private async blockForwarder(rec: Rec): Promise<void> {
    const id = rec.invitationId;
    if (rec.phase === 'linked') {
      this.forwarderBlocked.add(id);
      await this.options.ssh.authorizedKeys.remove(id).catch(() => undefined);
      this.changed();
      return;
    }
    await this.lane(id, async () => {
      const current = this.get(id);
      if (!current || current.phase === 'linked' || TERMINAL.has(current.phase)) return;
      await this.teardown(current, { abort: 'cancelled', failure: 'unreachable' });
      await this.invitations().fail(id, 'unreachable').catch(() => undefined);
    }).catch(() => undefined);
  }

  /** True while any inviter link still depends on the remembered F; the forwarder lease must not pick a new port then. */
  hasLiveServerLinks(): boolean {
    return this.records().some(rec => rec.ssh.side === 'server' && !TERMINAL.has(rec.phase) && !this.forwarderBlocked.has(rec.invitationId));
  }

  /** Drops Zana-owned authorized_keys lines of links that no longer exist (crash between steps, failed removal), and orphaned link-key seeds. */
  private async reconcileTransport(): Promise<void> {
    const active = this.records().filter(rec => !TERMINAL.has(rec.phase));
    const live = new Set(active.filter(rec => rec.ssh.side === 'server' && !this.forwarderBlocked.has(rec.invitationId)).map(rec => rec.invitationId));
    await this.options.ssh.authorizedKeys.reconcile(live).catch(() => undefined);
    const keyed = new Set(active.filter(rec => rec.ssh.side === 'client').map(rec => rec.invitationId));
    await this.options.ssh.reconcileLinkKeys?.(keyed).catch(() => undefined);
  }

  /** Periodic: reconciles authorized_keys, expires stale attempts, retries pulls and supervises linked links. Coalesced. */
  sweep(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return this.sweeping ??= this.track(this.sweepOnce().finally(() => { this.sweeping = undefined; }));
  }

  private async sweepOnce(): Promise<void> {
    if (!this.loaded) await this.load().catch(() => undefined);
    await this.reconcileTransport();
    for (const rec of this.records()) {
      if (this.disposed) return;
      if (TERMINAL.has(rec.phase)) continue;
      const now = this.now();
      if ((rec.phase === 'pre-consent' && now >= rec.createdAt + PEER_LINK_PRE_CONSENT_MAX_MS) ||
        (rec.phase === 'activating' && rec.deadline !== undefined && now >= rec.deadline)) {
        await this.lane(rec.invitationId, async () => {
          const current = this.get(rec.invitationId);
          if (!current || current.phase === 'linked' || TERMINAL.has(current.phase)) return;
          await this.teardown(current, { abort: 'expired', failure: 'expired' });
          await this.invitations().fail(current.invitationId, 'expired').catch(() => undefined);
        }).catch(() => undefined);
        continue;
      }
      if (rec.phase === 'pre-consent' && rec.role === 'inviter' && rec.inbound && !rec.outbound?.hostKey &&
        this.options.hostHub.getSession(rec.inbound.hostId) && !this.timers.has(`pull:${rec.invitationId}`)) {
        this.kickPull(rec.invitationId, 0);
        continue;
      }
      if (rec.phase === 'linked' && this.orphaned(rec)) { await this.dropOrphans(rec.peer!).catch(() => undefined); continue; }
      if (rec.phase === 'linked') await this.lane(rec.invitationId, () => this.supervise(rec.invitationId)).catch(() => undefined);
    }
  }

  /** A linked record whose own inbound host is gone: the computer was removed without this store (nothing in Computers shows it). */
  private orphaned(rec: Rec): boolean {
    if (rec.phase !== 'linked' || !rec.peer || !rec.inbound) return false;
    const host = getHost(this.options.db, rec.inbound.hostId);
    return !host || !!host.destroyedAt;
  }

  /** True when no live record owns the peer's channel but a finished one of this store does. */
  private ownsStaleChannel(peer: string, hostId: string): boolean {
    const owners = this.records().filter(rec => rec.peer === peer && rec.outbound?.hostId === hostId);
    return owners.length > 0 && owners.every(rec => TERMINAL.has(rec.phase));
  }

  /** Finishes the teardown of orphaned links for a peer, so a fresh join is not refused by a connection no one can see. */
  private async dropOrphans(peer: string): Promise<void> {
    const orphans = this.records().filter(rec => rec.peer === peer && this.orphaned(rec));
    for (const rec of orphans) {
      await this.lane(rec.invitationId, async () => {
        const current = this.get(rec.invitationId);
        if (current && this.orphaned(current)) await this.removeLinked(current, 'removed', true);
      });
    }
    if (orphans.length) {
      try { await this.options.onRemoved?.(peer); } catch { /* grants/notes cleanup is best effort */ }
      this.changed();
    }
  }

  private async supervise(invitationId: string): Promise<void> {
    const rec = this.get(invitationId);
    if (!rec || rec.phase !== 'linked' || this.disposed || this.forwarderBlocked.has(invitationId) || rec.paused) return;
    if (rec.pendingRotate) {
      if (await this.applyRotate(invitationId).catch(() => false)) return;
    }
    if (rec.ssh.side === 'server' && rec.ssh.throwawayPub) await this.dropBootstrap(invitationId);
    if (rec.ssh.side === 'client' && !this.tunnels.has(invitationId)) await this.ensureTunnel(rec).catch(() => undefined);
    if (rec.outbound?.hostKey && !this.live.has(invitationId)) await this.open(rec).catch(() => undefined);
    if (rec.lastRotatedAt === undefined || this.now() - rec.lastRotatedAt >= PEER_LINK_ROTATION_MS) await this.rotateOwn(invitationId).catch(() => false);
    await this.relinkIfStale(invitationId);
  }

  private closeAll(): Promise<unknown> {
    return Promise.allSettled([...[...this.live.keys()].map(key => this.closeConnection(key)), ...[...this.tunnels.keys()].map(key => this.closeTunnel(key))]);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.controller.abort(new Error('peer links disposed'));
    void this.track(this.closeAll());
    this.storage.dispose();
  }

  async whenIdle(): Promise<void> {
    while (this.tasks.size) await Promise.allSettled([...this.tasks]);
    if (this.disposed) await this.closeAll();
    await this.storage.whenIdle();
  }
}
