import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { getHost } from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import { MobileConnectionStore } from '../../mobile/connection.js';
import { ConnectRequestError, connectRequest, type ConnectFetch } from '../../mobile/connect-account.js';

/** The persisted Connect enrollment (mode, account, server id, public URL, server bearer). Main-only. */
export function connection(ctx: Pick<ProductHttpContext, 'dataDir'>) {
  return new MobileConnectionStore(join(ctx.dataDir, 'mobile', 'connection.json')).read();
}

export function usesConnect(ctx: ProductHttpContext): boolean { return connection(ctx).mode === 'connect'; }

export function connectInstallCommand(issued: { accountUrl: string; serverId: string; code: string }): string {
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  return `(umask 077; f=$(mktemp); trap 'rm -f "$f"' EXIT; curl --proto '=https' -fsS --connect-timeout 10 --max-time 30 ${quote(issued.accountUrl + '/api/connect/host-installer')} -o "$f" && node "$f" --account ${quote(issued.accountUrl)} --server-id ${quote(issued.serverId)} --code ${quote(issued.code)})`;
}

export async function issueConnectHostCode(ctx: ProductHttpContext, input: unknown, fetcher?: ConnectFetch) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Enter a machine name');
  const row = input as Record<string, unknown>;
  if (Object.keys(row).some(key => key !== 'name' && key !== 'hostId') || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 80 || /[\x00-\x1f\x7f]/.test(row.name)) throw new Error('Enter a valid machine name');
  if (row.hostId !== undefined) {
    const host = typeof row.hostId === 'string' ? getHost(ctx.db, row.hostId) : null;
    // Plugin-link hosts are managed only through /api/v1/peer-links; an execution code must never re-enroll one.
    if (!host || host.destroyedAt || host.isPrimary || host.purpose.kind !== 'execution' || host.enrollmentCapability !== 'execution') {
      throw new Error('Choose an existing execution machine to repair');
    }
  }
  const config = connection(ctx);
  if (config.mode !== 'connect') throw new Error('Connect this Zana instance before adding machines through your account');
  const issued = typeof row.hostId === 'string' ? ctx.joinCodes.mintForHost(row.hostId) : ctx.joinCodes.mint();
  try {
    const result = await connectRequest(config.accountUrl!, '/hosts/code', config.relayToken, {
      instanceId: ctx.productInstanceId, hostId: issued.hostId, name: row.name.trim(), enrollToken: issued.joinCode
    }, fetcher);
    if (result.serverId !== config.serverId || result.hostId !== issued.hostId || result.serverUrl !== config.publicUrl ||
      typeof result.code !== 'string' || !/^(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/.test(result.code) ||
      !Number.isFinite(result.expiresAt) || result.expiresAt <= Date.now() || result.expiresAt > issued.expiresAt) throw new Error('Invalid machine enrollment response');
    return { enrollmentId: createHash('sha256').update(issued.joinCode).digest('hex'), code: result.code, expiresAt: result.expiresAt as number, hostId: issued.hostId, serverId: config.serverId!, serverUrl: config.publicUrl!, accountUrl: config.accountUrl! };
  } catch (error) {
    ctx.joinCodes.invalidateHost(issued.hostId);
    throw error;
  }
}

export async function revokeConnectHost(ctx: Pick<ProductHttpContext, 'dataDir'>, hostId: string, fetcher?: ConnectFetch): Promise<void> {
  const config = connection(ctx);
  if (config.mode !== 'connect') return;
  // Cloud revocation precedes local deletion; failure leaves the visible machine
  // available for an explicit retry instead of reporting a false success.
  await connectRequest(config.accountUrl!, '/hosts/revoke', config.relayToken, { hostId }, fetcher);
}

// ---------------------------------------------------------------------------------------------------------------
// Peer-link client (design A, plan-rework-no-connect-changes §3.1). Uses only the base Connect machine-code ABI:
// `POST /hosts/code` (server bearer), `POST /hosts/redeem` (unauthenticated, attemptSecret), `POST /hosts/revoke`,
// `GET /hosts` and `GET /servers` (server bearer). Codes, credentials and enroll tokens never appear in errors or logs.
// ---------------------------------------------------------------------------------------------------------------

export const PEER_LINK_NAME_MAX = 80;
export const PEER_LINK_NAME_PREFIX = 'Zana peer link: ';
export const PEER_LINK_NAME_SUFFIX = ' (sync only)';
/** Inviter-side Connect name before the redeemer is known (renamed by the first rotation; risk R6). */
export const PEER_LINK_PLACEHOLDER_NAME = `${PEER_LINK_NAME_PREFIX}pending invitation${PEER_LINK_NAME_SUFFIX}`;
/** Scheduled credential rotation cadence while a link is `linked` (scheduler lives in PeerLinks). */
export const PEER_LINK_ROTATION_MS = 30 * 24 * 60 * 60_000;
export const CONNECT_PEER_REQUIRED_MESSAGE = 'Turn on Remote access (Zana Connect) to invite peers';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MACHINE_CODE_RE = /^(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/;
const SECRET_RE = /^[\w-]{43}$/;
const ENROLL_TOKEN_RE = /^zcde_[\w-]{24}$/;
// C0, DEL, C1, and the Unicode bidi embedding/override/isolate/mark controls.
const UNSAFE_NAME_CHARS = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

const PEER_LINK_REASONS: Record<string, string> = {
  connect_required: CONNECT_PEER_REQUIRED_MESSAGE,
  account_limit: 'Your Zana Connect account has reached its machine limit. Remove a machine or peer and try again.',
  instance_mismatch: 'This Zana Connect server is bound to another Zana instance. Sign in to Zana Connect again.',
  too_many_attempts: 'Zana Connect is rate limiting peer requests. Wait a minute and try again.',
  revoked: 'The Zana Connect sign-in or peer link was revoked.',
  expired_or_used: 'The peer link code expired or was already used.',
  unauthorized: 'Zana Connect no longer accepts this instance. Sign in to Zana Connect again.',
  invalid_response: 'Zana Connect returned an invalid peer link response.'
};

/** Own-property lookup: a Connect-supplied code such as `toString` must not resolve through `Object.prototype`. */
function knownReason(code: unknown): code is string { return typeof code === 'string' && Object.hasOwn(PEER_LINK_REASONS, code); }

/** Bounded, secret-free failure. `reason` is a stable machine code callers map to user copy. */
export class PeerLinkConnectError extends Error {
  constructor(readonly reason: string, readonly status?: number) { super(knownReason(reason) ? PEER_LINK_REASONS[reason]! : 'Zana Connect peer link request failed.'); this.name = 'PeerLinkConnectError'; }
}

type PeerLinkContext = Pick<ProductHttpContext, 'dataDir' | 'productInstanceId' | 'joinCodes'>;

function requirePeerLinkConnect(ctx: Pick<ProductHttpContext, 'dataDir'>) {
  const config = connection(ctx);
  if (config.mode !== 'connect' || !config.accountUrl || !config.relayToken || !config.serverId || !config.publicUrl) throw new PeerLinkConnectError('connect_required');
  return { accountUrl: config.accountUrl, relayToken: config.relayToken, serverId: config.serverId, publicUrl: config.publicUrl };
}

/** Maps Connect/network failures to `PeerLinkConnectError` without ever echoing a request or response body. */
async function peerLinkRequest(origin: string, path: string, credential: string | undefined, body: unknown, fetcher?: ConnectFetch): Promise<Record<string, any>> {
  try { return await connectRequest(origin, path, credential, body, fetcher); }
  catch (error) {
    if (error instanceof ConnectRequestError) {
      const reason = knownReason(error.code) ? error.code : error.status === 401 || error.status === 403 ? 'unauthorized' : 'connect_failed';
      throw new PeerLinkConnectError(reason, error.status);
    }
    if (error instanceof PeerLinkConnectError) throw error;
    throw new PeerLinkConnectError('connect_unreachable');
  }
}

function httpsOrigin(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && url.origin === value; } catch { return false; }
}

/** `serverUrl` must be an https origin equal to, or a subdomain of, the Connect account origin. */
function serverUrlUnder(serverUrl: unknown, accountUrl: string): serverUrl is string {
  if (!httpsOrigin(serverUrl)) return false;
  const server = new URL(serverUrl), account = new URL(accountUrl);
  return server.port === account.port && (server.hostname === account.hostname || server.hostname.endsWith(`.${account.hostname}`));
}

function sanitizeName(value: string): string {
  return value.replace(UNSAFE_NAME_CHARS, ' ').replace(/\s+/g, ' ').trim();
}

/** Truncates by code point so a surrogate pair is never split; measures UTF-16 length like Connect does. */
function fitCodePoints(value: string, max: number): string {
  let out = '';
  for (const char of value) { if (out.length + char.length > max) break; out += char; }
  return out.trimEnd();
}

/**
 * `Zana peer link: <peer display name> (sync only)`. Strips C0/C1/DEL and bidi controls, collapses whitespace, trims,
 * truncates the peer name so the whole fits {@link PEER_LINK_NAME_MAX}; appends ` [<instanceId:6>]` only when an active
 * Connect machine of this server already has the same name (`taken`, e.g. from {@link listConnectPeerLinkNames}).
 */
export function peerLinkHostName(peerName: string, peerInstanceId: string, taken: ReadonlySet<string>): string {
  const peer = sanitizeName(typeof peerName === 'string' ? peerName : '') || 'unnamed peer';
  const build = (tag: string) => {
    const room = PEER_LINK_NAME_MAX - PEER_LINK_NAME_PREFIX.length - PEER_LINK_NAME_SUFFIX.length - tag.length;
    return `${PEER_LINK_NAME_PREFIX}${fitCodePoints(peer, room) || 'peer'}${PEER_LINK_NAME_SUFFIX}${tag}`;
  };
  const plain = build('');
  if (!taken.has(plain)) return plain;
  const id = sanitizeName(String(peerInstanceId ?? '')).replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  // Probe progressively longer tags so peers sharing a six-character prefix still get distinct names.
  for (let length = 6; length <= id.length; length++) {
    const candidate = build(` [${id.slice(0, length)}]`);
    if (!taken.has(candidate)) return candidate;
  }
  return build(` [${id.slice(0, 6) || 'peer'}]`);
}

function validPeerLinkName(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && name.length <= PEER_LINK_NAME_MAX && name === sanitizeName(name) &&
    !/[\x00-\x1f\x7f]/.test(name) && name.startsWith(PEER_LINK_NAME_PREFIX);
}

export interface IssuedConnectPeerLinkCode { hostId: string; code: string; expiresAt: number; serverId: string; accountUrl: string }

/**
 * Inviter/destination: mints a forward-only Connect machine code. Without `hostId`, a fresh `peer.forward` host
 * (`joinCodes.mintForwardOnly`); with `hostId`, rotation of an existing `peer.forward` host
 * (`joinCodes.mintForwardOnlyForHost`) — Connect replaces the pending code and, at redeem, the credential (no overlap).
 * `name` must be a {@link peerLinkHostName} / {@link PEER_LINK_PLACEHOLDER_NAME}. Requires connect mode. The local join code
 * is invalidated on any failure.
 */
export async function issueConnectPeerLinkCode(ctx: PeerLinkContext, input: { name: string; hostId?: string }, fetcher?: ConnectFetch): Promise<IssuedConnectPeerLinkCode> {
  if (!input || typeof input !== 'object' || !validPeerLinkName(input.name)) throw new PeerLinkConnectError('invalid_name');
  if (input.hostId !== undefined && (typeof input.hostId !== 'string' || !UUID_RE.test(input.hostId))) throw new PeerLinkConnectError('invalid_host');
  const config = requirePeerLinkConnect(ctx);
  let issued;
  try { issued = input.hostId === undefined ? ctx.joinCodes.mintForwardOnly() : ctx.joinCodes.mintForwardOnlyForHost(input.hostId); }
  catch { throw new PeerLinkConnectError(input.hostId === undefined ? 'enrollment_capacity' : 'invalid_host'); }
  try {
    if (issued.enrollmentCapability !== 'peer.forward') throw new PeerLinkConnectError('invalid_host');
    const result = await peerLinkRequest(config.accountUrl, '/hosts/code', config.relayToken, {
      instanceId: ctx.productInstanceId, hostId: issued.hostId, name: input.name, enrollToken: issued.joinCode
    }, fetcher);
    if (result.serverId !== config.serverId || result.hostId !== issued.hostId || result.serverUrl !== config.publicUrl ||
      typeof result.code !== 'string' || !MACHINE_CODE_RE.test(result.code) || !Number.isSafeInteger(result.expiresAt) ||
      result.expiresAt <= Date.now() || result.expiresAt > issued.expiresAt) throw new PeerLinkConnectError('invalid_response');
    return { hostId: issued.hostId, code: result.code, expiresAt: result.expiresAt, serverId: config.serverId, accountUrl: config.accountUrl };
  } catch (error) {
    ctx.joinCodes.invalidateHost(issued.hostId);
    throw error;
  }
}

/** Destination: rotates its own inbound peer-link host H; the caller sends the code to the peer as `peer.rotate`. */
export function rotateConnectPeerLinkCode(ctx: PeerLinkContext, hostId: string, name: string, fetcher?: ConnectFetch): Promise<IssuedConnectPeerLinkCode> {
  return issueConnectPeerLinkCode(ctx, { name, hostId }, fetcher);
}

export interface RedeemedConnectPeerLink { hostId: string; serverId: string; instanceId: string; serverUrl: string; credential: string; enrollToken: string; expiresAt: number }

/** A fresh 43-character base64url attempt secret. Persist it to make a redeem retry idempotent at Connect. */
export function connectAttemptSecret(): string { return randomBytes(32).toString('base64url'); }

/**
 * Peer: redeems a Connect peer-link code at `accountUrl` (unauthenticated `POST /hosts/redeem`). Returns the
 * Connect-attested destination (`instanceId`, `serverId`) and the machine credential for forward-only enroll + WS.
 * `options.attemptSecret` makes a retry after a lost response idempotent (Connect returns the same credential); omitted,
 * a fresh secret is used. `accountUrl` in the response must equal the input and `serverUrl` must be https under it.
 * Redirects and oversize responses are errors. Never logs code/credential/enrollToken.
 */
export async function redeemConnectPeerLinkCode(accountUrl: string, code: string, fetcher?: ConnectFetch, options: { attemptSecret?: string } = {}): Promise<RedeemedConnectPeerLink> {
  if (!httpsOrigin(accountUrl)) throw new PeerLinkConnectError('invalid_account');
  if (typeof code !== 'string' || !MACHINE_CODE_RE.test(code)) throw new PeerLinkConnectError('invalid_code');
  const attemptSecret = options.attemptSecret ?? connectAttemptSecret();
  if (!SECRET_RE.test(attemptSecret)) throw new PeerLinkConnectError('invalid_attempt');
  const result = await peerLinkRequest(accountUrl, '/hosts/redeem', undefined, { code, attemptSecret }, fetcher);
  if (result.accountUrl !== accountUrl || !serverUrlUnder(result.serverUrl, accountUrl) ||
    typeof result.hostId !== 'string' || !UUID_RE.test(result.hostId) || typeof result.serverId !== 'string' || !UUID_RE.test(result.serverId) ||
    typeof result.instanceId !== 'string' || !UUID_RE.test(result.instanceId) || typeof result.credential !== 'string' || !SECRET_RE.test(result.credential) ||
    typeof result.enrollToken !== 'string' || !ENROLL_TOKEN_RE.test(result.enrollToken) || !Number.isSafeInteger(result.expiresAt) ||
    result.expiresAt <= Date.now()) throw new PeerLinkConnectError('invalid_response');
  return { hostId: result.hostId, serverId: result.serverId, instanceId: result.instanceId, serverUrl: result.serverUrl,
    credential: result.credential, enrollToken: result.enrollToken, expiresAt: result.expiresAt };
}

/**
 * Same-account check: true only when `instanceId` is bound to the non-revoked server `serverId` in this instance's own
 * `GET /api/connect/servers` (same Connect account). A different account, revoked server, unbound or self instance is
 * false; a Connect/auth failure throws (fail closed, never "true").
 */
export async function sameAccountInstance(ctx: Pick<ProductHttpContext, 'dataDir' | 'productInstanceId'>, instanceId: string, serverId: string, fetcher?: ConnectFetch): Promise<boolean> {
  if (typeof instanceId !== 'string' || !UUID_RE.test(instanceId) || typeof serverId !== 'string' || !UUID_RE.test(serverId)) return false;
  if (instanceId === ctx.productInstanceId) return false;
  const config = requirePeerLinkConnect(ctx);
  if (serverId === config.serverId) return false;
  const result = await peerLinkRequest(config.accountUrl, '/servers', config.relayToken, undefined, fetcher);
  if (!Array.isArray(result.servers) || result.servers.length > 500) throw new PeerLinkConnectError('invalid_response');
  return result.servers.some((row: unknown) => !!row && typeof row === 'object' &&
    (row as Record<string, unknown>).id === serverId && (row as Record<string, unknown>).instanceId === instanceId && (row as Record<string, unknown>).revoked === false);
}

/** Names of this server's active Connect machines (the `taken` set for {@link peerLinkHostName}). */
export async function listConnectPeerLinkNames(ctx: Pick<ProductHttpContext, 'dataDir'>, fetcher?: ConnectFetch): Promise<Set<string>> {
  const config = requirePeerLinkConnect(ctx);
  const result = await peerLinkRequest(config.accountUrl, '/hosts', config.relayToken, undefined, fetcher);
  if (!Array.isArray(result.machines) || result.machines.length > 500) throw new PeerLinkConnectError('invalid_response');
  const names = new Set<string>();
  for (const row of result.machines) {
    if (row && typeof row === 'object' && row.revoked === false && typeof row.name === 'string' && row.name.length <= PEER_LINK_NAME_MAX) names.add(row.name);
  }
  return names;
}

/**
 * Destination: revokes its own inbound peer-link host at Connect (machine + pending code). Returns whether Connect
 * revoked an active machine; false when Connect is off (nothing to revoke). Failures throw so the caller can retry.
 */
export async function revokeConnectPeerLink(ctx: Pick<ProductHttpContext, 'dataDir'>, hostId: string, fetcher?: ConnectFetch): Promise<boolean> {
  if (typeof hostId !== 'string' || !UUID_RE.test(hostId)) throw new PeerLinkConnectError('invalid_host');
  if (connection(ctx).mode !== 'connect') return false;
  const config = requirePeerLinkConnect(ctx);
  const result = await peerLinkRequest(config.accountUrl, '/hosts/revoke', config.relayToken, { hostId }, fetcher);
  return result.revoked === true;
}

/** True when a linked peer-link credential is due for scheduled rotation. */
export function peerLinkRotationDue(lastRotatedAt: number, now = Date.now()): boolean {
  return !Number.isFinite(lastRotatedAt) || now - lastRotatedAt >= PEER_LINK_ROTATION_MS;
}
