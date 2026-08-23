import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Archive, GitFork, Terminal } from 'lucide-react';
import type { ActiveThinking, ThreadTimelineGoal, ThreadTimelinePendingTodos } from '@zana-ai/zcc-domain/thread-runtime';
import type { ThreadContextWindowUsage, TimelineRow } from '@zana-ai/zcc-server-contract';
import type { TimelineViewWorkflowWorkRow } from '@zana-ai/zcc-thread-view';
import { product } from '../../lib/product-client.js';
import { hasDesktopBridge } from '../../lib/app-surface.js';
import { ThreadCommandComposer } from '../../components/ThreadCommandComposer.js';
import { ThreadTimeline } from '../../components/thread/ThreadTimeline.js';
import { ThreadConversationToc } from '../../components/thread/ThreadConversationToc.js';
import { ThreadDiffPanel } from '../../components/thread/ThreadDiffPanel.js';
import { ThreadWorkspaceBanner } from '../../components/thread/ThreadWorkspaceBanner.js';
import { isBusyThreadStatus } from '../../components/thread/thread-timeline-model.js';
import { getProjectWorkspaceRoutePath, getThreadRoutePath } from '../../lib/route-paths.js';
import { useThreads } from '../../thread-store.js';

const INITIAL_SEGMENT_LIMIT = 200;

export function ThreadDetailView() {
  const { threadId } = useParams<{ threadId: string }>();
  const navigate = useNavigate();
  const upsertThread = useThreads((s) => s.upsert);
  const [title, setTitle] = useState('Thread');
  const [status, setStatus] = useState('starting');
  const [cwd, setCwd] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [environmentId, setEnvironmentId] = useState<string | null>(null);
  const [isWorktree, setIsWorktree] = useState(false);
  const [rows, setRows] = useState<TimelineRow[]>([]);
  const [thinking, setThinking] = useState<ActiveThinking | null>(null);
  const [todos, setTodos] = useState<ThreadTimelinePendingTodos | null>(null);
  const [goal, setGoal] = useState<ThreadTimelineGoal | null>(null);
  const [workflows, setWorkflows] = useState<TimelineViewWorkflowWorkRow[]>([]);
  const [promptMode, setPromptMode] = useState<{ mode: string; prompt?: string } | null>(null);
  const [contextWindow, setContextWindow] = useState<ThreadContextWindowUsage | null>(null);
  const [lastReadSeq, setLastReadSeq] = useState<number | null>(null);
  const [hasOlderRows, setHasOlderRows] = useState(false);
  const [segmentLimit, setSegmentLimit] = useState(INITIAL_SEGMENT_LIMIT);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [outline, setOutline] = useState<Array<{ id: string; role: 'user' | 'assistant'; preview: string }>>([]);
  const [diffPath, setDiffPath] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    let poll: number | null = null;
    const refresh = async () => {
      try {
        const [detail, timeline, toc] = await Promise.all([
          product.threads.get(threadId),
          product.threads.timeline(threadId, { segmentLimit }),
          product.threads.conversationOutline(threadId).catch(() => ({ items: [] as Array<{ id: string; role: 'user' | 'assistant'; preview: string }> }))
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
        setEnvironmentId(typeof thread.environmentId === 'string' ? thread.environmentId : null);
        setIsWorktree(thread.isWorktree ?? false);
        setRows((timeline.rows as TimelineRow[]) ?? []);
        setThinking((timeline.activeThinking as ActiveThinking | null) ?? null);
        setTodos((timeline.pendingTodos as ThreadTimelinePendingTodos | null) ?? null);
        setGoal((timeline.goal as ThreadTimelineGoal | null) ?? null);
        setWorkflows((timeline.activeWorkflows as TimelineViewWorkflowWorkRow[]) ?? []);
        setPromptMode((timeline.activePromptMode as { mode: string; prompt?: string } | null) ?? null);
        setContextWindow((timeline.contextWindowUsage as ThreadContextWindowUsage | null) ?? null);
        setLastReadSeq(typeof timeline.lastReadSeq === 'number' ? timeline.lastReadSeq : null);
        setHasOlderRows(Boolean(timeline.timelinePage?.hasOlderRows));
        setOutline((toc.items ?? []).map((item) => ({
          id: item.id,
          role: item.role,
          preview: item.preview
        })));
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
      } finally {
        if (!cancelled) setLoadingOlder(false);
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
  }, [segmentLimit, threadId, upsertThread]);

  const markRead = useCallback(() => {
    if (!threadId) return;
    void product.threads.read(threadId).then((body) => {
      const seq = (body.thread as { lastReadSeq?: number }).lastReadSeq;
      if (typeof seq === 'number') setLastReadSeq(seq);
    }).catch(() => undefined);
  }, [threadId]);

  const jumpTo = useCallback((id: string) => {
    const node = document.querySelector(`[data-row-id="${CSS.escape(id)}"]`);
    if (node) {
      node.scrollIntoView({ block: 'center' });
      return;
    }
    setLoadingOlder(true);
    setSegmentLimit((current) => current + INITIAL_SEGMENT_LIMIT);
  }, []);

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
      <div className={`thread-detail-body${showDiff ? ' is-diff' : ''}`}>
        <ThreadTimeline
          threadId={threadId}
          rows={rows}
          status={status}
          thinking={thinking}
          todos={todos}
          goal={goal}
          activeWorkflows={workflows}
          activePromptMode={promptMode}
          contextWindowUsage={contextWindow}
          lastReadSeq={lastReadSeq}
          hasOlderRows={hasOlderRows}
          loadingOlder={loadingOlder}
          onLoadOlder={() => {
            setLoadingOlder(true);
            setSegmentLimit((current) => current + INITIAL_SEGMENT_LIMIT);
          }}
          onReachedBottom={markRead}
          onCopy={(text) => {
            void navigator.clipboard?.writeText(text);
          }}
          onTitleAction={(action) => {
            if (action.kind === 'open-file-diff') {
              setDiffPath(action.path);
              setShowDiff(true);
            }
          }}
          onTitleLink={(link) => {
            if (link.kind === 'thread') navigate(getThreadRoutePath(link.threadId));
          }}
          onOpenDiff={(path) => {
            setDiffPath(path);
            setShowDiff(true);
          }}
          onAnswer={(text) => {
            void product.threads.send(threadId, [{ type: 'text', text }], 'auto');
          }}
        />
        {showDiff && environmentId ? (
          <ThreadDiffPanel
            environmentId={environmentId}
            path={diffPath}
            onClose={() => setShowDiff(false)}
          />
        ) : (
          <ThreadConversationToc items={outline} onJump={jumpTo} />
        )}
      </div>
      <ThreadWorkspaceBanner
        environmentId={environmentId}
        onOpenDiff={(path) => {
          setDiffPath(path ?? null);
          setShowDiff(true);
        }}
      />
      <ThreadCommandComposer
        threadId={threadId}
        environmentLabel={isWorktree ? 'This checkout' : 'Local'}
        onOpenExplorer={projectId ? () => navigate(getProjectWorkspaceRoutePath(projectId, 'explorer')) : undefined}
      />
    </section>
  );
}
