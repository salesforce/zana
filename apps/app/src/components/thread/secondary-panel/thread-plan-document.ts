import {
  isApprovalPendingInteractionPayload,
  type PendingInteraction
} from '@zana-ai/zcc-domain/thread-runtime';

export type ThreadPlanDocument = {
  markdown: string | null;
  filePath: string | null;
  prompt: string | null;
  source: 'approval' | 'durable' | 'empty';
};

export function planFileTabTitle(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

export type PlanDocumentBadge = 'building' | 'ready' | 'complete';

export type PlanReferenceView = {
  threadId: string;
  taskId: string | null;
  title?: string | null;
  role?: string | null;
  todosAssigned?: number;
};

function normalizePlanPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

/** True when a file-preview path is this thread's live `.plan.md` artifact. */
export function isLivePlanFilePath(
  previewPath: string | null | undefined,
  planFilePath: string | null | undefined
): boolean {
  if (!previewPath?.trim() || !planFilePath?.trim()) return false;
  const preview = normalizePlanPath(previewPath);
  const plan = normalizePlanPath(planFilePath);
  if (preview === plan) return true;
  const longer = preview.length >= plan.length ? preview : plan;
  const shorter = preview.length >= plan.length ? plan : preview;
  if (!longer.endsWith(shorter)) return false;
  if (longer.length === shorter.length) return true;
  return longer[longer.length - shorter.length - 1] === '/';
}

export function planDocumentBadge(plan: {
  status?: string | null;
  processing?: { text?: string } | null;
  progress?: { completed: number; total: number } | null;
  tasks?: ReadonlyArray<{ status: string }>;
  markdown?: string | null;
} | null | undefined): PlanDocumentBadge | null {
  if (!plan) return null;
  const tasks = plan.tasks ?? [];
  if (plan.processing || tasks.some((task) => task.status === 'in_progress' || task.status === 'active')) {
    return 'building';
  }
  const total = plan.progress?.total ?? tasks.length;
  const completed = plan.progress?.completed
    ?? tasks.filter((task) => task.status === 'completed').length;
  const remaining = tasks.filter((task) => task.status !== 'cancelled' && task.status !== 'completed');
  if (plan.status === 'completed' || (total > 0 && completed === total && remaining.length === 0)) {
    return 'complete';
  }
  if (!plan.markdown?.trim() && total === 0) return null;
  return 'ready';
}

export function planDocumentBadgeLabel(badge: PlanDocumentBadge): string {
  if (badge === 'building') return 'Building';
  if (badge === 'complete') return 'Complete';
  return 'Ready';
}

export function uniquePlanReferences(refs: readonly PlanReferenceView[]): PlanReferenceView[] {
  const seen = new Map<string, PlanReferenceView>();
  for (const ref of refs) {
    if (!seen.has(ref.threadId)) seen.set(ref.threadId, ref);
  }
  return [...seen.values()];
}

export function planReferenceSummary(refs: readonly PlanReferenceView[]): string {
  const n = uniquePlanReferences(refs).length;
  return `Referenced by ${n} ${n === 1 ? 'Agent' : 'Agents'}`;
}

export function planReferenceDetail(ref: PlanReferenceView): string {
  const title = ref.title?.trim() || 'Untitled agent';
  const role = ref.role?.trim() || 'Agent';
  const n = ref.todosAssigned ?? 0;
  return `${title} · ${role} · ${n} ${n === 1 ? 'todo' : 'todos'} assigned`;
}

export function pendingPlanApprovalSubject(
  interactions: readonly PendingInteraction[]
): { plan: string; planFilePath: string | null } | null {
  for (const interaction of interactions) {
    if (!isApprovalPendingInteractionPayload(interaction.payload)) continue;
    if (interaction.payload.subject.kind !== 'plan') continue;
    return {
      plan: interaction.payload.subject.plan,
      planFilePath: interaction.payload.subject.planFilePath
    };
  }
  return null;
}

export function resolveThreadPlanDocument(args: {
  promptMode: { mode: string; prompt?: string } | null | undefined;
  pendingInteractions: readonly PendingInteraction[];
  durablePlan?: {
    markdown: string | null;
    filePath?: string | null;
    requestedExecutionMode?: string | null;
    effectiveExecutionMode?: string | null;
    executionModeMismatch?: boolean;
  } | null;
}): ThreadPlanDocument | null {
  const inPlanMode = args.promptMode?.mode === 'plan';
  const durable = args.durablePlan;
  const approval = pendingPlanApprovalSubject(args.pendingInteractions);
  if (!inPlanMode && !approval && !durable) return null;
  const prompt = inPlanMode ? (args.promptMode?.prompt?.trim() || null) : null;
  const durableFilePath = durable?.filePath?.trim() ? durable.filePath : null;
  if (approval) {
    return {
      markdown: approval.plan,
      filePath: approval.planFilePath,
      prompt,
      source: 'approval'
    };
  }
  if (durable?.markdown) {
    return {
      markdown: durable.markdown,
      filePath: durableFilePath,
      prompt,
      source: 'durable'
    };
  }
  return {
    markdown: durable?.markdown ?? null,
    filePath: durableFilePath,
    prompt,
    source: durable ? 'durable' : 'empty'
  };
}
