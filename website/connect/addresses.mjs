import { ConnectError } from './registry.mjs';

const reserved = new Set('www api app zana connect dashboard about blog docs download downloads help legal privacy status support terms abuse account accounts admin auth billing login logout oauth register security settings signin signout signup sso assets cdn dns edge files gateway git internal mail origin proxy relay root static system tunnel websocket dev preview prod production staging test'.split(' '));
export function addressError(label) {
  if (typeof label !== 'string' || !/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(label) || label.includes('--')) return 'invalid_address';
  if (reserved.has(label) || label.startsWith('s-')) return 'reserved_address';
  return null;
}

/**
 * A label stays reserved for its owner after the computer holding it is
 * revoked or purged, so re-enrolling that computer can take its name back.
 * Runs inside the owner's transaction; another account never matches.
 */
export async function reclaimAddress(query, userId, serverId, label) {
  const rows = await query('UPDATE connect_addresses SET server_id=$1 WHERE label=$2 AND user_id=$3 AND (server_id IS NULL OR server_id IN (SELECT id FROM connect_servers WHERE revoked_at IS NOT NULL)) RETURNING label', [serverId, label, userId]);
  return rows.length > 0;
}

export function createAddresses(db, { browserUrl, now, limit }) {
  return {
    async addressAvailability(label, userId = null) {
      const error = addressError(label);
      if (error) throw new ConnectError(error);
      const [row] = await db.query('SELECT a.user_id,a.server_id,v.revoked_at FROM connect_addresses a LEFT JOIN connect_servers v ON v.id=a.server_id WHERE a.label=$1', [label]);
      const available = !row || (userId !== null && row.user_id === userId && (row.server_id == null || row.revoked_at != null));
      return { available, browserUrl: browserUrl(label) };
    },
    async claimAddress(userId, serverId, label) {
      const error = addressError(label);
      if (error) throw new ConnectError(error);
      return db.transaction(userId, async query => {
        const [server] = await query('SELECT id FROM connect_servers WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL', [serverId, userId]);
        if (!server) throw new ConnectError('unknown_server', 404);
        const [existing] = await query('SELECT label FROM connect_addresses WHERE server_id=$1', [serverId]);
        if (existing) {
          if (existing.label !== label) throw new ConnectError('address_already_claimed', 409);
          return { label, browserUrl: browserUrl(label) };
        }
        if (await reclaimAddress(query, userId, serverId, label)) return { label, browserUrl: browserUrl(label) };
        const [count] = await query('SELECT COUNT(*) AS n FROM connect_addresses WHERE user_id=$1', [userId]);
        if (Number(count.n) >= limit) throw new ConnectError('account_limit', 409);
        const rows = await query('INSERT INTO connect_addresses(label,server_id,user_id,created_at) VALUES($1,$2,$3,$4) ON CONFLICT(label) DO NOTHING RETURNING label', [label, serverId, userId, now()]);
        if (!rows.length) throw new ConnectError('address_taken', 409);
        return { label, browserUrl: browserUrl(label) };
      });
    }
  };
}
