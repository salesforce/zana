export type PlanExecutionTask = {
  id: string;
  text: string;
  status: string;
};

export type PlanExecutionView = {
  title: string;
  tasks: readonly PlanExecutionTask[];
  /** Remembers the reader's open/closed choice for this plan revision across messages and reloads. */
  stateKey?: string | null;
};

/**
 * One choice per approved plan revision. Provider step updates, even ones that
 * rewrite the checklist, keep it, so a closed card does not pop back open.
 */
export function planExecutionStateKey(
  threadId: string,
  planId: string | null | undefined,
  revision: number
): string {
  return JSON.stringify([threadId, planId ?? null, revision]);
}

/** The timeline card for a thread's durable plan, or null when it has no steps. */
export function timelinePlanExecution(
  threadId: string,
  plan: {
    id?: string | null;
    markdown: string | null;
    revision: number;
    tasks: readonly PlanExecutionTask[];
  } | null | undefined
): PlanExecutionView | null {
  if (!plan?.tasks.length) return null;
  return {
    title: planExecutionTitle(plan.markdown),
    tasks: plan.tasks,
    stateKey: planExecutionStateKey(threadId, plan.id, plan.revision)
  };
}

export function planExecutionTitle(markdown: string | null | undefined): string {
  if (!markdown) return 'Plan';
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.startsWith('# ') ? line.slice(2).trim() : line;
    return heading || 'Plan';
  }
  return 'Plan';
}

/** 0-based index of the current task; first in-progress, else first pending, else 0. */
export function planExecutionCurrentIndex(tasks: readonly PlanExecutionTask[]): number {
  if (tasks.length === 0) return 0;
  const inProgress = tasks.findIndex((task) => task.status === 'in_progress' || task.status === 'active');
  if (inProgress >= 0) return inProgress;
  const pending = tasks.findIndex((task) => task.status === 'pending');
  if (pending >= 0) return pending;
  for (let i = tasks.length - 1; i >= 0; i--) {
    if (tasks[i]!.status === 'completed') return i;
  }
  return 0;
}

/** Canonical visual bucket for a task status, so pending/in-progress/done/blocked read differently. */
export type PlanTaskVisual = 'completed' | 'in_progress' | 'blocked' | 'cancelled' | 'pending';

export function planTaskVisual(status: string): PlanTaskVisual {
  if (status === 'completed') return 'completed';
  if (status === 'in_progress' || status === 'active') return 'in_progress';
  if (status === 'blocked') return 'blocked';
  if (status === 'cancelled' || status === 'canceled') return 'cancelled';
  return 'pending';
}

export function planTaskStatusLabel(status: string): string {
  switch (planTaskVisual(status)) {
    case 'completed':
      return 'Completed';
    case 'in_progress':
      return 'In progress';
    case 'blocked':
      return 'Blocked';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Pending';
  }
}

/** How many tasks are done — the numerator of the progress counter. */
export function planCompletedCount(tasks: readonly PlanExecutionTask[]): number {
  return tasks.reduce((count, task) => (planTaskVisual(task.status) === 'completed' ? count + 1 : count), 0);
}

/** Every step is settled (done or cancelled), so there is no progress left to watch. */
export function planExecutionFinished(tasks: readonly PlanExecutionTask[]): boolean {
  return tasks.length > 0 && tasks.every((task) => {
    const visual = planTaskVisual(task.status);
    return visual === 'completed' || visual === 'cancelled';
  });
}

/**
 * The card rides on the latest user message, and a thread keeps one plan for
 * life, so a finished plan would trail every later message. The Plan panel
 * keeps it instead.
 */
export function visiblePlanExecution(plan: PlanExecutionView | null | undefined): PlanExecutionView | null {
  if (!plan?.tasks.length || planExecutionFinished(plan.tasks)) return null;
  return plan;
}
