import {
  destroyHost,
  getHost,
  listPluginLinkHosts,
  removeHostLinkUse,
  type HostRow
} from '@zana-ai/zcc-db';
import type { PeerLink, PeerLinkActivityResponse, PeerLeftoverListResponse, PeerLinkHookFailure, PeerLinkListResponse, PeerLinkState } from '@zana-ai/zcc-server-contract';
import type { ProductHttpContext } from '../../http/product-context.js';
import { PluginLinkNotes } from '../peers/plugin-link-notes.js';
import { revokeConnectHost } from './connect-enrollment.js';

/** What an owner store (the thing that created a plugin link) knows about the peer. */
export interface PeerLinkDirectoryEntry {
  peerInstanceId: string;
  peerName: string;
  state: Exclude<PeerLinkState, 'unclaimed'>;
  reason?: string;
  paused?: boolean;
}

/**
 * Optional seam implemented by the link owners. Core never names a plugin: it only asks
 * "who is this host's peer" and, for owner-gesture removal, lets the owner clean its own
 * store. A `release`/`remove` that returns `undefined` did not claim the host and core
 * performs the generic teardown itself.
 */
export interface PeerLinkDirectory {
  describe(hostId: string): PeerLinkDirectoryEntry | undefined;
  release?(hostId: string, pluginId: string, scope: string | undefined): Promise<{ linkRemoved: boolean } | undefined>;
  /** `hooksRan`: core already ran the plugins' removing handlers and revoked the uses; the owner only tears down. */
  remove?(hostId: string, options?: { hooksRan?: boolean }): Promise<{ linkRemoved: true } | undefined>;
  /** Owner Disconnect / Reconnect: `undefined` means the owner store does not claim a pausable link on this host. */
  pause?(hostId: string): Promise<{ paused: true } | undefined>;
  resume?(hostId: string): Promise<{ paused: false } | undefined>;
  /** Owner Repair: re-key and reopen a dropped link. `undefined` means the owner store does not claim a repairable link here. */
  repair?(hostId: string): Promise<{ repaired: true } | undefined>;
}

type LinkCtx = ProductHttpContext;

const REASON_MAX = 200;

function toPeerLink(host: HostRow, ctx: LinkCtx, connected: ReadonlySet<string>): PeerLink {
  const directory = ctx.peerLinkDirectory;
  const uses = host.purpose.kind === 'plugin-link' ? host.purpose.uses : [];
  const entry = directory?.describe(host.id);
  const link: PeerLink = {
    hostId: host.id,
    peerInstanceId: entry?.peerInstanceId ?? null,
    peerName: entry?.peerName || host.name || 'Unknown peer',
    // A forward host no owner store claims and with no uses is surfaced for removal, not hidden.
    state: entry?.state ?? (uses.length > 0 ? 'linked' : 'unclaimed'),
    connected: connected.has(host.id),
    uses: uses.map(({ pluginId, label, scope, since }) => {
      // Notes are keyed by the peer the owner store names; an unclaimed link has none.
      const note = entry && ctx.peerLinkNotes?.get(pluginId, entry.peerInstanceId, scope);
      return note ? { pluginId, label, scope, since, note } : { pluginId, label, scope, since };
    })
  };
  if (entry?.paused) link.paused = true;
  if (entry?.reason) link.reason = entry.reason.slice(0, REASON_MAX);
  return link;
}

export function listPeerLinks(ctx: LinkCtx): PeerLinkListResponse {
  const connected = new Set(ctx.hostHub.connectedHostIds());
  const hosts = listPluginLinkHosts(ctx.db);
  if (ctx.peerLinkNotes?.size) {
    // Backstop for every way a link or use can vanish: a note outlives nothing it was reported against.
    const live = new Set<string>();
    for (const host of hosts) {
      const peer = ctx.peerLinkDirectory?.describe(host.id)?.peerInstanceId;
      if (peer && host.purpose.kind === 'plugin-link') for (const use of host.purpose.uses) live.add(PluginLinkNotes.liveKey(use.pluginId, peer, use.scope));
    }
    ctx.peerLinkNotes.retainOnly(live);
  }
  return { links: hosts.map((host) => toPeerLink(host, ctx, connected)) };
}

export type PeerLinkRemoval =
  | { status: 'ok'; linkRemoved: boolean }
  | { status: 'not-found' }
  | { status: 'unavailable' };

function unavailable(operation: string, hostId: string, error: unknown): { status: 'unavailable' } {
  console.warn(`[zcc] peer link ${operation} failed for host ${hostId}: ${error instanceof Error ? error.message : String(error)}`);
  return { status: 'unavailable' };
}

/** Only a live plugin link is addressable here; an execution host id is indistinguishable from a missing one. */
function pluginLink(ctx: LinkCtx, hostId: string): HostRow | null {
  const host = getHost(ctx.db, hostId);
  return host && !host.destroyedAt && host.purpose.kind === 'plugin-link' ? host : null;
}

async function teardownLink(ctx: LinkCtx, host: HostRow): Promise<PeerLinkRemoval> {
  // Connect revocation precedes local deletion for a Connect-backed host; a failure keeps the link visible for a retry.
  try { await revokeConnectHost(ctx, host.id); } catch (error) { return unavailable('revoke', host.id, error); }
  ctx.hostHub.getSession(host.id)?.socket.close(4003, 'host-removed');
  ctx.hostHub.detach(host.id, 'removed');
  ctx.joinCodes.invalidateHost(host.id);
  destroyHost(ctx.db, host.id);
  return { status: 'ok', linkRemoved: true };
}

/** Owner gesture: drop one plugin's use of a link. The link stays even when no use is left. */
export async function removePeerLinkUse(
  ctx: LinkCtx,
  hostId: string,
  pluginId: string,
  scope?: string
): Promise<PeerLinkRemoval> {
  const host = pluginLink(ctx, hostId);
  if (!host || host.purpose.kind !== 'plugin-link') return { status: 'not-found' };
  if (!host.purpose.uses.some((use) => use.pluginId === pluginId && (scope === undefined || use.scope === scope))) {
    return { status: 'not-found' };
  }
  const peer = ctx.peerLinkDirectory?.describe(hostId)?.peerInstanceId;
  let delegated: { linkRemoved: boolean } | undefined;
  try { delegated = await ctx.peerLinkDirectory?.release?.(hostId, pluginId, scope); } catch (error) { return unavailable('release', hostId, error); }
  if (peer) ctx.peerLinkNotes?.clearUse(pluginId, peer, scope);
  // A zero-use link is normal: the last use never removes the link (explicit removal does).
  if (!delegated) removeHostLinkUse(ctx.db, hostId, pluginId, scope);
  const after = pluginLink(ctx, hostId)?.purpose;
  if (peer && !(after?.kind === 'plugin-link' && after.uses.some(use => use.pluginId === pluginId))) await stopUse(ctx, pluginId, peer);
  return { status: 'ok', linkRemoved: delegated?.linkRemoved ?? false };
}

/** The plugin's last use is gone: fence its grants here now; the peer hears via the use layer, never awaited. */
async function stopUse(ctx: LinkCtx, pluginId: string, peer: string): Promise<void> {
  await ctx.peerAuthority.revokeUse(pluginId, peer).catch(() => undefined);
  ctx.peerActiveUse?.forgetUse(pluginId, peer);
  void Promise.resolve(ctx.peerConnectionUses?.stop(pluginId, peer)).catch(() => undefined);
}

/** Registry display name for a plugin; the use row's label (also registry-chosen) or the id when it is gone. */
function pluginName(ctx: LinkCtx, host: HostRow, pluginId: string): string {
  const fromUse = host.purpose.kind === 'plugin-link' ? host.purpose.uses.find(use => use.pluginId === pluginId)?.label : undefined;
  return (ctx.plugins?.get(pluginId)?.name?.trim() || fromUse || pluginId).slice(0, 80);
}

/** Plugins that completed a call with this link's computer within the active-use window. */
export function peerLinkActivity(ctx: LinkCtx, hostId: string): PeerLinkActivityResponse | null {
  const host = pluginLink(ctx, hostId);
  if (!host) return null;
  const peer = ctx.peerLinkDirectory?.describe(hostId)?.peerInstanceId;
  const active = peer ? ctx.peerActiveUse?.activePlugins(peer) ?? [] : [];
  return { active: active.slice(0, 32).map(pluginId => ({ pluginId, label: pluginName(ctx, host, pluginId) })) };
}

export type PeerLinkFullRemoval = PeerLinkRemoval | { status: 'hooks-failed'; failures: PeerLinkHookFailure[] };

/**
 * Owner gesture: remove the link and every use on it, in one order: plugins' removing handlers (bounded) -> revoke
 * every use -> local drop (the peer notice is sent, never awaited). A failed or timed-out handler stops before the
 * revoke so the owner can Retry; `force` (Remove anyway) skips the handlers and keeps a hidden orphan record.
 */
export async function removePeerLink(ctx: LinkCtx, hostId: string, options?: { force?: boolean }): Promise<PeerLinkFullRemoval> {
  const host = pluginLink(ctx, hostId);
  if (!host) return { status: 'not-found' };
  const force = !!options?.force;
  const entry = ctx.peerLinkDirectory?.describe(hostId);
  const peer = entry?.peerInstanceId;
  const hooks = !!peer && !!ctx.peerConnections && !!ctx.peerLinkDirectory?.remove;
  if (hooks) {
    const registry = ctx.peerConnections!;
    if (force) registry.recordOrphans(peer!, registry.failuresFor(peer!), entry?.peerName || host.name || '');
    else {
      const failures = await registry.runRemoving(peer!);
      if (failures.length) {
        return { status: 'hooks-failed', failures: failures.slice(0, 32).map(({ pluginId, reason }) => ({ pluginId, reason, label: pluginName(ctx, host, pluginId) })) };
      }
    }
    // Local grants fence at once; the peer hears through the removal notice or the next recover. Never blocks removal.
    await revokeAllPairs(ctx, peer!);
  }
  let delegated: { linkRemoved: true } | undefined;
  try { delegated = await (hooks ? ctx.peerLinkDirectory!.remove!(hostId, { hooksRan: true }) : ctx.peerLinkDirectory?.remove?.(hostId)); } catch (error) {
    // Remove anyway must complete: fall back to the generic teardown when the owner store cannot.
    if (!force) return unavailable('remove', hostId, error);
    console.warn(`[zcc] peer link remove failed for host ${hostId}, forcing generic teardown: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (peer) { ctx.peerLinkNotes?.clearPeer(peer); ctx.peerActiveUse?.forget(peer); }
  if (delegated) return { status: 'ok', linkRemoved: true };
  return teardownLink(ctx, host);
}

/** Best-effort: revoke every active pair for a computer; a throwing authority never blocks the caller. */
async function revokeAllPairs(ctx: LinkCtx, peer: string): Promise<void> {
  try {
    for (const pairId of await ctx.peerAuthority.activePairIds(peer)) await Promise.resolve(ctx.peerAuthority.revoke(pairId)).catch(() => undefined);
  } catch { /* fencing is best effort */ }
}

/** Hidden orphan records left by Remove anyway, for the Forget action. */
export function listPeerLeftovers(ctx: LinkCtx): PeerLeftoverListResponse {
  const records = ctx.peerConnections?.orphanRecords() ?? [];
  return {
    leftovers: records.map(({ computerId, name, failed }) => ({
      computerId,
      name,
      plugins: failed.slice(0, 32).map(({ pluginId, reason }) => ({ pluginId, reason, label: (ctx.plugins?.get(pluginId)?.name?.trim() || pluginId).slice(0, 80) }))
    }))
  };
}

/**
 * Forget a leftover: revoke any remaining authority, re-run plugin cleanup once, then drop the record whatever the
 * retry did. Only a recorded orphan is addressable; everything else is not-found. Never throws.
 */
export async function forgetLeftover(ctx: LinkCtx, computerId: string): Promise<{ status: 'ok' } | { status: 'not-found' }> {
  const registry = ctx.peerConnections;
  if (!registry?.hasOrphan(computerId)) return { status: 'not-found' };
  await revokeAllPairs(ctx, computerId);
  try { await registry.runRemoving(computerId); } catch { /* Forget drops the record whatever cleanup did */ }
  registry.forgetOrphan(computerId);
  try { ctx.peerLinkNotes?.clearPeer(computerId); ctx.peerActiveUse?.forget(computerId); } catch { /* cosmetic state */ }
  registry.notifyChanged();
  return { status: 'ok' };
}

export type PeerLinkPause =
  | { status: 'ok'; paused: boolean }
  | { status: 'not-found' }
  | { status: 'unavailable' };

/** Owner gesture: close the connection but keep the link, its uses and keys. */
export async function pausePeerLink(ctx: LinkCtx, hostId: string): Promise<PeerLinkPause> {
  if (!pluginLink(ctx, hostId)) return { status: 'not-found' };
  try {
    const result = await ctx.peerLinkDirectory?.pause?.(hostId);
    return result ? { status: 'ok', paused: true } : { status: 'not-found' };
  } catch (error) { return unavailable('pause', hostId, error); }
}

/** Owner gesture: clear the pause and resume connecting. */
export async function resumePeerLink(ctx: LinkCtx, hostId: string): Promise<PeerLinkPause> {
  if (!pluginLink(ctx, hostId)) return { status: 'not-found' };
  try {
    const result = await ctx.peerLinkDirectory?.resume?.(hostId);
    return result ? { status: 'ok', paused: false } : { status: 'not-found' };
  } catch (error) { return unavailable('resume', hostId, error); }
}

export type PeerLinkRepair =
  | { status: 'ok' }
  | { status: 'not-found' }
  | { status: 'unavailable' };

/** Owner gesture: re-key and reopen a dropped or unhealthy link. A paused link is resumed, not repaired. */
export async function repairPeerLink(ctx: LinkCtx, hostId: string): Promise<PeerLinkRepair> {
  if (!pluginLink(ctx, hostId)) return { status: 'not-found' };
  try {
    const result = await ctx.peerLinkDirectory?.repair?.(hostId);
    return result ? { status: 'ok' } : { status: 'not-found' };
  } catch (error) { return unavailable('repair', hostId, error); }
}
