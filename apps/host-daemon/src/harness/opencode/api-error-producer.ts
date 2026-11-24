import { realpath } from 'node:fs/promises';
import { dirname, sep } from 'node:path';
import { createSqliteDatabase } from '@zana-ai/zcc-db';
import type { ApiErrorProducer, ApiErrorSessionRef, HarnessInteractionEvent } from '@zcc/harness-sdk';
import { isRetryableApiErrorKind } from '@zcc/harness-sdk';
import { classifyApiError } from '../api-error-kind.js';
import { sanitizeApiErrorText } from '../api-error-text.js';
import { openCodeDbPath } from './transcript-reader.js';

/**
 * OpenCode writes a final failure to its database within milliseconds, so a short quiet period is enough.
 * It retries retryable provider errors (429, 503, 529) without end and persists nothing for them, so this
 * signal only covers failures OpenCode gives up on: non-retryable API errors (auth, bad request) and
 * provider errors it could not classify (`UnknownError`, which is how a gateway outage arrives).
 */
export const OPENCODE_QUIET_MS = 10_000;

/** Bound on one message blob parsed from the database. */
const MAX_DATA_BYTES = 256 * 1024;
/** Clock-skew slack when matching a session row to this tab's spawn time. */
const CREATED_SLACK_MS = 5_000;
const SESSION_ID = /^ses_[A-Za-z0-9]{8,64}$/;
const FAILURE_NAMES = new Set(['APIError', 'UnknownError', 'ProviderAuthError']);

interface Marker {
  /** Newest message time in the session at turn start; null when no session row existed yet. */
  readonly since: number | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

type Db = ReturnType<typeof createSqliteDatabase>;

export interface OpenCodeApiErrorProducerDeps {
  dbPath?: () => string;
  quietMs?: number;
  log?: (message: string) => void;
}

/**
 * The failure carried by one assistant message `data` blob, or null. Only structure is trusted: a completed
 * assistant message with an `error` whose name is a provider failure. `MessageAbortedError` is a user
 * interrupt and never matches.
 */
export function failureFromMessage(data: unknown): HarnessInteractionEvent | null {
  const message = record(data);
  if (!message || message.role !== 'assistant') return null;
  const time = record(message.time);
  if (typeof time?.completed !== 'number') return null;
  const error = record(message.error);
  const name = error?.name;
  if (typeof name !== 'string' || !FAILURE_NAMES.has(name)) return null;
  const detail = record(error?.data);
  const text = sanitizeApiErrorText(detail?.message);
  const kind = name === 'ProviderAuthError'
    ? 'authentication_failed'
    : classifyApiError({ status: detail?.statusCode as number | string | undefined, text });
  return { kind: 'api-error-stop', error: kind, text, retryable: isRetryableApiErrorKind(kind) };
}

export function createOpenCodeApiErrorProducer(deps: OpenCodeApiErrorProducerDeps = {}): ApiErrorProducer {
  const dbPathOf = deps.dbPath ?? (() => openCodeDbPath());
  const loggedMismatch = new Set<string>();

  /** The database path, only if it really sits inside its own directory (no symlink out). */
  const confinedDb = async (): Promise<string | null> => {
    try {
      const path = dbPathOf();
      const real = await realpath(path);
      return real.startsWith(await realpath(dirname(path)) + sep) ? real : null;
    } catch { return null; }
  };

  const sameDir = async (a: string, b: string): Promise<boolean> => {
    try { return (await realpath(a)) === (await realpath(b)); } catch { return false; }
  };

  const resolveSession = async (db: Db, session: ApiErrorSessionRef): Promise<string | null> => {
    const known = session.openCodeSessionId;
    if (typeof known === 'string' && SESSION_ID.test(known)) {
      const row = db.prepare('SELECT directory FROM session WHERE id = ?').get(known) as { directory: string } | undefined;
      return row && await sameDir(row.directory, session.cwd) ? known : null;
    }
    // The first turn has no id yet: accept exactly one session created in this directory since spawn.
    const created = typeof session.createdAt === 'number' ? session.createdAt - CREATED_SLACK_MS : 0;
    const rows = db.prepare('SELECT id, directory FROM session WHERE parent_id IS NULL AND time_created >= ? ORDER BY time_created ASC LIMIT 20')
      .all(created) as Array<{ id: string; directory: string }>;
    const matches: string[] = [];
    for (const row of rows) if (await sameDir(row.directory, session.cwd)) matches.push(row.id);
    return matches.length === 1 ? matches[0]! : null;
  };

  const withDb = async <T>(session: ApiErrorSessionRef, use: (db: Db) => Promise<T>): Promise<T | null> => {
    if (session.remote) return null;
    const path = await confinedDb();
    if (!path) return null;
    let db: Db | undefined;
    try {
      db = createSqliteDatabase(path, { readonly: true, fileMustExist: true });
      db.pragma('busy_timeout = 250');
      return await use(db);
    } catch (error) {
      if (!loggedMismatch.has(session.id)) {
        loggedMismatch.add(session.id);
        deps.log?.(`[opencode-api-error] read failed: ${(error as Error).message}`);
      }
      return null;
    } finally {
      try { db?.close(); } catch { /* ignore */ }
    }
  };

  return {
    quietMs: deps.quietMs ?? OPENCODE_QUIET_MS,
    async markTurnStart(session): Promise<Marker> {
      const marker = await withDb(session, async (db) => {
        const id = await resolveSession(db, session);
        if (!id) return { since: null };
        const row = db.prepare('SELECT MAX(time_created) AS newest FROM message WHERE session_id = ?').get(id) as { newest: number | null };
        return { since: row.newest ?? null };
      });
      return marker ?? { since: null };
    },
    async check(session, marker): Promise<HarnessInteractionEvent | null> {
      const turn = marker as Marker | undefined;
      if (!turn) return null;
      return withDb(session, async (db) => {
        const id = await resolveSession(db, session);
        if (!id) return null;
        const rows = db.prepare(
          `SELECT data FROM message WHERE session_id = ? AND time_created > ? AND length(data) <= ?
           ORDER BY time_created DESC, id DESC LIMIT 10`
        ).all(id, turn.since ?? -1, MAX_DATA_BYTES) as Array<{ data: string }>;
        for (const row of rows) {
          let parsed: unknown;
          try { parsed = JSON.parse(row.data); } catch { continue; }
          if (record(parsed)?.role !== 'assistant') continue;
          // Only the newest assistant message counts: a later good reply means the turn recovered.
          return failureFromMessage(parsed);
        }
        return null;
      });
    },
    release(sessionId) {
      loggedMismatch.delete(sessionId);
    }
  };
}
