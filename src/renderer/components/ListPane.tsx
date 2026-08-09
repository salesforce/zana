import { useEffect } from 'react';
import { useData, useUi } from '../store';
import { useMergedModules } from '../modules';
import { ProjectFocusView } from './listpane/ProjectFocusView';
import { InboxPane } from './listpane/InboxPane';
import { ProjectsList } from './listpane/ProjectsList';
import { SchedulerPane } from './listpane/SchedulerPane';
import { SettingsPane } from './listpane/SettingsPane';
import { AgentsListPane } from './AgentsView';
import type { Project } from '@shared/types';

export function ListPane() {
  const nav = useUi((s) => s.nav);
  const modules = useMergedModules();
  const focusedProjectId = useUi((s) => s.focusedProjectId);
  const exitProjectFocus = useUi((s) => s.exitProjectFocus);
  const projects = useData((s) => s.projects);

  // Focus mode: drill into a single project. If the focused project was
  // deleted/closed while focused, fall back to the list gracefully.
  const focusedProject = focusedProjectId
    ? projects.find((p: Project) => p.id === focusedProjectId) ?? null
    : null;
  useEffect(() => {
    if (focusedProjectId && !focusedProject) exitProjectFocus();
  }, [focusedProjectId, focusedProject, exitProjectFocus]);

  // Home owns the full content area (its own card grid), same as Personas /
  // Usage / Squads — no Projects list column.
  if (nav === 'home') return null;
  // The global (unscoped) Follow-ups nav owns the full content area (its own
  // toolbar + list), same as Personas / Usage / Squads — no Projects list
  // column. The project-scoped 'followups' WORKSPACE mode is unrelated (it
  // renders inside SchedulerPane-less Workspace.tsx, not through nav here).
  if (nav === 'followups') return null;
  if (nav === 'settings') return <SettingsPane />;
  if (nav === 'scheduler') return <SchedulerPane />;
  if (nav === 'inbox') return <InboxPane />;
  // Suggestions launcher owns the full content area (its own card grid) — no
  // Projects list column, same as Personas / Teams / module panels.
  if (nav === 'suggestions') return null;
  if (nav === 'agents') return <AgentsListPane />;
  // Personas owns the whole content area (read-only catalogue with its own
  // toolbar) — no Projects list column, same as the app-module panels below.
  if (nav === 'personas') return null;
  // Squads owns the whole content area (catalogue with its own toolbar) — no
  // Projects list column, same as Personas / app-module panels.
  if (nav === 'squads') return null;
  // Usage dashboard owns the full content area (whole-workspace rollup, no
  // Projects list column) — same as Personas / app-module panels.
  if (nav === 'usage') return null;
  // Extensions owns the full content area (its own hub tabs + toolbar) — no
  // Projects list column, same as Personas / app-module panels.
  if (nav === 'extensions') return null;
  // Library owns the full content area (its own folder-tree + doc list +
  // preview, like ExplorerView) — no Projects list column.
  if (nav === 'library') return null;
  // App modules (built-ins + runtime extensions) own the whole content area and
  // bring their own filter rail — they don't want the Projects list column.
  if (modules.some((m) => m.id === nav)) return null;

  // Show focus view if we have a focused project
  if (focusedProject) return <ProjectFocusView project={focusedProject} />;

  return <ProjectsList />;
}
