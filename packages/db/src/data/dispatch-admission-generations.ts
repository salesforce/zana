import type { ZccDatabase } from '../connection.js';

export interface DispatchAdmissionGenerationRow {
  threadId: string;
  generation: number;
  overrideable: boolean;
  reason: string | null;
  updatedAt: number;
}

interface DispatchAdmissionGenerationSqlRow {
  thread_id: string;
  generation: number;
  overrideable: number;
  reason: string | null;
  updated_at: number;
}

function toRow(row: DispatchAdmissionGenerationSqlRow): DispatchAdmissionGenerationRow {
  return {
    threadId: row.thread_id,
    generation: row.generation,
    overrideable: row.overrideable === 1,
    reason: row.reason,
    updatedAt: row.updated_at
  };
}

/** Current wait generation for a thread, or null when no wait is recorded (dispatch open). */
export function getDispatchAdmissionGeneration(db: ZccDatabase, threadId: string): DispatchAdmissionGenerationRow | null {
  const row = db.sqlite.prepare(
    'SELECT * FROM dispatch_admission_generations WHERE thread_id = ?'
  ).get(threadId) as DispatchAdmissionGenerationSqlRow | undefined;
  return row ? toRow(row) : null;
}

/** Bump the thread's generation on every wait decision; this is the version an override must match. */
export function recordDispatchAdmissionWait(
  db: ZccDatabase,
  args: { threadId: string; overrideable: boolean; reason: string }
): DispatchAdmissionGenerationRow {
  const now = Date.now();
  db.sqlite.prepare(
    `INSERT INTO dispatch_admission_generations (thread_id, generation, overrideable, reason, updated_at)
     VALUES (?, 1, ?, ?, ?)
     ON CONFLICT (thread_id) DO UPDATE SET
       generation = generation + 1, overrideable = excluded.overrideable,
       reason = excluded.reason, updated_at = excluded.updated_at`
  ).run(args.threadId, args.overrideable ? 1 : 0, args.reason, now);
  return getDispatchAdmissionGeneration(db, args.threadId)!;
}

/** Clear the recorded wait once dispatch proceeds normally, so a later wait starts a fresh lineage check. */
export function clearDispatchAdmissionGeneration(db: ZccDatabase, threadId: string): void {
  db.sqlite.prepare('DELETE FROM dispatch_admission_generations WHERE thread_id = ?').run(threadId);
}

/**
 * CAS consume of a specific wait generation for an authenticated human override.
 * Returns false when the generation is stale (another wait superseded it) or no wait is on record.
 */
export function consumeDispatchAdmissionOverride(
  db: ZccDatabase,
  args: { threadId: string; generation: number }
): boolean {
  const result = db.sqlite.prepare(
    `DELETE FROM dispatch_admission_generations WHERE thread_id = ? AND generation = ? AND overrideable = 1`
  ).run(args.threadId, args.generation);
  return Number(result.changes ?? 0) > 0;
}
