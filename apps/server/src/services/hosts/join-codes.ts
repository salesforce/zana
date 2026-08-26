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

export interface JoinCodeStore {
  mint(now?: number): IssuedJoinCode;
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

  return {
    mint(now = Date.now()): IssuedJoinCode {
      prune(now);
      const record: JoinCodeRecord = {
        joinCode: mintToken(),
        hostId: createHostId(),
        expiresAt: now + JOIN_CODE_TTL_MS,
        redeemedAt: null
      };
      codes.set(record.joinCode, record);
      return {
        joinCode: record.joinCode,
        hostId: record.hostId,
        expiresAt: record.expiresAt
      };
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
