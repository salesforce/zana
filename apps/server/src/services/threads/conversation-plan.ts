import {
  addThreadPlanReference,
  appendThreadPlanRevision,
  createThreadPlan,
  createThreadPlanTask,
  getConversationThread,
  getEnvironment,
  getThreadExecutionState,
  getThreadPlanByRootThread,
  listConversationThreadEvents,
  listThreadPlanReferences,
  listThreadPlanTasks,
  latestThreadPlanRevision,
  updateThreadPlanFilePath,
  updateThreadPlanTask,
  upsertThreadExecutionState,
  type ThreadPlanTaskRow,
  type ThreadPlanTaskStatus,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import { isPlanExecutionMode } from './conversation-execution-mode.js';
import { isSubstantialPlanDraft, writeThreadPlanFile } from './thread-plan-files.js';

export interface DurableThreadPlanView {
  id: string;
  rootThreadId: string;
  status: string;
  markdown: string | null;
  filePath: string | null;
  revision: number;
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
  referencedBy: Array<{ threadId: string; taskId: string | null }>;
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
  if (args.steps.length === 0) return;
  const plan = ensureDraftThreadPlan(db, args.threadId);
  const existing = listThreadPlanTasks(db, plan.id);
  const byKey = new Map(existing.filter((task) => task.providerKey).map((task) => [task.providerKey!, task]));
  const used = new Set<string>();
  args.steps.forEach((step, index) => {
    const text = step.step.trim();
    if (!text) return;
    const key = providerKeyFor(text, index);
    used.add(key);
    const status = normalizeProviderStatus(step.status);
    const match = byKey.get(key)
      ?? existing.find((task) => !task.userEdited && task.text.trim() === text && !used.has(task.providerKey ?? ''));
    if (match) {
      if (match.userEdited && match.text !== text) return;
      if (match.status === 'completed' && status === 'in_progress') return;
      const startedAt = status === 'in_progress'
        ? match.startedAt ?? Date.now()
        : match.startedAt;
      updateThreadPlanTask(db, match.id, {
        status,
        providerKey: key,
        startedAt,
        owningThreadId: status === 'in_progress' ? (args.owningThreadId ?? args.threadId) : match.owningThreadId,
        latestActivity: status === 'in_progress' ? 'provider-plan-steps' : match.latestActivity,
        blockedReason: status === 'blocked' ? 'interrupted' : match.blockedReason
      });
      return;
    }
    const created = createThreadPlanTask(db, {
      planId: plan.id,
      text,
      status,
      ownerKind: 'provider',
      providerKey: key
    });
    if (status === 'in_progress') {
      updateThreadPlanTask(db, created.id, {
        startedAt: Date.now(),
        owningThreadId: args.owningThreadId ?? args.threadId,
        latestActivity: 'provider-plan-steps'
      });
    }
  });
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
    referencedBy: listThreadPlanReferences(db, plan.id).map((row) => ({
      threadId: row.threadId,
      taskId: row.taskId
    }))
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
  const updated = updateThreadPlanTask(ctx.db, taskId, {
    ...patch,
    userEdited: true
  });
  if (!updated || updated.planId !== plan.id) {
    throw new ThreadCreateError(404, 'unknown-task', 'plan task is not registered');
  }
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
  const rows = listConversationThreadEvents(db, threadId);
  const completed: CompletedPlanItem[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const parsed = completedItemFromPayload(rows[index]?.payload);
    if (!parsed) continue;
    completed.push({ ...parsed, index });
  }
  const latestSteps = [...completed].reverse().find((row) => row.itemType === 'planSteps');
  if (latestSteps) {
    const steps = planStepsFromItem(latestSteps.item);
    importProviderPlanSteps(db, { threadId, steps, owningThreadId: threadId });
  }
  const markdown = resolveProviderPlanMarkdown(db, threadId, completed, latestSteps);
  if (markdown) snapshotApprovedPlan(db, { threadId, markdown, source: markdownSource(latestSteps, completed) });
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

function markdownSource(
  latestSteps: CompletedPlanItem | undefined,
  completed: readonly CompletedPlanItem[]
): string {
  if (latestSteps) {
    const explanation = stringField(latestSteps.item, 'explanation');
    if (explanation) return 'provider';
  }
  const turnId = latestSteps?.turnId;
  const planItem = [...completed].reverse().find((row) => {
    if (row.itemType !== 'plan') return false;
    if (turnId && row.turnId && row.turnId !== turnId) return false;
    if (latestSteps && row.index > latestSteps.index) return false;
    return Boolean(stringField(row.item, 'text'));
  });
  if (planItem) return 'provider';
  return 'provider-draft';
}

function resolveProviderPlanMarkdown(
  db: ZccDatabase,
  threadId: string,
  completed: readonly CompletedPlanItem[],
  latestSteps: CompletedPlanItem | undefined
): string | null {
  const turnId = latestSteps?.turnId ?? completed.at(-1)?.turnId ?? null;
  const sameTurn = (row: CompletedPlanItem) => {
    if (latestSteps && row.index > latestSteps.index) return false;
    if (turnId && row.turnId) return row.turnId === turnId;
    if (latestSteps) return row.index <= latestSteps.index;
    return true;
  };
  const planItem = [...completed].reverse().find((row) => row.itemType === 'plan' && sameTurn(row));
  const planText = planItem ? stringField(planItem.item, 'text') : null;
  if (planText) return planText;
  const explanation = latestSteps ? stringField(latestSteps.item, 'explanation') : null;
  if (explanation) return explanation;
  if (!latestSteps) return null;
  const execution = getThreadExecutionState(db, threadId);
  if (!isPlanExecutionMode(execution?.requestedMode) && !isPlanExecutionMode(execution?.effectiveMode)) {
    return null;
  }
  const plan = getThreadPlanByRootThread(db, rootThreadIdFor(db, threadId));
  const latestRevision = plan ? latestThreadPlanRevision(db, plan.id) : null;
  if (latestRevision && latestRevision.source !== 'provider-draft') return null;
  const message = [...completed].reverse().find((row) => row.itemType === 'agentMessage' && sameTurn(row));
  const text = message ? stringField(message.item, 'text') : null;
  if (!text || !isSubstantialPlanDraft(text)) return null;
  return text;
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
