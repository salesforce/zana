import { useEffect, useRef, useState, type CSSProperties, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Archive, GitFork, Mail, MoreHorizontal, Pencil, Square } from 'lucide-react';
import { product } from '../../lib/product-client.js';
import { getAgentsRoutePath, getProjectRoutePath, getThreadRoutePath } from '../../lib/route-paths.js';
import { useRouteState } from '../../hooks/useRouteState.js';
import { useThreads } from '../../thread-store.js';
import { PromptModal } from '../PromptModal.js';
import { shouldShowThreadStop } from './thread-timeline-model.js';

/** Viewport coords for the overflow menu. Fixed + portaled so the timeline cannot steal clicks. */
export function threadOverflowMenuPosition(rect: Pick<DOMRect, 'bottom' | 'left'>): CSSProperties {
  return { top: rect.bottom + 4, left: rect.left };
}

export function ThreadDetailOverflowMenu({
  canStop,
  onUnread,
  onRename,
  onFork,
  onStop,
  onArchive,
  menuRef,
  style
}: {
  canStop: boolean;
  onUnread: () => void;
  onRename: () => void;
  onFork: () => void;
  onStop: () => void;
  onArchive: () => void;
  menuRef?: Ref<HTMLDivElement>;
  style?: CSSProperties;
}) {
  return (
    <div
      ref={menuRef}
      className="tab-context-menu thread-detail-overflow-menu"
      role="menu"
      aria-label="Thread actions"
      data-testid="thread-overflow-menu"
      style={style}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button type="button" role="menuitem" onClick={onUnread}>
        <Mail size={13} /> Mark unread
      </button>
      <button type="button" role="menuitem" onClick={onRename}>
        <Pencil size={13} /> Rename
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onFork}
        title="Start a new thread from this conversation"
      >
        <GitFork size={13} /> Fork
      </button>
      {canStop ? (
        <button
          type="button"
          role="menuitem"
          onClick={onStop}
          title="Stop this thread. The conversation stays in the list."
        >
          <Square size={13} /> Stop
        </button>
      ) : null}
      <div className="tab-context-sep" />
      <button
        type="button"
        role="menuitem"
        className="tab-context-danger"
        onClick={onArchive}
        title="Archive this thread and remove it from the list"
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
  projectId,
  onRenamed,
  onUnread
}: {
  threadId: string;
  title: string;
  status: string;
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
  const canStop = shouldShowThreadStop(threadId, status);
  const scopedProjectId = projectId && route.isProjectWorkspace ? projectId : null;

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
        void product.threads.stop(threadId);
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
        aria-label="Thread actions"
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
          title="Rename thread"
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
