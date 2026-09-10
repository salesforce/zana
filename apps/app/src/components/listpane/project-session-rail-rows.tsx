import type { MouseEvent } from 'react';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';
import { profileIcon } from '../../lib/profileIcon.js';
import { AgentDeleteQuickAction } from '../agentCardActions.js';
import { ThreadArchiveQuickAction } from '../threadCardActions.js';
import { usePaneContentSplitDrag, useThreadRowSplitDrag } from '../sidebar/useThreadRowSplitDrag.js';
import { usePaneContentSplitIndicator } from '../sidebar/paneContentSplitIndicator.js';
import { SplitPaneMiniMap } from '../sidebar/SplitPaneMiniMap.js';
import { ProviderIcon } from '../thread/pickers/ProviderIcon.js';
import {
  fleetKindLabel,
  threadRailStatus,
  threadRailStatusClass,
  threadTitle
} from '../fleet-item.js';
import type { ThreadListItem } from '../../thread-store.js';
import { AgentRowDetail } from './AgentRowDetail.js';

export function ProjectAgentRailRow({
  session,
  projectId,
  projectRemote = false,
  isUnread,
  active,
  onOpen,
  onContextMenu
}: {
  session: TerminalSession;
  projectId: string;
  projectRemote?: boolean;
  isUnread: boolean;
  active: boolean;
  onOpen: () => void;
  onContextMenu: (e: MouseEvent) => void;
}) {
  const title = session.cohort?.executionJobTitle?.trim() || session.title;
  const { onPointerDown, openInSplit } = usePaneContentSplitDrag({
    content: { kind: 'agent-session', projectId, sessionId: session.id },
    title
  });
  const indicator = usePaneContentSplitIndicator({
    kind: 'agent-session',
    projectId,
    sessionId: session.id
  });
  return (
    <div role="listitem" className="project-thread-row-wrap">
      <button
        type="button"
        className={`project-terminal-row ${isUnread ? 'unread' : ''}${active ? ' active' : ''}`}
        data-kind="agent"
        onPointerDown={(e) => {
          e.stopPropagation();
          onPointerDown?.(e);
        }}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            openInSplit();
            return;
          }
          onOpen();
        }}
        onContextMenu={onContextMenu}
        aria-label={isUnread ? `${title}, unread output` : title}
        aria-current={active ? 'true' : undefined}
        title={isUnread ? `${title} · unread output` : title}
      >
        <span className={`tab-profile-icon profile-${session.profile}`} aria-hidden="true">
          {profileIcon(session.profile)}
        </span>
        <span className="project-terminal-text">
          <span className="project-terminal-name">{title}</span>
          <AgentRowDetail session={session} projectRemote={projectRemote} />
        </span>
        {indicator.miniMap ? (
          <SplitPaneMiniMap slots={indicator.miniMap} label={`${title} split position`} />
        ) : null}
      </button>
      {!session.scheduled && <AgentDeleteQuickAction session={session} projectId={projectId} />}
    </div>
  );
}

export function ProjectThreadRailRow({
  thread,
  active,
  projectId,
  onOpen,
  onContextMenu
}: {
  thread: ThreadListItem;
  active: boolean;
  projectId: string;
  onOpen: () => void;
  onContextMenu: (e: MouseEvent) => void;
}) {
  const title = threadTitle(thread);
  const status = threadRailStatus(thread);
  const { onPointerDown, openInSplit } = useThreadRowSplitDrag({
    projectId,
    threadId: thread.id,
    title
  });
  const indicator = usePaneContentSplitIndicator({
    kind: 'thread',
    projectId,
    threadId: thread.id
  });
  return (
    <div role="listitem" className="project-thread-row-wrap">
      <button
        type="button"
        className={`project-terminal-row is-thread${active ? ' active' : ''}`}
        data-kind="thread"
        data-testid="project-thread-row"
        onPointerDown={(e) => {
          e.stopPropagation();
          onPointerDown?.(e);
        }}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            openInSplit();
            return;
          }
          onOpen();
        }}
        onContextMenu={onContextMenu}
        aria-label={title}
        aria-current={active ? 'true' : undefined}
        title={`${title} · ${thread.status}`}
      >
        <span className="tab-profile-icon" aria-hidden="true">
          <ProviderIcon providerId={thread.providerId} size={14} />
        </span>
        <span className="project-terminal-text">
          <span className="project-terminal-name">{title}</span>
          <span className="project-terminal-detail">
            <span className={threadRailStatusClass(status)}>{status}</span>
            {` · ${fleetKindLabel('thread')}`}
          </span>
        </span>
        {indicator.miniMap ? (
          <SplitPaneMiniMap slots={indicator.miniMap} label={`${title} split position`} />
        ) : null}
      </button>
      <ThreadArchiveQuickAction thread={thread} />
    </div>
  );
}
