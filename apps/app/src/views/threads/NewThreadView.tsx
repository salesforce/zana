import { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { Project } from '@zana-ai/zcc-domain/product';
import { useData } from '@/store';
import { AuroraGrid } from '@/components/AuroraGrid';
import { HomeAgentComposer } from '@/components/HomeAgentComposer';
import { PluginNewThreadActions } from '@/plugins/PluginNewThreadActions';

/**
 * Composer-only create surface. Agents board and list navigate here instead of
 * embedding the prompt on the kanban. Submit already opens `/threads/:id`.
 *
 * From a workspace the project is locked: the nested `/projects/:id/threads/new`
 * route keeps the project rail, and the composer shows that workspace selected
 * and read-only.
 */
export function NewThreadView({ project: projectProp }: { project?: Project } = {}) {
  const { projectId: routeProjectId } = useParams();
  const [search] = useSearchParams();
  const projectId = projectProp?.id ?? routeProjectId ?? search.get('project');
  const projects = useData((s) => s.projects);
  const project = useMemo(
    () => projectProp ?? (projectId ? projects.find((row) => row.id === projectId) : undefined),
    [projectId, projectProp, projects]
  );

  return (
    <section className="new-thread-view aurora-host" data-testid="new-thread-view">
      <AuroraGrid />
      <div className="new-thread-view-inner">
        <h1 className="new-thread-view-heading">New thread</h1>
        <HomeAgentComposer project={project} />
        <PluginNewThreadActions projectId={project?.id ?? null} />
      </div>
    </section>
  );
}
