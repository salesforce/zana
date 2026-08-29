import { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useExclusivePopover } from './ui/PopoverPicklist.js';
import { useData, useInboxScopeProjectId } from '../store.js';
import { useThreads } from '../thread-store.js';
import { getThreadRoutePath } from '../lib/route-paths.js';
import { unreadCountLabel, unreadThreadCount, unreadThreads } from '../lib/unread-threads.js';

export function CollapsedUnreadThreads() {
  const threads = useThreads((s) => s.threads);
  const projects = useData((s) => s.projects);
  const scopeProjectId = useInboxScopeProjectId();
  const navigate = useNavigate();
  const [open, setOpen] = useExclusivePopover();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const count = useMemo(
    () => unreadThreadCount(threads, { scopeProjectId }),
    [scopeProjectId, threads]
  );
  const rows = useMemo(
    () => unreadThreads(threads, { scopeProjectId }),
    [scopeProjectId, threads]
  );

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  if (count === 0) return null;

  return (
    <div className="collapsed-unread">
      <button
        ref={triggerRef}
        type="button"
        className="collapsed-unread-trigger"
        aria-label={`${count} unread agents`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${count} unread`}
        data-testid="collapsed-unread-trigger"
        onClick={() => setOpen((current) => !current)}
      >
        {unreadCountLabel(count)}
      </button>
      {open ? (
        <div
          ref={menuRef}
          className="collapsed-unread-menu"
          role="menu"
          aria-label="Unread"
          data-testid="collapsed-unread-menu"
        >
          <header className="collapsed-unread-heading">Unread</header>
          {rows.map((thread) => {
            const project = projects.find((row) => row.id === thread.projectId);
            const title = thread.title?.trim() || 'Untitled agent';
            return (
              <button
                key={thread.id}
                type="button"
                role="menuitem"
                className="collapsed-unread-row"
                title={project?.name ? `${title} — ${project.name}` : title}
                onClick={() => {
                  setOpen(false);
                  void navigate(getThreadRoutePath(thread.id, thread.projectId));
                }}
              >
                <span className="collapsed-unread-dot" aria-hidden="true" />
                <span className="collapsed-unread-row-text">
                  <span className="collapsed-unread-row-title">{title}</span>
                  {project?.name ? (
                    <span className="collapsed-unread-row-meta">{project.name}</span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
