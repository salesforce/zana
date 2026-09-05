import { keepsProjectFocusRail } from '../shellLayout.js';

export const GLOBAL_SPLIT_SCOPE_KEY = 'global';

export function projectSplitScopeKey(projectId: string): string {
  return `project:${projectId}`;
}

/**
 * Which split-layout bag slot the current shell should use. Dedicated project
 * windows are always that project. The main window uses a project slot only
 * while the project rail is showing — Home / Agents / Scheduler stay global.
 */
export function splitLayoutScopeKey({
  scopedProjectId,
  nav,
  focusedProjectId
}: {
  scopedProjectId: string | null;
  nav: string;
  focusedProjectId: string | null | undefined;
}): string {
  if (scopedProjectId) return projectSplitScopeKey(scopedProjectId);
  if (keepsProjectFocusRail(nav, focusedProjectId) && focusedProjectId) {
    return projectSplitScopeKey(focusedProjectId);
  }
  return GLOBAL_SPLIT_SCOPE_KEY;
}
