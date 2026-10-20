import { randomBytes, randomUUID } from 'node:crypto';
import { CODE_TTL, ConnectError, digest } from './registry.mjs';
import { addressError, reclaimAddress } from './addresses.mjs';

export function normalizeComputerCode(value) {
  if (typeof value !== 'string' || value.length > 80) throw new ConnectError('invalid_code');
  const normalized = value.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-F0-9]{16}$/.test(normalized)) throw new ConnectError('invalid_code');
  return normalized;
}

/** Short-lived account-issued bearer codes. Only their digests reach storage. */
export function createComputerCodes(db, { accountUrl, serverUrl, browserUrl, now, limit }) {
  const issue = async (query, userId, serverId = null) => {
    const raw = randomBytes(8).toString('hex').toUpperCase();
    const expiresAt = now() + CODE_TTL;
    // Rotating one instance's code must not invalidate another instance's setup.
    await query('DELETE FROM connect_codes WHERE purpose=$1 AND user_id=$2 AND (server_id=$3 OR (server_id IS NULL AND $3 IS NULL))', ['computer', userId, serverId]);
    await query('INSERT INTO connect_codes(hash,purpose,user_id,server_id,name,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [digest(raw), 'computer', userId, serverId, '', expiresAt, now()]);
    return { code: raw.match(/.{4}/g).join('-'), expiresAt };
  };
  return {
    async reserveComputer(userId, label) {
      const error = addressError(label);
      if (error) throw new ConnectError(error);
      return db.transaction(userId, async query => {
        const [count] = await query('SELECT COUNT(*) AS n FROM connect_servers WHERE user_id=$1 AND revoked_at IS NULL', [userId]);
        if (Number(count.n) >= limit) throw new ConnectError('account_limit', 409);
        const serverId = randomUUID(), transport = `s-${randomBytes(12).toString('hex')}`;
        await query('INSERT INTO connect_servers(id,user_id,label,name,created_at) VALUES($1,$2,$3,$4,$5)', [serverId, userId, transport, label, now()]);
        if (!await reclaimAddress(query, userId, serverId, label)) {
          const [addresses] = await query('SELECT COUNT(*) AS n FROM connect_addresses WHERE user_id=$1', [userId]);
          if (Number(addresses.n) >= limit) throw new ConnectError('account_limit', 409);
          const inserted = await query('INSERT INTO connect_addresses(label,server_id,user_id,created_at) VALUES($1,$2,$3,$4) ON CONFLICT(label) DO NOTHING RETURNING label', [label, serverId, userId, now()]);
          if (!inserted.length) throw new ConnectError('address_taken', 409);
        }
        return { ...await issue(query, userId, serverId), serverId, browserUrl: browserUrl(label) };
      });
    },
    async createComputerCode(userId, serverId = null) {
      return db.transaction(userId, async query => {
        if (serverId !== null) {
          if (typeof serverId !== 'string' || serverId.length > 64) throw new ConnectError('unknown_server', 404);
          const [server] = await query('SELECT credential_hash FROM connect_servers WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL', [serverId, userId]);
          if (!server) throw new ConnectError('unknown_server', 404);
          if (server.credential_hash) throw new ConnectError('already_connected', 409);
        }
        return issue(query, userId, serverId);
      });
    },
    async redeemComputerCode(value, name) {
      const hash = digest(normalizeComputerCode(value));
      if (typeof name !== 'string' || !name.trim() || name.length > 80 || /[\x00-\x1f\x7f]/.test(name)) throw new ConnectError('invalid_name');
      const [owner] = await db.query('SELECT user_id FROM connect_codes WHERE hash=$1 AND purpose=$2 AND consumed_at IS NULL AND expires_at>$3', [hash, 'computer', now()]);
      if (!owner) throw new ConnectError('expired_or_used', 409);
      return db.transaction(owner.user_id, async query => {
        const [row] = await query('UPDATE connect_codes SET consumed_at=$1 WHERE hash=$2 AND purpose=$3 AND user_id=$4 AND consumed_at IS NULL AND expires_at>$1 RETURNING user_id,server_id', [now(), hash, 'computer', owner.user_id]);
        if (!row) throw new ConnectError('expired_or_used', 409);
        const credential = randomBytes(32).toString('base64url');
        if (row.server_id) {
          const [server] = await query('UPDATE connect_servers SET credential_hash=$1,name=$2 WHERE id=$3 AND user_id=$4 AND credential_hash IS NULL AND revoked_at IS NULL RETURNING id,label', [digest(credential), name.trim(), row.server_id, row.user_id]);
          if (!server) throw new ConnectError('expired_or_used', 409);
          return { credential, serverId: server.id, serverUrl: serverUrl(server.label), accountUrl, name: name.trim() };
        }
        const [count] = await query('SELECT COUNT(*) AS n FROM connect_servers WHERE user_id=$1 AND revoked_at IS NULL', [row.user_id]);
        if (Number(count.n) >= limit) throw new ConnectError('account_limit', 409);
        const id = randomUUID(), label = `s-${randomBytes(12).toString('hex')}`;
        await query('INSERT INTO connect_servers(id,user_id,label,name,credential_hash,created_at) VALUES($1,$2,$3,$4,$5,$6)', [id, row.user_id, label, name.trim(), digest(credential), now()]);
        return { credential, serverId: id, serverUrl: serverUrl(label), accountUrl, name: name.trim() };
      });
    }
  };
}
