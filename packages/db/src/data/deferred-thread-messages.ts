import type { ZccDatabase } from '../connection.js';
import { createDeferredThreadMessageId } from '../ids.js';

export const DEFERRED_THREAD_MESSAGE_CAP = 50;
export const DEFERRED_RETRY_DELAYS_MS = [15_000, 60_000, 300_000] as const;

export type NextTurnSendStatus = 'queued' | 'dispatching' | 'failed';

export interface DeferredThreadMessageRow {
  id: string;
  threadId: string;
  kind: string;
  payload: string;
  createdAt: number;
  status: NextTurnSendStatus;
  paused: boolean;
  sendAfter: number | null;
  failureReason: string | null;
  failureCount: number;
  retryAt: number | null;
  groupBoundaryId: string | null;
  updatedAt: number;
  /** Absolute epoch ms; a row is held while this is in the future. */
  editHeldUntil: number | null;
}

interface DeferredThreadMessageSqlRow {
  id: string;
  thread_id: string;
  kind: string;
  payload: string;
  created_at: number;
  status?: string | null;
  paused?: number | null;
  send_after?: number | null;
  failure_reason?: string | null;
  failure_count?: number;
  retry_at?: number | null;
  group_boundary_id?: string | null;
  updated_at?: number | null;
  edit_held_until?: number | null;
}

function toStatus(value: string | null | undefined): NextTurnSendStatus {
  if (value === 'dispatching' || value === 'failed') return value;
  return 'queued';
}

function toRow(row: DeferredThreadMessageSqlRow): DeferredThreadMessageRow {
  return {
    id: row.id,
    threadId: row.thread_id,
    kind: row.kind,
    payload: row.payload,
    createdAt: row.created_at,
    status: toStatus(row.status),
    paused: Number(row.paused ?? 0) === 1,
    sendAfter: row.send_after ?? null,
    failureReason: row.failure_reason ?? null,
    failureCount: row.failure_count ?? 0,
    retryAt: row.retry_at ?? null,
    groupBoundaryId: row.group_boundary_id ?? null,
    updatedAt: row.updated_at ?? row.created_at,
    editHeldUntil: row.edit_held_until ?? null
  };
}

export function createDeferredThreadMessage(
  db: ZccDatabase,
  input: {
    threadId: string;
    kind: string;
    payload: string;
    sendAfter?: number | null;
    paused?: boolean;
    groupBoundaryId?: string | null;
  }
): DeferredThreadMessageRow {
  const now = Date.now();
  const row: DeferredThreadMessageRow = {
    id: createDeferredThreadMessageId(),
    threadId: input.threadId,
    kind: input.kind,
    payload: input.payload,
    createdAt: now,
    status: 'queued',
    paused: input.paused === true,
    sendAfter: input.sendAfter ?? null,
    failureReason: null,
    failureCount: 0,
    retryAt: null,
    groupBoundaryId: input.groupBoundaryId ?? null,
    updatedAt: now,
    editHeldUntil: null
  };
  db.sqlite.prepare(
    `INSERT INTO deferred_thread_messages (
       id, thread_id, kind, payload, created_at, status, paused, send_after, failure_reason, group_boundary_id, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.threadId,
    row.kind,
    row.payload,
    row.createdAt,
    row.status,
    row.paused ? 1 : 0,
    row.sendAfter,
    row.failureReason,
    row.groupBoundaryId,
    row.updatedAt
  );
  return row;
}

export function countDeferredThreadMessages(db: ZccDatabase, threadId: string): number {
  const row = db.sqlite.prepare(
    `SELECT COUNT(*) AS count FROM deferred_thread_messages
      WHERE thread_id = ?`
  ).get(threadId) as { count: number };
  return row.count;
}

/** Oldest first so delivery preserves arrival order. */
export function listDeferredThreadMessages(
  db: ZccDatabase,
  threadId: string
): DeferredThreadMessageRow[] {
  return (db.sqlite.prepare(
    `SELECT * FROM deferred_thread_messages
      WHERE thread_id = ?
      ORDER BY created_at ASC, rowid ASC`
  ).all(threadId) as DeferredThreadMessageSqlRow[]).map(toRow);
}

export function getDeferredThreadMessage(
  db: ZccDatabase,
  args: { id: string; threadId: string }
): DeferredThreadMessageRow | null {
  const row = db.sqlite.prepare(
    'SELECT * FROM deferred_thread_messages WHERE id = ? AND thread_id = ?'
  ).get(args.id, args.threadId) as DeferredThreadMessageSqlRow | undefined;
  return row ? toRow(row) : null;
}

export function listDueDeferredThreadMessages(
  db: ZccDatabase,
  args: { threadId?: string; now?: number } = {}
): DeferredThreadMessageRow[] {
  const now = args.now ?? Date.now();
  const sql = args.threadId
    ? `SELECT * FROM deferred_thread_messages
        WHERE thread_id = ? AND status = 'queued' AND paused = 0
          AND (send_after IS NULL OR send_after <= ?)
        ORDER BY created_at ASC, rowid ASC`
    : `SELECT * FROM deferred_thread_messages
        WHERE status = 'queued' AND paused = 0
          AND (send_after IS NULL OR send_after <= ?)
        ORDER BY created_at ASC, rowid ASC`;
  const rows = args.threadId
    ? db.sqlite.prepare(sql).all(args.threadId, now)
    : db.sqlite.prepare(sql).all(now);
  return (rows as DeferredThreadMessageSqlRow[]).map(toRow);
}

export function isThreadQueueAutoSendPaused(db: ZccDatabase, threadId: string): boolean {
  const row = db.sqlite.prepare(
    `SELECT COUNT(*) AS count FROM deferred_thread_messages
      WHERE thread_id = ? AND paused = 1`
  ).get(threadId) as { count: number };
  return row.count > 0;
}

export function pauseDeferredThreadMessagesForThread(db: ZccDatabase, threadId: string): number {
  const result = db.sqlite.prepare(
    `UPDATE deferred_thread_messages
        SET paused = 1, updated_at = ?
      WHERE thread_id = ?`
  ).run(Date.now(), threadId);
  return Number(result.changes ?? 0);
}

export function resumeDeferredThreadMessagesForThread(db: ZccDatabase, threadId: string): number {
  const result = db.sqlite.prepare(
    `UPDATE deferred_thread_messages
        SET paused = 0, updated_at = ?
      WHERE thread_id = ?`
  ).run(Date.now(), threadId);
  return Number(result.changes ?? 0);
}

export function markDeferredThreadMessageFailed(
  db: ZccDatabase,
  args: { id: string; threadId: string; reason: string; retryable?: boolean; now?: number }
): boolean {
  const now = args.now ?? Date.now();
  const result = db.sqlite.prepare(
    `UPDATE deferred_thread_messages
        SET status = 'failed', failure_reason = ?, updated_at = ?,
            retry_at = CASE WHEN ? = 1 THEN CASE failure_count
              WHEN 0 THEN ? WHEN 1 THEN ? WHEN 2 THEN ? ELSE NULL END ELSE NULL END,
            failure_count = failure_count + 1
      WHERE id = ? AND thread_id = ?`
  ).run(args.reason, now, args.retryable ? 1 : 0,
    ...DEFERRED_RETRY_DELAYS_MS.map((delay) => now + delay), args.id, args.threadId);
  return Number(result.changes ?? 0) > 0;
}

export function markDeferredThreadMessageDispatching(
  db: ZccDatabase,
  args: {
    id: string; threadId: string; retryFailed?: boolean; expectedUpdatedAt?: number;
    /** Explicit user sends claim a row whose editor is still open; automatic claims never do. */
    overrideEditHold?: boolean; now?: number;
  }
): boolean {
  const now = args.now ?? Date.now();
  // Any claim ends the lease, so the editor's next renewal learns the row is gone.
  const result = db.sqlite.prepare(
    `UPDATE deferred_thread_messages
        SET status = 'dispatching', updated_at = ?, edit_held_until = NULL
      WHERE id = ? AND thread_id = ? AND (status = 'queued' OR (? = 1 AND status = 'failed'))
        AND (? IS NULL OR updated_at = ?)
        AND (? = 1 OR edit_held_until IS NULL OR edit_held_until <= ?)`
  ).run(
    Date.now(), args.id, args.threadId, args.retryFailed ? 1 : 0,
    args.expectedUpdatedAt ?? null, args.expectedUpdatedAt ?? null,
    args.overrideEditHold ? 1 : 0, now
  );
  return Number(result.changes ?? 0) > 0;
}

/** Claim an entire automatic send group while no earlier send is preparing. */
export function claimDeferredThreadMessageGroup(
  db: ZccDatabase,
  args: { threadId: string; rows: Pick<DeferredThreadMessageRow, 'id' | 'updatedAt'>[]; overrideEditHold?: boolean; now?: number }
): boolean {
  return db.transaction(() => {
    if (args.rows.length === 0 || args.rows.length > DEFERRED_THREAD_MESSAGE_CAP) return false;
    const inFlight = db.sqlite.prepare(
      "SELECT 1 FROM deferred_thread_messages WHERE thread_id = ? AND status = 'dispatching' LIMIT 1"
    ).get(args.threadId);
    if (inFlight) return false;
    const now = args.now ?? Date.now();
    const rows = args.rows.map(row => getDeferredThreadMessage(db, { id: row.id, threadId: args.threadId }));
    // Validate every member before writing so an edited/held member cannot split a group.
    if (new Set(args.rows.map(row => row.id)).size !== args.rows.length || rows.some((row, index) =>
      !row || row.status !== 'queued' || row.updatedAt !== args.rows[index]!.updatedAt
      || (!args.overrideEditHold && row.editHeldUntil !== null && row.editHeldUntil > now)
    )) return false;
    for (const row of args.rows) {
      markDeferredThreadMessageDispatching(db, {
        id: row.id, threadId: args.threadId, expectedUpdatedAt: row.updatedAt,
        overrideEditHold: args.overrideEditHold, now
      });
    }
    return true;
  });
}

export type HoldDeferredThreadMessageForEditResult = 'held' | 'not_found' | 'claimed';

/**
 * Take or renew the edit lease on a waiting row. The revision (`updated_at`) is
 * deliberately untouched so the editor's later save still matches what it opened.
 */
export function holdDeferredThreadMessageForEdit(
  db: ZccDatabase,
  args: { id: string; threadId: string; heldUntil: number }
): HoldDeferredThreadMessageForEditResult {
  const result = db.sqlite.prepare(
    `UPDATE deferred_thread_messages SET edit_held_until = ?
      WHERE id = ? AND thread_id = ? AND status = 'queued'`
  ).run(args.heldUntil, args.id, args.threadId);
  if (Number(result.changes ?? 0) > 0) return 'held';
  return getDeferredThreadMessage(db, args) ? 'claimed' : 'not_found';
}

/** Idempotent; true only when a live or lapsed lease was actually cleared. */
export function releaseDeferredThreadMessageEditHold(
  db: ZccDatabase,
  args: { id: string; threadId: string }
): boolean {
  const result = db.sqlite.prepare(
    `UPDATE deferred_thread_messages SET edit_held_until = NULL
      WHERE id = ? AND thread_id = ? AND edit_held_until IS NOT NULL`
  ).run(args.id, args.threadId);
  return Number(result.changes ?? 0) > 0;
}

export type UpdateDeferredThreadMessagePayloadResult =
  | { kind: 'updated'; row: DeferredThreadMessageRow; releasedEditHold: boolean }
  | { kind: 'not_found' }
  | { kind: 'claimed' }
  | { kind: 'stale' };

/** Save an edit and end its lease in the same write; the revision always moves forward. */
export function updateDeferredThreadMessagePayload(
  db: ZccDatabase,
  args: { id: string; threadId: string; payload: string; expectedUpdatedAt?: number; now?: number }
): UpdateDeferredThreadMessagePayloadResult {
  return db.transaction((): UpdateDeferredThreadMessagePayloadResult => {
    const existing = getDeferredThreadMessage(db, args);
    if (!existing) return { kind: 'not_found' };
    if (existing.status !== 'queued') return { kind: 'claimed' };
    if (args.expectedUpdatedAt !== undefined && existing.updatedAt !== args.expectedUpdatedAt) return { kind: 'stale' };
    const updatedAt = Math.max(args.now ?? Date.now(), existing.updatedAt + 1);
    db.sqlite.prepare(
      `UPDATE deferred_thread_messages SET payload = ?, updated_at = ?, edit_held_until = NULL
        WHERE id = ? AND thread_id = ? AND status = 'queued'`
    ).run(args.payload, updatedAt, args.id, args.threadId);
    return {
      kind: 'updated',
      row: { ...existing, payload: args.payload, updatedAt, editHeldUntil: null },
      releasedEditHold: existing.editHeldUntil !== null
    };
  });
}

/**
 * Forget leases that ran out so the abandoned row can drain; returns each
 * affected thread once. Bounded so a backlog cannot stall the event loop.
 */
export function clearLapsedDeferredEditHolds(db: ZccDatabase, now = Date.now(), limit = 100): string[] {
  return db.transaction(() => {
    const lapsed = db.sqlite.prepare(
      `SELECT id, thread_id FROM deferred_thread_messages
        WHERE edit_held_until IS NOT NULL AND edit_held_until <= ?
        ORDER BY edit_held_until ASC LIMIT ?`
    ).all(now, limit) as Array<{ id: string; thread_id: string }>;
    const clear = db.sqlite.prepare(
      'UPDATE deferred_thread_messages SET edit_held_until = NULL WHERE id = ? AND edit_held_until <= ?'
    );
    for (const row of lapsed) clear.run(row.id, now);
    return [...new Set(lapsed.map((row) => row.thread_id))];
  });
}

/** Admission wait retains the original row and any concurrent Stop pause. */
export function holdDeferredThreadMessage(
  db: ZccDatabase,
  args: { id: string; threadId: string; payload: string }
): boolean {
  const result = db.sqlite.prepare(
    `UPDATE deferred_thread_messages SET status = 'queued', payload = ?, updated_at = ?
      WHERE id = ? AND thread_id = ? AND status = 'dispatching'`
  ).run(args.payload, Date.now(), args.id, args.threadId);
  return Number(result.changes ?? 0) > 0;
}

export function deleteDeferredThreadMessage(
  db: ZccDatabase,
  args: { id: string; threadId: string }
): boolean {
  const result = db.sqlite.prepare(
    'DELETE FROM deferred_thread_messages WHERE id = ? AND thread_id = ?'
  ).run(args.id, args.threadId);
  return Number(result.changes ?? 0) > 0;
}

export function deleteDeferredThreadMessagesForThread(db: ZccDatabase, threadId: string): number {
  const result = db.sqlite.prepare(
    'DELETE FROM deferred_thread_messages WHERE thread_id = ?'
  ).run(threadId);
  return Number(result.changes ?? 0);
}

/** Explicit recovery never steals a row from an in-flight dispatcher. */
export function requeueDeferredThreadMessagesForThread(db: ZccDatabase, threadId: string): number {
  const result = db.sqlite.prepare(
    `UPDATE deferred_thread_messages
        SET status = 'queued', paused = 0, failure_reason = NULL, failure_count = 0, retry_at = NULL, updated_at = ?
      WHERE thread_id = ? AND status = 'failed'`
  ).run(Date.now(), threadId);
  return Number(result.changes ?? 0);
}

export function countActiveConversationTurns(db: ZccDatabase): number {
  const row = db.sqlite.prepare(
    `SELECT COUNT(*) AS count FROM threads
      WHERE archived_at IS NULL AND status IN ('starting', 'active')`
  ).get() as { count: number };
  return row.count;
}

/** Bounded retry sweep; ordinary queue drains never revive failures. */
export function listRetryableDeferredThreadMessages(db: ZccDatabase, now = Date.now()): DeferredThreadMessageRow[] {
  return (db.sqlite.prepare(`SELECT * FROM deferred_thread_messages
    WHERE status = 'failed' AND paused = 0 AND retry_at <= ?
    ORDER BY retry_at, created_at LIMIT 100`).all(now) as DeferredThreadMessageSqlRow[]).map(toRow);
}

export function retryDeferredThreadMessage(db: ZccDatabase, row: DeferredThreadMessageRow, now = Date.now()): boolean {
  return db.sqlite.prepare(`UPDATE deferred_thread_messages
    SET status = 'queued', failure_reason = NULL, retry_at = NULL, updated_at = ?
    WHERE id = ? AND thread_id = ? AND status = 'failed' AND paused = 0 AND retry_at <= ?`)
    .run(now, row.id, row.threadId, now).changes > 0;
}

/** Rotate blocked candidates behind other due work without spending a retry attempt. */
export function postponeDeferredThreadRetry(db: ZccDatabase, row: DeferredThreadMessageRow, now: number): void {
  db.sqlite.prepare(`UPDATE deferred_thread_messages SET retry_at = ?
    WHERE id = ? AND thread_id = ? AND status = 'failed' AND retry_at <= ?`)
    .run(now + 5_000, row.id, row.threadId, now);
}

/** A restarted server cannot know whether an interrupted RPC reached the host. */
export function recoverInterruptedDeferredThreadMessages(db: ZccDatabase): number {
  return db.sqlite.prepare(`UPDATE deferred_thread_messages
    SET status = 'failed', retry_at = NULL, updated_at = ?,
        failure_reason = 'Server restarted during send. Check the conversation before retrying.'
    WHERE status = 'dispatching'`).run(Date.now()).changes;
}
