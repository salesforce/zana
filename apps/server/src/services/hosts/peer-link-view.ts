import {
  destroyHost,
  getHost,
  listPluginLinkHosts,
  removeHostLinkUse,
  type HostRow
} from '@zana-ai/zcc-db';
import type { PeerLink, PeerLinkListResponse, PeerLinkState } from '@zana-ai/zcc-server-contract';
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
  remove?(hostId: string): Promise<{ linkRemoved: true } | undefined>;
  /** Owner Disconnect / Reconnect: `undefined` means the owner store does not claim a pausable link on this host. */
  pause?(hostId: string): Promise<{ paused: true } | undefined>;
  resume?(hostId: string): Promise<{ paused: false } | undefined>;
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
  // Cloud revocation precedes local deletion; a failure keeps the link visible for a retry.
  try { await revokeConnectHost(ctx, host.id); } catch (error) { return unavailable('revoke', host.id, error); }
  ctx.hostHub.getSession(host.id)?.socket.close(4003, 'host-removed');
  ctx.hostHub.detach(host.id, 'removed');
  ctx.joinCodes.invalidateHost(host.id);
  destroyHost(ctx.db, host.id);
  return { status: 'ok', linkRemoved: true };
}

/** Owner gesture: drop one plugin's use of a link. The last use removes the link itself. */
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
  if (delegated) return { status: 'ok', linkRemoved: delegated.linkRemoved };
  if (removeHostLinkUse(ctx.db, hostId, pluginId, scope) > 0) return { status: 'ok', linkRemoved: false };
  return teardownLink(ctx, host);
}

/** Owner gesture: remove the link and every use on it. */
export async function removePeerLink(ctx: LinkCtx, hostId: string): Promise<PeerLinkRemoval> {
  const host = pluginLink(ctx, hostId);
  if (!host) return { status: 'not-found' };
  const peer = ctx.peerLinkDirectory?.describe(hostId)?.peerInstanceId;
  let delegated: { linkRemoved: true } | undefined;
  try { delegated = await ctx.peerLinkDirectory?.remove?.(hostId); } catch (error) { return unavailable('remove', hostId, error); }
  if (peer) ctx.peerLinkNotes?.clearPeer(peer);
  if (delegated) return { status: 'ok', linkRemoved: true };
  return teardownLink(ctx, host);
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
