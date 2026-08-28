import { useCallback, useEffect, useRef, useState } from 'react';
import { GripVertical, Pencil, Send, Trash2 } from 'lucide-react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { GitHostPullRequest, WorkspaceStatus } from '@zana-ai/zcc-domain';
import type { ThreadTimelineModelFallback } from '@zana-ai/zcc-domain/thread-runtime';
import type { TimelineViewWorkflowWorkRow } from '@zana-ai/zcc-thread-view';
import { product } from '../../../lib/product-client.js';
import { handleHttpLinkClick } from '../../../lib/in-app-browser-link-preference.js';
import { POST_DRAG_CLICK_SUPPRESS_MS, suppressPostDragClick } from '../../../lib/suppress-post-drag-click.js';
import { loadWorkspaceMeta } from '../secondary-panel/threadSecondaryPanelLogic.js';
import { queuedMessageTextFromUnknown } from './queued-message-text.js';
import { previousQueuedIdAfterReorder } from './queued-reorder.js';

interface QueuedMessageView {
  id: string;
  text: string;
  updatedAt: number;
  raw: unknown;
}

export function QueuedMessagesCard({ threadId }: { threadId: string }) {
  const [items, setItems] = useState<QueuedMessageView[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const refresh = useCallback(() => {
    void product.threads.queuedMessages(threadId).then((list) => {
      const rows = Array.isArray(list) ? list : [];
      setItems(rows.map((row) => {
        const record = row as { id?: string; updatedAt?: number };
        return {
          id: typeof record.id === 'string' ? record.id : '',
          text: queuedMessageTextFromUnknown(row),
          updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : 0,
          raw: row
        };
      }).filter((row) => row.id));
    }).catch(() => undefined);
  }, [threadId]);

  useEffect(() => {
    refresh();
    const stop = product.threads.onUpdated((payload) => {
      if (payload && typeof payload === 'object' && 'id' in payload && (payload as { id: unknown }).id === threadId) {
        refresh();
      }
    });
    return stop;
  }, [refresh, threadId]);

  const suppressClickRef = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const clearClickSuppress = () => {
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, POST_DRAG_CLICK_SUPPRESS_MS);
  };

  const onDragStart = ({ activatorEvent }: DragStartEvent) => {
    suppressClickRef.current = activatorEvent.type === 'pointerdown';
  };

  const onDragEnd = (event: DragEndEvent) => {
    if (suppressClickRef.current) suppressPostDragClick();
    clearClickSuppress();
    const overId = event.over?.id;
    if (typeof overId !== 'string') return;
    const ids = items.map((item) => item.id);
    const previous = previousQueuedIdAfterReorder(ids, String(event.active.id), overId);
    if (previous === undefined) return;
    void product.threads.reorderQueuedMessage(threadId, String(event.active.id), previous).then(refresh);
  };

  const onDragCancel = () => {
    if (suppressClickRef.current) suppressPostDragClick();
    clearClickSuppress();
  };

  if (items.length === 0) return null;
  return (
    <section className="thread-composer-stack-card" data-testid="thread-queued-messages">
      <header className="thread-stack-card-title">Queued</header>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
          <ul className="thread-queued-list">
            {items.map((item) => (
              <SortableQueuedItem
                key={item.id}
                item={item}
                editing={editingId === item.id}
                draft={draft}
                onDraft={setDraft}
                onEdit={() => {
                  setEditingId(item.id);
                  setDraft(item.text);
                }}
                onCancel={() => setEditingId(null)}
                onSave={() => {
                  void product.threads.updateQueuedMessage(threadId, item.id, {
                    input: [{ type: 'text', text: draft, mentions: [] }],
                    expectedUpdatedAt: item.updatedAt
                  }).then(() => {
                    setEditingId(null);
                    refresh();
                  });
                }}
                onSend={() => {
                  void product.threads.sendQueuedMessage(threadId, item.id, 'auto').then(refresh);
                }}
                onDelete={() => {
                  void product.threads.deleteQueuedMessage(threadId, item.id).then(refresh);
                }}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </section>
  );
}

function SortableQueuedItem({
  item,
  editing,
  draft,
  onDraft,
  onEdit,
  onCancel,
  onSave,
  onSend,
  onDelete
}: {
  item: QueuedMessageView;
  editing: boolean;
  draft: string;
  onDraft: (value: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onSend: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({
    id: item.id,
    animateLayoutChanges: () => false
  });
  return (
    <li
      ref={setNodeRef}
      className={`thread-queued-item${isDragging ? ' is-dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform) ?? undefined }}
    >
      <button type="button" className="thread-queued-handle" aria-label="Reorder queued message" {...attributes} {...listeners}>
        <GripVertical size={12} />
      </button>
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <input value={draft} onChange={(event) => onDraft(event.target.value)} aria-label="Edit queued message" />
          <button type="submit">Save</button>
          <button type="button" onClick={onCancel}>Cancel</button>
        </form>
      ) : (
        <p>{item.text}</p>
      )}
      <div className="thread-queued-actions">
        <button type="button" aria-label="Edit queued message" onClick={onEdit}>
          <Pencil size={12} />
        </button>
        <button type="button" aria-label="Send queued message" onClick={onSend}>
          <Send size={12} />
        </button>
        <button type="button" aria-label="Delete queued message" onClick={onDelete}>
          <Trash2 size={12} />
        </button>
      </div>
    </li>
  );
}

export function ModelFallbackCard({ fallback }: { fallback: ThreadTimelineModelFallback | null | undefined }) {
  if (!fallback) return null;
  return (
    <section className="thread-composer-stack-card" data-testid="thread-model-fallback">
      <strong>Model fallback</strong>
      <p>{fallback.originalModel} → {fallback.fallbackModel}</p>
      <p className="thread-banner-meta">{fallback.message}</p>
    </section>
  );
}

export function BackgroundCommandsCard({
  commands
}: {
  commands: TimelineViewWorkflowWorkRow[] | null | undefined;
}) {
  if (!commands?.length) return null;
  return (
    <section className="thread-composer-stack-card" data-testid="thread-background-commands">
      <header className="thread-stack-card-title">Background commands</header>
      <ul>
        {commands.map((command) => (
          <li key={command.id}>{command.workflowName || command.description || 'Running'}</li>
        ))}
      </ul>
    </section>
  );
}

const PROMPT_CONTEXT_POLL_MS = 3_000;

export function PromptContextBanner({
  branchName,
  isWorktree,
  parentThreadId,
  childCount,
  environmentId,
  onReview
}: {
  branchName?: string | null;
  isWorktree?: boolean;
  parentThreadId?: string | null;
  childCount?: number;
  environmentId?: string | null;
  onReview?: () => void;
}) {
  const [dirtyCount, setDirtyCount] = useState(0);
  const [filesTruncated, setFilesTruncated] = useState(false);
  const [pullRequest, setPullRequest] = useState<GitHostPullRequest | null>(null);

  useEffect(() => {
    if (!environmentId) {
      setDirtyCount(0);
      setFilesTruncated(false);
      setPullRequest(null);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      void loadWorkspaceMeta(
        product.environments.status,
        product.environments.pullRequest,
        environmentId
      ).then(({ status, pullRequest: nextPr }) => {
        if (cancelled) return;
        const workspace = status as WorkspaceStatus | null;
        setDirtyCount(workspace?.dirty ? workspace.files.length : 0);
        setFilesTruncated(Boolean(workspace?.filesTruncated));
        setPullRequest((nextPr as GitHostPullRequest | null) ?? null);
      });
    };
    refresh();
    const timer = window.setInterval(refresh, PROMPT_CONTEXT_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [environmentId]);

  const bits = [
    branchName ? `git: ${branchName}` : null,
    isWorktree ? 'worktree' : null,
    dirtyCount > 0 ? `${dirtyCount}${filesTruncated ? '+' : ''} uncommitted` : null,
    parentThreadId ? 'child thread' : null,
    childCount && childCount > 0 ? `${childCount} child ${childCount === 1 ? 'agent' : 'agents'}` : null
  ].filter(Boolean);
  if (bits.length === 0 && !pullRequest) return null;
  return (
    <div className="thread-composer-stack-card thread-prompt-context" data-testid="thread-prompt-context">
      <span>{bits.join(' · ')}</span>
      {dirtyCount > 0 && onReview ? (
        <button type="button" className="thread-prompt-context-review" onClick={onReview}>
          Review
        </button>
      ) : null}
      {pullRequest ? (
        <a
          className="thread-prompt-context-pr"
          href={pullRequest.url}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            if (handleHttpLinkClick(pullRequest.url)) event.preventDefault();
          }}
        >
          PR #{pullRequest.number}
        </a>
      ) : null}
    </div>
  );
}
