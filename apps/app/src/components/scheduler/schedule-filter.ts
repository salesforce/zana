import type { Project, ScheduledTask } from '@zana-ai/zcc-domain/product';
import { taskOpenProblems } from '@zana-ai/zcc-domain/schedule-health';
import { lastRunSkipped } from '@zana-ai/zcc-domain/schedule-skipped';

const OPEN_PROBLEM_LABEL = 'Open problem';

export type ScheduleFilter = 'all' | 'enabled' | 'paused' | 'attention' | 'skipped';

export function scheduleIssue(task: ScheduledTask, projects: ReadonlyMap<string, Project>): string | null {
  if (!projects.has(task.projectId)) return 'Project missing';
  // A later finished success closes earlier problems (also in pre-recovery history).
  if (taskOpenProblems(task, Date.now()).length > 0) return OPEN_PROBLEM_LABEL;
  return null;
}

export function filterSchedules(
  tasks: ScheduledTask[], projects: ReadonlyMap<string, Project>, search: string, filter: ScheduleFilter, nowMs = Date.now()
): ScheduledTask[] {
  const query = search.trim().toLowerCase();
  return tasks.filter(task => {
    if (filter === 'enabled' && !task.enabled) return false;
    if (filter === 'paused' && task.enabled) return false;
    if (filter === 'attention' && !scheduleIssue(task, projects)) return false;
    if (filter === 'skipped' && !lastRunSkipped(task, nowMs)) return false;
    return [task.name, task.description ?? '', task.profile, projects.get(task.projectId)?.name ?? 'Project missing']
      .join(' ').toLowerCase().includes(query);
  });
}
