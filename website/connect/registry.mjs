import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createAddresses } from './addresses.mjs';
import { createComputerCodes } from './computer-codes.mjs';
import { createPhoneLogin } from './phone-login.mjs';
import { createMachines } from './machines.mjs';

export const CODE_TTL = 10 * 60_000;
export const SESSION_TTL = 60 * 60_000;
export const ACCOUNT_LIMIT = 500;
export const digest = value => createHash('sha256').update(value).digest('hex');
export const credentialValid = value => typeof value === 'string' && /^[\w-]{43}$/.test(value);
const token = () => randomBytes(32).toString('base64url');
const code = () => randomBytes(16).toString('base64url');
const cleanName = value => {
  if (typeof value !== 'string' || !value.trim() || value.length > 80 || /[\x00-\x1f\x7f]/.test(value)) throw new ConnectError('invalid_name', 400);
  return value.trim();
};
export class ConnectError extends Error {
  constructor(code, status = 400) { super(code); this.status = status; }
}

/** BB's account-owned server/device and one-use enrollment model, on portable SQL. */
export function createRegistry(db, { domain, browserDomain = domain, accountUrl, now = Date.now, limit = ACCOUNT_LIMIT, allowLocal = false }) {
  const account = new URL(accountUrl);
  if (account.username || account.password || account.search || account.hash || account.pathname !== '/' ||
      (account.protocol !== 'https:' && !(allowLocal && account.protocol === 'http:')) ||
      [domain, browserDomain].some(value => typeof value !== 'string' || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d+)?$/.test(value) || value.includes('..'))) throw new Error('Invalid Connect origins');
  const serverUrl = label => `${account.protocol}//${label}.${domain}`;
  // Stable generated URLs remain the transport identity for already paired devices.
  const browserUrl = label => /^s-[a-f0-9]{24}$/.test(label) ? serverUrl(label) : `${account.protocol}//${label}.${browserDomain}`;
  const summary = row => ({ id: row.id, ...(row.instance_id ? { instanceId: row.instance_id } : {}), name: row.name, label: row.label, serverUrl: serverUrl(row.label), browserUrl: row.address ? browserUrl(row.address) : null, address: row.address ?? null, paired: !!row.credential_hash, live: row.revoked_at == null && !!row.credential_hash && Number(row.last_seen_at) > now() - 90_000, revoked: row.revoked_at != null });
  const one = async (query, sql, args) => (await query(sql, args))[0] ?? null;
  const authenticate = async (kind, credential) => {
    if (!credentialValid(credential)) return null;
    const table = kind === 'server' ? 'connect_servers' : 'connect_devices';
    return one(db.query, `SELECT * FROM ${table} WHERE credential_hash=$1 AND revoked_at IS NULL`, [digest(credential)]);
  };
  const prune = async query => {
    // Expiry-indexed bounded batches keep maintenance off the request's critical path.
    await query('DELETE FROM connect_sessions WHERE hash IN (SELECT hash FROM connect_sessions WHERE expires_at <= $1 LIMIT 200)', [now()]);
    await query('DELETE FROM connect_codes WHERE hash IN (SELECT hash FROM connect_codes WHERE expires_at <= $1 LIMIT 200)', [now()]);
    await query('DELETE FROM connect_machine_codes WHERE hash IN (SELECT hash FROM connect_machine_codes WHERE expires_at <= $1 LIMIT 200)', [now()]);
    await query('DELETE FROM connect_browser_requests WHERE hash IN (SELECT hash FROM connect_browser_requests WHERE expires_at <= $1 LIMIT 200)', [now()]);
    await query('DELETE FROM connect_browser_sessions WHERE hash IN (SELECT hash FROM connect_browser_sessions WHERE expires_at <= $1 LIMIT 200)', [now()]);
    const retention = now() - 90 * 24 * 60 * 60_000;
    await query('DELETE FROM connect_machines WHERE id IN (SELECT id FROM connect_machines WHERE revoked_at<$1 LIMIT 200)', [retention]);
    await query('DELETE FROM connect_devices WHERE id IN (SELECT d.id FROM connect_devices d WHERE d.revoked_at<$1 AND NOT EXISTS (SELECT 1 FROM connect_sessions s WHERE s.device_id=d.id) LIMIT 200)', [retention]);
    await query('DELETE FROM connect_servers WHERE id IN (SELECT v.id FROM connect_servers v WHERE v.revoked_at<$1 AND NOT EXISTS (SELECT 1 FROM connect_sessions s WHERE s.server_id=v.id) AND NOT EXISTS (SELECT 1 FROM connect_codes c WHERE c.server_id=v.id) LIMIT 200)', [retention]);
  };
  const capacity = async (query, table, userId) => {
    const count = await one(query, `SELECT COUNT(*) AS n FROM ${table} WHERE user_id=$1 AND revoked_at IS NULL`, [userId]);
    if (Number(count.n) >= limit) throw new ConnectError('account_limit', 409);
  };
  const requireActive = async (query, table, principal) => {
    const row = await one(query, `SELECT id FROM ${table} WHERE id=$1 AND user_id=$2 AND credential_hash=$3 AND revoked_at IS NULL`, [principal.id, principal.user_id, principal.credential_hash]);
    if (!row) throw new ConnectError('revoked', 403);
  };
  return {
    domain, browserDomain, accountUrl: account.origin, serverUrl, browserUrl, summary,
    ...createAddresses(db, { browserUrl, now, limit }),
    ...createComputerCodes(db, { accountUrl: account.origin, serverUrl, browserUrl, now, limit }),
    ...createMachines(db, { accountUrl: account.origin, serverUrl, now, limit }),
    ...createPhoneLogin(db, { accountUrl: account.origin, domain, now, limit }),
    authenticateServer: credential => authenticate('server', credential),
    authenticateDevice: credential => authenticate('device', credential),
    resolveServer: label => one(db.query, 'SELECT v.* FROM connect_servers v LEFT JOIN connect_addresses a ON a.server_id=v.id WHERE (v.label=$1 OR a.label=$1) AND v.revoked_at IS NULL', [label]),
    async startEnrollment(name) {
      name = cleanName(name);
      const deviceCode = token(); const userCode = code(); const expiresAt = now() + CODE_TTL;
      await db.transaction('enrollment', async query => {
        await prune(query);
        const pending = await one(query, 'SELECT COUNT(*) AS n FROM connect_codes WHERE purpose=$1 AND expires_at>$2 AND consumed_at IS NULL', ['enroll', now()]);
        if (Number(pending.n) >= 1000) throw new ConnectError('busy', 429);
        await query('INSERT INTO connect_codes (hash,purpose,name,device_hash,expires_at,created_at) VALUES ($1,$2,$3,$4,$5,$6)', [digest(userCode), 'enroll', name, digest(deviceCode), expiresAt, now()]);
      });
      return { deviceCode, userCode, expiresAt, verificationUrl: `${account.origin}/connect/?code=${encodeURIComponent(userCode)}`, interval: 3000 };
    },
    async enrollmentInfo(userCode) {
      if (typeof userCode !== 'string' || userCode.length > 100) throw new ConnectError('invalid_code');
      const row = await one(db.query, 'SELECT name,server_id,expires_at,consumed_at,denied_at FROM connect_codes WHERE hash=$1 AND purpose=$2', [digest(userCode), 'enroll']);
      if (!row || Number(row.expires_at) <= now()) throw new ConnectError('expired', 410);
      return { name: row.name, ...(row.server_id ? { serverId: row.server_id } : {}), expiresAt: Number(row.expires_at), approved: row.consumed_at != null, denied: row.denied_at != null };
    },
    async approveEnrollment(userId, userCode, approved = true) {
      if (typeof userId !== 'string' || !userId || typeof userCode !== 'string' || userCode.length > 100) throw new ConnectError('invalid_code');
      return db.transaction(userId, async query => {
        const row = await one(query, 'UPDATE connect_codes SET consumed_at=$1,user_id=$2,denied_at=$3 WHERE hash=$4 AND purpose=$5 AND consumed_at IS NULL AND expires_at>$1 RETURNING *', [now(), userId, approved ? null : now(), digest(userCode), 'enroll']);
        if (!row) throw new ConnectError('expired_or_used', 409);
        if (!approved) return { denied: true };
        await capacity(query, 'connect_servers', userId);
        const id = randomUUID(); const label = `s-${randomBytes(12).toString('hex')}`;
        await query('INSERT INTO connect_servers(id,user_id,label,name,created_at) VALUES($1,$2,$3,$4,$5)', [id, userId, label, row.name, now()]);
        await query('UPDATE connect_codes SET server_id=$1 WHERE hash=$2', [id, row.hash]);
        return { id, name: row.name, serverUrl: serverUrl(label) };
      });
    },
    async pollEnrollment(deviceCode) {
      if (!credentialValid(deviceCode)) throw new ConnectError('invalid_code');
      return db.transaction(digest(deviceCode), async query => {
        const row = await one(query, 'SELECT * FROM connect_codes WHERE device_hash=$1 AND purpose=$2', [digest(deviceCode), 'enroll']);
        if (!row || Number(row.expires_at) <= now()) throw new ConnectError('expired', 410);
        if (row.denied_at != null) throw new ConnectError('denied', 403);
        if (!row.server_id) return { pending: true };
        // Derivation makes a lost poll response recoverable without storing plaintext credentials.
        const credential = createHash('sha256').update(`zana-connect-server:${deviceCode}`).digest('base64url');
        const srv = await one(query, 'UPDATE connect_servers SET credential_hash=$1 WHERE id=$2 AND revoked_at IS NULL AND (credential_hash IS NULL OR credential_hash=$1) RETURNING *', [digest(credential), row.server_id]);
        if (!srv) throw new ConnectError('revoked', 403);
        return { credential, serverId: srv.id, serverUrl: serverUrl(srv.label), accountUrl: account.origin, name: srv.name };
      });
    },
    async listServers(userId) { return (await db.query('SELECT v.*,a.label AS address,b.instance_id FROM connect_servers v LEFT JOIN connect_addresses a ON a.server_id=v.id LEFT JOIN connect_instances b ON b.server_id=v.id WHERE v.user_id=$1 ORDER BY CASE WHEN v.revoked_at IS NULL THEN 0 ELSE 1 END,v.created_at DESC LIMIT $2', [userId, limit])).map(summary); },
    async listDevices(userId) { return (await db.query('SELECT id,name,created_at,revoked_at FROM connect_devices WHERE user_id=$1 ORDER BY CASE WHEN revoked_at IS NULL THEN 0 ELSE 1 END,created_at DESC LIMIT $2', [userId, limit])).map(row => ({ id: row.id, label: row.name, createdAt: Number(row.created_at), revoked: row.revoked_at != null })); },
    async createPhoneCode(server) {
      const value = code(); const expiresAt = now() + CODE_TTL;
      await db.transaction(server.user_id, async query => {
        await requireActive(query, 'connect_servers', server);
        await capacity(query, 'connect_devices', server.user_id);
        await query('DELETE FROM connect_codes WHERE server_id=$1 AND purpose=$2', [server.id, 'phone']);
        await query('INSERT INTO connect_codes(hash,purpose,user_id,server_id,name,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [digest(value), 'phone', server.user_id, server.id, '', expiresAt, now()]);
      });
      return { version: 1, serverUrl: serverUrl(server.label), code: value, expiresAt };
    },
    async redeemPhoneCode(server, value, name) {
      if (typeof value !== 'string' || !/^[\w-]{22}$/.test(value)) throw new ConnectError('invalid_code');
      name = cleanName(name);
      return db.transaction(server.user_id, async query => {
        // Authentication before entering the transaction may race revocation.
        // Issue credentials under the same account lock used by revoke().
        await requireActive(query, 'connect_servers', server);
        await capacity(query, 'connect_devices', server.user_id);
        const row = await one(query, 'UPDATE connect_codes SET consumed_at=$1 WHERE hash=$2 AND purpose=$3 AND server_id=$4 AND consumed_at IS NULL AND expires_at>$1 RETURNING user_id', [now(), digest(value), 'phone', server.id]);
        if (!row || row.user_id !== server.user_id) throw new ConnectError('expired_or_used', 409);
        const credential = token(); const deviceId = randomUUID();
        await query('INSERT INTO connect_devices(id,user_id,name,credential_hash,created_at) VALUES($1,$2,$3,$4,$5)', [deviceId, server.user_id, name, digest(credential), now()]);
        return { credential, deviceId, connectDomain: domain, accountUrl: account.origin };
      });
    },
    async createSession(server, device) {
      if (server.user_id !== device.user_id) throw new ConnectError('not_your_server', 403);
      const value = token(); const expiresAt = now() + SESSION_TTL;
      await db.transaction(server.user_id, async query => {
        await requireActive(query, 'connect_servers', server);
        await requireActive(query, 'connect_devices', device);
        await prune(query);
        await query('DELETE FROM connect_sessions WHERE device_id=$1 AND server_id=$2', [device.id, server.id]);
        await query('INSERT INTO connect_sessions(hash,device_id,server_id,expires_at) VALUES($1,$2,$3,$4)', [digest(value), device.id, server.id, expiresAt]);
      });
      return { cookie: { name: 'zcc_mobile_session', value, expires: new Date(expiresAt).toISOString(), path: '/', secure: account.protocol === 'https:', httpOnly: true }, expiresAt };
    },
    async authorizeSession(server, cookie) {
      if (!credentialValid(cookie)) return null;
      return one(db.query, 'SELECT d.id,d.user_id FROM connect_sessions s JOIN connect_devices d ON d.id=s.device_id JOIN connect_servers v ON v.id=s.server_id WHERE s.hash=$1 AND s.server_id=$2 AND s.expires_at>$3 AND d.revoked_at IS NULL AND v.revoked_at IS NULL AND d.user_id=v.user_id', [digest(cookie), server.id, now()]);
    },
    async revoke(userId, kind, id) {
      const table = kind === 'server' ? 'connect_servers' : 'connect_devices';
      return db.transaction(userId, async query => {
        const rows = await query(`UPDATE ${table} SET revoked_at=$1 WHERE id=$2 AND user_id=$3 AND revoked_at IS NULL RETURNING id`, [now(), id, userId]);
        return rows.length > 0;
      });
    },
    async markSeen(id) { await db.query('UPDATE connect_servers SET last_seen_at=$1 WHERE id=$2 AND revoked_at IS NULL', [now(), id]); },
    prune: () => db.transaction('connect-cleanup', prune)
  };
}
