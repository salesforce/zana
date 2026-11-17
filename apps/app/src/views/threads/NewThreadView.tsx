import { useMemo } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import type { Project } from '@zana-ai/zcc-domain/product';
import { useData } from '@/store';
import { AuroraGrid } from '@/components/AuroraGrid';
import { HomeAgentComposer } from '@/components/HomeAgentComposer';
import { PluginNewThreadActions } from '@/plugins/PluginNewThreadActions';
import { composePromptSeedFrom } from '@/lib/compose-prompt-seed';
import { NewChatPanelLayout } from './NewChatPanelLayout.js';
import { useOptionalPaneContext } from '../thread-detail/PaneContext.js';

/**
 * Full-page create surface. Project New Chat offers the same launch modes as
 * Home while keeping the project rail and a project-specific draft.
 *
 * From a workspace the project is locked: the nested `/projects/:id/threads/new`
 * route keeps the project rail, and the composer shows that workspace selected
 * and read-only.
 */
export function NewThreadView({ project: projectProp }: { project?: Project } = {}) {
  const { projectId: routeProjectId } = useParams();
  const location = useLocation();
  const [search] = useSearchParams();
  const seed = composePromptSeedFrom({ searchParams: search, state: location.state });
  const projectId = projectProp?.id ?? routeProjectId ?? search.get('project');
  const locationProjectId = search.get('locationProject') ?? undefined;
  const initialHostId = search.get('host') ?? undefined;
  const pane = useOptionalPaneContext();
  const projects = useData((s) => s.projects);
  const project = useMemo(
    () => projectProp ?? (projectId ? projects.find((row) => row.id === projectId) : undefined),
    [projectId, projectProp, projects]
  );
  const panelScope = JSON.stringify([project?.id ?? locationProjectId ?? null, initialHostId ?? null, pane?.paneId ?? null]);

  return (
    <NewChatPanelLayout key={panelScope} scopeId={panelScope} project={project} hostId={initialHostId}>
      {({ onCreated, onAgentCreated }) => (
        <section className="new-thread-view aurora-host" data-testid="new-thread-view">
          <AuroraGrid />
          <div className="new-thread-view-inner">
            <h1 className="new-thread-view-heading">New Chat</h1>
            <HomeAgentComposer
              allowLegacyAgent={Boolean(project)}
              key={`${locationProjectId ?? ''}:${initialHostId ?? ''}`}
              draftScope={locationProjectId || initialHostId ? `new-thread:${locationProjectId ?? ''}:${initialHostId ?? ''}` : 'new-thread'}
              composerProjectId={locationProjectId}
              initialHostId={initialHostId}
              project={project}
              initialText={seed.initialText}
              autoFocus={seed.focusPrompt}
              onCreated={onCreated}
              onAgentCreated={onAgentCreated}
            />
            <PluginNewThreadActions projectId={project?.id ?? null} />
          </div>
        </section>
      )}
    </NewChatPanelLayout>
  );
}
