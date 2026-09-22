export type PlanExecutionTask = {
  id: string;
  text: string;
  status: string;
};

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
