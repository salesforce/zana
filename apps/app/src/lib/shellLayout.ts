export type ShellRail = 'primary' | 'settings' | 'extensions';

export interface ShellLayout {
  rail: ShellRail;
}

/** Destinations that keep the project workspace rail while a project is focused. */
export const PROJECT_FOCUS_RAIL_NAVS = ['projects', 'inbox', 'suggestions', 'settings'] as const;

/**
 * True when the main window is drilled into a project AND the current
 * destination belongs on that project's rail (workspace modes, Inbox, Next
 * Steps, Settings). Global Home/Agents/Scheduler/Extensions keep the unified
 * sidebar so those destinations stay one click away.
 */
export function keepsProjectFocusRail(
  nav: string,
  focusedProjectId: string | null | undefined
): boolean {
  return (
    focusedProjectId != null &&
    (PROJECT_FOCUS_RAIL_NAVS as readonly string[]).includes(nav)
  );
}

/**
 * Chooses which left rail the shell shows. Content is always the remaining
 * full track — panels that want list/detail chrome draw it inside themselves.
 * A project-locked view (dedicated window, or main-window focus on a project
 * destination) keeps its project rail; only the global Settings/Extensions
 * routes replace the rail.
 */
export function resolveShellLayout(nav: string, projectRailLocked: boolean): ShellLayout {
  if (projectRailLocked) return { rail: 'primary' };
  if (nav === 'settings') return { rail: 'settings' };
  if (nav === 'extensions') return { rail: 'extensions' };
  return { rail: 'primary' };
}

/** In-app titlebar wordmark: the project name while its rail is showing, else Zana. */
export function shellTitlebarLabel(
  projectName: string | null | undefined,
  projectRailLocked: boolean
): string {
  return projectRailLocked && projectName ? projectName : 'Zana';
}
