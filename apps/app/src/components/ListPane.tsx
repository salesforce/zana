import { useEffect } from 'react';
import { useData, useUi } from '../store.js';
import { useMergedModules } from '../modules/index.js';
import { ProjectFocusView } from './listpane/ProjectFocusView.js';
import { InboxPane } from './listpane/InboxPane.js';
import { SettingsPane } from './listpane/SettingsPane.js';
import { AgentsListPane } from './listpane/AgentsList.js';
import { PluginNavListPane } from '../plugins/PluginNavRows.js';
import { listSidebarNavPanels } from '../plugins/plugin-slots.js';
import type { Project } from '@zana-ai/zcc-domain/product';

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

  // New Chat owns the full content area (composer-only; no list column).
  if (nav === 'home') return null;
  // The global (unscoped) Follow-ups nav owns the full content area (its own
  // toolbar + list). The project-scoped 'followups' WORKSPACE mode is unrelated
  // (it renders inside Workspace.tsx, not through nav here).
  if (nav === 'followups') return null;
  if (nav === 'settings') return <SettingsPane />;
  // Scheduler owns the full content area (overview + schedule list). The
  // project-scoped workspace tab is unrelated and mounts SchedulerPanel
  // directly inside Workspace.tsx.
  if (nav === 'scheduler') return null;
  if (nav === 'inbox') return <InboxPane />;
  // Suggestions launcher owns the full content area (its own card grid) — no
  // Projects list column, same as Personas / Teams / module panels.
  if (nav === 'suggestions') return null;
  if (nav === 'agents') return <AgentsListPane />;
  // Extensions owns the full content area (its own hub tabs + toolbar) — no
  // Projects list column, same as Personas / app-module panels.
  if (nav === 'extensions') return null;
  if (listSidebarNavPanels().some((panel) => panel.pluginId === nav)) return <PluginNavListPane />;
  // App modules (built-ins + runtime extensions) own the whole content area and
  // bring their own filter rail — they don't want the Projects list column.
  if (modules.some((m) => m.id === nav)) return null;

  // Show focus view if we have a focused project
  if (focusedProject) return <ProjectFocusView project={focusedProject} />;

  // The primary Sidebar owns the global project/session tree. Keeping a second
  // copy in column two made focus and project order feel disconnected.
  return null;
}
