import { useEffect, useRef, useState, type CSSProperties, type Ref, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { AppWindow, Archive, FolderInput, GitFork, Mail, MailCheck, MoreHorizontal, Pencil, Search, Square } from 'lucide-react';
import { product } from '../../lib/product-client.js';
import { hasDesktopBridge } from '../../lib/app-surface.js';
import { isThreadViewSurface } from '../../lib/threadViewSurface.js';
import { openThreadViewWindow } from '../../lib/thread-view-windows.js';
import { getAgentsRoutePath, getProjectRoutePath, getThreadRoutePath } from '../../lib/route-paths.js';
import { useRouteState } from '../../hooks/useRouteState.js';
import { useThreads } from '../../thread-store.js';
import { withRunningProcessWarning } from '../../lib/thread-running-processes.js';
import { threadCloseFollowupConfirm, threadCloseFollowupToast } from '../../lib/thread-close-followup.js';
import { errorMessage, useData, useUi } from '../../store.js';
import { MobileActionSheet } from '../MobilePageHeader.js';
import { useCompactLayout } from '../../hooks/useCompactLayout.js';
import { PromptModal } from '../PromptModal.js';
import { shouldShowThreadStop } from './thread-timeline-model.js';
import { dispatchThreadStopRequested } from './timeline/thread-optimistic-events.js';
import { ThreadNotificationLevelControl } from './ThreadNotificationLevel.js';
import { useSessionMove } from '../../lib/session-move.js';

const MENU_GAP = 4;
const VIEWPORT_GUTTER = 8;

/** Viewport coords for the overflow menu. Fixed + portaled so the timeline cannot steal clicks.
 *  Hang from the trigger’s right edge (the kebab sits after a flexing title) and clamp so
 *  “Close with follow-up” cannot clip the window. */
export function threadOverflowMenuPosition(
  rect: Pick<DOMRect, 'bottom' | 'right'>,
  viewport: Pick<Window, 'innerWidth'>
): CSSProperties {
  const right = Math.max(VIEWPORT_GUTTER, viewport.innerWidth - rect.right);
  return {
    top: rect.bottom + MENU_GAP,
    right,
    maxWidth: Math.max(0, viewport.innerWidth - right - VIEWPORT_GUTTER)
  };
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
  onOpenInWindow,
  menuRef,
  onSearch,
  extraActions,
  notificationsThreadId,
  style
}: {
  canStop: boolean;
  onUnread: () => void;
  onRename: () => void;
  onFork: () => void;
  onStop: () => void;
  onArchive: () => void;
  onCloseFollowup: () => void;
  /** When set, the menu offers to move the thread into its own window. */
  onOpenInWindow?: () => void;
  menuRef?: Ref<HTMLDivElement>;
  onSearch?: () => void;
  extraActions?: ReactNode;
  /** When set, the menu offers this thread's phone-notification level. */
  notificationsThreadId?: string;
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
      {onSearch && <button type="button" role="menuitem" onClick={onSearch}><Search size={16} /> Search in thread</button>}
      {extraActions}
      {onOpenInWindow ? (
        <button
          type="button"
          role="menuitem"
          onClick={onOpenInWindow}
          title="Move this agent and its side panel into a separate window"
          data-testid="thread-open-in-window"
        >
          <AppWindow size={13} /> Open in new window
        </button>
      ) : null}
      {SHOW_THREAD_UNREAD ? (
        <button type="button" role="menuitem" onClick={onUnread}>
          <Mail size={13} /> Mark unread
        </button>
      ) : null}
      <button type="button" role="menuitem" onClick={onRename}>
        <Pencil size={13} /> Rename
      </button>
      {notificationsThreadId ? <ThreadNotificationLevelControl threadId={notificationsThreadId} /> : null}
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

/** Desktop only, and not from the thread's own window. */
export function canOpenInWindow(): boolean {
  return hasDesktopBridge() && !isThreadViewSurface();
}

/** The menu's "Open in new window" action, or undefined where it does not apply. */
export function threadOpenInWindowAction(threadId: string, projectId: string | null, closeMenu: () => void): (() => void) | undefined {
  if (!canOpenInWindow()) return undefined;
  return () => {
    closeMenu();
    void openThreadViewWindow(projectId ? { threadId, projectId } : { threadId });
  };
}

export function ThreadDetailOverflow({
  threadId,
  title,
  status,
  inFlightRetry = false,
  projectId,
  onRenamed,
  onUnread,
  onSearch,
  extraActions
}: {
  threadId: string;
  title: string;
  status: string;
  inFlightRetry?: boolean;
  projectId: string | null;
  onRenamed?: (title: string) => void;
  onUnread?: () => void;
  onSearch?: () => void;
  extraActions?: ReactNode;
}) {
  const compact = useCompactLayout();
  const navigate = useNavigate();
  const route = useRouteState();
  const remove = useThreads((s) => s.remove);
  const currentThread = () => useThreads.getState().threads.find((row) => row.id === threadId);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [menuPos, setMenuPos] = useState<CSSProperties>({});
  const canStop = shouldShowThreadStop(threadId, status, inFlightRetry);
  const scopedProjectId = projectId && route.isProjectFocused ? projectId : null;
  const reportFailure = (error: unknown, fallback: string) => {
    useUi.getState().pushToast(errorMessage(error, fallback), 'error');
  };

  useEffect(() => {
    if (!open || compact) return;
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
  }, [open, compact]);

  const close = () => setOpen(false);
  const menu = (
    <ThreadDetailOverflowMenu
      menuRef={menuRef}
      style={compact ? undefined : menuPos}
      onSearch={onSearch ? () => { close(); onSearch(); } : undefined}
      extraActions={<>{extraActions}<button type="button" role="menuitem" onClick={() => {
        close();
        useSessionMove.getState().open(threadId);
      }}><FolderInput size={14} /> Move to project…</button></>}
      notificationsThreadId={threadId}
      canStop={canStop}
      onOpenInWindow={threadOpenInWindowAction(threadId, projectId, close)}
      onUnread={() => {
        close();
        void product.threads.unread(threadId).then(() => onUnread?.()).catch((error) => reportFailure(error, 'Failed to mark agent unread'));
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
        }).catch((error) => reportFailure(error, 'Failed to fork agent'));
      }}
      onStop={() => {
        close();
        dispatchThreadStopRequested(threadId);
        void product.threads.stop(threadId).catch((error) => reportFailure(error, 'Failed to stop agent'));
      }}
      onCloseFollowup={() => {
        close();
        const prompt = threadCloseFollowupConfirm(title, useData.getState().closeWrapUpEnabled);
        if (!window.confirm(withRunningProcessWarning(prompt, currentThread()))) return;
        void product.threads.closeFollowup(threadId).then((result) => {
          if (result && result.ok === false) return;
          // Kept open, or wrapping up (the thread archives itself when it finishes): stay on it.
          const leftInPlace = threadCloseFollowupToast(title, result);
          if (leftInPlace) {
            useUi.getState().pushToast(leftInPlace, 'info');
            return;
          }
          remove(threadId);
          navigate(scopedProjectId ? getProjectRoutePath(scopedProjectId) : getAgentsRoutePath());
        }).catch((error) => reportFailure(error, 'Failed to close agent'));
      }}
      onArchive={() => {
        close();
        if (!window.confirm(withRunningProcessWarning(`Archive “${title}”?`, currentThread()))) return;
        void product.threads.archive(threadId).then((result) => {
          if (result && result.ok === false) return;
          remove(threadId);
          navigate(scopedProjectId ? getProjectRoutePath(scopedProjectId) : getAgentsRoutePath());
        }).catch((error) => reportFailure(error, 'Failed to archive agent'));
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
        aria-haspopup={compact ? 'dialog' : 'menu'}
        aria-expanded={open}
        data-testid="thread-overflow-trigger"
        onClick={() => {
          const rect = triggerRef.current?.getBoundingClientRect();
          if (rect) setMenuPos(threadOverflowMenuPosition(rect, window));
          setOpen((value) => !value);
        }}
      >
        <MoreHorizontal size={16} />
      </button>
      {open ? compact ? <MobileActionSheet title="Agent actions" onClose={close}>{menu}</MobileActionSheet> : (typeof document === 'undefined' ? menu : createPortal(menu, document.body)) : null}
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
            void product.threads.rename(threadId, next).catch((error) => reportFailure(error, 'Failed to rename agent'));
          }}
        />
      ) : null}
    </div>
  );
}
