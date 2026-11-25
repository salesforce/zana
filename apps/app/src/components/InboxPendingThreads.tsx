import { useEffect, useMemo } from 'react';
import { MessageSquareMore } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useThreads, type ThreadListItem } from '../thread-store.js';
import { getThreadRoutePath } from '../lib/route-paths.js';

export function useInboxPendingThreads(enabled: boolean, scope: string | null, query: string, projectNames: ReadonlyMap<string, string>) {
  const threads = useThreads((state) => state.threads);
  const load = useThreads((state) => state.load);
  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  return useMemo(() => {
    if (!enabled) return [];
    const search = query.trim().toLowerCase();
    return threads.filter((thread) =>
      thread.hasPendingInteraction && !thread.archivedAt && thread.visibility !== 'hidden'
      && (!scope || thread.projectId === scope)
      && (!search || `${thread.title ?? 'Untitled thread'} ${projectNames.get(thread.projectId) ?? thread.projectId}`.toLowerCase().includes(search))
    );
  }, [enabled, threads, scope, query, projectNames]);
}

export function InboxPendingThreads({ threads, projectNames, scope }: {
  threads: readonly ThreadListItem[];
  projectNames: ReadonlyMap<string, string>;
  scope: string | null;
}) {
  if (threads.length === 0) return null;
  return (
    <section className="inbox-pending-threads" aria-label="Threads waiting for input">
      {threads.map((thread) => (
        <div className="inbox-feed-card inbox-feed-card--attention" key={thread.id}>
          <span className="inbox-feed-card-icon"><MessageSquareMore size={18} aria-hidden /></span>
          <div className="inbox-feed-card-content">
            <span className="inbox-feed-card-title">{thread.title || 'Untitled thread'}</span>
            <span className="inbox-feed-card-preview">Waiting for your input · {projectNames.get(thread.projectId) ?? thread.projectId}</span>
          </div>
          <Link className="inbox-feed-action" to={getThreadRoutePath(thread.id, scope)}>Review in thread</Link>
        </div>
      ))}
    </section>
  );
}
