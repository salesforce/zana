import { randomBytes } from 'node:crypto';
import { createHostId } from '@zana-ai/zcc-db';

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

export interface JoinCodeStore {
  mint(now?: number): IssuedJoinCode;
  mintForHost(hostId: string, now?: number): IssuedJoinCode;
  peek(joinCode: string, now?: number): JoinCodeRecord | null;
  redeem(joinCode: string, now?: number): IssuedJoinCode | null;
}

function mintToken(): string {
  return `${JOIN_CODE_PREFIX}${randomBytes(18).toString('base64url')}`;
}

/**
 * Short-lived enroll keys for Settings → Add machine. Minting does not insert
 * a host row — redeem happens at `/internal/hosts/enroll`.
 */
export function createJoinCodeStore(): JoinCodeStore {
  const codes = new Map<string, JoinCodeRecord>();

  function prune(now: number): void {
    for (const [key, row] of codes) {
      if (row.redeemedAt !== null || row.expiresAt <= now) codes.delete(key);
    }
  }

  function issue(hostId: string, now: number): IssuedJoinCode {
    prune(now);
    const record: JoinCodeRecord = {
      joinCode: mintToken(),
      hostId,
      expiresAt: now + JOIN_CODE_TTL_MS,
      redeemedAt: null
    };
    codes.set(record.joinCode, record);
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
      const row = codes.get(joinCode);
      if (!row || row.redeemedAt !== null || row.expiresAt <= now) return null;
      return row;
    },
    redeem(joinCode: string, now = Date.now()): IssuedJoinCode | null {
      const row = codes.get(joinCode);
      if (!row || row.redeemedAt !== null || row.expiresAt <= now) return null;
      row.redeemedAt = now;
      codes.delete(joinCode);
      return {
        joinCode: row.joinCode,
        hostId: row.hostId,
        expiresAt: row.expiresAt
      };
    }
  };
}
