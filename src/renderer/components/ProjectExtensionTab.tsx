/**
 * Mounts an extension module's renderer panel as a PER-PROJECT TAB — the
 * project-scoped twin of {@link ModulePanelHost} (which mounts the same panel
 * as a top-level, cross-project sidebar surface). An extension opts in via its
 * manifest's `projectTab` block (SDK `ProjectTabContribution`); core's Workspace
 * adds a tab per such module and renders this when that tab is active.
 *
 * SCOPING. The panel is the SAME component the sidebar mounts; what differs is
 * the host it receives. Here we wrap the module's cached {@link ModuleHost} so
 * `getScopedProjectId()` returns THIS tab's project id (and `getActiveProject()`
 * is that project) — the documented signal a project-aware panel reads to filter
 * its data to one project. The sidebar surface leaves `getScopedProjectId()`
 * null (cross-project). Everything else (`call`, `storage`, `cache`, `on`, …)
 * delegates to the one cached base host, so capability routing, the shared
 * module cache/snapshot, and `evictHost` all behave exactly as for the sidebar
 * surface. A panel that ignores `getScopedProjectId()` renders identically in
 * both — the scoping is opt-in on the extension side.
 *
 * We re-key on `project.id` so switching the active project remounts the panel
 * cleanly (fresh effects), matching how core's own project tabs (Explorer,
 * Tickets, …) remount per project.
 *
 * Core stays decoupled: this names no concrete extension — it takes the module
 * by id and renders whatever panel it contributes (Rule 6).
 */

import { useEffect, useMemo } from 'react';
import type { Project } from '@shared/types';
import type { ModuleHost } from '@shared/module-api';
import { useMergedModule } from '../modules';
import { getHost } from '../modules/ModulePanelHost';
import { createMountScopedHost, createProjectScopedHost } from '../modules/host';
import { ErrorBoundary } from './ErrorBoundary';

/**
 * A host bound to one project: filters project/session capabilities and events
 * before the mount cleanup scope takes ownership of subscriptions.
 */
export function ProjectExtensionTab({
  moduleId,
  project
}: {
  moduleId: string;
  project: Project;
}) {
  const mod = useMergedModule(moduleId);
  // The scoped host wraps the SAME cached base host the sidebar uses, so they
  // share the module's cache/storage and `evictHost` releases both. W1-6: also
  // wrap it in a per-MOUNT cleanup scope so this tab's `on`/`subscribe`/`register`
  // subscriptions auto-dispose when the tab unmounts (project switch / tab close).
  const mount = useMemo(
    () => (mod ? createMountScopedHost(createProjectScopedHost(getHost(mod.id), project)) : null),
    [mod, project]
  );
  const host: ModuleHost | null = mount?.host ?? null;
  useEffect(() => () => mount?.dispose(), [mount]);

  // The extension backing this tab is gone (disabled/removed) but the project
  // still remembers it as its active view. Render a tasteful placeholder rather
  // than nothing; the Workspace's mode fallback will move off it on the next
  // interaction.
  if (!mod || !host) {
    return (
      <div className="module-no-panel" role="status">
        <p>This tab’s extension is no longer available.</p>
        <p className="module-no-panel-hint">Pick another tab above.</p>
      </div>
    );
  }

  const Panel = mod.panel;
  if (!Panel) {
    return (
      <div className="module-no-panel" role="status">
        <p>{mod.title} has no view of its own.</p>
      </div>
    );
  }

  return (
    <ErrorBoundary key={`${mod.id}:${project.id}`}>
      <Panel host={host} />
    </ErrorBoundary>
  );
}
