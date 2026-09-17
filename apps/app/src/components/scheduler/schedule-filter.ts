import type { Project, ScheduledTask } from '@zana-ai/zcc-domain/product';

export type ScheduleFilter = 'all' | 'enabled' | 'paused' | 'attention';

export function scheduleIssue(task: ScheduledTask, projects: ReadonlyMap<string, Project>): string | null {
  if (!projects.has(task.projectId)) return 'Project missing';
  // A skipped overlap does not erase the last actual run's outcome.
  const result = task.status?.runs.find(run => run.result !== 'skipped')?.result
    ?? task.status?.lastRunResult;
  if (result === 'error') return 'Last run failed';
  if (result === 'incomplete') return 'Last run incomplete';
  return null;
}

export function filterSchedules(
  tasks: ScheduledTask[], projects: ReadonlyMap<string, Project>, search: string, filter: ScheduleFilter
): ScheduledTask[] {
  const query = search.trim().toLowerCase();
  return tasks.filter(task => {
    if (filter === 'enabled' && !task.enabled) return false;
    if (filter === 'paused' && task.enabled) return false;
    if (filter === 'attention' && !scheduleIssue(task, projects)) return false;
    return [task.name, task.description ?? '', task.profile, projects.get(task.projectId)?.name ?? 'Project missing']
      .join(' ').toLowerCase().includes(query);
  });
}
