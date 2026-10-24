import { createHash, randomBytes } from 'node:crypto';
import { createHostId, getHost, type ZccDatabase } from '@zana-ai/zcc-db';

export const JOIN_CODE_TTL_MS = 15 * 60 * 1000;
export const JOIN_CODE_PREFIX = 'zcde_';

export type JoinCodeCapability = 'execution' | 'peer.forward';

export interface IssuedJoinCode {
  joinCode: string;
  hostId: string;
  expiresAt: number;
  /** Decided by the server at mint time; the enrolling client never chooses it. */
  enrollmentCapability: JoinCodeCapability;
}

interface JoinCodeRecord extends IssuedJoinCode {
  redeemedAt: number | null;
}

const HOST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type JoinCodeRejection = 'missing' | 'expired' | 'redeemed' | 'host_mismatch';

/** Invalidation deletes the row, so an invalidated code is reported as `missing`. */
export type JoinCodeInspection =
  | { ok: true; hostId: string; expiresAt: number }
  | { ok: false; reason: JoinCodeRejection; hostId?: string };

export interface JoinCodeStore {
  mint(now?: number): IssuedJoinCode;
  /** Fresh host only: a forward-only code can never re-enroll (or downgrade) an existing machine. */
  mintForwardOnly(now?: number): IssuedJoinCode;
  mintForHost(hostId: string, now?: number): IssuedJoinCode;
  /**
   * Re-mints a forward-only code for an existing, live `peer.forward` host (peer-link credential rotation).
   * Throws for an unknown, destroyed, or execution host so a rotation can never widen or downgrade a machine.
   * Requires the database-backed store.
   */
  mintForwardOnlyForHost(hostId: string, now?: number): IssuedJoinCode;
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
    const row = db ? db.sqlite.prepare('SELECT host_id AS hostId,expires_at AS expiresAt,redeemed_at AS redeemedAt,enrollment_capability AS enrollmentCapability FROM host_join_codes WHERE hash=?').get(hash) as Stored | undefined : codes.get(hash);
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

  function issue(hostId: string, now: number, enrollmentCapability: JoinCodeCapability = 'execution'): IssuedJoinCode {
    prune(now);
    invalidateHost(hostId);
    const size = db ? (db.sqlite.prepare('SELECT COUNT(*) AS n FROM host_join_codes').get() as { n: number }).n : codes.size;
    if (size >= 500) throw new Error('Too many pending machine enrollments');
    const record: JoinCodeRecord = {
      joinCode: mintToken(),
      hostId,
      expiresAt: now + JOIN_CODE_TTL_MS,
      redeemedAt: null,
      enrollmentCapability
    };
    if (db) db.sqlite.prepare('INSERT INTO host_join_codes(hash,host_id,expires_at,redeemed_at,enrollment_capability) VALUES(?,?,?,NULL,?)').run(digest(record.joinCode), hostId, record.expiresAt, enrollmentCapability);
    else codes.set(digest(record.joinCode), { hostId, expiresAt: record.expiresAt, redeemedAt: null, enrollmentCapability });
    return {
      joinCode: record.joinCode,
      hostId: record.hostId,
      expiresAt: record.expiresAt,
      enrollmentCapability
    };
  }

  return {
    mint(now = Date.now()): IssuedJoinCode {
      return issue(createHostId(), now);
    },
    mintForwardOnly(now = Date.now()): IssuedJoinCode {
      return issue(createHostId(), now, 'peer.forward');
    },
    mintForHost(hostId: string, now = Date.now()): IssuedJoinCode {
      if (!HOST_ID_RE.test(hostId)) throw new Error('hostId must be a UUID');
      return issue(hostId, now);
    },
    mintForwardOnlyForHost(hostId: string, now = Date.now()): IssuedJoinCode {
      if (!HOST_ID_RE.test(hostId)) throw new Error('hostId must be a UUID');
      const host = db ? getHost(db, hostId) : null;
      if (!host || host.destroyedAt || host.isPrimary || host.enrollmentCapability !== 'peer.forward') throw new Error('Choose an existing peer link to rotate');
      return issue(hostId, now, 'peer.forward');
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
      } else codes.set(digest(joinCode), { hostId: row.hostId, expiresAt: row.expiresAt, redeemedAt: now, enrollmentCapability: row.enrollmentCapability });
      return {
        joinCode: row.joinCode,
        hostId: row.hostId,
        expiresAt: row.expiresAt,
        enrollmentCapability: row.enrollmentCapability
      };
    },
    recovered(joinCode: string, now = Date.now()): IssuedJoinCode | null {
      const row = lookup(joinCode);
      return row && row.redeemedAt !== null && row.expiresAt > now ? { joinCode, hostId: row.hostId, expiresAt: row.expiresAt, enrollmentCapability: row.enrollmentCapability } : null;
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
