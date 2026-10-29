import { lazy, Suspense, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, MessageSquare } from 'lucide-react';
import { PluginAssistantContext } from '../../../plugins/plugin-assistant-context.js';
import { ThreadCommandComposer } from '../../ThreadCommandComposer.js';
import { ComposerDraftProvider } from '../../composer/ComposerDraft.js';
import { product } from '../../../lib/product-client.js';
import { useData } from '../../../store.js';
import { getThreadRoutePath } from '../../../lib/route-paths.js';
import { getPluginViewTarget } from '../../../lib/pluginViewSurface.js';
import { showInMainWindow } from '../../../plugins/plugin-view-windows.js';

const ThreadDetailLazy = lazy(async () => {
  const mod = await import('../../../views/threads/ThreadDetailView.js');
  return { default: mod.ThreadDetail };
});

function ago(ts: number, now = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - ts) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}

/** Enough to resume recent work without turning the composer into a list view. */
export const PANEL_AGENT_RECENT_LIMIT = 5;

export interface PanelConversation {
  id: string;
  title: string | null;
  updatedAt: number;
}

/**
 * Side-panel agent: a composer until the first send, then that thread's chat.
 * A plugin page may prefill the composer (`draft`); the harness, model and
 * send stay the user's, exactly as in the main composer.
 * Creation never navigates, so the page beside the panel stays in view. With
 * `pluginPanel`, the thread is bound to that plugin (main grounds it on the
 * page and the plugin can give it tools). Bound threads are hidden from the
 * Agents list, so the composer lists them to reopen, and the chat can be
 * promoted with Open as thread.
 */
export function PanelAgentTab({
  threadId,
  draft,
  draftProjectId,
  projectId,
  resourceLabel,
  pluginPanel,
  onCreated,
  onOpenConversation
}: {
  threadId?: string;
  /** Text the plugin page prefilled; the user still picks the harness and sends. */
  draft?: string;
  /** Project the prefilled composer starts on; the user can still change it. */
  draftProjectId?: string;
  /** The page's own project: new threads run there, with no project or machine to pick. */
  projectId?: string;
  /** Human-readable identity of the page resource this assistant belongs to. */
  resourceLabel?: string;
  pluginPanel?: { pluginId: string; panel: string; view?: string };
  onCreated: (threadId: string) => void;
  onOpenConversation?: (conversation: PanelConversation) => void;
}) {
  const project = useData((s) => (projectId ? s.projects.find((row) => row.id === projectId) : undefined));
  if (threadId) {
    return (
      <div className="panel-agent-tab is-chat" data-testid="panel-agent-tab-chat">
        {pluginPanel ? <OpenAsThreadBar threadId={threadId} /> : null}
        <Suspense fallback={null}>
          <PluginAssistantContext.Provider value={pluginPanel?.pluginId ?? null}>
            <ThreadDetailLazy threadId={threadId} embedded />
          </PluginAssistantContext.Provider>
        </Suspense>
      </div>
    );
  }
  return (
    <div className="panel-agent-tab is-composer" data-testid="panel-agent-tab-composer">
      {pluginPanel && onOpenConversation ? (
        <RecentPanelConversations key={JSON.stringify([pluginPanel.pluginId, pluginPanel.panel, projectId, pluginPanel.view])} pluginId={pluginPanel.pluginId} panel={pluginPanel.panel} projectId={projectId} view={pluginPanel.view} onOpen={onOpenConversation} />
      ) : null}
      <p className="panel-agent-tab-hint">
        {resourceLabel ? `Ask about ${resourceLabel}.` : pluginPanel
          ? 'Ask about this page. The agent knows which plugin it is next to.'
          : 'Ask an agent without leaving this page.'}
      </p>
      <ComposerDraftProvider sessionKey={pluginPanel ? JSON.stringify(['panel', pluginPanel.pluginId, pluginPanel.panel, projectId ?? draftProjectId ?? null, pluginPanel.view ?? null]) : undefined}>
      <ThreadCommandComposer
        autoFocus
        navigateOnCreate={false}
        initialText={draft}
        project={project}
        composerProjectId={draftProjectId ?? projectId}
        pluginPanel={pluginPanel}
        onCreated={onCreated}
      />
      </ComposerDraftProvider>
    </div>
  );
}

function RecentPanelConversations({
  pluginId,
  panel,
  projectId,
  view,
  onOpen
}: {
  pluginId: string;
  panel: string;
  projectId?: string;
  view?: string;
  onOpen: (conversation: PanelConversation) => void;
}) {
  const [conversations, setConversations] = useState<PanelConversation[]>([]);
  useEffect(() => {
    let cancelled = false;
    product.threads.panelConversations(pluginId, panel, { projectId, view })
      .then((rows) => {
        if (!cancelled) setConversations(rows.slice(0, PANEL_AGENT_RECENT_LIMIT));
      })
      // Reopening is a convenience; a failed lookup leaves the composer usable.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pluginId, panel, projectId, view]);

  if (conversations.length === 0) return null;
  return (
    <section className="panel-agent-recents" data-testid="panel-agent-recents" aria-label="Recent conversations">
      <h3 className="panel-agent-recents-title">Recent conversations</h3>
      <ul className="panel-agent-recents-list">
        {conversations.map((conversation) => (
          <li key={conversation.id}>
            <button
              type="button"
              className="panel-agent-recent"
              data-testid="panel-agent-recent"
              onClick={() => onOpen(conversation)}
            >
              <MessageSquare size={12} aria-hidden="true" />
              <span className="panel-agent-recent-title">{conversation.title || 'Untitled conversation'}</span>
              <span className="panel-agent-recent-time">{ago(conversation.updatedAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function OpenAsThreadBar({ threadId }: { threadId: string }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="panel-agent-tab-bar">
      {error ? <span className="panel-agent-tab-error" role="alert">{error}</span> : null}
      <button
        type="button"
        className="panel-agent-tab-open"
        data-testid="panel-agent-open-as-thread"
        title="Move this conversation into the Agents list"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void product.threads.openAsThread(threadId)
            .then(() => {
              // A plugin view window has no routes: the thread opens in the main window.
              if (getPluginViewTarget()) void showInMainWindow(getThreadRoutePath(threadId));
              else void navigate(getThreadRoutePath(threadId));
            })
            .catch((err: unknown) => {
              setError(err instanceof Error ? err.message : 'Could not open as thread');
              setBusy(false);
            });
        }}
      >
        <ExternalLink size={12} aria-hidden="true" />
        Open as thread
      </button>
    </div>
  );
}
