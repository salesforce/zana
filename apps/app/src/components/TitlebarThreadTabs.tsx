import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, RotateCcw, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../store.js';
import { onThreadArchived, useThreads } from '../thread-store.js';
import { useRouteState } from '../hooks/useRouteState.js';
import { getAgentsRoutePath, getNewThreadRoutePath, getProjectRoutePath, getThreadRoutePath } from '../lib/route-paths.js';
import { getScopedProjectId } from '../lib/windowScope.js';
import { closeThreadTab, openThreadTab, readThreadTabs, saveThreadTabs, type ThreadTab } from '../lib/thread-tabs.js';
import { threadStatusToAgentState } from './thread/thread-timeline-model.js';
import { ProviderIcon } from './thread/pickers/ProviderIcon.js';
import './TitlebarThreadTabs.css';

export function TitlebarThreadTabs() {
  const route = useRouteState();
  const navigate = useNavigate();
  const scope = getScopedProjectId();
  const threads = useThreads(s => s.threads);
  const projects = useData(s => s.projects);
  const [tabs, setTabs] = useState(() => readThreadTabs(sessionStorage, scope));
  const [query, setQuery] = useState('');
  const [menuPosition, setMenuPosition] = useState({ left: 8, top: 44 });
  const strip = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const fallback = scope ? getProjectRoutePath(scope) : getAgentsRoutePath();

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
  useEffect(() => {
    if (menu.current) menu.current.open = false;
    setQuery('');
  }, [route.threadId]);

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
          const unread = !active && (thread.maxSeq ?? 0) > (thread.lastReadSeq ?? 0);
          const title = thread.title || 'Untitled thread';
          return (
            <div key={thread.id} className={`titlebar-thread ${active ? 'is-active' : ''}`}>
              <button type="button" role="tab" aria-selected={active} tabIndex={active || (!visible.some(row => row.thread.id === route.threadId) && index === 0) ? 0 : -1}
                title={`${title}\n${project.name} · ${status}${unread ? ' · Unread' : ''}`}
                aria-label={`${title} — ${project.name}${unread ? ' — Unread' : ''}`} onClick={() => go(tab)}>
                <ProviderIcon providerId={thread.providerId} size={15} />
                <span className="titlebar-thread-copy"><span className="titlebar-thread-name">{title}</span>
                  <span className="titlebar-thread-context"><i style={{ background: project.color || 'var(--text-dim)' }} />{project.name}</span>
                </span>
                <span className={`titlebar-thread-status status-${status.toLowerCase().replace(' ', '-')}`} role="img" aria-label={status} />
                {unread && <span className="titlebar-thread-unread" aria-hidden="true" />}
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
          {lastClosed && <button type="button" className="titlebar-threads-reopen" onClick={() => { setTabs(state => openThreadTab(state, lastClosed)); go(lastClosed); }}><RotateCcw size={13} />Reopen closed tab</button>}
        </div>
      </details>
    </div>
  );
}
