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
