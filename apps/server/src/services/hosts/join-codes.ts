import { createHash, randomBytes } from 'node:crypto';
import { createHostId, type ZccDatabase } from '@zana-ai/zcc-db';

export const JOIN_CODE_TTL_MS = 15 * 60 * 1000;
export const JOIN_CODE_PREFIX = 'zcde_';

export interface IssuedJoinCode {
  joinCode: string;
  hostId: string;
  expiresAt: number;
}

interface JoinCodeRecord extends IssuedJoinCode {
  redeemedAt: number | null;
}

const HOST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type JoinCodeRejection = 'missing' | 'expired' | 'redeemed' | 'invalidated' | 'host_mismatch';

/** `invalidated` is never reported: invalidation deletes the row, so it is indistinguishable from `missing`. */
export type JoinCodeInspection =
  | { ok: true; hostId: string; expiresAt: number }
  | { ok: false; reason: JoinCodeRejection; hostId?: string };

export interface JoinCodeStore {
  mint(now?: number): IssuedJoinCode;
  mintForHost(hostId: string, now?: number): IssuedJoinCode;
  peek(joinCode: string, now?: number): JoinCodeRecord | null;
  redeem(joinCode: string, now?: number): IssuedJoinCode | null;
  recovered(joinCode: string, now?: number): IssuedJoinCode | null;
  /** Diagnostic only; callers must keep the rejection reason out of any remote response. */
  inspect(joinCode: string, hostId?: string, now?: number): JoinCodeInspection;
  invalidateHost(hostId: string): void;
  status(enrollmentId: string, now?: number): { hostId: string; expiresAt: number; redeemedAt: number | null } | null;
}

function mintToken(): string {
  return `${JOIN_CODE_PREFIX}${randomBytes(18).toString('base64url')}`;
}

/**
 * Short-lived enroll keys for Settings → Add machine. Minting does not insert
 * a host row — redeem happens at `/internal/hosts/enroll`.
 */
export function createJoinCodeStore(db?: ZccDatabase): JoinCodeStore {
  type Stored = Omit<JoinCodeRecord, 'joinCode'>;
  const codes = new Map<string, Stored>();
  const digest = (code: string) => createHash('sha256').update(code).digest('hex');
  const lookup = (code: string): JoinCodeRecord | null => {
    const hash = digest(code);
    const row = db ? db.sqlite.prepare('SELECT host_id AS hostId,expires_at AS expiresAt,redeemed_at AS redeemedAt FROM host_join_codes WHERE hash=?').get(hash) as Stored | undefined : codes.get(hash);
    return row ? { ...row, joinCode: code } : null;
  };
  const invalidateHost = (hostId: string) => {
    if (db) db.sqlite.prepare('DELETE FROM host_join_codes WHERE host_id=?').run(hostId);
    else for (const [hash, row] of codes) if (row.hostId === hostId) codes.delete(hash);
  };

  function prune(now: number): void {
    for (const [key, row] of codes) {
      if (row.expiresAt <= now) codes.delete(key);
    }
    if (db) db.sqlite.prepare('DELETE FROM host_join_codes WHERE expires_at<=?').run(now);
  }

  function issue(hostId: string, now: number): IssuedJoinCode {
    prune(now);
    invalidateHost(hostId);
    const size = db ? (db.sqlite.prepare('SELECT COUNT(*) AS n FROM host_join_codes').get() as { n: number }).n : codes.size;
    if (size >= 500) throw new Error('Too many pending machine enrollments');
    const record: JoinCodeRecord = {
      joinCode: mintToken(),
      hostId,
      expiresAt: now + JOIN_CODE_TTL_MS,
      redeemedAt: null
    };
    if (db) db.sqlite.prepare('INSERT INTO host_join_codes(hash,host_id,expires_at,redeemed_at) VALUES(?,?,?,NULL)').run(digest(record.joinCode), hostId, record.expiresAt);
    else codes.set(digest(record.joinCode), { hostId, expiresAt: record.expiresAt, redeemedAt: null });
    return {
      joinCode: record.joinCode,
      hostId: record.hostId,
      expiresAt: record.expiresAt
    };
  }

  return {
    mint(now = Date.now()): IssuedJoinCode {
      return issue(createHostId(), now);
    },
    mintForHost(hostId: string, now = Date.now()): IssuedJoinCode {
      if (!HOST_ID_RE.test(hostId)) throw new Error('hostId must be a UUID');
      return issue(hostId, now);
    },
    peek(joinCode: string, now = Date.now()): JoinCodeRecord | null {
      const row = lookup(joinCode);
      if (!row || row.redeemedAt !== null || row.expiresAt <= now) return null;
      return row;
    },
    redeem(joinCode: string, now = Date.now()): IssuedJoinCode | null {
      const row = lookup(joinCode);
      if (!row || row.redeemedAt !== null || row.expiresAt <= now) return null;
      row.redeemedAt = now;
      if (db) {
        const result = db.sqlite.prepare('UPDATE host_join_codes SET redeemed_at=? WHERE hash=? AND redeemed_at IS NULL').run(now, digest(joinCode));
        if (result.changes !== 1) return null;
      } else codes.set(digest(joinCode), { hostId: row.hostId, expiresAt: row.expiresAt, redeemedAt: now });
      return {
        joinCode: row.joinCode,
        hostId: row.hostId,
        expiresAt: row.expiresAt
      };
    },
    recovered(joinCode: string, now = Date.now()): IssuedJoinCode | null {
      const row = lookup(joinCode);
      return row && row.redeemedAt !== null && row.expiresAt > now ? { joinCode, hostId: row.hostId, expiresAt: row.expiresAt } : null;
    },
    inspect(joinCode: string, hostId?: string, now = Date.now()): JoinCodeInspection {
      const row = joinCode ? lookup(joinCode) : null;
      if (!row) return { ok: false, reason: 'missing' };
      if (row.expiresAt <= now) return { ok: false, reason: 'expired', hostId: row.hostId };
      if (hostId && hostId !== row.hostId) return { ok: false, reason: 'host_mismatch', hostId: row.hostId };
      if (row.redeemedAt !== null) return { ok: false, reason: 'redeemed', hostId: row.hostId };
      return { ok: true, hostId: row.hostId, expiresAt: row.expiresAt };
    },
    status(enrollmentId: string, now = Date.now()) {
      if (!/^[a-f0-9]{64}$/.test(enrollmentId)) return null;
      const row = db ? db.sqlite.prepare('SELECT host_id AS hostId,expires_at AS expiresAt,redeemed_at AS redeemedAt FROM host_join_codes WHERE hash=?').get(enrollmentId) as Stored | undefined : codes.get(enrollmentId);
      return row && row.expiresAt > now ? { hostId: row.hostId, expiresAt: row.expiresAt, redeemedAt: row.redeemedAt } : null;
    },
    invalidateHost
  };
}
