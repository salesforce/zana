import { getHost, type ZccDatabase } from '@zana-ai/zcc-db';

/**
 * Approved-use lookup for a pair's `targetHostId`, synchronous so the PairStore commit guard can run it under its mutex.
 * A plugin-link host (a connection) carries a plugin's traffic only while its `host_link_uses` row for that plugin exists:
 * core writes the row when both owners approved the use and deletes it on Stop using; removing the connection destroys the
 * host and its rows. Hosts are per invitation, so a re-link starts with no uses. An execution enrollment is not a
 * connection and keeps its existing trust.
 */
export function hostUseApproved(db: ZccDatabase, hostId: string, pluginId: string): boolean {
  const host = getHost(db, hostId);
  if (!host || host.destroyedAt) return false;
  return host.purpose.kind !== 'plugin-link' || host.purpose.uses.some(use => use.pluginId === pluginId);
}
