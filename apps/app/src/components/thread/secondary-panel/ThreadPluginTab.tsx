import { ProjectExtensionTab } from '../../../views/project/ProjectExtensionTab.js';
import { useData } from '../../../store.js';

export function ThreadPluginTab({
  moduleId,
  projectId
}: {
  moduleId: string;
  projectId: string | null;
}) {
  const project = useData((s) => s.projects.find((row) => row.id === projectId) ?? null);
  if (!project) {
    return <p className="thread-detail-empty">Project is unavailable for this panel.</p>;
  }
  return (
    <div className="thread-plugin-tab" data-testid="thread-plugin-tab">
      <ProjectExtensionTab moduleId={moduleId} project={project} />
    </div>
  );
}
