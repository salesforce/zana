import { lazy, Suspense } from 'react';
import type { ModuleHost } from '@zana-ai/zcc-extension-sdk/renderer';
import { useData } from '@/store';
import { DelayedStencilList } from '@/components/ui/Skeleton';
import { useRouteState } from '../../hooks/useRouteState.js';
import { parseLibraryPanelSubPath } from './library-deep-link.js';

const LibraryPanel = lazy(() =>
  import('./LibraryPanel.js').then((m) => ({ default: m.LibraryPanel }))
);
const LibraryView = lazy(() =>
  import('./LibraryView.js').then((m) => ({ default: m.LibraryView }))
);

const loading = <DelayedStencilList label="Loading library" className="zcc-stencil-padded" />;

/**
 * One panel, two scopes — the documented projectTab contract. The sidebar Docs
 * rail leaves `getScopedProjectId()` null (every project). A project's Library
 * tab mounts the same panel with that project's id.
 */
export function DocsPanel({ host }: { host: ModuleHost }) {
  const scopedId = host.getScopedProjectId();
  const projects = useData((s) => s.projects);
  const route = useRouteState();
  const deepLink = parseLibraryPanelSubPath(route.pluginSubPath);

  if (scopedId) {
    const project = projects.find((p) => p.id === scopedId);
    if (!project) {
      return (
        <div className="module-no-panel" role="status">
          <p>This project is no longer available.</p>
        </div>
      );
    }
    const scopedLink =
      !deepLink ||
      deepLink.scope === 'global' ||
      deepLink.projectId === project.id
        ? deepLink
        : null;
    return (
      <Suspense fallback={loading}>
        <LibraryView project={project} deepLink={scopedLink} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={loading}>
      <LibraryPanel deepLink={deepLink} />
    </Suspense>
  );
}
