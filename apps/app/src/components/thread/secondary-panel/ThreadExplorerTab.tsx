import { lazy, Suspense } from 'react';
import { useData } from '../../../store.js';
import { StencilList } from '../../ui/Skeleton.js';

const ExplorerView = lazy(() =>
  import('../../../views/project/ExplorerView.js').then((m) => ({ default: m.ExplorerView }))
);

export function ThreadExplorerTab({ projectId }: { projectId: string | null }) {
  const project = useData((s) => s.projects.find((row) => row.id === projectId) ?? null);
  if (!project) {
    return <p className="thread-detail-empty">Project is unavailable for Explorer.</p>;
  }
  return (
    <div className="thread-explorer-tab" data-testid="thread-explorer-tab">
      <Suspense fallback={<StencilList label="Loading Explorer" className="zcc-stencil-padded" />}>
        <ExplorerView project={project} embedded />
      </Suspense>
    </div>
  );
}
