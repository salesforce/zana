import type { ZccDatabase } from '../connection.js';
import {
  createThreadPlanId,
  createThreadPlanReferenceId,
  createThreadPlanRevisionId,
  createThreadPlanTaskId
} from '../ids.js';

export type ThreadPlanStatus = 'draft' | 'active' | 'completed';
export type ThreadPlanTaskStatus = 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
export type ThreadPlanTaskOwnerKind = 'user' | 'provider';

export interface ThreadPlanRow {
  id: string;
  rootThreadId: string;
  status: ThreadPlanStatus;
  filePath: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ThreadPlanRevisionRow {
  id: string;
  planId: string;
  sequence: number;
  markdown: string;
  source: string;
  createdAt: number;
}

export interface ThreadPlanTaskRow {
  id: string;
  planId: string;
  text: string;
  status: ThreadPlanTaskStatus;
  sortOrder: number;
  ownerKind: ThreadPlanTaskOwnerKind;
  providerKey: string | null;
  startedAt: number | null;
  owningThreadId: string | null;
  latestActivity: string | null;
  blockedReason: string | null;
  userEdited: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ThreadPlanReferenceRow {
  id: string;
  planId: string;
  taskId: string | null;
  threadId: string;
  createdAt: number;
}

export interface ThreadExecutionStateRow {
  threadId: string;
  requestedMode: string | null;
  effectiveMode: string | null;
  updatedAt: number;
}

export function getThreadExecutionState(
  db: ZccDatabase,
  threadId: string
): ThreadExecutionStateRow | null {
  const row = db.sqlite.prepare(
    'SELECT * FROM thread_execution_state WHERE thread_id = ?'
  ).get(threadId) as {
    thread_id: string;
    requested_mode: string | null;
    effective_mode: string | null;
    updated_at: number;
  } | undefined;
  if (!row) return null;
  return {
    threadId: row.thread_id,
    requestedMode: row.requested_mode,
    effectiveMode: row.effective_mode,
    updatedAt: row.updated_at
  };
}

export function upsertThreadExecutionState(
  db: ZccDatabase,
  input: { threadId: string; requestedMode?: string | null; effectiveMode?: string | null }
): ThreadExecutionStateRow {
  const now = Date.now();
  const current = getThreadExecutionState(db, input.threadId);
  const requested = input.requestedMode === undefined ? current?.requestedMode ?? null : input.requestedMode;
  const effective = input.effectiveMode === undefined ? current?.effectiveMode ?? null : input.effectiveMode;
  db.sqlite.prepare(
    `INSERT INTO thread_execution_state (thread_id, requested_mode, effective_mode, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(thread_id) DO UPDATE SET
       requested_mode = excluded.requested_mode,
       effective_mode = excluded.effective_mode,
       updated_at = excluded.updated_at`
  ).run(input.threadId, requested, effective, now);
  return {
    threadId: input.threadId,
    requestedMode: requested,
    effectiveMode: effective,
    updatedAt: now
  };
}

function toPlan(row: {
  id: string;
  root_thread_id: string;
  status: ThreadPlanStatus;
  file_path?: string | null;
  created_at: number;
  updated_at: number;
}): ThreadPlanRow {
  return {
    id: row.id,
    rootThreadId: row.root_thread_id,
    status: row.status,
    filePath: row.file_path ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function getThreadPlanByRootThread(
  db: ZccDatabase,
  rootThreadId: string
): ThreadPlanRow | null {
  const row = db.sqlite.prepare(
    'SELECT * FROM thread_plans WHERE root_thread_id = ?'
  ).get(rootThreadId) as Parameters<typeof toPlan>[0] | undefined;
  return row ? toPlan(row) : null;
}

export function getThreadPlan(db: ZccDatabase, planId: string): ThreadPlanRow | null {
  const row = db.sqlite.prepare('SELECT * FROM thread_plans WHERE id = ?').get(planId) as
    | Parameters<typeof toPlan>[0]
    | undefined;
  return row ? toPlan(row) : null;
}

export function createThreadPlan(
  db: ZccDatabase,
  input: { rootThreadId: string; status?: ThreadPlanStatus }
): ThreadPlanRow {
  const now = Date.now();
  const row: ThreadPlanRow = {
    id: createThreadPlanId(),
    rootThreadId: input.rootThreadId,
    status: input.status ?? 'draft',
    filePath: null,
    createdAt: now,
    updatedAt: now
  };
  db.sqlite.prepare(
    `INSERT INTO thread_plans (id, root_thread_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(row.id, row.rootThreadId, row.status, row.createdAt, row.updatedAt);
  return row;
}

export function touchThreadPlan(db: ZccDatabase, planId: string, status?: ThreadPlanStatus): void {
  if (status) {
    db.sqlite.prepare(
      'UPDATE thread_plans SET status = ?, updated_at = ? WHERE id = ?'
    ).run(status, Date.now(), planId);
    return;
  }
  db.sqlite.prepare('UPDATE thread_plans SET updated_at = ? WHERE id = ?').run(Date.now(), planId);
}

export function updateThreadPlanFilePath(
  db: ZccDatabase,
  planId: string,
  filePath: string | null
): void {
  db.sqlite.prepare(
    'UPDATE thread_plans SET file_path = ?, updated_at = ? WHERE id = ?'
  ).run(filePath, Date.now(), planId);
}

export function listThreadPlanRevisions(db: ZccDatabase, planId: string): ThreadPlanRevisionRow[] {
  return (db.sqlite.prepare(
    `SELECT * FROM thread_plan_revisions WHERE plan_id = ? ORDER BY sequence ASC`
  ).all(planId) as Array<{
    id: string;
    plan_id: string;
    sequence: number;
    markdown: string;
    source: string;
    created_at: number;
  }>).map((row) => ({
    id: row.id,
    planId: row.plan_id,
    sequence: row.sequence,
    markdown: row.markdown,
    source: row.source,
    createdAt: row.created_at
  }));
}

export function latestThreadPlanRevision(
  db: ZccDatabase,
  planId: string
): ThreadPlanRevisionRow | null {
  const row = db.sqlite.prepare(
    `SELECT * FROM thread_plan_revisions WHERE plan_id = ? ORDER BY sequence DESC LIMIT 1`
  ).get(planId) as {
    id: string;
    plan_id: string;
    sequence: number;
    markdown: string;
    source: string;
    created_at: number;
  } | undefined;
  if (!row) return null;
  return {
    id: row.id,
    planId: row.plan_id,
    sequence: row.sequence,
    markdown: row.markdown,
    source: row.source,
    createdAt: row.created_at
  };
}

export function appendThreadPlanRevision(
  db: ZccDatabase,
  input: { planId: string; markdown: string; source: string }
): ThreadPlanRevisionRow {
  const latest = latestThreadPlanRevision(db, input.planId);
  const sequence = (latest?.sequence ?? 0) + 1;
  const row: ThreadPlanRevisionRow = {
    id: createThreadPlanRevisionId(),
    planId: input.planId,
    sequence,
    markdown: input.markdown,
    source: input.source,
    createdAt: Date.now()
  };
  db.sqlite.prepare(
    `INSERT INTO thread_plan_revisions (id, plan_id, sequence, markdown, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(row.id, row.planId, row.sequence, row.markdown, row.source, row.createdAt);
  touchThreadPlan(db, input.planId);
  return row;
}

function toTask(row: {
  id: string;
  plan_id: string;
  text: string;
  status: ThreadPlanTaskStatus;
  sort_order: number;
  owner_kind: ThreadPlanTaskOwnerKind;
  provider_key: string | null;
  started_at: number | null;
  owning_thread_id: string | null;
  latest_activity: string | null;
  blocked_reason: string | null;
  user_edited: number;
  created_at: number;
  updated_at: number;
}): ThreadPlanTaskRow {
  return {
    id: row.id,
    planId: row.plan_id,
    text: row.text,
    status: row.status,
    sortOrder: row.sort_order,
    ownerKind: row.owner_kind,
    providerKey: row.provider_key,
    startedAt: row.started_at,
    owningThreadId: row.owning_thread_id,
    latestActivity: row.latest_activity,
    blockedReason: row.blocked_reason,
    userEdited: row.user_edited === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listThreadPlanTasks(db: ZccDatabase, planId: string): ThreadPlanTaskRow[] {
  return (db.sqlite.prepare(
    `SELECT * FROM thread_plan_tasks WHERE plan_id = ? ORDER BY sort_order ASC, id ASC`
  ).all(planId) as Parameters<typeof toTask>[0][]).map(toTask);
}

export function getThreadPlanTask(db: ZccDatabase, taskId: string): ThreadPlanTaskRow | null {
  const row = db.sqlite.prepare('SELECT * FROM thread_plan_tasks WHERE id = ?').get(taskId) as
    | Parameters<typeof toTask>[0]
    | undefined;
  return row ? toTask(row) : null;
}

export function createThreadPlanTask(
  db: ZccDatabase,
  input: {
    planId: string;
    text: string;
    status?: ThreadPlanTaskStatus;
    ownerKind?: ThreadPlanTaskOwnerKind;
    providerKey?: string | null;
    sortOrder?: number;
    userEdited?: boolean;
  }
): ThreadPlanTaskRow {
  const now = Date.now();
  const max = db.sqlite.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) AS n FROM thread_plan_tasks WHERE plan_id = ?'
  ).get(input.planId) as { n: number };
  const row: ThreadPlanTaskRow = {
    id: createThreadPlanTaskId(),
    planId: input.planId,
    text: input.text,
    status: input.status ?? 'pending',
    sortOrder: input.sortOrder ?? max.n + 1,
    ownerKind: input.ownerKind ?? 'user',
    providerKey: input.providerKey ?? null,
    startedAt: null,
    owningThreadId: null,
    latestActivity: null,
    blockedReason: null,
    userEdited: input.userEdited === true,
    createdAt: now,
    updatedAt: now
  };
  db.sqlite.prepare(
    `INSERT INTO thread_plan_tasks (
       id, plan_id, text, status, sort_order, owner_kind, provider_key, started_at,
       owning_thread_id, latest_activity, blocked_reason, user_edited, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.planId,
    row.text,
    row.status,
    row.sortOrder,
    row.ownerKind,
    row.providerKey,
    row.startedAt,
    row.owningThreadId,
    row.latestActivity,
    row.blockedReason,
    row.userEdited ? 1 : 0,
    row.createdAt,
    row.updatedAt
  );
  touchThreadPlan(db, input.planId);
  return row;
}

export function updateThreadPlanTask(
  db: ZccDatabase,
  taskId: string,
  patch: Partial<{
    text: string;
    status: ThreadPlanTaskStatus;
    sortOrder: number;
    ownerKind: ThreadPlanTaskOwnerKind;
    providerKey: string | null;
    startedAt: number | null;
    owningThreadId: string | null;
    latestActivity: string | null;
    blockedReason: string | null;
    userEdited: boolean;
  }>
): ThreadPlanTaskRow | null {
  const current = getThreadPlanTask(db, taskId);
  if (!current) return null;
  const next: ThreadPlanTaskRow = {
    ...current,
    text: patch.text ?? current.text,
    status: patch.status ?? current.status,
    sortOrder: patch.sortOrder ?? current.sortOrder,
    ownerKind: patch.ownerKind ?? current.ownerKind,
    providerKey: patch.providerKey === undefined ? current.providerKey : patch.providerKey,
    startedAt: patch.startedAt === undefined ? current.startedAt : patch.startedAt,
    owningThreadId: patch.owningThreadId === undefined ? current.owningThreadId : patch.owningThreadId,
    latestActivity: patch.latestActivity === undefined ? current.latestActivity : patch.latestActivity,
    blockedReason: patch.blockedReason === undefined ? current.blockedReason : patch.blockedReason,
    userEdited: patch.userEdited ?? current.userEdited,
    updatedAt: Date.now()
  };
  db.sqlite.prepare(
    `UPDATE thread_plan_tasks
        SET text = ?, status = ?, sort_order = ?, owner_kind = ?, provider_key = ?,
            started_at = ?, owning_thread_id = ?, latest_activity = ?, blocked_reason = ?,
            user_edited = ?, updated_at = ?
      WHERE id = ?`
  ).run(
    next.text,
    next.status,
    next.sortOrder,
    next.ownerKind,
    next.providerKey,
    next.startedAt,
    next.owningThreadId,
    next.latestActivity,
    next.blockedReason,
    next.userEdited ? 1 : 0,
    next.updatedAt,
    taskId
  );
  touchThreadPlan(db, current.planId);
  return next;
}

export function listThreadPlanReferences(db: ZccDatabase, planId: string): ThreadPlanReferenceRow[] {
  return (db.sqlite.prepare(
    `SELECT * FROM thread_plan_references WHERE plan_id = ? ORDER BY created_at ASC, rowid ASC`
  ).all(planId) as Array<{
    id: string;
    plan_id: string;
    task_id: string | null;
    thread_id: string;
    created_at: number;
  }>).map((row) => ({
    id: row.id,
    planId: row.plan_id,
    taskId: row.task_id,
    threadId: row.thread_id,
    createdAt: row.created_at
  }));
}

export function addThreadPlanReference(
  db: ZccDatabase,
  input: { planId: string; threadId: string; taskId?: string | null }
): ThreadPlanReferenceRow {
  const existing = db.sqlite.prepare(
    `SELECT * FROM thread_plan_references
      WHERE plan_id = ? AND thread_id = ? AND ifnull(task_id, '') = ifnull(?, '')`
  ).get(input.planId, input.threadId, input.taskId ?? null) as {
    id: string;
    plan_id: string;
    task_id: string | null;
    thread_id: string;
    created_at: number;
  } | undefined;
  if (existing) {
    return {
      id: existing.id,
      planId: existing.plan_id,
      taskId: existing.task_id,
      threadId: existing.thread_id,
      createdAt: existing.created_at
    };
  }
  const row: ThreadPlanReferenceRow = {
    id: createThreadPlanReferenceId(),
    planId: input.planId,
    taskId: input.taskId ?? null,
    threadId: input.threadId,
    createdAt: Date.now()
  };
  db.sqlite.prepare(
    `INSERT INTO thread_plan_references (id, plan_id, task_id, thread_id, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(row.id, row.planId, row.taskId, row.threadId, row.createdAt);
  return row;
}
