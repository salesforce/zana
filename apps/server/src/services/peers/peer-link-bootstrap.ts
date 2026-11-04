import { hkdfSync } from 'node:crypto';
import { z } from 'zod';
import { PeerControlPacketSchema, PEER_CONTROL_MAX_BYTES, type PeerControlPacket } from '@zana-ai/zcc-contracts/host-rpc';
import { getHost, type ZccDatabase } from '@zana-ai/zcc-db';
import type { HostHub } from '../../http/host-hub.js';
import { PEER_ID } from './peer-auth.js';
import { channelHash, type EnrolledPeerChannels } from './enrolled-peer-channels.js';
import { controlResponse, openControl, sealControl } from './peer-control-protocol.js';
import type { PeerReplayWindow } from './peer-replay-window.js';

/**
 * Pre-consent bootstrap control plane for invitation-founded peer links (plan-rework-no-connect-changes §3.2, §5).
 *
 * Reuses the `peer.control` host RPC and `PeerControlPacketSchema` unchanged. A packet is bootstrap-form iff
 * `senderHostId === recipientHostId`: it travels over the one link H whose hub session the sender owns, and both sides
 * key it from H alone (the connector side has no reverse host yet). The mutual path (`peer-control-api.ts`) rejects this
 * form; this module accepts only it. Nothing here consults `ScopedLinkAuthority`: a pre-consent link is never a
 * plugin-usable peer.
 */

export const BOOTSTRAP_LIMITS = Object.freeze({
  bodyBytes: 32 * 1024, abortBytes: 1024, timeoutMs: 15_000, concurrentPerApp: 4, messagesPerLink: 64, pullsPerLink: 3,
  exchangesPerInvitation: 20, preConsentLinksPerApp: 4, pluginLinksPerApp: 16
});
const ISSUED_PAST_MS = 60_000, ISSUED_FUTURE_MS = 10_000, MAX_TRACKED = 256;

export type PeerLinkPhase = 'pre-consent' | 'activating' | 'linked' | 'removed' | 'failed';
/** Phases in which `bootstrap.exchange` / `bootstrap.abort` may still arrive (a lost `ack` reply is retried after linking). */
const BOOTSTRAP_PHASES: ReadonlySet<PeerLinkPhase> = new Set(['pre-consent', 'activating', 'linked']);

const invitationId = z.string().regex(PEER_ID);
const UUID = z.string().uuid();
const JOIN_CODE = /^zcde_[A-Za-z0-9_-]{24}$/;
export const BootstrapInputSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('bootstrap.pull'), invitationId, nonce: z.string().regex(/^[a-f0-9]{48}$/) }).strict(),
  // `wire` is `wireRedeem` (kind 'redeem') or `wireExchange` (kind 'exchange') from peer-invitation.ts; it is validated there.
  z.object({ op: z.literal('bootstrap.exchange'), invitationId, kind: z.enum(['redeem', 'exchange']),
    wire: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ op: z.literal('bootstrap.abort'), invitationId, reason: z.enum(['denied', 'cancelled', 'expired']) }).strict(),
  // Inviter -> redeemer: both owners approved; poll the inviter now instead of on the next status cadence.
  z.object({ op: z.literal('bootstrap.nudge'), invitationId }).strict()
]);
export type BootstrapInput = z.infer<typeof BootstrapInputSchema>;
/** Reply to `bootstrap.pull`: the redeemer's sealed `wireRedeem` and its lazily minted reverse join code for H'. */
export const PullReplySchema = z.object({ redeem: z.record(z.string(), z.unknown()),
  reverse: z.object({ hostId: UUID, code: z.string().regex(JOIN_CODE), expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict() }).strict();
export type PullReply = z.infer<typeof PullReplySchema>;
export const AbortReplySchema = z.object({ ok: z.literal(true) }).strict();
/** Reply to `bootstrap.exchange`: `wireResponse` from peer-invitation.ts, validated there. */
export type ExchangeReply = Record<string, unknown>;
export type BootstrapReply<I extends BootstrapInput> = I extends { op: 'bootstrap.pull' } ? PullReply
  : I extends { op: 'bootstrap.abort' | 'bootstrap.nudge' } ? { ok: true } : ExchangeReply;

/** Bounded, secret-free rejection. `status`: 403 not authorized / not consented, 404 no record, 413 oversize, 429 cap. */
export class BootstrapRejection extends Error {
  constructor(readonly status: 403 | 404 | 413 | 429 | 502, message: string) { super(message); this.name = 'BootstrapRejection'; }
}
export const NOT_CONSENTED = 'peer link not consented';

/** The link record the receiving app holds for (sender, H). `role` is the receiver's own role in the invitation. */
export interface BootstrapLinkRecord { invitationId: string; role: 'inviter' | 'redeemer'; phase: PeerLinkPhase }

/** What `handleBootstrapPacket` needs from the link store (`PeerLinks`, W4). Every method reads its own verified state. */
export interface BootstrapPeerLinks {
  /** Phase of the link with `peerInstanceId` (optionally over `hostId`); undefined when no invitation-founded link exists. */
  phase(peerInstanceId: string, hostId?: string): PeerLinkPhase | undefined;
  /** The record for the link `peerInstanceId` reaches this app over, via its own connector or inbound host `hostId`. */
  bootstrapLink(peerInstanceId: string, hostId: string): Promise<BootstrapLinkRecord | undefined>;
  /** Redeemer: answer the inviter's pull over H. Mint H' once per invitation; return the same code on retry until expiry. */
  answerPull(invitationId: string, hostId: string, signal: AbortSignal): Promise<PullReply>;
  /** Inviter: `kind:'redeem'` → `acceptRedeem`, `kind:'exchange'` → `acceptExchange`. Returns `wireResponse`. */
  acceptExchange(invitationId: string, peerInstanceId: string, hostId: string, kind: 'redeem' | 'exchange', wire: Record<string, unknown>, signal: AbortSignal): Promise<ExchangeReply>;
  /** Either side: tear down this side of the link (destroy own inbound host, `/hosts/revoke`, stop own connector). */
  acceptAbort(invitationId: string, peerInstanceId: string, hostId: string, reason: 'denied' | 'cancelled' | 'expired'): Promise<void>;
  /** Redeemer: the inviter reports both approvals; deliver the owed status poll now. */
  acceptNudge(invitationId: string, peerInstanceId: string, hostId: string): Promise<void>;
}

/** The full link-store port the control API dispatches to (bootstrap plus linked-link lifecycle). */
export interface PeerLinksControlPort extends BootstrapPeerLinks {
  /** True when this app founded the link over `channelHostId` with `peerInstanceId` from a first-contact invitation for `pluginId`. */
  foundedFor(peerInstanceId: string, channelHostId: string, pluginId: string): Promise<boolean>;
  /** Peer side: the destination re-minted the join code for host `hostId` (the peer's connector into it). */
  acceptRotate(senderId: string, hostId: string, rotate: { code: string; expiresAt: number }, signal: AbortSignal): Promise<{ accepted: boolean }>;
  /** Destination side: the peer's connector into host `hostId` was rejected; re-mint and return its code, or refuse. */
  acceptRelink(senderId: string, hostId: string, signal: AbortSignal): Promise<{ accepted: false } | { accepted: true; code: string; expiresAt: number }>;
  /** Either side: the peer removed the link; `hostId` is the host this app minted for the sender. */
  acceptRemoval(senderId: string, hostId: string, ref: { pairingId: string; hostId: string }): Promise<{ accepted: boolean }>;
}

/** k = HKDF-SHA256(ikm = hostKeyHash(H) bytes, salt = invitationId, info = `zcc-peer-bootstrap:v1:${senderId}:${recipientId}:${H}`). */
export function bootstrapKey(hostKeyHash: string, invitationId: string, senderId: string, recipientId: string, hostId: string): Buffer {
  if (!/^[a-f0-9]{64}$/.test(hostKeyHash) || !PEER_ID.test(invitationId) || !PEER_ID.test(senderId) || !PEER_ID.test(recipientId) ||
    senderId === recipientId || !UUID.safeParse(hostId).success) throw new Error('peer bootstrap key unavailable');
  const ikm = Buffer.from(hostKeyHash, 'hex');
  try { return Buffer.from(hkdfSync('sha256', ikm, Buffer.from(invitationId), Buffer.from(`zcc-peer-bootstrap:v1:${senderId}:${recipientId}:${hostId}`), 32)); }
  finally { ikm.fill(0); }
}

export const isBootstrapForm = (packet: Pick<PeerControlPacket, 'senderHostId' | 'recipientHostId'>): boolean => packet.senderHostId === packet.recipientHostId;

const plainBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const boundFor = (op: string) => op === 'bootstrap.abort' || op === 'bootstrap.nudge' ? BOOTSTRAP_LIMITS.abortBytes : BOOTSTRAP_LIMITS.bodyBytes;
/** Upper bound on the sealed base64url length of a `bytes`-long plaintext (ZCP2 + IV + tag = 32 bytes overhead). */
const sealedBound = (bytes: number) => Math.ceil((bytes + 32) * 4 / 3) + 4;

/** Bounded counters; the oldest entry is evicted past MAX_TRACKED (hosts and invitations are fresh per link). */
class Counter {
  private readonly counts = new Map<string, number>();
  take(key: string, max: number): boolean {
    const count = this.counts.get(key) ?? 0;
    if (count >= max) return false;
    this.counts.delete(key); this.counts.set(key, count + 1);
    while (this.counts.size > MAX_TRACKED) this.counts.delete(this.counts.keys().next().value!);
    return true;
  }
}
interface Budget { active: number; messages: Counter; pulls: Counter; exchanges: Counter }
const newBudget = (): Budget => ({ active: 0, messages: new Counter(), pulls: new Counter(), exchanges: new Counter() });

export type BootstrapSend = <I extends BootstrapInput>(hostId: string, recipientId: string, input: I, signal: AbortSignal) => Promise<BootstrapReply<I>>;

/**
 * Sends one bootstrap message over host `hostId`, whose hub session this app owns (the peer's connector into it).
 * Throws `BootstrapRejection` with the receiver's status (404 = no record there) or a local cap; any other error is
 * transport or integrity failure. Outbound budgets (in memory, reset on restart): ≤4 in flight, ≤64 messages and ≤3
 * pulls per host, ≤20 exchanges per invitation.
 */
export function createBootstrapSender(deps: { instanceId: string; db: ZccDatabase; hub: Pick<HostHub, 'getSession' | 'callHostOnlineRpc'> }): BootstrapSend {
  const budget = newBudget();
  return async function send<I extends BootstrapInput>(hostId: string, recipientId: string, rawInput: I, signal: AbortSignal): Promise<BootstrapReply<I>> {
    signal.throwIfAborted();
    const input = BootstrapInputSchema.parse(rawInput) as I;
    if (plainBytes(input) > boundFor(input.op)) throw new BootstrapRejection(413, 'peer bootstrap message too large');
    if (!PEER_ID.test(recipientId) || recipientId === deps.instanceId) throw new BootstrapRejection(403, 'peer bootstrap recipient invalid');
    const host = getHost(deps.db, hostId);
    if (!host || host.destroyedAt || host.isPrimary || host.enrollmentCapability !== 'peer.forward') throw new BootstrapRejection(403, 'peer link unavailable');
    const session = deps.hub.getSession(hostId);
    if (!session) throw new BootstrapRejection(404, 'peer link offline');
    if (budget.active >= BOOTSTRAP_LIMITS.concurrentPerApp) throw new BootstrapRejection(429, 'peer bootstrap busy');
    if (!budget.messages.take(hostId, BOOTSTRAP_LIMITS.messagesPerLink) ||
      input.op === 'bootstrap.pull' && !budget.pulls.take(hostId, BOOTSTRAP_LIMITS.pullsPerLink) ||
      input.op === 'bootstrap.exchange' && !budget.exchanges.take(input.invitationId, BOOTSTRAP_LIMITS.exchangesPerInvitation)) {
      throw new BootstrapRejection(429, 'peer bootstrap limit reached');
    }
    budget.active++;
    const key = bootstrapKey(host.hostKeyHash, input.invitationId, deps.instanceId, recipientId, hostId);
    const timeout = AbortSignal.timeout(BOOTSTRAP_LIMITS.timeoutMs), combined = AbortSignal.any([signal, timeout]);
    try {
      const packet = sealControl(input, { senderId: deps.instanceId, recipientId, senderHostId: hostId, recipientHostId: hostId }, key);
      const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const abort = () => reject(combined.reason);
        combined.addEventListener('abort', abort, { once: true });
        const done = () => combined.removeEventListener('abort', abort);
        deps.hub.callHostOnlineRpc<{ status: number; body: string }>({ hostId,
          command: { type: 'peer.control', packet, timeoutMs: BOOTSTRAP_LIMITS.timeoutMs }, timeoutMs: BOOTSTRAP_LIMITS.timeoutMs + 1000 })
          .then(value => { done(); resolve(value); }, error => { done(); reject(error); });
        if (combined.aborted) abort();
      });
      const current = getHost(deps.db, hostId);
      if (!current || current.destroyedAt || current.hostKeyHash !== host.hostKeyHash || deps.hub.getSession(hostId) !== session) throw new Error('peer link changed');
      if (!response || typeof response.body !== 'string' || response.body.length > PEER_CONTROL_MAX_BYTES + 4096) throw new Error('invalid peer bootstrap response');
      if (response.status !== 200) {
        throw new BootstrapRejection(([403, 404, 413, 429] as const).find(status => status === response.status) ?? 502, 'peer bootstrap rejected');
      }
      const returned = PeerControlPacketSchema.parse(JSON.parse(response.body));
      if (JSON.stringify({ ...returned, sealed: '' }) !== JSON.stringify({ ...packet, sealed: '' })) throw new Error('peer bootstrap response mismatch');
      if (returned.sealed.length > sealedBound(BOOTSTRAP_LIMITS.bodyBytes)) throw new BootstrapRejection(413, 'peer bootstrap reply too large');
      const reply = openControl(returned, key, true);
      if (plainBytes(reply) > BOOTSTRAP_LIMITS.bodyBytes) throw new BootstrapRejection(413, 'peer bootstrap reply too large');
      // Never echo an invalid reply: a pull reply carries a one-time join code.
      if (input.op === 'bootstrap.pull') {
        const parsed = PullReplySchema.safeParse(reply);
        if (!parsed.success) throw new Error('invalid peer bootstrap pull reply');
        return parsed.data as BootstrapReply<I>;
      }
      if (input.op === 'bootstrap.abort' || input.op === 'bootstrap.nudge') {
        if (!AbortReplySchema.safeParse(reply).success) throw new Error(`invalid peer ${input.op} reply`);
        return { ok: true } as BootstrapReply<I>;
      }
      if (!reply || typeof reply !== 'object' || Array.isArray(reply)) throw new Error('invalid peer bootstrap exchange reply');
      return reply as BootstrapReply<I>;
    } finally { key.fill(0); budget.active--; }
  };
}

export interface BootstrapContext {
  productInstanceId: string;
  peerChannels: Pick<EnrolledPeerChannels, 'remote'>;
  peerControlReplay: Pick<PeerReplayWindow, 'consumeAuthenticated'>;
  peerLinks: BootstrapPeerLinks;
}

const inbound = new WeakMap<object, Budget>();
function inboundBudget(links: object): Budget {
  let budget = inbound.get(links);
  if (!budget) { budget = newBudget(); inbound.set(links, budget); }
  return budget;
}

/**
 * Receives one bootstrap-form packet over this app's own connector H into the sender (the sender owns the hub session;
 * the daemon already checked sender = its hello owner, recipient = this app, recipientHostId = H). Returns the sealed
 * response packet. Throws `BootstrapRejection`: 404 for a missing/expired record (no state change), 403
 * `peer link not consented` for any non-allowlisted op (counted toward `messagesPerLink`), 413/429 for bounds.
 * Inbound budgets (in memory, reset on restart): ≤4 in flight per app, ≤64 messages and ≤3 pulls per link, ≤20
 * exchanges per invitation.
 */
export async function handleBootstrapPacket(rawPacket: PeerControlPacket, ctx: BootstrapContext, signal: AbortSignal = new AbortController().signal): Promise<PeerControlPacket> {
  const packet = PeerControlPacketSchema.parse(rawPacket);
  if (!isBootstrapForm(packet)) throw new BootstrapRejection(403, 'not a bootstrap packet');
  if (packet.recipientId !== ctx.productInstanceId) throw new BootstrapRejection(403, 'wrong recipient');
  if (packet.sealed.length > sealedBound(BOOTSTRAP_LIMITS.bodyBytes)) throw new BootstrapRejection(413, 'peer bootstrap message too large');
  const budget = inboundBudget(ctx.peerLinks);
  if (budget.active >= BOOTSTRAP_LIMITS.concurrentPerApp) throw new BootstrapRejection(429, 'peer bootstrap busy');
  budget.active++;
  let key: Buffer | undefined;
  try {
    const hostId = packet.recipientHostId;
    const channel = await ctx.peerChannels.remote(packet.senderId);
    if (!channel || channel.hostId !== hostId || channel.capability !== 'peer.forward') throw new BootstrapRejection(403, 'peer link missing');
    const link = await ctx.peerLinks.bootstrapLink(packet.senderId, hostId);
    if (!link || !BOOTSTRAP_PHASES.has(link.phase) || !PEER_ID.test(link.invitationId)) throw new BootstrapRejection(404, 'peer link record missing');
    // Counted before decryption so a flood of garbage or non-allowlisted ops exhausts this link, not the app.
    if (!budget.messages.take(hostId, BOOTSTRAP_LIMITS.messagesPerLink)) throw new BootstrapRejection(429, 'peer bootstrap limit reached');
    key = bootstrapKey(channelHash(channel), link.invitationId, packet.senderId, ctx.productInstanceId, hostId);
    let opened: unknown;
    try { opened = openControl(packet, key); } catch { throw new BootstrapRejection(403, 'peer bootstrap not authorized'); }
    const parsed = BootstrapInputSchema.safeParse(opened);
    if (!parsed.success) throw new BootstrapRejection(403, NOT_CONSENTED);
    const input = parsed.data;
    if (input.invitationId !== link.invitationId) throw new BootstrapRejection(403, 'peer bootstrap invitation mismatch');
    if (plainBytes(input) > boundFor(input.op)) throw new BootstrapRejection(413, 'peer bootstrap message too large');
    const now = Date.now();
    if (packet.issuedAt <= now - ISSUED_PAST_MS || packet.issuedAt > now + ISSUED_FUTURE_MS ||
      !await ctx.peerControlReplay.consumeAuthenticated({ pairId: hostId, senderId: packet.senderId, epoch: 1, nonce: packet.nonce, issuedAt: packet.issuedAt })) {
      throw new BootstrapRejection(403, 'peer bootstrap replay');
    }
    signal.throwIfAborted();
    let result: unknown;
    if (input.op === 'bootstrap.pull') {
      // The inviter pulls over H (this redeemer's connector into it) only before consent.
      if (link.role !== 'redeemer' || link.phase !== 'pre-consent') throw new BootstrapRejection(403, NOT_CONSENTED);
      if (!budget.pulls.take(hostId, BOOTSTRAP_LIMITS.pullsPerLink)) throw new BootstrapRejection(429, 'peer bootstrap limit reached');
      const reply = PullReplySchema.safeParse(await ctx.peerLinks.answerPull(link.invitationId, hostId, signal));
      if (!reply.success) throw new BootstrapRejection(404, 'peer bootstrap pull unavailable');
      result = reply.data;
    } else if (input.op === 'bootstrap.exchange') {
      if (link.role !== 'inviter') throw new BootstrapRejection(403, NOT_CONSENTED);
      if (!budget.exchanges.take(link.invitationId, BOOTSTRAP_LIMITS.exchangesPerInvitation)) throw new BootstrapRejection(429, 'peer bootstrap limit reached');
      result = await ctx.peerLinks.acceptExchange(link.invitationId, packet.senderId, hostId, input.kind, input.wire, signal);
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new BootstrapRejection(404, 'peer bootstrap exchange unavailable');
    } else if (input.op === 'bootstrap.nudge') {
      // The inviter nudges over H (this redeemer's connector into it) only while this side has not seen consent.
      if (link.role !== 'redeemer' || link.phase !== 'pre-consent') throw new BootstrapRejection(403, NOT_CONSENTED);
      await ctx.peerLinks.acceptNudge(link.invitationId, packet.senderId, hostId);
      result = { ok: true };
    } else {
      await ctx.peerLinks.acceptAbort(link.invitationId, packet.senderId, hostId, input.reason);
      result = { ok: true };
    }
    if (plainBytes(result) > BOOTSTRAP_LIMITS.bodyBytes) throw new BootstrapRejection(413, 'peer bootstrap reply too large');
    signal.throwIfAborted();
    // The connector registration must not have changed under the request (re-enrollment rotates the key).
    if (input.op !== 'bootstrap.abort') {
      const current = await ctx.peerChannels.remote(packet.senderId);
      if (!current || current.hostId !== channel.hostId || channelHash(current) !== channelHash(channel)) throw new BootstrapRejection(403, 'peer link changed');
    }
    return controlResponse(packet, result, key);
  } finally { key?.fill(0); budget.active--; }
}

/**
 * Mutual-path guard: true when either host of a mutual-form packet belongs to an invitation-founded link that has not
 * reached `linked`. Such a packet is rejected (`peer link not consented`) and counted toward that link's budget.
 */
export function rejectsMutualPacket(links: BootstrapPeerLinks | undefined, packet: Pick<PeerControlPacket, 'senderId' | 'senderHostId' | 'recipientHostId'>): boolean {
  if (!links) return false;
  for (const hostId of [packet.recipientHostId, packet.senderHostId]) {
    const phase = links.phase(packet.senderId, hostId);
    if (phase !== undefined && phase !== 'linked') {
      inboundBudget(links).messages.take(hostId, BOOTSTRAP_LIMITS.messagesPerLink);
      return true;
    }
  }
  return false;
}
