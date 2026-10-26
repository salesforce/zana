import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, LoaderCircle, MessageSquareText, Plus, RotateCcw, TriangleAlert, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useData, useUi } from '../store.js';
import { onThreadArchived, useThreads, type ThreadListItem } from '../thread-store.js';
import { useRouteState } from '../hooks/useRouteState.js';
import { getAgentsRoutePath, getNewThreadRoutePath, getProjectRoutePath, getThreadRoutePath } from '../lib/route-paths.js';
import { getScopedProjectId } from '../lib/windowScope.js';
import { closeThreadTab, openThreadTab, readThreadTabs, saveThreadTabs, type ThreadTab } from '../lib/thread-tabs.js';
import { threadStatusToAgentState } from './thread/thread-timeline-model.js';
import { ProviderIcon } from './thread/pickers/ProviderIcon.js';
import { copyTextOrFail } from '../lib/copy-text.js';
import { product } from '../lib/product-client.js';
import { withRunningProcessWarning } from '../lib/thread-running-processes.js';
import { ThreadTabContextMenu } from './ThreadTabContextMenu.js';
import './TitlebarThreadTabs.css';

export function TitlebarThreadTabs() {
  const route = useRouteState();
  const location = useLocation();
  const navigate = useNavigate();
  const scope = getScopedProjectId();
  const threads = useThreads(s => s.threads);
  const projects = useData(s => s.projects);
  const [tabs, setTabs] = useState(() => readThreadTabs(sessionStorage, scope));
  const [query, setQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<{ threadId: string; x: number; y: number; anchor: HTMLElement } | null>(null);
  const dismissContextMenu = useCallback(() => setContextMenu(null), []);
  const [menuPosition, setMenuPosition] = useState({ left: 8, top: 44 });
  const strip = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const fallback = scope ? getProjectRoutePath(scope) : getAgentsRoutePath();
  const activeThreadId = useRef(route.threadId);
  activeThreadId.current = route.threadId;

  useEffect(() => { void useThreads.getState().load(); }, []);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (menu.current && event.target instanceof Node && !menu.current.contains(event.target)) menu.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector('summary')?.focus();
      }
    };
    const resized = () => { if (menu.current) menu.current.open = false; };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', resized);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', resized);
    };
  }, []);
  useEffect(() => { saveThreadTabs(sessionStorage, scope, tabs); }, [scope, tabs]);
  useEffect(() => onThreadArchived(id => {
    setTabs(state => closeThreadTab(state, id, false));
    if (route.threadId === id) navigate(fallback);
  }), [route.threadId, navigate, fallback]);

  // A visit opens a tab; background roster updates never open additional tabs.
  useEffect(() => {
    const row = threads.find(thread => thread.id === route.threadId);
    if (!row || row.archivedAt || row.visibility === 'hidden' || (scope && row.projectId !== scope)) return;
    setTabs(state => openThreadTab(state, {
      threadId: row.id, projectId: row.projectId, projectScoped: !!route.focusedProjectId || !!scope
    }));
  }, [route.threadId, route.focusedProjectId, scope, threads]);

  useEffect(() => {
    strip.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [route.threadId, tabs.open]);
  useLayoutEffect(() => {
    if (menu.current) menu.current.open = false;
    setContextMenu(null);
    setQuery('');
  }, [location]);

  const visible = tabs.open.flatMap(tab => {
    const thread = threads.find(row => row.id === tab.threadId);
    const project = projects.find(row => row.id === tab.projectId);
    return thread && project && !thread.archivedAt && thread.visibility !== 'hidden' && (!scope || tab.projectId === scope)
      ? [{ tab, thread, project }] : [];
  });
  const lastClosed = [...tabs.closed].reverse().find(tab => threads.some(row => row.id === tab.threadId && !row.archivedAt && row.visibility !== 'hidden')
    && projects.some(row => row.id === tab.projectId));
  const go = (tab: ThreadTab) => {
    navigate(getThreadRoutePath(tab.threadId, scope ?? (tab.projectScoped ? tab.projectId : null)));
    if (menu.current) menu.current.open = false;
  };
  const close = (id: string) => {
    const index = visible.findIndex(row => row.tab.threadId === id);
    const neighbor = visible[index + 1] ?? visible[index - 1];
    setTabs(state => closeThreadTab(state, id));
    if (route.threadId === id) {
      if (neighbor) go(neighbor.tab);
      else navigate(fallback);
    }
  };
  const closeMany = (ids: string[]) => {
    const targets = new Set(ids);
    const activeIndex = visible.findIndex(row => row.tab.threadId === route.threadId);
    const neighbor = visible.slice(activeIndex + 1).find(row => !targets.has(row.tab.threadId))
      ?? visible.slice(0, activeIndex).reverse().find(row => !targets.has(row.tab.threadId));
    setTabs(state => ids.reduce((next, id) => closeThreadTab(next, id), state));
    if (route.threadId && targets.has(route.threadId)) {
      if (neighbor) go(neighbor.tab);
      else navigate(fallback);
    }
  };
  const contextRow = visible.find(row => row.tab.threadId === contextMenu?.threadId);
  const contextIndex = visible.findIndex(row => row === contextRow);
  const reopen = () => { if (lastClosed) { setTabs(state => openThreadTab(state, lastClosed)); go(lastClosed); } };
  const archive = (thread: ThreadListItem) => {
    const current = useThreads.getState().threads.find(row => row.id === thread.id) ?? thread;
    if (!window.confirm(withRunningProcessWarning(`Archive “${current.title || 'Untitled thread'}”?`, current))) return;
    const failed = () => useUi.getState().pushToast('Could not archive thread', 'error');
    void product.threads.archive(thread.id).then(result => {
      if (!result.ok) { failed(); return; }
      useThreads.getState().remove(thread.id);
      setTabs(state => closeThreadTab(state, thread.id, false));
      // The user may have switched threads while the request was pending.
      if (activeThreadId.current === thread.id) navigate(fallback);
    }, failed);
  };

  return (
    <div className="titlebar-threads" data-testid="titlebar-thread-tabs">
      <div className="titlebar-threads-strip" role="tablist" aria-label="Open threads" ref={strip}
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'tab') return;
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
          const index = buttons.indexOf(event.target as HTMLButtonElement);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
            : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
          event.preventDefault();
          buttons[next]?.focus();
          buttons[next]?.click();
        }}>
        {visible.map(({ tab, thread, project }, index) => {
          const active = route.threadId === thread.id;
          const state = threadStatusToAgentState(thread.status, thread.hasPendingInteraction, thread.activity);
          const status = thread.status === 'error' ? 'Error' : state === 'blocked' ? 'Needs you' : state === 'working' ? 'Working' : 'Idle';
          const StatusIcon = status === 'Error' ? TriangleAlert : status === 'Needs you' ? MessageSquareText : status === 'Working' ? LoaderCircle : null;
          const unread = !active && (thread.maxSeq ?? 0) > (thread.lastReadSeq ?? 0);
          const title = thread.title || 'Untitled thread';
          return (
            <div key={thread.id} className={`titlebar-thread ${active ? 'is-active' : ''} ${unread ? 'is-unread' : ''}`}
              onContextMenu={event => {
                event.preventDefault();
                event.stopPropagation();
                if (menu.current) menu.current.open = false;
                const anchor = event.currentTarget.querySelector<HTMLButtonElement>('[role="tab"]')!;
                setContextMenu({ threadId: thread.id, x: event.clientX, y: event.clientY, anchor });
              }}>
              <button type="button" role="tab" aria-selected={active} tabIndex={active || (!visible.some(row => row.thread.id === route.threadId) && index === 0) ? 0 : -1}
                aria-haspopup="menu" aria-expanded={contextMenu?.threadId === thread.id}
                onKeyDown={event => {
                  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
                  event.preventDefault();
                  if (menu.current) menu.current.open = false;
                  const rect = event.currentTarget.getBoundingClientRect();
                  setContextMenu({ threadId: thread.id, x: rect.left, y: rect.bottom, anchor: event.currentTarget });
                }}
                title={`${title}\n${project.name} · ${status}${unread ? ' · Unread' : ''}`}
                aria-label={`${title} — ${project.name}${unread ? ' — Unread' : ''}`} onClick={() => go(tab)}>
                <ProviderIcon providerId={thread.providerId} size={15} />
                <span className="titlebar-thread-copy"><span className="titlebar-thread-name">{title}</span>
                  <span className="titlebar-thread-context">
                    <span className="titlebar-thread-project">{project.name}</span>
                    {unread && <span className="titlebar-thread-unread-label" aria-hidden="true"><span className="titlebar-thread-context-separator">/</span>New</span>}
                  </span>
                </span>
                {StatusIcon && <span className={`titlebar-thread-status status-${status.toLowerCase().replace(' ', '-')}`} role="img" aria-label={status}>
                  <StatusIcon size={12} aria-hidden="true" />
                </span>}
              </button>
              <button type="button" className="titlebar-thread-close" aria-label={`Close tab: ${title}`} title="Close tab (keeps thread running)" onClick={() => close(thread.id)}><X size={12} /></button>
            </div>
          );
        })}
        {visible.length === 0 && <span className="titlebar-threads-empty">Open a thread to keep it here</span>}
      </div>
      <button type="button" className="titlebar-threads-action" aria-label="New thread" title="New thread" onClick={() => navigate(getNewThreadRoutePath(scope ?? route.focusedProjectId ?? undefined))}><Plus size={16} /></button>
      <details className="titlebar-threads-menu" ref={menu} onToggle={event => {
        if (event.currentTarget.open) {
          dismissContextMenu();
          const rect = event.currentTarget.getBoundingClientRect();
          setMenuPosition({ left: Math.max(8, Math.min(rect.right - 330, window.innerWidth - 338)), top: rect.bottom + 4 });
          event.currentTarget.querySelector('input')?.focus();
        } else setQuery('');
      }}>
        <summary className="titlebar-threads-action" aria-label="All open threads" title="All open threads"><ChevronDown size={15} /></summary>
        <div className="titlebar-threads-popover" style={menuPosition}>
          <input aria-label="Find an open thread" placeholder="Find an open thread…" value={query} onChange={event => setQuery(event.target.value)} />
          <div className="titlebar-threads-results">
            {visible.filter(({ thread, project }) => `${thread.title || 'Untitled thread'} ${project.name}`.toLowerCase().includes(query.toLowerCase())).map(({ tab, thread, project }) => (
              <button type="button" key={tab.threadId} onClick={() => go(tab)} aria-current={route.threadId === tab.threadId ? 'page' : undefined}>
                <ProviderIcon providerId={thread.providerId} size={14} /><span>{thread.title || 'Untitled thread'}<small>{project.name}</small></span>
              </button>
            ))}
          </div>
          {lastClosed && <button type="button" className="titlebar-threads-reopen" onClick={reopen}><RotateCcw size={13} />Reopen closed tab</button>}
        </div>
      </details>
      {contextMenu && contextRow && <ThreadTabContextMenu {...contextMenu} onClose={dismissContextMenu} items={[
        { label: 'Copy thread link', run: () => {
          const path = getThreadRoutePath(contextRow.tab.threadId, scope ?? (contextRow.tab.projectScoped ? contextRow.tab.projectId : null));
          void copyTextOrFail(new URL(path, window.location.origin).href).then(
            () => useUi.getState().pushToast('Thread link copied'),
            () => useUi.getState().pushToast('Could not copy thread link', 'error')
          );
        } },
        { label: 'Open project', run: () => navigate(getProjectRoutePath(contextRow.project.id)) },
        { label: 'Close tab', separatorBefore: true, run: () => close(contextRow.thread.id) },
        { label: 'Close other tabs', disabled: visible.length < 2, run: () => closeMany(visible.filter(row => row !== contextRow).map(row => row.thread.id)) },
        { label: 'Close tabs to the right', disabled: contextIndex === visible.length - 1, run: () => closeMany(visible.slice(contextIndex + 1).map(row => row.thread.id)) },
        { label: 'Close all tabs', run: () => closeMany(visible.map(row => row.thread.id)) },
        { label: 'Reopen closed tab', separatorBefore: true, disabled: !lastClosed, run: reopen },
        { label: 'Archive', separatorBefore: true, run: () => archive(contextRow.thread) }
      ]} />}
    </div>
  );
}
