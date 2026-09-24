import {
  addThreadPlanReference,
  appendThreadPlanRevision,
  createThreadPlan,
  createThreadPlanTask,
  deleteProviderThreadPlanTask,
  getConversationThread,
  getEnvironment,
  getThreadExecutionState,
  getThreadPlanByRootThread,
  getThreadPlanTask,
  listConversationThreadEventsWindow,
  getConversationTurnStart,
  appendConversationThreadEvent,
  listThreadPlanReferences,
  listThreadPlanTasks,
  latestThreadPlanRevision,
  touchThreadPlan,
  updateThreadPlanFilePath,
  updateThreadPlanTask,
  upsertThreadExecutionState,
  type ThreadPlanStatus,
  type ThreadPlanTaskRow,
  type ThreadPlanTaskStatus,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import { foldTodoPlanSnapshot, type TodoPlanFoldState } from '@zana-ai/zcc-domain/thread-runtime';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import { isPlanExecutionMode, requestedExecutionModeFromTurn } from './conversation-execution-mode.js';
import { isSubstantialPlanDraft, writeThreadPlanFile } from './thread-plan-files.js';

export interface DurableThreadPlanView {
  id: string;
  rootThreadId: string;
  status: string;
  markdown: string | null;
  filePath: string | null;
  revision: number;
  revisionSource: string | null;
  createdAt: number;
  updatedAt: number;
  requestedExecutionMode: string | null;
  effectiveExecutionMode: string | null;
  executionModeMismatch: boolean;
  tasks: Array<{
    id: string;
    text: string;
    status: ThreadPlanTaskStatus;
    sortOrder: number;
    ownerKind: string;
    owningThreadId: string | null;
    startedAt: number | null;
    latestActivity: string | null;
    blockedReason: string | null;
    userEdited: boolean;
  }>;
  progress: { completed: number; total: number };
  processing: {
    taskId: string;
    text: string;
    owningThreadId: string | null;
    startedAt: number | null;
    latestActivity: string | null;
  } | null;
  referencedBy: Array<{
    threadId: string;
    taskId: string | null;
    title: string;
    role: 'Author' | 'Agent';
    todosAssigned: number;
  }>;
}

export function deriveThreadPlanStatus(tasks: readonly ThreadPlanTaskRow[]): ThreadPlanStatus {
  if (tasks.some((task) => task.status === 'in_progress')) return 'active';
  const open = tasks.filter((task) => task.status !== 'cancelled');
  if (open.length > 0 && open.every((task) => task.status === 'completed')) return 'completed';
  if (tasks.some((task) => task.status === 'pending' || task.status === 'blocked')) return 'active';
  if (tasks.some((task) => task.status === 'completed')) return 'completed';
  return 'draft';
}

function reconcileThreadPlanStatus(
  db: ZccDatabase,
  planId: string,
  tasks?: ThreadPlanTaskRow[]
): void {
  const rows = tasks ?? listThreadPlanTasks(db, planId);
  touchThreadPlan(db, planId, deriveThreadPlanStatus(rows));
}

function referencedAgentViews(
  db: ZccDatabase,
  plan: { id: string; rootThreadId: string },
  tasks: readonly ThreadPlanTaskRow[]
): DurableThreadPlanView['referencedBy'] {
  const seen = new Set<string>();
  const refs: DurableThreadPlanView['referencedBy'] = [];
  for (const row of listThreadPlanReferences(db, plan.id)) {
    if (seen.has(row.threadId)) continue;
    seen.add(row.threadId);
    const thread = getConversationThread(db, row.threadId);
    const role = row.threadId === plan.rootThreadId ? 'Author' as const : 'Agent' as const;
    const owned = tasks.filter((task) => task.owningThreadId === row.threadId).length;
    const claimed = tasks.some((task) => task.owningThreadId);
    refs.push({
      threadId: row.threadId,
      taskId: row.taskId,
      title: thread?.title?.trim() || 'Untitled agent',
      role,
      todosAssigned: owned > 0 ? owned : (role === 'Author' && !claimed ? tasks.length : 0)
    });
  }
  return refs.sort((left, right) => {
    if (left.role !== right.role) return left.role === 'Author' ? -1 : 1;
    return left.threadId.localeCompare(right.threadId);
  });
}

function rootThreadIdFor(db: ZccDatabase, threadId: string): string {
  const thread = getConversationThread(db, threadId);
  return thread?.parentThreadId ?? threadId;
}

export function ensureDraftThreadPlan(db: ZccDatabase, threadId: string) {
  const rootThreadId = rootThreadIdFor(db, threadId);
  const existing = getThreadPlanByRootThread(db, rootThreadId);
  if (existing) {
    addThreadPlanReference(db, { planId: existing.id, threadId });
    return existing;
  }
  const created = createThreadPlan(db, { rootThreadId, status: 'draft' });
  addThreadPlanReference(db, { planId: created.id, threadId: rootThreadId });
  if (threadId !== rootThreadId) {
    addThreadPlanReference(db, { planId: created.id, threadId });
  }
  return created;
}

export function recordThreadExecutionMode(
  db: ZccDatabase,
  input: { threadId: string; requestedMode?: string | null; effectiveMode?: string | null }
): void {
  upsertThreadExecutionState(db, input);
  if (isPlanExecutionMode(input.requestedMode) || isPlanExecutionMode(input.effectiveMode)) {
    ensureDraftThreadPlan(db, input.threadId);
  }
}

export function snapshotApprovedPlan(
  db: ZccDatabase,
  args: { threadId: string; markdown: string; source?: string }
): void {
  const trimmed = args.markdown.trim();
  if (!trimmed) return;
  const plan = ensureDraftThreadPlan(db, args.threadId);
  const latest = latestThreadPlanRevision(db, plan.id);
  if (!latest || latest.markdown !== trimmed) {
    appendThreadPlanRevision(db, {
      planId: plan.id,
      markdown: trimmed,
      source: args.source ?? 'approval'
    });
  }
  persistPlanFile(db, args.threadId, trimmed, plan.filePath);
  reconcileThreadPlanStatus(db, plan.id);
}

function normalizeProviderStatus(status: string | undefined): ThreadPlanTaskStatus {
  if (status === 'active' || status === 'in_progress') return 'in_progress';
  if (status === 'completed') return 'completed';
  if (status === 'cancelled' || status === 'canceled') return 'cancelled';
  if (status === 'blocked' || status === 'failed' || status === 'interrupted') return 'blocked';
  return 'pending';
}

function providerKeyFor(step: string, index: number): string {
  return `idx:${index}:${step.trim().toLowerCase().slice(0, 80)}`;
}

export function importProviderPlanSteps(
  db: ZccDatabase,
  args: {
    threadId: string;
    steps: Array<{ step: string; status?: string }>;
    owningThreadId?: string;
  }
): void {
  const previous = getThreadPlanByRootThread(db, rootThreadIdFor(db, args.threadId));
  if (!previous && args.steps.length === 0) return;
  const plan = ensureDraftThreadPlan(db, args.threadId);
  const sourceThread = args.owningThreadId ?? args.threadId;
  const existing = listThreadPlanTasks(db, plan.id).filter(task =>
    task.ownerKind === 'provider' && (task.owningThreadId === sourceThread
      || (task.owningThreadId === null && sourceThread === plan.rootThreadId)));
  const used = new Set<string>();
  db.sqlite.transaction(() => {
    args.steps.forEach((step, index) => {
      const text = step.step.trim();
      if (!text) return;
      const key = providerKeyFor(text, index);
      const match = existing.find(task => !used.has(task.id) && task.providerKey === key)
        ?? existing.find(task => !used.has(task.id) && !task.userEdited && task.text.trim() === text);
      const status = normalizeProviderStatus(step.status);
      if (match) {
        used.add(match.id);
        if (match.userEdited) return;
        updateThreadPlanTask(db, match.id, {
          text, status, providerKey: key, sortOrder: index,
          startedAt: status === 'in_progress' ? match.startedAt ?? Date.now() : match.startedAt,
          owningThreadId: sourceThread,
          latestActivity: status === 'in_progress' ? 'provider-plan-steps' : match.latestActivity,
          blockedReason: status === 'blocked' ? 'interrupted' : null
        });
        return;
      }
      const created = createThreadPlanTask(db, { planId: plan.id, text, status,
        ownerKind: 'provider', providerKey: key, sortOrder: index });
      updateThreadPlanTask(db, created.id, {
        owningThreadId: sourceThread,
        ...(status === 'in_progress' ? { startedAt: Date.now(), latestActivity: 'provider-plan-steps' } : {})
      });
    });
    for (const task of existing) {
      if (!used.has(task.id) && !task.userEdited) deleteProviderThreadPlanTask(db, task.id);
    }
  })();
  reconcileThreadPlanStatus(db, plan.id);
}

export function markOwningThreadPlanTasksInterrupted(db: ZccDatabase, threadId: string): void {
  const plan = getThreadPlanByRootThread(db, rootThreadIdFor(db, threadId));
  if (!plan) return;
  for (const task of listThreadPlanTasks(db, plan.id)) {
    if (task.owningThreadId !== threadId || task.status !== 'in_progress') continue;
    updateThreadPlanTask(db, task.id, {
      status: 'blocked',
      blockedReason: 'interrupted',
      latestActivity: 'thread-stopped'
    });
  }
  reconcileThreadPlanStatus(db, plan.id);
}

function taskProgress(tasks: ThreadPlanTaskRow[]): { completed: number; total: number } {
  return {
    completed: tasks.filter((task) => task.status === 'completed').length,
    total: tasks.length
  };
}

export function getDurableThreadPlanView(
  db: ZccDatabase,
  threadId: string
): DurableThreadPlanView | null {
  const plan = getThreadPlanByRootThread(db, rootThreadIdFor(db, threadId));
  if (!plan) return null;
  const revision = latestThreadPlanRevision(db, plan.id);
  const tasks = listThreadPlanTasks(db, plan.id);
  const execution = getThreadExecutionState(db, threadId);
  const processing = tasks.find((task) => task.status === 'in_progress') ?? null;
  return {
    id: plan.id,
    rootThreadId: plan.rootThreadId,
    status: plan.status,
    markdown: revision?.markdown ?? null,
    filePath: plan.filePath,
    revision: revision?.sequence ?? 0,
    revisionSource: revision?.source ?? null,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    requestedExecutionMode: execution?.requestedMode ?? null,
    effectiveExecutionMode: execution?.effectiveMode ?? null,
    executionModeMismatch: Boolean(
      execution?.requestedMode
      && execution.effectiveMode
      && execution.requestedMode !== execution.effectiveMode
    ),
    tasks: tasks.map((task) => ({
      id: task.id,
      text: task.text,
      status: task.status,
      sortOrder: task.sortOrder,
      ownerKind: task.ownerKind,
      owningThreadId: task.owningThreadId,
      startedAt: task.startedAt,
      latestActivity: task.latestActivity,
      blockedReason: task.blockedReason,
      userEdited: task.userEdited
    })),
    progress: taskProgress(tasks),
    processing: processing
      ? {
        taskId: processing.id,
        text: processing.text,
        owningThreadId: processing.owningThreadId,
        startedAt: processing.startedAt,
        latestActivity: processing.latestActivity
      }
      : null,
    referencedBy: referencedAgentViews(db, plan, tasks)
  };
}

export function addUserPlanTask(
  ctx: ProductHttpContext,
  threadId: string,
  text: string
): DurableThreadPlanView {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  const plan = ensureDraftThreadPlan(ctx.db, threadId);
  createThreadPlanTask(ctx.db, {
    planId: plan.id,
    text: text.trim(),
    ownerKind: 'user',
    userEdited: true
  });
  reconcileThreadPlanStatus(ctx.db, plan.id);
  return getDurableThreadPlanView(ctx.db, threadId)!;
}

export function updateUserPlanTask(
  ctx: ProductHttpContext,
  threadId: string,
  taskId: string,
  patch: { text?: string; status?: ThreadPlanTaskStatus; sortOrder?: number }
): DurableThreadPlanView {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  const plan = getThreadPlanByRootThread(ctx.db, rootThreadIdFor(ctx.db, threadId));
  if (!plan) throw new ThreadCreateError(404, 'unknown-plan', 'thread has no plan');
  const task = getThreadPlanTask(ctx.db, taskId);
  if (!task || task.planId !== plan.id) {
    throw new ThreadCreateError(404, 'unknown-task', 'plan task is not registered');
  }
  const updated = updateThreadPlanTask(ctx.db, taskId, {
    ...patch,
    userEdited: true
  });
  if (!updated || updated.planId !== plan.id) {
    throw new ThreadCreateError(404, 'unknown-task', 'plan task is not registered');
  }
  reconcileThreadPlanStatus(ctx.db, plan.id);
  return getDurableThreadPlanView(ctx.db, threadId)!;
}

export function updateUserPlanMarkdown(
  ctx: ProductHttpContext,
  threadId: string,
  markdown: string
): DurableThreadPlanView {
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread) throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
  snapshotApprovedPlan(ctx.db, { threadId, markdown, source: 'user' });
  return getDurableThreadPlanView(ctx.db, threadId)!;
}

type CompletedPlanItem = {
  itemType: string;
  item: Record<string, unknown>;
  turnId: string | null;
  index: number;
};

export function syncPlanFromLatestEvents(db: ZccDatabase, threadId: string): void {
  // Bound completed items separately so streamed deltas cannot evict the final reply.
  const rows = listConversationThreadEventsWindow(db, threadId, { limit: 400, type: 'item/completed' });
  const completed: CompletedPlanItem[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const parsed = completedItemFromPayload(rows[index]?.payload);
    if (!parsed) continue;
    completed.push({ ...parsed, index: rows[index]!.sequence });
  }
  let steps: Array<{ step: string; status?: string }> | null = null;
  const todos: TodoPlanFoldState = new Map();
  for (const row of completed) {
    if (row.itemType === 'planSteps') {
      steps = planStepsFromItem(row.item);
      todos.clear();
    } else if (row.itemType === 'toolCall') {
      const snapshot = foldTodoPlanSnapshot(todos, row.item.arguments);
      if (snapshot !== null) steps = snapshot;
    }
  }
  if (steps !== null) {
    importProviderPlanSteps(db, { threadId, steps, owningThreadId: threadId });
  }
  const draft = resolveProviderPlanMarkdown(db, threadId, completed);
  if (!draft) return;
  snapshotApprovedPlan(db, { threadId, markdown: draft.markdown, source: draft.source });
  appendConversationThreadEvent(db, { threadId, type: 'plan/document/captured', payload: { sourceSequence: draft.index } });
}

function persistPlanFile(
  db: ZccDatabase,
  threadId: string,
  markdown: string,
  existingPath: string | null
): void {
  const thread = getConversationThread(db, threadId);
  if (!thread?.environmentId) return;
  const environment = getEnvironment(db, thread.environmentId);
  if (!environment?.path) return;
  const written = writeThreadPlanFile({
    projectRoot: environment.path,
    markdown,
    fallbackId: rootThreadIdFor(db, threadId),
    existingPath
  });
  if (!written) return;
  const plan = getThreadPlanByRootThread(db, rootThreadIdFor(db, threadId));
  if (plan && plan.filePath !== written) updateThreadPlanFilePath(db, plan.id, written);
}

function eventRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {};
  const record = payload as Record<string, unknown>;
  return record.event && typeof record.event === 'object' ? record.event as Record<string, unknown> : record;
}

function resolveProviderPlanMarkdown(
  db: ZccDatabase,
  threadId: string,
  completed: readonly CompletedPlanItem[]
): { markdown: string; source: string; index: number } | null {
  const latest = completed.at(-1);
  if (!latest) return null;
  const sameTurn = completed.filter(row => row.turnId === latest.turnId && !row.item.parentToolCallId);
  const planItem = sameTurn.findLast(row => row.itemType === 'plan' && stringField(row.item, 'text'));
  const explanation = sameTurn.findLast(row => row.itemType === 'planSteps' && stringField(row.item, 'explanation'));
  const message = sameTurn.findLast(row => row.itemType === 'agentMessage');
  const candidate = planItem ?? explanation ?? message;
  if (!candidate) return null;
  const captured = listConversationThreadEventsWindow(db, threadId, { limit: 1, type: 'plan/document/captured' })[0];
  const capturedSequence = eventRecord(captured?.payload).sourceSequence;
  if (typeof capturedSequence === 'number' && candidate.index <= capturedSequence) return null;
  const plan = getThreadPlanByRootThread(db, rootThreadIdFor(db, threadId));
  const revision = plan ? latestThreadPlanRevision(db, plan.id) : null;
  const start = latest.turnId ? getConversationTurnStart(db, threadId, latest.turnId) : null;
  if (eventRecord(start?.payload).parentToolCallId) return null;
  const request = listConversationThreadEventsWindow(db, threadId, {
    limit: 1, type: 'client/turn/requested', beforeSeq: start?.sequence ?? candidate.index
  })[0];
  const requestPayload = eventRecord(request?.payload);
  const execution = eventRecord(requestPayload.execution);
  const mode = request
    ? requestedExecutionModeFromTurn({ input: requestPayload.input, acpMode: typeof execution.acpMode === 'string' ? execution.acpMode : undefined })
    : getThreadExecutionState(db, threadId)?.requestedMode;
  // Only a fresh, explicitly requested planning turn can revise a user-edited or
  // approved document. Ordinary chat and replayed provider history cannot.
  const explicitlyRevising = request && revision && request.createdAt >= revision.createdAt && isPlanExecutionMode(mode);
  if (revision && (revision.source === 'user' || revision.source === 'approval') && !explicitlyRevising) return null;
  // Execution checklists describe progress; their explanations must not replace
  // the reviewed document while the agent is implementing it.
  if (explanation && !planItem && revision && !isPlanExecutionMode(mode)) return null;
  if (planItem || explanation) {
    return { markdown: stringField(candidate.item, planItem ? 'text' : 'explanation')!, source: 'provider', index: candidate.index };
  }
  if (revision && revision.source !== 'provider-draft' && !explicitlyRevising) return null;
  if (!latest.turnId || !isPlanExecutionMode(mode)) return null;
  const terminal = ['turn/completed', 'turn.completed'].flatMap(type =>
    listConversationThreadEventsWindow(db, threadId, { limit: 80, type }))
    .sort((a, b) => a.sequence - b.sequence)
    .findLast(row => turnIdFrom(eventRecord(row.payload)) === latest.turnId);
  // An assistant item can be commentary. Wait for a successful turn boundary.
  // Legacy checklist-backed drafts retain their existing capture behavior.
  if (terminal ? eventRecord(terminal.payload).status !== 'completed' : !sameTurn.some(row => row.itemType === 'planSteps')) return null;
  const text = stringField(candidate.item, 'text');
  if (!text || !isSubstantialPlanDraft(text)) return null;
  return { markdown: text, source: 'provider-draft', index: candidate.index };
}

function planStepsFromItem(item: Record<string, unknown>): Array<{ step: string; status?: string }> {
  if (!Array.isArray(item.steps)) return [];
  return item.steps.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as { step?: unknown; status?: unknown };
    if (typeof row.step !== 'string') return [];
    return [{ step: row.step, status: typeof row.status === 'string' ? row.status : undefined }];
  });
}

function completedItemFromPayload(payload: unknown): Omit<CompletedPlanItem, 'index'> | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const nested = record.event;
  const candidate = record.type === 'item/completed'
    ? record
    : nested && typeof nested === 'object' && (nested as { type?: unknown }).type === 'item/completed'
      ? nested as Record<string, unknown>
      : null;
  if (!candidate) return null;
  const item = candidate.item;
  if (!item || typeof item !== 'object') return null;
  const itemType = (item as { type?: unknown }).type;
  if (typeof itemType !== 'string') return null;
  return {
    itemType,
    item: item as Record<string, unknown>,
    turnId: turnIdFrom(candidate) ?? turnIdFrom(record)
  };
}

function turnIdFrom(record: Record<string, unknown>): string | null {
  const scope = record.scope;
  if (scope && typeof scope === 'object') {
    const turnId = (scope as { turnId?: unknown }).turnId;
    if (typeof turnId === 'string' && turnId.length > 0) return turnId;
  }
  if (typeof record.providerTurnId === 'string' && record.providerTurnId.length > 0) {
    return record.providerTurnId;
  }
  return null;
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
