import {
  createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, randomUUID,
  scryptSync, sign, timingSafeEqual, verify
} from 'node:crypto';
import { z } from 'zod';
import { CORE_APPROVAL_PRINCIPAL } from '../../http/plugin-approval-proof.js';
import type { PluginApprovalBinding, PluginApprovalRequest } from '@zana-ai/zcc-plugin-sdk/server';
import {
  PEER_DIGEST, PEER_ID, PEER_NONCE, PEER_TOKEN, PrivatePeerStorage, sealPeerBytes, unsealPeerBytes, validScope,
  type PeerKeyProvider
} from './peer-auth.js';
import { SSH_REASONS, type InvitationLinkMint, type InvitationSshOffer } from './peer-ssh-contract.js';
import { PAIRING_CODE_MISMATCH_LIMIT, mintApprovalCode, normalizeCode, pairingCodeMatches, pairingCodeOf } from './pairing-code.js';

export type { InvitationLinkMint, InvitationSshOffer } from './peer-ssh-contract.js';

/**
 * Copy/paste first-contact invitation (v3, SSH peer transport). The token carries the inviter's SSH endpoint, its pinned
 * host key, a throwaway bootstrap key and a forward-only join code; redeeming it only opens a pre-consent bootstrap link.
 * It never grants transport, plugin or execution authority. Every invitation message after that travels over the
 * bootstrap plane of that link (`InvitationTransport`), never over a public route.
 */
export const INVITATION_TOKEN_PREFIX = 'zccinv1.';
export const INVITATION_APPROVE_ACTION = 'peer.invitation.approve';
/**
 * Owner-approval principal of a core connection (no plugin, no scope). Contains a colon, so no plugin id (`PEER_TOKEN`)
 * can ever equal it and a plugin-signed approval cannot be replayed against a core connection.
 */
export { CORE_APPROVAL_PRINCIPAL };

export const INVITATION_LIMITS = Object.freeze({
  tokenBytes: 4096,
  bodyBytes: 32 * 1024,
  ttlMs: 10 * 60_000,
  consentWindowMs: 60 * 60_000,
  /**
   * Mirrors PeerLinks' founding deadline. A founding saga starts no later than consent expiry, so a consented/connecting
   * record still pending after consentExpiresAt + foundingMs (+ clock skew) is stuck and the sweep fails it.
   */
  foundingMs: 14 * 60_000,
  concurrent: 4,
  live: 32,
  pending: 64,
  terminal: 64,
  attemptsPerInvitation: 20,
  timeoutMs: 15_000,
  retryMinMs: 1_000,
  retryMaxMs: 30_000,
  /**
   * Status poll cadence once the inviter answered. The bootstrap plane allows 20 exchanges per invitation, so a
   * one-hour consent window polls at most 12 times; owner actions (decide, founding) are sent immediately.
   */
  statusPollMs: 5 * 60_000,
  /** A plugin/UI `refresh` forces at most one delivery per invitation this often; otherwise it answers the stored status. */
  refreshMinMs: 10_000,
  clockSkewMs: 120_000,
  noncesPerRecord: 32,
  listMax: 50
});

export const INVITATION_REASONS = [
  'invalid_invitation', 'own_invitation', 'wrong_plugin', 'expired', 'denied', 'cancelled',
  'already_redeemed', 'already_connected', 'attempt_limit', 'identity_mismatch', 'unreachable', 'not_found', 'capacity', 'replay',
  'stale_generation', 'owner_proof_required', 'not_ready', 'fenced', 'unavailable', 'unknown_connection', 'use_unavailable', ...SSH_REASONS
] as const;
export type InvitationReason = typeof INVITATION_REASONS[number];

const MESSAGES: Record<InvitationReason, string> = {
  invalid_invitation: 'This invitation is not valid',
  own_invitation: 'This invitation was created on this computer',
  wrong_plugin: 'This invitation is for a different plugin',
  expired: 'This invitation has expired',
  denied: 'Pairing was declined',
  cancelled: 'Pairing was cancelled',
  already_redeemed: 'This invitation was already used',
  already_connected: 'This computer is already connected to the computer that created the invitation',
  attempt_limit: 'This invitation was locked after too many attempts',
  identity_mismatch: 'The other computer did not prove the identity in the invitation',
  unreachable: 'The other computer is not reachable yet; retrying',
  not_found: 'Invitation not found',
  capacity: 'Too many open invitations',
  replay: 'Request was already processed',
  stale_generation: 'Pairing attempt changed',
  owner_proof_required: 'Owner approval is required',
  not_ready: 'Pairing is not ready for that action',
  fenced: 'Pairing consent is no longer valid',
  unavailable: 'Invitations are unavailable',
  unknown_connection: 'That computer is not connected to this one',
  use_unavailable: 'Using a connection is not available yet',
  ssh_remote_login_off: 'Zana on the computer that created the invitation could not start its connection service',
  ssh_unreachable: 'The other computer could not be reached over SSH. Both computers must be on the same network',
  ssh_auth_refused: 'The other computer refused the SSH connection',
  ssh_forwarding_refused: 'The other computer does not allow SSH port forwarding',
  ssh_host_key_mismatch: 'The other computer presented a different SSH host key than the invitation. Create a new invitation'
};

/** Fixed, secret-free messages. Never carries a token, key or request body. */
export class InvitationError extends Error {
  constructor(readonly code: InvitationReason) { super(MESSAGES[code]); this.name = 'InvitationError'; }
}

export type InvitationDecision = 'pending' | 'approved' | 'denied';
export const INVITATION_STATES = ['open', 'redeeming', 'reserved', 'consented', 'connecting', 'ready', 'denied', 'cancelled', 'expired', 'failed'] as const;
export type InvitationState = typeof INVITATION_STATES[number];
const TERMINAL = new Set<InvitationState>(['ready', 'denied', 'cancelled', 'expired', 'failed']);
const PENDING = new Set<InvitationState>(['redeeming', 'reserved', 'consented', 'connecting']);
export type TerminatedState = 'denied' | 'cancelled' | 'expired' | 'failed';
const ENDED = new Set<InvitationState>(['denied', 'cancelled', 'expired', 'failed']);

/** Redacted, plugin-safe projection: no secret, token, private key, join code or credential. */
export interface PublicInvitationStatus {
  invitationId: string;
  role: 'inviter' | 'redeemer';
  /** Absent on a core connection (no plugin, no scope). */
  pluginId?: string;
  scope?: string;
  state: InvitationState;
  reason?: InvitationReason;
  localFingerprint: string;
  peer?: { instanceId: string; name: string; fingerprint: string };
  inviterDecision: InvitationDecision;
  redeemerDecision: InvitationDecision;
  pairingId?: string;
  consentDigest?: string;
  /** Redeemer only, once reserved: the `XXXX-XXXX` code its owner reads to the inviter's owner. */
  pairingCode?: string;
  generation: number;
  expiresAt: number;
  consentExpiresAt?: number;
}

export interface PairingFence { invitationId: string; pairingId: string; consentDigest: string; generation: number }

/** Platform-internal view for the link store. Never exposed to plugins. */
export interface ConsentedPairing extends PairingFence {
  role: 'inviter' | 'redeemer';
  state: 'consented' | 'connecting';
  /** Absent on a core connection. */
  pluginId?: string;
  scope?: string;
  local: { instanceId: string; fingerprint: string };
  /** `sshKey` is the redeemer's per-link public key (set when the remote side is the redeemer). */
  remote: { instanceId: string; name: string; fingerprint: string; ed: string; x: string; sshKey?: string };
}

/** The bootstrap link an invitation message travels over: this app's own inbound host and the peer to address. */
export interface InvitationLinkRef { hostId: string; recipientId: string }
export interface InvitationTransportResponse { status: number; body: unknown }
/**
 * Redeemer -> inviter over the bootstrap plane. `kind: 'redeem'` carries `wireRedeem`, `'exchange'` `wireExchange`.
 * A refusal is `{ status: 403 | 410, body: { error: code } }`; a throw is transient (retried with backoff).
 */
export interface InvitationTransport {
  post(link: InvitationLinkRef, kind: 'redeem' | 'exchange', invitationId: string, body: unknown, signal: AbortSignal): Promise<InvitationTransportResponse>;
}

/** The link store (PeerLinks). Platform-internal; its codes never reach a plugin. */
export interface InvitationLinks {
  /** Inviter: mint the SSH offer (endpoint, bootstrap key, ports, forward-only join code) the token carries. Throws `InvitationError` (e.g. `ssh_remote_login_off`). */
  create(input: { invitationId: string; pluginId?: string; scope?: string }): Promise<InvitationLinkMint>;
  /**
   * Redeemer: open the SSH tunnel, enroll with the join code and connect into the inviter. An `InvitationError` other than `unreachable` ends
   * the invitation with that reason; any other failure is retried with backoff until the token expires.
   */
  redeem(input: { invitationId: string; inviterId: string; inviterName: string; pluginId?: string; scope?: string; link: InvitationSshOffer },
    signal: AbortSignal): Promise<void>;
}

/** Founding message carried inside the sealed, signed exchange. Only the link store produces or consumes it. */
export type FoundingOp = 'offer' | 'ack';

export interface PeerInvitationsOptions {
  directory: string;
  instanceId: string;
  keyProvider: PeerKeyProvider;
  /** Consumes a main-signed single-use owner approval (`ctx.verifyPluginApproval`). `principal` is the plugin id, or `CORE_APPROVAL_PRINCIPAL` for a core connection. */
  verifyOwnerApproval: (token: unknown, principal: string, binding: PluginApprovalBinding) => boolean;
  localName?: () => string;
  links?: InvitationLinks;
  /** Redeemer: this link's own SSH public key (created on first use); signed into the offer so both owners approve it. */
  linkKey?: (invitationId: string) => Promise<string>;
  /** Redeemer: the bootstrap link to the inviter once the inviter enrolled back into this app; null until then. */
  linkRef?: (invitationId: string) => InvitationLinkRef | null;
  transport?: InvitationTransport;
  /** Fires after the consent commit, outside the storage transaction. */
  onConsented?: (pairing: ConsentedPairing) => void;
  /**
   * Inviter side of a founding `offer`/`ack` from the reserved redeemer, called outside the storage transaction and only
   * while both owners' consent is live. Throwing `fenced` answers with the current receipt; any other failure answers
   * `unavailable` so the redeemer retries.
   */
  onFounding?: (pairing: ConsentedPairing, message: { op: FoundingOp }) => Promise<void>;
  /** After commit, once per record entering denied/cancelled/expired/failed (or a create that never stored its record). */
  onTerminated?: (invitationId: string, role: 'inviter' | 'redeemer', reason: InvitationReason) => void;
  /** `pluginId` is absent for a core connection. */
  onChanged?: (pluginId: string | undefined) => void;
  now?: () => number;
}

const b32 = z.string().regex(PEER_DIGEST);
const id = z.string().regex(PEER_ID);
const uuid = z.string().uuid();
const decision = z.enum(['pending', 'approved', 'denied']);
const displayName = z.string().min(1).max(64).refine(value => !/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value));
const scope = z.string().refine(validScope);
const nonce = z.string().regex(PEER_NONCE);
const int = z.number().int().nonnegative();
const SSH_PUB = /^ssh-ed25519 [A-Za-z0-9+/]{68}$/;
const port = z.number().int().min(1024).max(65535);
const sshOfferSchema = z.object({
  v: z.literal(1),
  endpoint: z.object({
    host: z.string().min(1).max(253).regex(/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/),
    port: z.number().int().min(1).max(65535), user: z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/), hostKey: z.string().regex(SSH_PUB)
  }).strict(),
  bootstrapSeed: z.string().regex(/^[A-Za-z0-9_-]{43}$/), listenPort: port, targetPort: port, hostId: uuid,
  joinCode: z.string().regex(/^zcde_[A-Za-z0-9_-]{24}$/)
}).strict();
/**
 * What the pasted token carries in place of the plaintext SSH offer: everything the redeemer needs to reach the inviter
 * EXCEPT the bootstrap private seed, which is sealed (`sealedSeed`) under a key derived from the approval code the
 * inviter's owner reads aloud. An intercepted token alone cannot recover the authorized bootstrap identity.
 */
const tokenOfferSchema = sshOfferSchema.omit({ bootstrapSeed: true }).extend({
  /** base64url ZCP2 AES-256-GCM blob of the 43-char seed, AAD-bound to the invitation id. */
  sealedSeed: z.string().regex(/^[A-Za-z0-9_-]{1,512}$/),
  /** base64url 16-byte scrypt salt for the approval-code key. */
  seedSalt: z.string().regex(/^[A-Za-z0-9_-]{22}$/)
}).strict();
type TokenOffer = z.infer<typeof tokenOfferSchema>;
const endpointSchema = z.object({ instanceId: id, name: displayName, fingerprint: b32, ed: b32, x: b32, sshKey: z.string().regex(SSH_PUB).optional() }).strict();
type Endpoint = z.infer<typeof endpointSchema>;
const keyPair = z.object({ x: b32, d: b32 }).strict();
type KeyPair = z.infer<typeof keyPair>;
const recordSchema = z.object({
  id, role: z.enum(['inviter', 'redeemer']), pluginId: z.string().regex(PEER_TOKEN).optional(), scope: scope.optional(),
  createdAt: int, updatedAt: int, expiresAt: int,
  inviter: endpointSchema, redeemer: endpointSchema.optional(),
  tokenHash: b32.optional(), secret: b32.optional(), attempts: z.number().int().min(0).max(1000),
  requestDigest: b32.optional(), nonce: nonce.optional(),
  /** Redeemer only, until the link store redeemed it: the token's SSH offer. Sealed at rest, never projected. */
  link: sshOfferSchema.optional(),
  pairingId: id.optional(), consentDigest: b32.optional(), consentExpiresAt: int.optional(),
  generation: z.number().int().min(1), inviterDecision: decision, redeemerDecision: decision,
  /** Inviter only: wrong pairing codes typed (separate from `attempts`); the invitation burns at the limit. */
  codeMismatches: z.number().int().min(0).max(PAIRING_CODE_MISMATCH_LIMIT).optional(),
  state: z.enum(INVITATION_STATES), reason: z.enum(INVITATION_REASONS).optional(),
  seenNonces: z.array(nonce).max(INVITATION_LIMITS.noncesPerRecord),
  outbox: z.object({ op: z.enum(['redeem', 'decide', 'status']), attempts: z.number().int().min(0).max(10_000), nextAt: int }).strict().optional()
}).strict().refine(rec => (rec.pluginId === undefined) === (rec.scope === undefined), { message: 'pluginId and scope go together' });
type Rec = z.infer<typeof recordSchema>;
const MAX_RECORDS = INVITATION_LIMITS.live + INVITATION_LIMITS.pending + INVITATION_LIMITS.terminal;
const stateSchema = z.object({
  version: z.literal(3),
  keys: z.object({ ed: keyPair, x: keyPair }).strict().optional(),
  records: z.array(recordSchema).max(MAX_RECORDS)
}).strict();
type State = z.infer<typeof stateSchema>;
type Keys = NonNullable<State['keys']>;

const tokenSchema = z.object({
  v: z.literal(3), id, inviter: id, name: displayName, fp: b32, ed: b32, x: b32,
  plugin: z.string().regex(PEER_TOKEN).optional(), scope: scope.optional(), exp: int, s: b32, link: tokenOfferSchema
}).strict().refine(token => (token.plugin === undefined) === (token.scope === undefined));
export type InvitationTokenPayload = z.infer<typeof tokenSchema>;

const sealedText = z.string().regex(/^[A-Za-z0-9_-]{1,30000}$/);
const wireRedeem = z.object({ v: z.literal(1), invitationId: id, redeemerX: b32, sealed: sealedText }).strict();
const wireExchange = z.object({ v: z.literal(1), invitationId: id, sealed: sealedText }).strict();
const wireResponse = z.object({ v: z.literal(1), sealed: sealedText }).strict();
const offerSchema = z.object({
  invitationId: id, inviterId: id, inviterFingerprint: b32, pluginId: z.string().regex(PEER_TOKEN).optional(), scope: scope.optional(),
  redeemer: endpointSchema, nonce
}).strict().refine(offer => (offer.pluginId === undefined) === (offer.scope === undefined));
const redeemInner = z.object({ offer: offerSchema, secret: b32, sig: z.string().max(128) }).strict();
const exchangeMsg = z.object({
  op: z.enum(['status', 'decide', 'offer', 'ack']), invitationId: id, pairingId: id, redeemerId: id, consentDigest: b32,
  generation: z.number().int().min(1), decision: z.enum(['approved', 'denied']).optional(), nonce, issuedAt: int
}).strict();
const exchangeInner = z.object({ msg: exchangeMsg, sig: z.string().max(128) }).strict();
const receiptSchema = z.object({
  invitationId: id, pairingId: id, inviterId: id, redeemerId: id, consentDigest: b32, generation: z.number().int().min(1),
  state: z.enum(INVITATION_STATES), reason: z.enum(INVITATION_REASONS).optional(), inviterDecision: decision,
  redeemerDecision: decision, consentExpiresAt: int, inReplyTo: b32
}).strict();
const responseInner = z.object({ receipt: receiptSchema, sig: z.string().max(128) }).strict();
type Receipt = z.infer<typeof receiptSchema>;

function digest(...parts: (string | number)[]): string {
  return createHash('sha256').update(JSON.stringify(['zccinv1', ...parts])).digest('base64url');
}
/** OpenSSH-style `SHA256:<base64>` fingerprint of an `ssh-ed25519 <b64>` public key line. */
export function sshKeyFingerprint(pub: string): string {
  return `SHA256:${createHash('sha256').update(Buffer.from(pub.split(' ')[1] ?? '', 'base64')).digest('base64').replace(/=+$/, '')}`;
}
function secretHash(secret: string): string { return createHash('sha256').update(Buffer.from(secret, 'base64url')).digest('base64url'); }
export function invitationFingerprint(ed: string): string { return createHash('sha256').update(Buffer.from(ed, 'base64url')).digest('base64url'); }
function okp(crv: 'Ed25519' | 'X25519', pair: { x: string; d?: string }) {
  const key = { kty: 'OKP', crv, x: pair.x, ...(pair.d ? { d: pair.d } : {}) };
  return pair.d ? createPrivateKey({ key, format: 'jwk' }) : createPublicKey({ key, format: 'jwk' });
}
function generate(type: 'ed25519' | 'x25519'): KeyPair {
  const { privateKey } = generateKeyPairSync(type as 'ed25519');
  const jwk = privateKey.export({ format: 'jwk' });
  return { x: jwk.x!, d: jwk.d! };
}
function signText(pair: KeyPair, text: string): string { return sign(null, Buffer.from(text), okp('Ed25519', pair)).toString('base64url'); }
function verifyText(ed: string, text: string, sig: string): boolean {
  try { return verify(null, Buffer.from(text), okp('Ed25519', { x: ed }), Buffer.from(sig, 'base64url')); } catch { return false; }
}
function channelKey(local: KeyPair, remoteX: string, invitationId: string, info: string): Buffer {
  let shared: Buffer;
  try { shared = diffieHellman({ privateKey: okp('X25519', local), publicKey: okp('X25519', { x: remoteX }) }); }
  catch { throw new InvitationError('identity_mismatch'); }
  try { return Buffer.from(hkdfSync('sha256', shared, invitationId, info, 32)); } finally { shared.fill(0); }
}
function sealJson(value: unknown, key: Buffer, aad: string): string {
  const plain = Buffer.from(JSON.stringify(value));
  try { return sealPeerBytes(plain, key, aad).toString('base64url'); } finally { plain.fill(0); key.fill(0); }
}
function openJson(sealed: string, key: Buffer, aad: string): unknown {
  let plain: Buffer | undefined;
  try { plain = unsealPeerBytes(Buffer.from(sealed, 'base64url'), key, aad); return JSON.parse(plain.toString('utf8')); }
  catch { return undefined; } finally { plain?.fill(0); key.fill(0); }
}
/** scrypt key from the normalized approval code and the token's per-invitation salt. Returns null for an unparseable code. */
function codeKey(code: string, saltB64: string): Buffer | null {
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  return scryptSync(Buffer.from(normalized), Buffer.from(saltB64, 'base64url'), 32, { N: 16384, r: 8, p: 1 });
}
/** Seal the bootstrap seed under the approval code. The token carries `sealedSeed`+`seedSalt`, never the raw seed. */
function sealSeed(seed: string, code: string, invitationId: string): { sealedSeed: string; seedSalt: string } {
  const seedSalt = randomBytes(16).toString('base64url');
  const key = codeKey(code, seedSalt);
  if (!key) throw new InvitationError('unavailable');
  const plain = Buffer.from(seed, 'base64url');
  try { return { sealedSeed: sealPeerBytes(plain, key, `zccinv1:seed:${invitationId}`).toString('base64url'), seedSalt }; }
  finally { plain.fill(0); key.fill(0); }
}
/** Unseal the bootstrap seed with the typed approval code; null on a wrong code or tampered blob. */
function openSeed(offer: TokenOffer, code: string, invitationId: string): string | null {
  const key = codeKey(code, offer.seedSalt);
  if (!key) return null;
  let plain: Buffer | undefined;
  try { plain = unsealPeerBytes(Buffer.from(offer.sealedSeed, 'base64url'), key, `zccinv1:seed:${invitationId}`); return plain.toString('base64url'); }
  catch { return null; }
  finally { plain?.fill(0); key.fill(0); }
}
/**
 * Exported for tests: build a token's sealed SSH offer from a plaintext one and an approval code, exactly as `create`
 * does. Keeps test fixtures from re-implementing the seed-sealing crypto.
 */
export function sealTokenOffer(offer: z.infer<typeof sshOfferSchema>, code: string, invitationId: string): TokenOffer {
  const { bootstrapSeed, ...rest } = sshOfferSchema.parse(offer);
  return tokenOfferSchema.parse({ ...rest, ...sealSeed(bootstrapSeed, code, invitationId) });
}
function equalText(a: string, b: string): boolean {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function cleanName(value: string | undefined): string {
  const text = (value ?? '').replace(/[\u0000-\u001f\u007f\ud800-\udfff]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 64);
  return text || 'Zana';
}
/** Exported for tests: both owners approve a digest that covers the redeemer's per-link SSH key. */
export function consentDigestOf(rec: Pick<Rec, 'id' | 'pluginId' | 'scope' | 'inviter'> & { pairingId: string; redeemer: Endpoint }): string {
  return digest('consent', rec.pairingId, rec.id, rec.pluginId ?? '', rec.scope ?? '', rec.inviter.instanceId, rec.inviter.fingerprint,
    rec.redeemer.instanceId, rec.redeemer.fingerprint, rec.redeemer.sshKey ?? '');
}
/** Exported for tests: the redeemer signs this digest, which covers its per-link SSH key. */
export function offerDigest(offer: z.infer<typeof offerSchema>, secret: string): string {
  const r = offer.redeemer;
  return digest('redeem', offer.invitationId, offer.inviterId, offer.inviterFingerprint, offer.pluginId ?? '', offer.scope ?? '',
    r.instanceId, r.name, r.fingerprint, r.ed, r.x, r.sshKey ?? '', offer.nonce, secretHash(secret));
}
function messageDigest(msg: z.infer<typeof exchangeMsg>): string {
  return digest('exchange', msg.op, msg.invitationId, msg.pairingId, msg.redeemerId, msg.consentDigest, msg.generation,
    msg.decision ?? '', msg.nonce, msg.issuedAt);
}
function receiptDigest(r: Receipt): string {
  return digest('receipt', r.invitationId, r.pairingId, r.inviterId, r.redeemerId, r.consentDigest, r.generation, r.state,
    r.reason ?? '', r.inviterDecision, r.redeemerDecision, r.consentExpiresAt, r.inReplyTo);
}
function backoff(attempts: number): number {
  return Math.min(INVITATION_LIMITS.retryMaxMs, INVITATION_LIMITS.retryMinMs * 2 ** Math.min(attempts, 5));
}

/** Parses pasted text. Leading/trailing whitespace is tolerated; anything else malformed (or a v1 token) is `invalid_invitation`. */
export function parseInvitationToken(input: unknown): InvitationTokenPayload {
  if (typeof input !== 'string') throw new InvitationError('invalid_invitation');
  const text = input.trim();
  if (Buffer.byteLength(text) > INVITATION_LIMITS.tokenBytes || !text.startsWith(INVITATION_TOKEN_PREFIX)) throw new InvitationError('invalid_invitation');
  const body = text.slice(INVITATION_TOKEN_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(body)) throw new InvitationError('invalid_invitation');
  let parsed;
  try { parsed = tokenSchema.safeParse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))); }
  catch { throw new InvitationError('invalid_invitation'); }
  if (!parsed.success || invitationFingerprint(parsed.data.ed) !== parsed.data.fp) throw new InvitationError('invalid_invitation');
  return parsed.data;
}

type Plan = { id: string; op: NonNullable<Rec['outbox']>['op'] | FoundingOp; link: InvitationLinkRef; kind: 'redeem' | 'exchange'; body: unknown; expect: string };
type LinkStep = { id: string; input: Parameters<InvitationLinks['redeem']>[0] };
const TERMINAL_CODES: readonly string[] = ['expired', 'cancelled', 'already_redeemed', 'attempt_limit', 'not_found', 'invalid_invitation', 'identity_mismatch'];
/**
 * Terminal invitation reason for an inviter refusal code; null when the failure is transient. `denied` is deliberately
 * absent: the inviter never refuses with it, a denial reaches the redeemer as a signed 200 receipt (`receipt.state`).
 */
export function terminalInvitationReason(code: unknown): InvitationReason | null {
  return typeof code === 'string' && TERMINAL_CODES.includes(code) ? code as InvitationReason : null;
}

/**
 * Host-owned invitation records in private sealed storage. Both owner decisions are independent and bound to the
 * same pairing id, identities, plugin/scope (consent digest) and attempt generation.
 */
export class PeerInvitations {
  private readonly storage: PrivatePeerStorage<State>;
  private readonly now: () => number;
  private readonly controller = new AbortController();
  private readonly inflight = new Set<string>();
  private readonly running = new Set<Promise<void>>();
  /** Last forced `refresh` per invitation (bounded); throttles plugin/UI polling. */
  private readonly refreshed = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(private readonly options: PeerInvitationsOptions) {
    this.now = options.now ?? (() => Date.now());
    this.storage = new PrivatePeerStorage<State>(options.directory, 'invitations-v3', options.keyProvider, options.instanceId,
      () => ({ version: 3, records: [] }), value => stateSchema.parse(value));
  }

  /** Resume pending redeemer deliveries. Call once at context init. */
  start(): void { if (!this.disposed) this.schedule(0); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.controller.abort();
    this.storage.dispose();
  }

  async whenIdle(): Promise<void> {
    while (this.running.size) await Promise.allSettled([...this.running]);
    await this.storage.whenIdle();
  }

  /** Applies expiry and retention (firing `onTerminated` for anything that expired). Bounded by the stored records. */
  async sweep(): Promise<void> {
    if (this.disposed) return;
    await this.mutate(undefined, async () => undefined).catch(error => {
      // Stuck invitations keep their pending slots; leave a trail (error name/code only, never record contents).
      console.warn(`[peer-invitations] sweep failed: ${error instanceof InvitationError ? error.code : error instanceof Error ? error.name : 'unknown error'}`);
    });
  }

  private live(): void { if (this.disposed) throw new InvitationError('unavailable'); }

  private keys(state: State): Keys {
    state.keys ??= { ed: generate('ed25519'), x: generate('x25519') };
    return state.keys;
  }

  private self(keys: Keys): Endpoint {
    return { instanceId: this.options.instanceId, name: cleanName(this.options.localName?.()), fingerprint: invitationFingerprint(keys.ed.x),
      ed: keys.ed.x, x: keys.x.x };
  }

  private expire(state: State): void {
    const now = this.now();
    for (const rec of state.records) {
      if (TERMINAL.has(rec.state)) continue;
      const consentEnds = rec.consentExpiresAt ?? rec.expiresAt + INVITATION_LIMITS.consentWindowMs;
      const deadline = rec.state === 'open' ? rec.expiresAt
        // An unredeemed join code dies with the token; afterwards the inviter has the consent window to pull.
        : rec.state === 'redeeming' ? (rec.link ? rec.expiresAt : rec.expiresAt + INVITATION_LIMITS.consentWindowMs)
          : rec.state === 'reserved' ? rec.consentExpiresAt ?? rec.expiresAt
            // consented/connecting: a founding that never finished must not hold a pending slot forever.
            : consentEnds + INVITATION_LIMITS.foundingMs + INVITATION_LIMITS.clockSkewMs;
      if (now >= deadline) {
        if (rec.state === 'consented' || rec.state === 'connecting') this.terminate(rec, 'failed', 'expired');
        else this.terminate(rec, 'expired', 'expired');
      }
    }
    for (const rec of state.records) {
      if (rec.outbox && now >= (rec.consentExpiresAt ?? rec.expiresAt + INVITATION_LIMITS.consentWindowMs)) delete rec.outbox;
    }
    const terminal = state.records.filter(rec => TERMINAL.has(rec.state)).sort((a, b) => a.updatedAt - b.updatedAt);
    const drop = new Set(terminal.slice(0, Math.max(0, terminal.length - INVITATION_LIMITS.terminal)));
    if (drop.size) state.records = state.records.filter(rec => !drop.has(rec));
  }

  /** Ends an attempt. Pending deliveries are dropped: the link store tells the peer (bootstrap abort) and tears down. */
  private terminate(rec: Rec, next: TerminatedState, reason: InvitationReason): void {
    rec.state = next; rec.reason = reason; rec.updatedAt = this.now();
    delete rec.outbox; delete rec.link;
    if (rec.role === 'inviter') rec.generation++;
  }

  private project(rec: Rec, keys: Keys | undefined): PublicInvitationStatus {
    const peer = rec.role === 'inviter' ? rec.redeemer : rec.inviter;
    return {
      invitationId: rec.id, role: rec.role, ...(rec.pluginId !== undefined ? { pluginId: rec.pluginId, scope: rec.scope } : {}), state: rec.state,
      ...(rec.reason ? { reason: rec.reason } : {}),
      localFingerprint: keys ? invitationFingerprint(keys.ed.x) : '',
      ...(peer ? { peer: { instanceId: peer.instanceId, name: peer.name, fingerprint: peer.fingerprint } } : {}),
      inviterDecision: rec.inviterDecision, redeemerDecision: rec.redeemerDecision,
      ...(rec.pairingId ? { pairingId: rec.pairingId } : {}), ...(rec.consentDigest ? { consentDigest: rec.consentDigest } : {}),
      ...(rec.role === 'redeemer' && rec.consentDigest ? { pairingCode: pairingCodeOf(Buffer.from(rec.consentDigest, 'base64url')) } : {}),
      generation: rec.generation, expiresAt: rec.expiresAt,
      ...(rec.consentExpiresAt ? { consentExpiresAt: rec.consentExpiresAt } : {})
    };
  }

  private consented(rec: Rec): ConsentedPairing {
    const remote = rec.role === 'inviter' ? rec.redeemer! : rec.inviter, local = rec.role === 'inviter' ? rec.inviter : rec.redeemer!;
    return { invitationId: rec.id, pairingId: rec.pairingId!, consentDigest: rec.consentDigest!, generation: rec.generation, role: rec.role,
      state: rec.state as ConsentedPairing['state'], ...(rec.pluginId !== undefined ? { pluginId: rec.pluginId, scope: rec.scope } : {}),
      local: { instanceId: local.instanceId, fingerprint: local.fingerprint },
      remote: { instanceId: remote.instanceId, name: remote.name, fingerprint: remote.fingerprint, ed: remote.ed, x: remote.x, ...(remote.sshKey ? { sshKey: remote.sshKey } : {}) } };
  }

  private notifyTerminated(invitationId: string, role: 'inviter' | 'redeemer', reason: InvitationReason): void {
    try { this.options.onTerminated?.(invitationId, role, reason); }
    catch (error) { console.warn(`[peer-invitations] onTerminated observer failed (${role}, ${reason}): ${error instanceof Error ? error.message : 'unknown error'}`); }
  }

  /** Mutating transaction with sweep and change/consent/termination notification after commit. */
  private async mutate<R>(pluginId: string | undefined, run: (state: State, save: () => Promise<void>) => Promise<R>): Promise<R> {
    this.live();
    let changed = new Set<string | undefined>(), consented: ConsentedPairing[] = [], ended: { id: string; role: Rec['role']; reason: InvitationReason }[] = [];
    let committed = false;
    const result = await this.storage.transaction(async (state, persist) => {
      const before = new Map(state.records.map(rec => [rec.id + rec.role, rec.state]));
      const hadKeys = !!state.keys;
      this.expire(state);
      let saved = false;
      const save = async () => { await persist(); saved = true; };
      const diff = () => {
        for (const rec of state.records) {
          const previous = before.get(rec.id + rec.role);
          if (previous !== rec.state) {
            changed.add(rec.pluginId);
            if (rec.state === 'consented' && previous !== 'consented') consented.push(this.consented(rec));
            if (ENDED.has(rec.state) && (previous === undefined || !TERMINAL.has(previous))) ended.push({ id: rec.id, role: rec.role, reason: rec.reason ?? 'unavailable' });
          }
        }
      };
      let value: R;
      try { value = await run(state, save); }
      catch (error) {
        // A step that saved and then threw (e.g. terminate-then-refuse) committed its transition: still notify it.
        if (saved) { diff(); committed = true; }
        throw error;
      }
      diff();
      if (!saved && (changed.size || before.size !== state.records.length || hadKeys !== !!state.keys)) await persist();
      return value;
    }).catch(error => {
      if (committed) this.notify(changed, consented, ended);
      changed = new Set(); consented = []; ended = [];
      throw error;
    });
    if (pluginId) changed.add(pluginId);
    this.notify(changed, consented, ended);
    return result;
  }

  private notify(changed: Set<string | undefined>, consented: ConsentedPairing[], ended: { id: string; role: Rec['role']; reason: InvitationReason }[]): void {
    for (const entry of ended) this.notifyTerminated(entry.id, entry.role, entry.reason);
    for (const plugin of changed) { try { this.options.onChanged?.(plugin); } catch { /* observer only */ } }
    for (const pairing of consented) { try { this.options.onConsented?.(pairing); } catch { /* observer only */ } }
  }

  /** `pluginId` undefined addresses core connections only; a plugin never sees a core record and vice versa. */
  private find(state: State, pluginId: string | undefined, invitationId: string): Rec {
    const rec = state.records.find(row => row.id === invitationId && row.pluginId === pluginId);
    if (!rec) throw new InvitationError('not_found');
    return rec;
  }

  private full(state: State): boolean {
    return state.records.filter(rec => rec.role === 'inviter' && rec.state === 'open').length >= INVITATION_LIMITS.live ||
      state.records.length >= MAX_RECORDS;
  }

  // ---------- Owner-local operations (never routed over /api/v1) ----------

  async create(args: { pluginId?: string; scope?: string }): Promise<{ invitationId: string; token: string; expiresAt: number; code: string }> {
    const core = typeof args === 'object' && args !== null && args.pluginId === undefined && args.scope === undefined;
    if (!core && (typeof args?.pluginId !== 'string' || !PEER_TOKEN.test(args.pluginId) || !validScope(args.scope))) throw new InvitationError('invalid_invitation');
    const links = this.options.links;
    if (!links) throw new InvitationError('unavailable');
    await this.mutate(undefined, async state => { if (this.full(state)) throw new InvitationError('capacity'); });
    const invitationId = randomUUID();
    let minted: InvitationLinkMint;
    try { minted = await links.create({ invitationId, ...(core ? {} : { pluginId: args.pluginId, scope: args.scope }) }); }
    catch (error) {
      this.notifyTerminated(invitationId, 'inviter', 'unavailable');
      throw error instanceof InvitationError ? error : new InvitationError('unavailable');
    }
    try {
      const link = sshOfferSchema.parse(minted?.offer);
      if (!Number.isSafeInteger(minted.expiresAt) || minted.expiresAt <= this.now()) throw new InvitationError('unavailable');
      // The approval code the inviter's owner reads aloud. Its only copy that ever leaves this process is spoken
      // human-to-human; the token carries only the seed sealed under it, so an intercepted token stays inert.
      const code = mintApprovalCode();
      const tokenLink = sealTokenOffer(link, code, invitationId);
      return await this.mutate(args.pluginId, async (state, save) => {
        if (this.full(state)) throw new InvitationError('capacity');
        const keys = this.keys(state), now = this.now(), secret = randomBytes(32).toString('base64url');
        const inviter = this.self(keys), expiresAt = Math.min(now + INVITATION_LIMITS.ttlMs, minted.expiresAt);
        const payload: InvitationTokenPayload = { v: 3, id: invitationId, inviter: inviter.instanceId, name: inviter.name, fp: inviter.fingerprint,
          ed: inviter.ed, x: inviter.x, ...(core ? {} : { plugin: args.pluginId, scope: args.scope }), exp: expiresAt, s: secret, link: tokenLink };
        const token = INVITATION_TOKEN_PREFIX + Buffer.from(JSON.stringify(payload)).toString('base64url');
        if (Buffer.byteLength(token) > INVITATION_LIMITS.tokenBytes) throw new InvitationError('invalid_invitation');
        state.records.push({ id: invitationId, role: 'inviter', ...(core ? {} : { pluginId: args.pluginId, scope: args.scope }), createdAt: now, updatedAt: now, expiresAt,
          inviter, tokenHash: secretHash(secret), attempts: 0, generation: 1, inviterDecision: 'pending', redeemerDecision: 'pending',
          state: 'open', seenNonces: [] });
        await save();
        return { invitationId, token, expiresAt, code };
      });
    } catch (error) {
      // The link store minted a host for a record that never landed: let it tear that down.
      this.notifyTerminated(invitationId, 'inviter', 'unavailable');
      throw error instanceof InvitationError ? error : new InvitationError('unavailable');
    }
  }

  /**
   * Redeemer side: record the attempt, then let the link store open the SSH tunnel and connect. Re-pasting the
   * same token resumes the same attempt; after an `ssh_unreachable`/`unreachable` failure it starts over (until expiry).
   */
  async redeem(args: { pluginId?: string; token: string; code: string }): Promise<PublicInvitationStatus> {
    const token = parseInvitationToken(args?.token);
    if (token.inviter === this.options.instanceId) throw new InvitationError('own_invitation');
    if (token.plugin !== args?.pluginId) throw new InvitationError('wrong_plugin');
    if (this.now() >= token.exp || token.exp > this.now() + INVITATION_LIMITS.ttlMs + INVITATION_LIMITS.clockSkewMs) throw new InvitationError('expired');
    if (!this.options.links) throw new InvitationError('unavailable');
    if (typeof args?.code !== 'string' || !normalizeCode(args.code)) throw new InvitationError('identity_mismatch');
    // Unseal the bootstrap seed with the typed approval code into the plaintext offer the link store expects. A wrong
    // code never reaches SSH: it fails here as `identity_mismatch`, exactly like a mistyped pairing code.
    const seed = openSeed(token.link, args.code, token.id);
    if (!seed) throw new InvitationError('identity_mismatch');
    const { sealedSeed: _sealed, seedSalt: _salt, ...rest } = token.link;
    const plainLink: z.infer<typeof sshOfferSchema> = sshOfferSchema.parse({ ...rest, bootstrapSeed: seed });
    const status = await this.mutate(args.pluginId, async (state, save) => {
      const keys = this.keys(state), now = this.now();
      if (invitationFingerprint(keys.ed.x) === token.fp) throw new InvitationError('own_invitation');
      const index = state.records.findIndex(rec => rec.id === token.id && rec.role === 'redeemer');
      const existing = state.records[index];
      if (existing) {
        if (existing.pluginId !== token.plugin || existing.inviter.fingerprint !== token.fp || existing.secret !== token.s) throw new InvitationError('already_redeemed');
        const restart = ENDED.has(existing.state) && (existing.reason === 'ssh_unreachable' || existing.reason === 'unreachable');
        if (!restart) {
          if (existing.state === 'redeeming' && existing.outbox) { existing.outbox = { ...existing.outbox, nextAt: now }; await save(); }
          return this.project(existing, keys);
        }
        state.records.splice(index, 1);
      }
      if (state.records.some(rec => rec.id === token.id)) throw new InvitationError('own_invitation');
      if (state.records.filter(rec => PENDING.has(rec.state)).length >= INVITATION_LIMITS.pending || state.records.length >= MAX_RECORDS) {
        throw new InvitationError('capacity');
      }
      // Only now that every rejection above has passed: minting earlier leaked a sealed seed per refused redeem.
      let sshKey: string | undefined;
      if (this.options.linkKey) {
        try { sshKey = z.string().regex(SSH_PUB).parse(await this.options.linkKey(token.id)); } catch { throw new InvitationError('unavailable'); }
      }
      const rec: Rec = { id: token.id, role: 'redeemer', ...(token.plugin !== undefined ? { pluginId: token.plugin, scope: token.scope } : {}), createdAt: now, updatedAt: now, expiresAt: token.exp,
        inviter: { instanceId: token.inviter, name: token.name, fingerprint: token.fp, ed: token.ed, x: token.x },
        redeemer: { ...this.self(keys), ...(sshKey ? { sshKey } : {}) }, secret: token.s, attempts: 0, nonce: randomBytes(24).toString('base64url'), link: plainLink,
        generation: 1, inviterDecision: 'pending', redeemerDecision: 'pending', state: 'redeeming', seenNonces: [],
        outbox: { op: 'redeem', attempts: 0, nextAt: now } };
      state.records.push(rec);
      await save();
      return this.project(rec, keys);
    });
    if (status.state === 'redeeming') await this.deliver(status.invitationId);
    return this.status({ pluginId: args.pluginId, invitationId: status.invitationId });
  }

  async status(args: { pluginId?: string; invitationId: string }): Promise<PublicInvitationStatus> {
    return this.mutate(undefined, async state => this.project(this.find(state, args.pluginId, args.invitationId), state.keys));
  }

  /** Newest first, bounded page. */
  async list(args: { pluginId?: string; limit?: number }): Promise<PublicInvitationStatus[]> {
    const limit = Math.max(1, Math.min(INVITATION_LIMITS.listMax, Math.trunc(args.limit ?? INVITATION_LIMITS.listMax)));
    return this.mutate(undefined, async state => state.records.filter(rec => rec.pluginId === args.pluginId)
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit).map(rec => this.project(rec, state.keys)));
  }

  /** Core-rendered approval sheet; its binding is the only one `decide` will accept. */
  async approvalRequest(args: { pluginId?: string; invitationId: string }): Promise<PluginApprovalRequest> {
    return this.mutate(undefined, async state => {
      const rec = this.find(state, args.pluginId, args.invitationId);
      // Only the inviter's owner approves; the redeemer's consent is the pasted invitation.
      if (rec.state !== 'reserved' || rec.role !== 'inviter') throw new InvitationError('not_ready');
      return this.approvalFor(rec);
    });
  }

  private approvalFor(rec: Rec): PluginApprovalRequest {
    const peer = rec.role === 'inviter' ? rec.redeemer! : rec.inviter;
    const binding: PluginApprovalBinding = {
      action: INVITATION_APPROVE_ACTION, target: rec.pairingId!, targetLabel: `${peer.name} (${peer.fingerprint.slice(0, 16)})`,
      subject: `${rec.role}:${rec.pluginId ?? 'core'}`, revision: `${rec.consentDigest}.${rec.generation}`
    };
    return {
      binding, title: 'Pair with another computer',
      summary: rec.pluginId
        ? `Allow ${peer.name} to sync ${rec.pluginId} data with this computer. This does not share projects, threads, terminals or files.`
        : `Connect this computer with ${peer.name}. This does not share projects, threads, terminals or files, and grants no plugin access.`,
      details: [`Computer: ${peer.name}`, `Fingerprint: ${peer.fingerprint}`, `Instance: ${peer.instanceId}`,
        ...(peer.sshKey ? [`SSH key: ${sshKeyFingerprint(peer.sshKey)}`] : [])],
      confirmLabel: 'Approve pairing'
    };
  }

  /**
   * Owner decision. Approve needs a single-use main-signed proof over the core binding; deny needs none. A core
   * inviter's approve also needs the `pairingCode` the redeemer shows. A wrong code is `identity_mismatch` and counts
   * toward its own limit (not `attempts`), after which the invitation burns as `attempt_limit`. It is checked before the
   * proof so a typo does not consume it.
   */
  async decide(args: { pluginId?: string; invitationId: string; decision: 'approved' | 'denied'; ownerProof?: string; pairingCode?: string }): Promise<PublicInvitationStatus> {
    if (args?.decision !== 'approved' && args?.decision !== 'denied') throw new InvitationError('not_ready');
    const status = await this.mutate(args.pluginId, async (state, save) => {
      const rec = this.find(state, args.pluginId, args.invitationId);
      if (rec.state !== 'reserved' || !rec.pairingId || !rec.consentDigest) throw new InvitationError(TERMINAL.has(rec.state) ? rec.reason ?? 'fenced' : 'not_ready');
      const field = rec.role === 'inviter' ? 'inviterDecision' : 'redeemerDecision';
      if (rec[field] !== 'pending') throw new InvitationError('not_ready');
      if (args.decision === 'approved' && rec.role === 'inviter' && rec.pluginId === undefined &&
        !pairingCodeMatches(args.pairingCode, Buffer.from(rec.consentDigest, 'base64url'))) {
        rec.codeMismatches = (rec.codeMismatches ?? 0) + 1; rec.updatedAt = this.now();
        const burned = rec.codeMismatches >= PAIRING_CODE_MISMATCH_LIMIT;
        if (burned) this.terminate(rec, 'cancelled', 'attempt_limit');
        await save();
        throw new InvitationError(burned ? 'attempt_limit' : 'identity_mismatch');
      }
      if (args.decision === 'approved' &&
        !this.options.verifyOwnerApproval(args.ownerProof, rec.pluginId ?? CORE_APPROVAL_PRINCIPAL, this.approvalFor(rec).binding)) throw new InvitationError('owner_proof_required');
      rec[field] = args.decision; rec.updatedAt = this.now();
      // A deny ends the attempt here; the link store's bootstrap abort tells the peer.
      if (args.decision === 'denied') this.terminate(rec, 'denied', 'denied');
      else if (rec.role === 'inviter' && rec.redeemerDecision === 'approved') rec.state = 'consented';
      else if (rec.role === 'redeemer') rec.outbox = { op: 'decide', attempts: 0, nextAt: this.now() };
      await save();
      return this.project(rec, state.keys);
    });
    if (status.role === 'redeemer' && status.state === 'reserved') await this.deliver(status.invitationId);
    return this.status(args);
  }

  /** Owner cancel; no proof required. Fences any in-flight link work. Idempotent on terminal records. */
  async cancel(args: { pluginId?: string; invitationId: string }): Promise<PublicInvitationStatus> {
    return this.mutate(args.pluginId, async (state, save) => {
      const rec = this.find(state, args.pluginId, args.invitationId);
      if (!TERMINAL.has(rec.state)) { this.terminate(rec, 'cancelled', 'cancelled'); await save(); }
      return this.project(rec, state.keys);
    });
  }

  /** Redeemer side: deliver any queued message or poll the inviter now instead of waiting for backoff. */
  async poll(args: { pluginId?: string; invitationId: string }): Promise<PublicInvitationStatus> {
    const due = await this.mutate(undefined, async (state, save) => {
      const rec = this.find(state, args.pluginId, args.invitationId);
      if (rec.role !== 'redeemer' || !rec.outbox) return false;
      rec.outbox = { ...rec.outbox, nextAt: this.now() };
      await save();
      return true;
    });
    if (due) await this.deliver(args.invitationId);
    return this.status(args);
  }

  /**
   * Plugin/UI refresh: forces a delivery only while something is owed (an undelivered redeem/decision, or a delivery
   * that failed as `unreachable`), at most once per `refreshMinMs` per invitation; a plain status poll never spends the
   * peer link's exchange budget faster than its own cadence. Otherwise it answers the stored status.
   */
  async refresh(args: { pluginId?: string; invitationId: string }): Promise<PublicInvitationStatus> {
    const owed = await this.mutate(undefined, async state => {
      const rec = this.find(state, args.pluginId, args.invitationId);
      return rec.role === 'redeemer' && !!rec.outbox && (rec.outbox.op !== 'status' || rec.reason === 'unreachable');
    });
    if (!owed) return this.status(args);
    const key = `${args.pluginId ?? ''}\u0000${args.invitationId}`, now = this.now(), last = this.refreshed.get(key);
    if (last !== undefined && now >= last && now - last < INVITATION_LIMITS.refreshMinMs) return this.status(args);
    this.refreshed.delete(key);
    if (this.refreshed.size >= MAX_RECORDS) this.refreshed.delete(this.refreshed.keys().next().value!);
    this.refreshed.set(key, now);
    return this.poll(args);
  }

  // ---------- Link-store hooks (platform-internal) ----------

  /** Redeemer: the bootstrap link to the inviter just came up; deliver whatever is owed now. */
  async nudge(invitationId: string): Promise<void> {
    if (this.disposed) return;
    const due = await this.mutate(undefined, async (state, save) => {
      const rec = state.records.find(row => row.id === invitationId && row.role === 'redeemer');
      if (!rec?.outbox) return false;
      rec.outbox = { ...rec.outbox, nextAt: this.now() };
      await save();
      return true;
    }).catch(() => false);
    if (due) await this.deliver(invitationId);
  }

  /** The peer aborted the attempt over the bootstrap plane (it denied, cancelled or expired its side). */
  async terminateRemote(invitationId: string, reason: 'denied' | 'cancelled' | 'expired'): Promise<void> {
    await this.mutate(undefined, async (state, save) => {
      const rec = state.records.find(row => row.id === invitationId);
      if (!rec || TERMINAL.has(rec.state)) return;
      this.terminate(rec, reason, reason);
      await save();
    });
  }

  /** The link store could not establish the link (e.g. the inviter's Remote Login is off). */
  async fail(invitationId: string, reason: InvitationReason): Promise<void> {
    await this.mutate(undefined, async (state, save) => {
      const rec = state.records.find(row => row.id === invitationId);
      if (!rec || TERMINAL.has(rec.state)) return;
      this.terminate(rec, reason === 'expired' ? 'expired' : 'failed', reason);
      await save();
    });
  }

  /**
   * Redeemer: the sealed, signed `wireRedeem` the inviter pulls over the bootstrap link (deterministic per attempt, so
   * the same request digest is answered whether it arrives by pull or by this app's own delivery).
   */
  async redeemWire(invitationId: string): Promise<Record<string, unknown>> {
    return this.mutate(undefined, async state => {
      const rec = state.records.find(row => row.id === invitationId && row.role === 'redeemer');
      if (!rec || (rec.state !== 'redeeming' && rec.state !== 'reserved') || !state.keys) throw new InvitationError('not_found');
      return this.redeemBody(state.keys, rec).body;
    });
  }

  async listConsented(): Promise<ConsentedPairing[]> {
    return this.mutate(undefined, async state => state.records.filter(rec => rec.state === 'consented' || rec.state === 'connecting').map(rec => this.consented(rec)));
  }

  /** Rechecks both decisions, digest, generation and state; call before every mint, enrollment and activation. */
  async fence(ref: PairingFence): Promise<ConsentedPairing> {
    return this.mutate(undefined, async state => this.consented(this.fenced(state, ref)));
  }

  private fenced(state: State, ref: PairingFence): Rec {
    const rec = state.records.find(row => row.id === ref?.invitationId && row.pairingId === ref.pairingId);
    if (!rec || (rec.state !== 'consented' && rec.state !== 'connecting') || rec.inviterDecision !== 'approved' || rec.redeemerDecision !== 'approved' ||
      rec.consentDigest !== ref.consentDigest || rec.generation !== ref.generation) throw new InvitationError('fenced');
    return rec;
  }

  async markConnecting(ref: PairingFence): Promise<void> { await this.advance(ref, 'connecting'); }
  async markReady(ref: PairingFence): Promise<void> { await this.advance(ref, 'ready'); }
  async markFailed(ref: PairingFence): Promise<void> { await this.advance(ref, 'failed'); }

  private async advance(ref: PairingFence, next: 'connecting' | 'ready' | 'failed'): Promise<void> {
    await this.mutate(undefined, async (state, save) => {
      const rec = this.fenced(state, ref);
      if (next === 'failed') this.terminate(rec, 'failed', 'unreachable');
      else { rec.state = next; rec.updatedAt = this.now(); delete rec.outbox; }
      await save();
    });
  }

  // ---------- Bootstrap plane (inviter side) ----------

  /**
   * The redeemer's signed offer, pulled over (or delivered on) the bootstrap link. `attested.redeemerId` is the
   * hub-attested instance at the other end of that link and must match the signed offer.
   */
  async acceptRedeem(body: unknown, attested: { redeemerId: string; serverId?: string }): Promise<unknown> {
    const wire = wireRedeem.safeParse(body);
    if (!wire.success || typeof attested?.redeemerId !== 'string') throw new InvitationError('invalid_invitation');
    const { invitationId } = wire.data;
    return this.mutate(undefined, async (state, save) => {
      const rec = state.records.find(row => row.id === invitationId && row.role === 'inviter');
      if (!rec || !state.keys) throw new InvitationError('not_found');
      if (rec.attempts >= INVITATION_LIMITS.attemptsPerInvitation) throw new InvitationError('attempt_limit');
      rec.attempts++;
      let verified: { redeemer: Endpoint; requestDigest: string };
      try {
        verified = this.verifyOffer(state.keys, rec, wire.data);
        if (attested.redeemerId !== verified.redeemer.instanceId) throw new InvitationError('identity_mismatch');
      } catch (error) {
        if (rec.attempts >= INVITATION_LIMITS.attemptsPerInvitation && rec.state === 'open') this.terminate(rec, 'cancelled', 'attempt_limit');
        await save();
        throw error;
      }
      const { redeemer, requestDigest } = verified;
      if (rec.state === 'open') {
        if (state.records.filter(row => PENDING.has(row.state)).length >= INVITATION_LIMITS.pending) throw new InvitationError('capacity');
        const pairingId = randomUUID();
        Object.assign(rec, { redeemer, requestDigest, pairingId, consentExpiresAt: this.now() + INVITATION_LIMITS.consentWindowMs,
          consentDigest: consentDigestOf({ ...rec, pairingId, redeemer }), state: 'reserved', updatedAt: this.now() });
        await save();
      } else if (!rec.redeemer || rec.redeemer.instanceId !== redeemer.instanceId || rec.requestDigest !== requestDigest) {
        await save();
        throw new InvitationError(rec.redeemer ? 'already_redeemed' : rec.reason === 'attempt_limit' ? 'attempt_limit' : rec.state === 'expired' ? 'expired' : 'cancelled');
      } else await save();
      return this.respond(state.keys, rec, requestDigest);
    });
  }

  private verifyOffer(keys: Keys, rec: Rec, wire: z.infer<typeof wireRedeem>): { redeemer: Endpoint; requestDigest: string } {
    const inner = redeemInner.safeParse(openJson(wire.sealed, channelKey(keys.x, wire.redeemerX, rec.id, 'zccinv1:redeem'), `zccinv1:redeem:${rec.id}`));
    if (!inner.success) throw new InvitationError('invalid_invitation');
    const { offer, secret, sig } = inner.data, redeemer = offer.redeemer;
    if (!rec.tokenHash || !equalText(secretHash(secret), rec.tokenHash)) throw new InvitationError('invalid_invitation');
    if (offer.invitationId !== rec.id || offer.inviterId !== this.options.instanceId || offer.inviterFingerprint !== rec.inviter.fingerprint ||
      offer.pluginId !== rec.pluginId || offer.scope !== rec.scope || redeemer.x !== wire.redeemerX ||
      redeemer.fingerprint !== invitationFingerprint(redeemer.ed) || redeemer.instanceId === this.options.instanceId ||
      redeemer.fingerprint === rec.inviter.fingerprint) throw new InvitationError('identity_mismatch');
    const requestDigest = offerDigest(offer, secret);
    if (!verifyText(redeemer.ed, requestDigest, sig)) throw new InvitationError('identity_mismatch');
    return { redeemer, requestDigest };
  }

  /** A signed, sealed message from the reserved redeemer over the bootstrap link. */
  async acceptExchange(body: unknown, attested: { redeemerId: string }): Promise<unknown> {
    const wire = wireExchange.safeParse(body);
    if (!wire.success || typeof attested?.redeemerId !== 'string') throw new InvitationError('invalid_invitation');
    const { invitationId } = wire.data;
    const outcome = await this.mutate(undefined, async (state, save): Promise<{ response: unknown } | { founding: { pairing: ConsentedPairing; msg: z.infer<typeof exchangeMsg>; msgDigest: string } }> => {
      const rec = state.records.find(row => row.id === invitationId && row.role === 'inviter');
      if (!rec || !rec.redeemer || !state.keys) throw new InvitationError('not_found');
      if (attested.redeemerId !== rec.redeemer.instanceId) throw new InvitationError('identity_mismatch');
      const inner = exchangeInner.safeParse(openJson(wire.data.sealed, channelKey(state.keys.x, rec.redeemer.x, invitationId, 'zccinv1:exchange'),
        `zccinv1:exchange:${invitationId}`));
      if (!inner.success) throw new InvitationError('identity_mismatch');
      const { msg, sig } = inner.data, msgDigest = messageDigest(msg), now = this.now();
      if (!verifyText(rec.redeemer.ed, msgDigest, sig) || msg.invitationId !== invitationId || msg.pairingId !== rec.pairingId ||
        msg.redeemerId !== rec.redeemer.instanceId || msg.consentDigest !== rec.consentDigest) throw new InvitationError('identity_mismatch');
      if (Math.abs(now - msg.issuedAt) > INVITATION_LIMITS.clockSkewMs) throw new InvitationError('replay');
      if (rec.seenNonces.includes(msg.nonce)) throw new InvitationError('replay');
      rec.seenNonces = [...rec.seenNonces, msg.nonce].slice(-INVITATION_LIMITS.noncesPerRecord);
      if (msg.op !== 'status' && msg.generation !== rec.generation) {
        // A cancel/deny/expiry/failure ended the attempt and bumped the generation: answer with the signed terminal
        // receipt so the redeemer learns the real reason instead of a bare "attempt changed". The op is not applied.
        if (!TERMINAL.has(rec.state) || rec.state === 'ready') throw new InvitationError('stale_generation');
        await save();
        return { response: this.respond(state.keys, rec, msgDigest) };
      }
      if (msg.op === 'offer' || msg.op === 'ack') {
        await save();
        // Half consent (or a fenced attempt) never reaches the link store: the receipt alone tells the redeemer why.
        if (!this.options.onFounding || !this.foundingLive(rec)) return { response: this.respond(state.keys, rec, msgDigest) };
        return { founding: { pairing: this.consented(rec), msg, msgDigest } };
      }
      if (msg.op === 'decide' && rec.redeemerDecision === 'pending' && msg.decision) {
        if (msg.decision === 'denied') { rec.redeemerDecision = 'denied'; if (!TERMINAL.has(rec.state)) this.terminate(rec, 'denied', 'denied'); }
        else if (rec.state === 'reserved') {
          rec.redeemerDecision = 'approved'; rec.updatedAt = now;
          if (rec.inviterDecision === 'approved') rec.state = 'consented';
        }
      }
      await save();
      return { response: this.respond(state.keys, rec, msgDigest) };
    });
    if ('response' in outcome) return outcome.response;
    const { pairing, msg, msgDigest } = outcome.founding;
    try { await this.options.onFounding!(pairing, { op: msg.op as FoundingOp }); }
    catch (error) {
      if (!(error instanceof InvitationError && error.code === 'fenced')) throw new InvitationError('unavailable');
    }
    return this.mutate(undefined, async state => {
      const rec = state.records.find(row => row.id === pairing.invitationId && row.role === 'inviter');
      if (!rec || !rec.redeemer || !state.keys || rec.pairingId !== pairing.pairingId) throw new InvitationError('not_found');
      return this.respond(state.keys, rec, msgDigest);
    });
  }

  /** Both owners approved and the attempt is neither terminal nor superseded. */
  private foundingLive(rec: Rec): boolean {
    return (rec.state === 'consented' || rec.state === 'connecting') && rec.inviterDecision === 'approved' && rec.redeemerDecision === 'approved';
  }

  private respond(keys: Keys, rec: Rec, inReplyTo: string): unknown {
    const receipt: Receipt = { invitationId: rec.id, pairingId: rec.pairingId!, inviterId: this.options.instanceId, redeemerId: rec.redeemer!.instanceId,
      consentDigest: rec.consentDigest!, generation: rec.generation, state: rec.state, ...(rec.reason ? { reason: rec.reason } : {}),
      inviterDecision: rec.inviterDecision, redeemerDecision: rec.redeemerDecision, consentExpiresAt: rec.consentExpiresAt!, inReplyTo };
    return { v: 1, sealed: sealJson({ receipt, sig: signText(keys.ed, receiptDigest(receipt)) },
      channelKey(keys.x, rec.redeemer!.x, rec.id, 'zccinv1:response'), `zccinv1:response:${rec.id}`) };
  }

  // ---------- First-contact founding (redeemer side) ----------

  /**
   * Redeemer: sends one signed, sealed founding `offer`/`ack` and verifies the inviter's signed receipt. Fenced before
   * sending; a terminal or superseded receipt terminates the local record and throws `fenced`. Transient failures throw
   * `unreachable` and the caller retries.
   */
  async founding(ref: PairingFence, message: { op: FoundingOp }, signal?: AbortSignal): Promise<void> {
    if (message?.op !== 'offer' && message?.op !== 'ack') throw new InvitationError('not_ready');
    const plan = await this.mutate(undefined, async state => {
      const rec = this.fenced(state, ref);
      if (rec.role !== 'redeemer' || !state.keys || !rec.redeemer) throw new InvitationError('fenced');
      const link = this.linkFor(rec.id);
      if (!link) throw new InvitationError('unreachable');
      return this.exchangePlan(state.keys, rec, message.op, link);
    });
    const abort = signal ? AbortSignal.any([signal, this.controller.signal]) : this.controller.signal;
    let response: InvitationTransportResponse;
    try { response = await this.options.transport!.post(plan.link, plan.kind, plan.id, plan.body, abort); }
    catch { throw new InvitationError('unreachable'); }
    this.live();
    await this.mutate(undefined, async (state, save) => {
      const rec = state.records.find(row => row.id === plan.id && row.role === 'redeemer');
      if (!rec || !state.keys || rec.pairingId !== ref.pairingId) throw new InvitationError('fenced');
      if (response?.status !== 200) {
        const code = (response?.body as { error?: unknown } | null)?.error;
        const reason = code === 'stale_generation' ? 'stale_generation' : terminalInvitationReason(code);
        if (reason) {
          if (!TERMINAL.has(rec.state)) { this.terminate(rec, reason === 'expired' ? 'expired' : 'failed', reason); await save(); }
          throw new InvitationError('fenced');
        }
        throw new InvitationError('unreachable');
      }
      const receipt = this.openReceipt(state.keys, rec, response.body, plan.expect);
      if (!receipt) {
        if (!TERMINAL.has(rec.state)) { this.terminate(rec, 'failed', 'identity_mismatch'); await save(); }
        throw new InvitationError('fenced');
      }
      if (receipt.state === 'denied' || receipt.state === 'cancelled' || receipt.state === 'expired' || receipt.state === 'failed' ||
        receipt.generation !== rec.generation || receipt.consentDigest !== rec.consentDigest) {
        if (!TERMINAL.has(rec.state)) {
          const next = receipt.state === 'denied' || receipt.state === 'cancelled' || receipt.state === 'expired' ? receipt.state : 'failed';
          this.terminate(rec, next, receipt.reason ?? (next === 'failed' ? 'stale_generation' : next)); await save();
        }
        throw new InvitationError('fenced');
      }
    });
  }

  // ---------- Redeemer delivery loop ----------

  private linkFor(invitationId: string): InvitationLinkRef | null {
    if (!this.options.transport || !this.options.linkRef) return null;
    try { return this.options.linkRef(invitationId); } catch { return null; }
  }

  private schedule(delay?: number): void {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    const run = () => { this.timer = undefined; this.track(this.pump()); };
    if (delay !== undefined) { this.timer = setTimeout(run, delay); this.timer.unref?.(); return; }
    this.track(this.storage.transaction(async state => {
      const next = Math.min(...state.records.filter(rec => rec.outbox).map(rec => rec.outbox!.nextAt));
      if (Number.isFinite(next) && !this.disposed) {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(run, Math.min(INVITATION_LIMITS.retryMaxMs, Math.max(0, next - this.now())));
        this.timer.unref?.();
      }
    }).catch(() => undefined));
  }

  private track(promise: Promise<unknown>): void {
    const tracked = promise.then(() => undefined, () => undefined);
    this.running.add(tracked);
    void tracked.finally(() => this.running.delete(tracked));
  }

  private async pump(): Promise<void> {
    if (this.disposed) return;
    let due: string[] = [];
    try {
      due = await this.mutate(undefined, async state => state.records
        .filter(rec => rec.role === 'redeemer' && rec.outbox && rec.outbox.nextAt <= this.now() && !this.inflight.has(rec.id))
        .sort((a, b) => a.outbox!.nextAt - b.outbox!.nextAt).slice(0, INVITATION_LIMITS.concurrent).map(rec => rec.id));
    } catch { /* key unavailable: retry on the next tick */ }
    await Promise.all(due.map(invitationId => this.deliver(invitationId, false)));
    this.schedule();
  }

  /** One delivery attempt. Never throws; failures become backoff or a terminal reason. */
  private async deliver(invitationId: string, reschedule = true): Promise<void> {
    if (this.disposed || this.inflight.has(invitationId) || this.inflight.size >= INVITATION_LIMITS.concurrent) {
      if (reschedule) this.schedule(INVITATION_LIMITS.retryMinMs);
      return;
    }
    this.inflight.add(invitationId);
    try {
      const step = await this.mutate(undefined, async (state, save) => {
        const rec = state.records.find(row => row.id === invitationId && row.role === 'redeemer');
        if (!rec?.outbox || !rec.redeemer || !state.keys || !rec.secret || !rec.nonce) return null;
        if (rec.link) {
          return { link: { id: rec.id, input: { invitationId: rec.id, inviterId: rec.inviter.instanceId, inviterName: rec.inviter.name,
            ...(rec.pluginId !== undefined ? { pluginId: rec.pluginId, scope: rec.scope } : {}), link: { ...rec.link } } } satisfies LinkStep };
        }
        const plan = this.plan(state.keys, rec);
        if (plan) return { plan };
        // No bootstrap link to the inviter yet: wait for `nudge` without spending a delivery attempt.
        rec.outbox = { ...rec.outbox, nextAt: this.now() + INVITATION_LIMITS.retryMaxMs };
        await save();
        return null;
      }).catch(() => null);
      if (!step) return;
      if ('link' in step && step.link) { await this.redeemLink(step.link); return; }
      const { plan } = step;
      let response: InvitationTransportResponse | null = null;
      try { response = await this.options.transport!.post(plan.link, plan.kind, plan.id, plan.body, this.controller.signal); }
      catch { response = null; }
      if (this.disposed) return;
      await this.mutate(undefined, async (state, save) => {
        const rec = state.records.find(row => row.id === plan.id && row.role === 'redeemer');
        if (!rec || !state.keys) return;
        this.settle(state.keys, rec, plan, response);
        rec.updatedAt = this.now();
        await save();
      }).catch(() => undefined);
    } finally {
      this.inflight.delete(invitationId);
      if (reschedule) this.schedule();
    }
  }

  /** Lets the link store open the tunnel and redeem the token's join code; success waits for the inviter's reverse link (`nudge`). */
  private async redeemLink(step: LinkStep): Promise<void> {
    let failure: InvitationReason | null | undefined;
    try { await this.options.links!.redeem(step.input, this.controller.signal); failure = undefined; }
    catch (error) { failure = error instanceof InvitationError && error.code !== 'unreachable' ? error.code : null; }
    if (this.disposed) return;
    await this.mutate(undefined, async (state, save) => {
      const rec = state.records.find(row => row.id === step.id && row.role === 'redeemer');
      if (!rec || rec.state !== 'redeeming' || !rec.link) return;
      // The join code is consumed on first use. With the token still well inside its own window an expired answer can only
      // mean it was consumed (by another redeemer, or by this pair's existing link), so say so rather than "expired".
      if (failure === 'expired' && rec.expiresAt - this.now() > INVITATION_LIMITS.clockSkewMs) failure = 'already_redeemed';
      if (failure === undefined) {
        delete rec.link; delete rec.reason;
        rec.outbox = { op: 'redeem', attempts: 0, nextAt: this.now() + INVITATION_LIMITS.retryMaxMs };
      } else if (failure) this.terminate(rec, failure === 'expired' ? 'expired' : 'failed', failure);
      else {
        const attempts = (rec.outbox?.attempts ?? 0) + 1;
        rec.outbox = { op: 'redeem', attempts, nextAt: this.now() + backoff(attempts) };
        rec.reason = 'unreachable';
      }
      rec.updatedAt = this.now();
      await save();
    }).catch(() => undefined);
  }

  private redeemBody(keys: Keys, rec: Rec): { body: Record<string, unknown>; expect: string } {
    const offer = { invitationId: rec.id, inviterId: rec.inviter.instanceId, inviterFingerprint: rec.inviter.fingerprint,
      ...(rec.pluginId !== undefined ? { pluginId: rec.pluginId, scope: rec.scope } : {}), redeemer: rec.redeemer!, nonce: rec.nonce! };
    const requestDigest = offerDigest(offer, rec.secret!);
    rec.requestDigest = requestDigest;
    const sealed = sealJson({ offer, secret: rec.secret, sig: signText(keys.ed, requestDigest) },
      channelKey(keys.x, rec.inviter.x, rec.id, 'zccinv1:redeem'), `zccinv1:redeem:${rec.id}`);
    return { body: { v: 1, invitationId: rec.id, redeemerX: keys.x.x, sealed }, expect: requestDigest };
  }

  private plan(keys: Keys, rec: Rec): Plan | null {
    const link = this.linkFor(rec.id);
    if (!link || !rec.outbox) return null;
    if (rec.outbox.op === 'redeem') {
      const { body, expect } = this.redeemBody(keys, rec);
      return { id: rec.id, op: 'redeem', link, kind: 'redeem', expect, body };
    }
    if (!rec.pairingId || !rec.consentDigest) return null;
    return this.exchangePlan(keys, rec, rec.outbox.op, link);
  }

  private exchangePlan(keys: Keys, rec: Rec, op: Plan['op'], link: InvitationLinkRef): Plan {
    const msg: z.infer<typeof exchangeMsg> = { op: op as z.infer<typeof exchangeMsg>['op'], invitationId: rec.id, pairingId: rec.pairingId!, redeemerId: rec.redeemer!.instanceId,
      consentDigest: rec.consentDigest!, generation: rec.generation, nonce: randomBytes(24).toString('base64url'), issuedAt: this.now(),
      ...(op === 'decide' && rec.redeemerDecision !== 'pending' ? { decision: rec.redeemerDecision } : {}) };
    const msgDigest = messageDigest(msg);
    const sealed = sealJson({ msg, sig: signText(keys.ed, msgDigest) }, channelKey(keys.x, rec.inviter.x, rec.id, 'zccinv1:exchange'),
      `zccinv1:exchange:${rec.id}`);
    return { id: rec.id, op, link, kind: 'exchange', expect: msgDigest, body: { v: 1, invitationId: rec.id, sealed } };
  }

  /** Opens and verifies a signed inviter receipt for exactly the request `expect`; null on any mismatch. */
  private openReceipt(keys: Keys, rec: Rec, body: unknown, expect: string): Receipt | null {
    const wire = wireResponse.safeParse(body);
    const opened = wire.success ? responseInner.safeParse(openJson(wire.data.sealed, channelKey(keys.x, rec.inviter.x, rec.id, 'zccinv1:response'),
      `zccinv1:response:${rec.id}`)) : null;
    const receipt = opened?.success && verifyText(rec.inviter.ed, receiptDigest(opened.data.receipt), opened.data.sig) ? opened.data.receipt : null;
    if (!receipt || receipt.inReplyTo !== expect || receipt.invitationId !== rec.id || receipt.inviterId !== rec.inviter.instanceId ||
      receipt.redeemerId !== rec.redeemer!.instanceId || (rec.pairingId && rec.pairingId !== receipt.pairingId) ||
      receipt.consentDigest !== consentDigestOf({ ...rec, pairingId: receipt.pairingId, redeemer: rec.redeemer! }) ||
      receipt.consentExpiresAt > this.now() + INVITATION_LIMITS.consentWindowMs + INVITATION_LIMITS.clockSkewMs) return null;
    return receipt;
  }

  private settle(keys: Keys, rec: Rec, plan: Plan, response: InvitationTransportResponse | null): void {
    const sameOp = rec.outbox?.op === plan.op;
    const retry = () => {
      if (!sameOp || !rec.outbox) return;
      rec.outbox = { op: rec.outbox.op, attempts: rec.outbox.attempts + 1, nextAt: this.now() + backoff(rec.outbox.attempts + 1) };
      if (!TERMINAL.has(rec.state)) rec.reason = 'unreachable';
    };
    if (!response) return retry();
    const code = (response.body as { error?: unknown } | null)?.error;
    if (response.status !== 200) {
      if (code === 'stale_generation' && sameOp) { rec.outbox = { op: 'status', attempts: 0, nextAt: this.now() }; return; }
      // Inviter refusals end the attempt with an actionable reason; anything else is transient and backs off.
      const reason = terminalInvitationReason(code);
      if (!reason) return retry();
      if (!TERMINAL.has(rec.state)) this.terminate(rec, reason === 'expired' && (plan.op === 'redeem' || response.status === 410) ? 'expired' : 'failed', reason);
      else if (sameOp) delete rec.outbox;
      return;
    }
    const receipt = this.openReceipt(keys, rec, response.body, plan.expect);
    if (!receipt) {
      if (!TERMINAL.has(rec.state)) this.terminate(rec, 'failed', 'identity_mismatch');
      else if (sameOp) delete rec.outbox;
      return;
    }
    rec.pairingId = receipt.pairingId; rec.consentDigest = receipt.consentDigest; rec.consentExpiresAt = receipt.consentExpiresAt;
    rec.generation = Math.max(rec.generation, receipt.generation); rec.inviterDecision = receipt.inviterDecision;
    if (!TERMINAL.has(rec.state)) {
      delete rec.reason;
      if (receipt.state === 'denied' || receipt.state === 'cancelled' || receipt.state === 'expired') { this.terminate(rec, receipt.state, receipt.state); return; }
      // The redeemer's owner already consented by pasting the invitation, so its decision is implicit; only the inviter's
      // owner approves. Delivered below as the usual signed `decide`, so the inviter's both-decisions fence is unchanged.
      if (rec.redeemerDecision === 'pending' && (receipt.state === 'reserved' || rec.state === 'reserved')) rec.redeemerDecision = 'approved';
      if (['consented', 'connecting', 'ready'].includes(receipt.state) && rec.redeemerDecision === 'approved' && receipt.redeemerDecision === 'approved') {
        if (rec.state === 'redeeming' || rec.state === 'reserved') rec.state = 'consented';
      } else if (rec.state === 'redeeming') rec.state = 'reserved';
    }
    if (!sameOp) return;
    const undelivered = rec.redeemerDecision !== 'pending' && receipt.redeemerDecision !== rec.redeemerDecision && !TERMINAL.has(receipt.state);
    if (TERMINAL.has(rec.state) || rec.state === 'consented') delete rec.outbox;
    else if (undelivered) rec.outbox = { op: 'decide', attempts: 0, nextAt: this.now() };
    else rec.outbox = { op: 'status', attempts: 0, nextAt: this.now() + INVITATION_LIMITS.statusPollMs };
  }
}
