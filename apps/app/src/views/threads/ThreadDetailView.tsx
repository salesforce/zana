import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Archive, GitFork, Terminal } from 'lucide-react';
import type { ActiveThinking, ThreadTimelinePendingTodos } from '@zana-ai/zcc-domain/thread-runtime';
import type { TimelineRow } from '@zana-ai/zcc-server-contract';
import { product } from '../../lib/product-client.js';
import { hasDesktopBridge } from '../../lib/app-surface.js';
import { ThreadCommandComposer } from '../../components/ThreadCommandComposer.js';
import { ThreadTimeline } from '../../components/thread/ThreadTimeline.js';
import { isBusyThreadStatus } from '../../components/thread/thread-timeline-model.js';
import { getThreadRoutePath } from '../../lib/route-paths.js';
import { useThreads } from '../../thread-store.js';

export function ThreadDetailView() {
  const { threadId } = useParams<{ threadId: string }>();
  const navigate = useNavigate();
  const upsertThread = useThreads((s) => s.upsert);
  const [title, setTitle] = useState('Thread');
  const [status, setStatus] = useState('starting');
  const [cwd, setCwd] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [rows, setRows] = useState<TimelineRow[]>([]);
  const [thinking, setThinking] = useState<ActiveThinking | null>(null);
  const [todos, setTodos] = useState<ThreadTimelinePendingTodos | null>(null);

  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    let poll: number | null = null;
    const refresh = async () => {
      try {
        const [detail, timeline] = await Promise.all([
          product.threads.get(threadId),
          product.threads.timeline(threadId)
        ]);
        if (cancelled) return;
        const thread = detail.thread as {
          id?: string;
          title?: string | null;
          status?: string;
          cwd?: string | null;
          projectId?: string;
          hostId?: string;
          environmentId?: string | null;
          providerId?: string;
          createdAt?: number;
          branchName?: string | null;
          isWorktree?: boolean;
          archivedAt?: number | null;
        };
        const nextStatus = thread.status ?? timeline.status;
        setTitle(thread.title?.trim() || 'Thread');
        setStatus(nextStatus);
        setCwd(typeof thread.cwd === 'string' ? thread.cwd : null);
        setProjectId(typeof thread.projectId === 'string' ? thread.projectId : null);
        setRows((timeline.rows as TimelineRow[]) ?? []);
        setThinking((timeline.activeThinking as ActiveThinking | null) ?? null);
        setTodos((timeline.pendingTodos as ThreadTimelinePendingTodos | null) ?? null);
        if (thread.id) {
          upsertThread({
            id: thread.id,
            projectId: thread.projectId ?? '',
            hostId: thread.hostId ?? '',
            environmentId: thread.environmentId ?? null,
            providerId: thread.providerId ?? '',
            status: nextStatus,
            title: thread.title ?? null,
            createdAt: thread.createdAt ?? Date.now(),
            cwd: typeof thread.cwd === 'string' ? thread.cwd : null,
            branchName: thread.branchName ?? null,
            isWorktree: thread.isWorktree ?? false,
            archivedAt: thread.archivedAt ?? null
          });
        }
        if (!isBusyThreadStatus(nextStatus) && poll !== null) {
          window.clearInterval(poll);
          poll = null;
        }
      } catch {
        /* keep last */
      }
    };
    void refresh();
    poll = window.setInterval(() => {
      if (cancelled) {
        if (poll !== null) window.clearInterval(poll);
        return;
      }
      void refresh();
    }, 400);
    const stopUpdated = product.threads.onUpdated(() => void refresh());
    const stopEvents = product.threads.onEvent((payload) => {
      if (payload && typeof payload === 'object' && 'threadId' in payload
        && (payload as { threadId: string }).threadId === threadId) {
        void refresh();
      }
    });
    return () => {
      cancelled = true;
      if (poll !== null) window.clearInterval(poll);
      stopUpdated();
      stopEvents();
    };
  }, [threadId, upsertThread]);

  if (!threadId) return null;

  return (
    <section className="thread-detail-view" data-testid="thread-detail">
      <header className="thread-detail-header">
        <div>
          <h1>{title}</h1>
          <p className="thread-detail-status">{status}</p>
        </div>
        <div className="thread-detail-actions">
          <button
            type="button"
            className="icon-btn"
            title="Fork thread"
            aria-label="Fork thread"
            onClick={async () => {
              const forked = await product.threads.fork(threadId);
              if (forked.ok) navigate(getThreadRoutePath(forked.value.id));
            }}
          >
            <GitFork size={14} />
          </button>
          {hasDesktopBridge() && projectId && (
            <button
              type="button"
              className="icon-btn"
              title="Open workspace shell"
              aria-label="Open workspace shell"
              onClick={() => {
                void product.terminals.create({
                  projectId,
                  profile: 'shell',
                  cwd: cwd ?? undefined,
                  cols: 80,
                  rows: 24
                });
              }}
            >
              <Terminal size={14} />
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            title="Archive thread"
            aria-label="Archive thread"
            data-testid="thread-archive"
            onClick={async () => {
              await product.threads.archive(threadId);
              navigate('/agents');
            }}
          >
            <Archive size={14} />
          </button>
        </div>
      </header>
      <ThreadTimeline rows={rows} status={status} thinking={thinking} todos={todos} />
      <ThreadCommandComposer threadId={threadId} />
    </section>
  );
}
