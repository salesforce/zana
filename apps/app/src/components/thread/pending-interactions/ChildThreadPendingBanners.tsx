import { getThreadRoutePath } from '../../../lib/route-paths.js';
import { useOpenPendingInteractions } from './useOpenPendingInteractions.js';
import { ThreadPendingInteractionBanner } from './ThreadPendingInteractionBanner.js';

export function ChildThreadPendingBanners({
  childThreads,
  projectId
}: {
  childThreads: Array<{ id: string; title: string | null }>;
  projectId: string | null;
}) {
  return (
    <>
      {childThreads.map((child) => (
        <ChildThreadPendingBanner
          key={child.id}
          child={child}
          projectId={projectId}
        />
      ))}
    </>
  );
}

function ChildThreadPendingBanner({
  child,
  projectId
}: {
  child: { id: string; title: string | null };
  projectId: string | null;
}) {
  const interactions = useOpenPendingInteractions(child.id);
  return (
    <>
      {interactions.map((interaction) => (
        <ThreadPendingInteractionBanner
          key={interaction.id}
          interaction={interaction}
          threadId={child.id}
          sourceThread={{
            href: getThreadRoutePath(child.id, projectId ?? undefined),
            title: child.title?.trim() || 'Child thread'
          }}
        />
      ))}
    </>
  );
}
