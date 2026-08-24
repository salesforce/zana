import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PanelRight } from 'lucide-react';
import type { ActiveThinking, ThreadTimelineGoal, ThreadTimelinePendingTodos } from '@zana-ai/zcc-domain/thread-runtime';
import type { ThreadContextWindowUsage, TimelineRow } from '@zana-ai/zcc-server-contract';
import type { TimelineViewWorkflowWorkRow } from '@zana-ai/zcc-thread-view';
import { product } from '../../lib/product-client.js';
import { ThreadCommandComposer } from '../../components/ThreadCommandComposer.js';
import { ThreadTimeline } from '../../components/thread/ThreadTimeline.js';
import { ThreadConversationToc } from '../../components/thread/ThreadConversationToc.js';
import { ThreadDiffPanel } from '../../components/thread/ThreadDiffPanel.js';
import { ThreadWorkspaceBanner } from '../../components/thread/ThreadWorkspaceBanner.js';
import { isBusyThreadStatus } from '../../components/thread/thread-timeline-model.js';
import { ThreadStatusBadge } from '../../components/thread/timeline/ThreadBanners.js';
import { getProjectWorkspaceRoutePath, getThreadRoutePath } from '../../lib/route-paths.js';
import { useThreads } from '../../thread-store.js';
import { ThreadSecondaryPanel } from '../../components/thread/secondary-panel/ThreadSecondaryPanel.js';
import { ThreadInfoContent } from '../../components/thread/secondary-panel/ThreadInfoContent.js';
import { ThreadNewTabPage } from '../../components/thread/secondary-panel/ThreadNewTabPage.js';
import { ThreadFilePreviewTab } from '../../components/thread/secondary-panel/ThreadFilePreviewTab.js';
import { ThreadBrowserTab } from '../../components/thread/secondary-panel/ThreadBrowserTab.js';
import { ThreadTerminalTab } from '../../components/thread/secondary-panel/ThreadTerminalTab.js';
import { ThreadPluginTab } from '../../components/thread/secondary-panel/ThreadPluginTab.js';
import { useThreadSecondaryPanel } from '../../components/thread/secondary-panel/useThreadSecondaryPanel.js';
import {
  activeClosableTab,
  activePinnedView
} from '../../components/thread/secondary-panel/threadSecondaryPanelState.js';

const INITIAL_SEGMENT_LIMIT = 200;

export function ThreadDetailView() {
  const { threadId } = useParams<{ threadId: string }>();
  const navigate = useNavigate();
  const upsertThread = useThreads((s) => s.upsert);
  const panel = useThreadSecondaryPanel(threadId);
  const [title, setTitle] = useState('Thread');
  const [status, setStatus] = useState('starting');
  const [cwd, setCwd] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [environmentId, setEnvironmentId] = useState<string | null>(null);
  const [isWorktree, setIsWorktree] = useState(false);
  const [parentThreadId, setParentThreadId] = useState<string | null>(null);
  const [branchName, setBranchName] = useState<string | null>(null);
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
          parentThreadId?: string | null;
        };
        const nextStatus = thread.status ?? timeline.status;
        setTitle(thread.title?.trim() || 'Thread');
        setStatus(nextStatus);
        setCwd(typeof thread.cwd === 'string' ? thread.cwd : null);
        setProjectId(typeof thread.projectId === 'string' ? thread.projectId : null);
        setEnvironmentId(typeof thread.environmentId === 'string' ? thread.environmentId : null);
        setIsWorktree(thread.isWorktree ?? false);
        setParentThreadId(typeof thread.parentThreadId === 'string' ? thread.parentThreadId : null);
        setBranchName(thread.branchName ?? null);
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
            archivedAt: thread.archivedAt ?? null,
            parentThreadId: typeof thread.parentThreadId === 'string' ? thread.parentThreadId : null
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


  const openDiff = useCallback((path?: string | null) => {
    setDiffPath(path ?? null);
    panel.selectPin('diff');
  }, [panel]);

  const assignParent = useCallback(async (nextParentId: string | null) => {
    if (!threadId) return;
    await product.threads.update(threadId, { parentThreadId: nextParentId });
    setParentThreadId(nextParentId);
  }, [threadId]);

  const startPanelTerminal = useCallback(async () => {
    if (!projectId) return;
    const created = await product.terminals.create({
      projectId,
      profile: 'shell',
      cwd: cwd ?? undefined,
      cols: 80,
      rows: 24
    });
    if (created.ok) {
      panel.addTab({ kind: 'terminal', title: 'Terminal', sessionId: created.value.id });
    }
  }, [cwd, panel, projectId]);

  if (!threadId) return null;

  const pin = activePinnedView(panel.state);
  const closable = activeClosableTab(panel.state);
  const panelOpen = panel.state.isOpen;
  const viewClass = [
    'thread-detail-view',
    panelOpen ? 'is-secondary-open' : '',
    panel.state.isMaximized ? 'is-secondary-maximized' : ''
  ].filter(Boolean).join(' ');

  let panelBody = null;
  if (pin === 'info') {
    panelBody = (
      <ThreadInfoContent
        threadId={threadId}
        projectId={projectId}
        parentThreadId={parentThreadId}
        isWorktree={isWorktree}
        cwd={cwd}
        branchName={branchName}
        environmentId={environmentId}
        onAssignedParent={(next) => { void assignParent(next); }}
      />
    );
  } else if (pin === 'diff' && environmentId) {
    panelBody = (
      <ThreadDiffPanel
        environmentId={environmentId}
        path={diffPath}
        embedded
        onClose={() => panel.selectPin('info')}
      />
    );
  } else if (closable?.kind === 'new-tab') {
    panelBody = (
      <ThreadNewTabPage
        projectId={projectId}
        cwd={cwd}
        onOpenFile={(path, title) => panel.addTab({ kind: 'file-preview', title, path })}
        onOpenBrowser={() => panel.addTab({ kind: 'browser', title: 'Browser', url: 'https://example.com' })}
        onStartTerminal={() => { void startPanelTerminal(); }}
        onOpenPlugin={(moduleId, title) => panel.addTab({ kind: 'plugin', title, moduleId })}
      />
    );
  } else if (closable?.kind === 'file-preview' && closable.path) {
    panelBody = <ThreadFilePreviewTab threadId={threadId} path={closable.path} />;
  } else if (closable?.kind === 'browser') {
    panelBody = (
      <ThreadBrowserTab
        initialUrl={closable.url ?? 'https://example.com'}
        onUrlChange={(url) => panel.patchTab(closable.id, { url })}
      />
    );
  } else if (closable?.kind === 'terminal' && closable.sessionId && projectId) {
    panelBody = <ThreadTerminalTab sessionId={closable.sessionId} projectId={projectId} />;
  } else if (closable?.kind === 'plugin' && closable.moduleId) {
    panelBody = <ThreadPluginTab moduleId={closable.moduleId} projectId={projectId} />;
  } else if (pin === 'diff') {
    panelBody = <p className="thread-detail-empty">No environment is attached to this thread.</p>;
  }


  return (
    <section
      className={viewClass}
      data-testid="thread-detail"
      style={panelOpen ? { ['--thread-secondary-width' as string]: `${panel.state.widthPx}px` } : undefined}
    >
      <div className="thread-detail-main">
        <header className="thread-detail-header">
          <div className="thread-detail-heading">
            <h1>{title}</h1>
            <ThreadStatusBadge status={status} />
          </div>
          <div className="thread-detail-actions">
            {/* Fork / workspace shell / archive — parked until the chrome is useful
                on the create and detail surfaces.
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
            */}
            {!panelOpen ? (
              <button
                type="button"
                className="icon-btn"
                title="Show right panel"
                aria-label="Show right panel"
                data-testid="thread-secondary-show"
                onClick={panel.open}
              >
                <PanelRight size={14} />
              </button>
            ) : null}
          </div>
        </header>
        <div className="thread-detail-body">
          <ThreadTimeline
            threadId={threadId}
            rows={rows}
            status={status}
            thinking={thinking}
            todos={todos}
            goal={goal}
            activeWorkflows={workflows}
            activePromptMode={promptMode}
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
              if (action.kind === 'open-file-diff') openDiff(action.path);
            }}
            onTitleLink={(link) => {
              if (link.kind === 'thread') navigate(getThreadRoutePath(link.threadId));
            }}
            onOpenDiff={(path) => openDiff(path)}
            onAnswer={(text) => {
              void product.threads.send(threadId, [{ type: 'text', text }], 'auto');
            }}
          />
          {!panelOpen ? (
            <ThreadConversationToc items={outline} onJump={jumpTo} />
          ) : null}
        </div>
        <ThreadWorkspaceBanner
          environmentId={environmentId}
          onOpenDiff={(path) => openDiff(path)}
        />
        <ThreadCommandComposer
          threadId={threadId}
          status={status}
          environmentLabel={isWorktree ? 'This checkout' : 'Local'}
          contextWindowUsage={contextWindow}
          onOpenExplorer={projectId ? () => navigate(getProjectWorkspaceRoutePath(projectId, 'explorer')) : undefined}
        />
      </div>
      {panelOpen ? (
        <ThreadSecondaryPanel
          state={panel.state}
          showDiffPin={Boolean(environmentId)}
          onSelectInfo={() => panel.selectPin('info')}
          onSelectDiff={() => panel.selectPin('diff')}
          onNewTab={panel.openNewTab}
          onCloseTab={panel.closeTab}
          onActivateTab={panel.activateTab}
          onToggleMaximized={panel.toggleMaximized}
          onHide={panel.close}
          onResize={panel.setWidth}
        >
          {panelBody}
        </ThreadSecondaryPanel>
      ) : null}
    </section>
  );
}
