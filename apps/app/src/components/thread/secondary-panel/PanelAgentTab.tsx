import { lazy, Suspense } from 'react';
import { ThreadCommandComposer } from '../../ThreadCommandComposer.js';

const ThreadDetailLazy = lazy(async () => {
  const mod = await import('../../../views/threads/ThreadDetailView.js');
  return { default: mod.ThreadDetail };
});

/**
 * Side-panel agent: a composer until the first send, then that thread's chat.
 * Creation never navigates, so the page beside the panel stays in view. With
 * `pluginPanel`, the thread is bound to that plugin, which can give it tools.
 */
export function PanelAgentTab({
  threadId,
  pluginPanel,
  onCreated
}: {
  threadId?: string;
  pluginPanel?: { pluginId: string; panel: string };
  onCreated: (threadId: string) => void;
}) {
  if (threadId) {
    return (
      <div className="panel-agent-tab is-chat" data-testid="panel-agent-tab-chat">
        <Suspense fallback={null}>
          <ThreadDetailLazy threadId={threadId} embedded />
        </Suspense>
      </div>
    );
  }
  return (
    <div className="panel-agent-tab is-composer" data-testid="panel-agent-tab-composer">
      <p className="panel-agent-tab-hint">Ask an agent without leaving this page.</p>
      <ThreadCommandComposer autoFocus navigateOnCreate={false} pluginPanel={pluginPanel} onCreated={onCreated} />
    </div>
  );
}
