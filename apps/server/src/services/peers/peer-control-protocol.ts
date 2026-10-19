import { createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { PeerControlPacketSchema, PEER_CONTROL_ROUTE, type PeerControlPacket } from '@zana-ai/zcc-contracts/host-rpc';
import { sealPeerBytes, unsealPeerBytes, PEER_ID, PEER_TOKEN, validScope } from './peer-auth.js';

const id = z.string().regex(PEER_ID);
const JOIN_CODE = /^zcde_[A-Za-z0-9_-]{24}$/;
const CONNECT_CODE = /^(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/;
const httpsOrigin = (value: string) => { try { const url = new URL(value); return url.protocol === 'https:' && url.origin === value; } catch { return false; } };
/** A Connect peer-link code for the introduced app, redeemed at `accountUrl`; `serverId` is the minting server. */
export const ConnectOfferSchema = z.object({ code: z.string().regex(CONNECT_CODE), accountUrl: z.string().max(2048).refine(httpsOrigin),
  serverId: z.string().uuid() }).strict();
export type ConnectOffer = z.infer<typeof ConnectOfferSchema>;
const OFFER_FIELDS = { route: z.string().min(1).max(256).optional(), joinCode: z.string().regex(JOIN_CODE).optional(), connect: ConnectOfferSchema.optional() };
function exactlyOneOffer(value: { route?: string; joinCode?: string; connect?: unknown }, ctx: z.RefinementCtx): void {
  const local = value.route !== undefined && value.joinCode !== undefined, partial = (value.route === undefined) !== (value.joinCode === undefined);
  if (partial || local === (value.connect !== undefined)) ctx.addIssue({ code: 'custom', message: 'exactly one enrollment offer form' });
}
export const ControlProposalSchema = z.object({ pairId: id, localInstanceId: id, remoteInstanceId: id,
  targetHostId: id, pluginId: z.string().regex(PEER_TOKEN), scope: z.string().refine(validScope),
  proposalId: id, epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict();
export const ControlInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('proof'), nonce: z.string().regex(/^[a-f0-9]{48}$/) }).strict(),
  z.object({ operation: z.literal('import'), proposal: ControlProposalSchema, sealedCredential: z.string().max(11000).regex(/^[A-Za-z0-9_-]+$/) }).strict(),
  z.object({ operation: z.literal('activate'), proposal: ControlProposalSchema }).strict(),
  z.object({ operation: z.literal('revoke'), proposal: ControlProposalSchema }).strict(),
  z.object({ operation: z.literal('introduction'), capability: z.literal('peer.forward'), pluginId: z.string().regex(PEER_TOKEN),
    scope: z.string().refine(validScope), peerInstanceId: id, introductionId: id }).strict(),
  // Requester -> sponsor: an owner-approved introduction offers a forward-only code for the introduced app: either the
  // local route form (`route` + `joinCode`) or, cross-machine, a Connect peer-link code (`connect`). Exactly one form.
  z.object({ operation: z.literal('introduction.enroll'), introductionId: id, ...OFFER_FIELDS }).strict().superRefine(exactlyOneOffer),
  // Sponsor -> introduced app: relays the requester's offer; identities come from the sponsor's own job.
  z.object({ operation: z.literal('introduction.install'), introductionId: id, pluginId: z.string().regex(PEER_TOKEN),
    scope: z.string().refine(validScope), peerInstanceId: id, ...OFFER_FIELDS }).strict().superRefine(exactlyOneOffer),
  // Non-initiator -> sponsor: its owner approved; carries no code.
  z.object({ operation: z.literal('introduction.consent'), introductionId: id }).strict(),
  // Sponsor -> initiator: relays that consent; identities come from the sponsor's own job.
  z.object({ operation: z.literal('introduction.consented'), introductionId: id, pluginId: z.string().regex(PEER_TOKEN),
    scope: z.string().refine(validScope), peerInstanceId: id }).strict(),
  // Destination -> peer, over the destination's inbound host H (destination owns the hub session): a re-minted join
  // code for H. The peer redeems it (the code replaces the credential), re-enrolls and restarts its connector.
  z.object({ operation: z.literal('peer.rotate'), hostId: z.string().uuid(), code: z.string().regex(JOIN_CODE),
    expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict(),
  // Peer -> destination, over the reverse link (sessionless: the peer's own connector into the destination is dead):
  // asks the destination to rotate the code for the host the peer enrolled there.
  z.object({ operation: z.literal('peer.relink'), hostId: z.string().uuid() }).strict(),
  // Either side: the sender removed the link; the receiver drops and revokes its side too.
  z.object({ operation: z.literal('peer.remove'), pairingId: id, hostId: z.string().uuid() }).strict(),
  // Either side: a plugin asks to use the connection, then each owner's decision. Plain ids only; the receiver builds all text itself.
  z.object({ operation: z.literal('use.request'), pairingId: id, pluginId: z.string().regex(PEER_TOKEN) }).strict(),
  z.object({ operation: z.literal('use.decision'), pairingId: id, pluginId: z.string().regex(PEER_TOKEN), approved: z.boolean(), revoke: z.literal(true).optional() }).strict()
]);
/** Operations a linked peer may send while the receiver has no live session for it (its connector cannot reach it). */
export const SESSIONLESS_OPERATIONS: ReadonlySet<string> = new Set(['peer.relink', 'peer.remove']);
/** Reply to `peer.rotate`, `peer.remove`, `use.request` and `use.decision`. */
export const AcceptedReplySchema = z.object({ accepted: z.boolean() }).strict();
/** Reply to `peer.relink`: a fresh join code for the peer's host at the destination, or a refusal. */
export const RelinkReplySchema = z.union([
  z.object({ accepted: z.literal(false) }).strict(),
  z.object({ accepted: z.literal(true), code: z.string().regex(JOIN_CODE), expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict()
]);
export type RelinkReply = z.infer<typeof RelinkReplySchema>;
/** Reply to either consent operation. */
export const ConsentReplySchema = z.object({ recorded: z.boolean() }).strict();
/**
 * Reply to either enrollment operation: the counterpart's own single-use forward-only enrollment, either the local
 * route form or a Connect peer-link code minted with `issueConnectPeerLinkCode`.
 */
export const EnrollmentOfferSchema = z.union([
  z.object({ route: z.string().min(1).max(256), joinCode: z.string().regex(JOIN_CODE) }).strict(),
  z.object({ connect: ConnectOfferSchema }).strict()
]);
export type EnrollmentOffer = z.infer<typeof EnrollmentOfferSchema>;
/** The offer form carried by a parsed `introduction.enroll` / `introduction.install` (exactly one form, validated). */
export function enrollmentOffer(value: { route?: string; joinCode?: string; connect?: ConnectOffer }): EnrollmentOffer {
  return EnrollmentOfferSchema.parse(value.connect !== undefined ? { connect: value.connect } : { route: value.route, joinCode: value.joinCode });
}
export type ControlInput = z.infer<typeof ControlInputSchema>;
export function controlKey(left: string, right: string): Buffer {
  if (![left, right].every(value => /^[a-f0-9]{64}$/.test(value))) throw new Error('peer control credential unavailable');
  const generations = [left, right].sort();
  return createHmac('sha256', Buffer.from(generations[0]!, 'hex')).update(`zcc-peer-control-v1:${generations[1]}`).digest();
}
function aad(packet: Omit<PeerControlPacket, 'sealed'>, response: boolean): string {
  return JSON.stringify(['zcc-peer-control-v1', response ? 'response' : 'request', packet.version, packet.senderId, packet.recipientId,
    packet.senderHostId, packet.recipientHostId, packet.route, packet.nonce, packet.issuedAt]);
}
export function sealControl(input: unknown, identities: Pick<PeerControlPacket, 'senderId' | 'recipientId' | 'senderHostId' | 'recipientHostId'>, key: Uint8Array): PeerControlPacket {
  const fields: Omit<PeerControlPacket, 'sealed'> = { ...identities, version: 1, route: PEER_CONTROL_ROUTE, nonce: randomBytes(24).toString('hex'), issuedAt: Date.now() };
  return PeerControlPacketSchema.parse({ ...fields, sealed: sealPeerBytes(Buffer.from(JSON.stringify(input)), key, aad(fields, false)).toString('base64url') });
}
export function openControl(packet: PeerControlPacket, key: Uint8Array, response = false): unknown {
  const { sealed, ...fields } = PeerControlPacketSchema.parse(packet);
  const bytes = Buffer.from(sealed, 'base64url');
  if (bytes.toString('base64url') !== sealed) throw new Error('noncanonical peer control');
  const plain = unsealPeerBytes(bytes, key, aad(fields, response));
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain)); } finally { plain.fill(0); }
}
export function controlResponse(packet: PeerControlPacket, input: unknown, key: Uint8Array): PeerControlPacket {
  const { sealed: _sealed, ...fields } = packet;
  return PeerControlPacketSchema.parse({ ...fields, sealed: sealPeerBytes(Buffer.from(JSON.stringify(input)), key, aad(fields, true)).toString('base64url') });
}
