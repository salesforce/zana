import { useEffect, useRef, useState, type CSSProperties, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Archive, GitFork, Mail, MailCheck, MoreHorizontal, Pencil, Square } from 'lucide-react';
import { product } from '../../lib/product-client.js';
import { getAgentsRoutePath, getProjectRoutePath, getThreadRoutePath } from '../../lib/route-paths.js';
import { useRouteState } from '../../hooks/useRouteState.js';
import { useThreads } from '../../thread-store.js';
import { PromptModal } from '../PromptModal.js';
import { shouldShowThreadStop } from './thread-timeline-model.js';
import { dispatchThreadStopRequested } from './timeline/thread-optimistic-events.js';

/** Viewport coords for the overflow menu. Fixed + portaled so the timeline cannot steal clicks. */
export function threadOverflowMenuPosition(rect: Pick<DOMRect, 'bottom' | 'left'>): CSSProperties {
  return { top: rect.bottom + 4, left: rect.left };
}

/** Fork stays wired; hide the menu item until the flow is ready. */
export const SHOW_THREAD_FORK = true;

/** Mark unread stays wired; hide the menu item until the flow is ready. */
export const SHOW_THREAD_UNREAD = true;

export function ThreadDetailOverflowMenu({
  canStop,
  onUnread,
  onRename,
  onFork,
  onStop,
  onArchive,
  onCloseFollowup,
  menuRef,
  style
}: {
  canStop: boolean;
  onUnread: () => void;
  onRename: () => void;
  onFork: () => void;
  onStop: () => void;
  onArchive: () => void;
  onCloseFollowup: () => void;
  menuRef?: Ref<HTMLDivElement>;
  style?: CSSProperties;
}) {
  return (
    <div
      ref={menuRef}
      className="tab-context-menu thread-detail-overflow-menu"
      role="menu"
      aria-label="Agent actions"
      data-testid="thread-overflow-menu"
      style={style}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {SHOW_THREAD_UNREAD ? (
        <button type="button" role="menuitem" onClick={onUnread}>
          <Mail size={13} /> Mark unread
        </button>
      ) : null}
      <button type="button" role="menuitem" onClick={onRename}>
        <Pencil size={13} /> Rename
      </button>
      {SHOW_THREAD_FORK ? (
        <button
          type="button"
          role="menuitem"
          onClick={onFork}
          title="Start a new agent from this conversation"
        >
          <GitFork size={13} /> Fork
        </button>
      ) : null}
      {canStop ? (
        <button
          type="button"
          role="menuitem"
          onClick={onStop}
          title="Stop this agent. The conversation stays in the list."
        >
          <Square size={13} /> Stop
        </button>
      ) : null}
      <button
        type="button"
        role="menuitem"
        onClick={onCloseFollowup}
        title="Close the agent, summarising its work to your inbox and filing a follow-up if it left something unfinished"
      >
        <MailCheck size={13} /> Close with follow-up
      </button>
      <div className="tab-context-sep" />
      <button
        type="button"
        role="menuitem"
        className="tab-context-danger"
        onClick={onArchive}
        title="Archive this agent and remove it from the list"
      >
        <Archive size={13} /> Archive
      </button>
    </div>
  );
}

export function ThreadDetailOverflow({
  threadId,
  title,
  status,
  inFlightRetry = false,
  projectId,
  onRenamed,
  onUnread
}: {
  threadId: string;
  title: string;
  status: string;
  inFlightRetry?: boolean;
  projectId: string | null;
  onRenamed?: (title: string) => void;
  onUnread?: () => void;
}) {
  const navigate = useNavigate();
  const route = useRouteState();
  const remove = useThreads((s) => s.remove);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [menuPos, setMenuPos] = useState<CSSProperties>({});
  const canStop = shouldShowThreadStop(threadId, status, inFlightRetry);
  const scopedProjectId = projectId && route.isProjectFocused ? projectId : null;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(false);
  const menu = (
    <ThreadDetailOverflowMenu
      menuRef={menuRef}
      style={menuPos}
      canStop={canStop}
      onUnread={() => {
        close();
        void product.threads.unread(threadId).then(() => onUnread?.()).catch(() => undefined);
      }}
      onRename={() => {
        close();
        queueMicrotask(() => setRenaming(true));
      }}
      onFork={() => {
        close();
        void product.threads.fork(threadId).then((forked) => {
          if (forked.ok && forked.value?.id) {
            navigate(getThreadRoutePath(forked.value.id, scopedProjectId));
          }
        });
      }}
      onStop={() => {
        close();
        dispatchThreadStopRequested(threadId);
        void product.threads.stop(threadId);
      }}
      onCloseFollowup={() => {
        close();
        if (!window.confirm(`Close “${title}” and file a follow-up if work is left?`)) return;
        void product.threads.closeFollowup(threadId).then((result) => {
          if (result && result.ok === false) return;
          remove(threadId);
          navigate(scopedProjectId ? getProjectRoutePath(scopedProjectId) : getAgentsRoutePath());
        });
      }}
      onArchive={() => {
        close();
        if (!window.confirm(`Archive “${title}”?`)) return;
        void product.threads.archive(threadId).then((result) => {
          if (result && result.ok === false) return;
          remove(threadId);
          navigate(scopedProjectId ? getProjectRoutePath(scopedProjectId) : getAgentsRoutePath());
        });
      }}
    />
  );

  return (
    <div className="thread-detail-overflow-wrap" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className="icon-btn thread-detail-overflow-btn"
        aria-label="Agent actions"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="thread-overflow-trigger"
        onClick={() => {
          const rect = triggerRef.current?.getBoundingClientRect();
          if (rect) setMenuPos(threadOverflowMenuPosition(rect));
          setOpen((value) => !value);
        }}
      >
        <MoreHorizontal size={16} />
      </button>
      {open ? (typeof document === 'undefined' ? menu : createPortal(menu, document.body)) : null}
      {renaming ? (
        <PromptModal
          title="Rename agent"
          label="Title"
          initialValue={title}
          confirmLabel="Rename"
          onClose={() => setRenaming(false)}
          onSubmit={(next) => {
            setRenaming(false);
            onRenamed?.(next);
            void product.threads.rename(threadId, next).catch(() => undefined);
          }}
        />
      ) : null}
    </div>
  );
}
