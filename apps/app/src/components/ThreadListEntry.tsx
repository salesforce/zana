import { useNavigate } from 'react-router-dom';
import type { MouseEvent } from 'react';
import type { ThreadListItem } from '../thread-store.js';
import { getThreadRoutePath } from '../lib/route-paths.js';
import { isBusyThreadStatus, threadStatusLabel, threadStatusTone } from './thread/thread-timeline-model.js';
import { useThreadWorkingPhrase } from './thread/useThreadWorkingPhrase.js';
import { ProviderIcon } from './thread/pickers/ProviderIcon.js';
import { FleetKindChip } from './FleetKindChip.js';
import { useThreadRowSplitDrag } from './sidebar/useThreadRowSplitDrag.js';
import { usePaneContentSplitIndicator } from './sidebar/paneContentSplitIndicator.js';
import { SplitPaneMiniMap } from './sidebar/SplitPaneMiniMap.js';

export function ThreadListEntry({
  thread,
  projectName,
  projectId,
  active = false,
  onContextMenu
}: {
  thread: ThreadListItem;
  projectName?: string;
  projectId?: string | null;
  active?: boolean;
  onContextMenu?: (e: MouseEvent) => void;
}) {
  const navigate = useNavigate();
  const waitingOnUser = thread.status !== 'error' && Boolean(thread.hasPendingInteraction);
  const working = isBusyThreadStatus(thread.status) && !waitingOnUser;
  const workingPhrase = useThreadWorkingPhrase(working);
  const tone = threadStatusTone(thread.status, waitingOnUser);
  const statusLabel = threadStatusLabel(thread.status, waitingOnUser, null, workingPhrase);
  const resolvedProjectId = projectId ?? thread.projectId;
  const { onPointerDown, openInSplit } = useThreadRowSplitDrag({
    projectId: resolvedProjectId,
    threadId: thread.id,
    title: thread.title ?? 'Untitled agent'
  });
  const indicator = usePaneContentSplitIndicator({
    kind: 'thread',
    projectId: resolvedProjectId,
    threadId: thread.id
  });
  return (
    <button
      type="button"
      className={`agents-row is-thread ${active ? 'active' : ''}`}
      data-testid="thread-list-entry"
      data-kind="thread"
      data-status={thread.status}
      onPointerDown={onPointerDown}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          openInSplit();
          return;
        }
        navigate(getThreadRoutePath(thread.id, projectId));
      }}
      onContextMenu={onContextMenu}
      aria-current={active ? 'true' : undefined}
      title={`${thread.title ?? 'Untitled agent'}${projectName ? ` — ${projectName}` : ''} · ${thread.status}`}
    >
      <span className="agents-row-icon">
        <ProviderIcon providerId={thread.providerId} size={13} />
      </span>
      <span className="agents-row-text">
        <span className="agents-row-title-line">
          <span className={`tab-agent-dot agent-${tone}`} aria-hidden="true" />
          <span className="agents-row-title">{thread.title ?? 'Untitled agent'}</span>
          <FleetKindChip kind="thread" />
          {indicator.miniMap ? (
            <SplitPaneMiniMap slots={indicator.miniMap} label="Split position" isWorking={working} />
          ) : null}
        </span>
        <span className="agents-row-meta">
          {projectName && <span className="agents-row-project">{projectName}</span>}
          {waitingOnUser ? (
            <span className="agents-row-needs-you">Needs you</span>
          ) : working ? (
            <span className="thread-list-entry-working is-shimmer" data-testid="thread-list-entry-working">
              {workingPhrase}
            </span>
          ) : (
            <span className={thread.status === 'error' ? 'agents-row-needs-you' : 'agents-row-duration'}>
              {statusLabel || thread.status}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}
