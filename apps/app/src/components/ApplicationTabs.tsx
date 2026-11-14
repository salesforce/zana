import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Project } from '@zana-ai/zcc-domain/product';
import {
  FolderPlus,
  LoaderCircle,
  MessageSquareText,
  Server,
  TriangleAlert
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useData, useUi } from '../store.js';
import {
  onThreadArchived,
  useThreads,
  type ThreadListItem
} from '../thread-store.js';
import { useRouteState } from '../hooks/useRouteState.js';
import {
  getAgentsRoutePath,
  getNewThreadRoutePath,
  getProjectRoutePath,
  getThreadRoutePath
} from '../lib/route-paths.js';
import { getScopedProjectId } from '../lib/windowScope.js';
import {
  applicationTabId,
  saveApplicationTabs,
  useApplicationTabs,
  type ApplicationTab
} from '../lib/application-tabs.js';
import { threadStatusToAgentState } from './thread/thread-timeline-model.js';
import { ProjectDot } from './listpane/ProjectDot.js';
import { TitlebarProjectButton } from './TitlebarProjectButton.js';
import { copyTextOrFail } from '../lib/copy-text.js';
import { product } from '../lib/product-client.js';
import { withRunningProcessWarning } from '../lib/thread-running-processes.js';
import { setupPath, useSetupPages } from './setup/setup-pages.js';
import {
  ApplicationTabBar,
  type ApplicationTabView
} from './ApplicationTabBar.js';

/** Content adapters supply identity, live metadata and lifecycle rules to one tab shell. */
export function ApplicationTabs({
  includeThreads = true,
  project
}: {
  includeThreads?: boolean;
  project?: Project | null;
}) {
  const route = useRouteState();
  const location = useLocation();
  const navigate = useNavigate();
  const scope = getScopedProjectId();
  const threads = useThreads((s) => s.threads);
  const projects = useData((s) => s.projects);
  const setups = useSetupPages((s) => s.pages);
  const open = useApplicationTabs((s) => s.open);
  const closed = useApplicationTabs((s) => s.closed);
  const initialized = useApplicationTabs((s) => s.initializedScope);
  const currentPath = useRef(location.pathname);
  currentPath.current = location.pathname;
  const fallback = scope ? getProjectRoutePath(scope) : getAgentsRoutePath();

  useLayoutEffect(() => {
    useApplicationTabs.getState().initialize(sessionStorage, scope);
  }, [scope]);
  useEffect(() => {
    if (initialized === scope)
      saveApplicationTabs(sessionStorage, scope, { open, closed });
  }, [open, closed, scope, initialized]);
  useEffect(() => {
    if (includeThreads) void useThreads.getState().load();
  }, [includeThreads]);
  useEffect(() => {
    if (!includeThreads) return;
    const row = threads.find((thread) => thread.id === route.threadId);
    if (
      !row ||
      row.archivedAt ||
      row.visibility === 'hidden' ||
      (scope && row.projectId !== scope)
    )
      return;
    useApplicationTabs
      .getState()
      .openTab({
        kind: 'thread',
        threadId: row.id,
        projectId: row.projectId,
        projectScoped: !!route.focusedProjectId || !!scope
      });
  }, [includeThreads, route.threadId, route.focusedProjectId, scope, threads]);
  useEffect(
    () =>
      onThreadArchived((id) => {
        useApplicationTabs.getState().closeTab(`thread:${id}`, false);
        if (route.threadId === id) void navigate(fallback);
      }),
    [route.threadId, navigate, fallback]
  );

  const validThread = (tab: Extract<ApplicationTab, { kind: 'thread' }>) => {
    const thread = threads.find((row) => row.id === tab.threadId);
    return thread &&
      !thread.archivedAt &&
      thread.visibility !== 'hidden' &&
      projects.some((project) => project.id === tab.projectId) &&
      (!scope || tab.projectId === scope)
      ? thread
      : null;
  };
  const path = (tab: ApplicationTab) =>
    tab.kind === 'thread'
      ? getThreadRoutePath(
          tab.threadId,
          scope ?? (tab.projectScoped ? tab.projectId : null)
        )
      : setupPath(tab.setupId);
  const archive = (thread: ThreadListItem) => {
    const current =
      useThreads.getState().threads.find((row) => row.id === thread.id) ??
      thread;
    if (
      !window.confirm(
        withRunningProcessWarning(
          `Archive “${current.title || 'Untitled thread'}”?`,
          current
        )
      )
    )
      return;
    const failed = () =>
      useUi.getState().pushToast('Could not archive thread', 'error');
    void product.threads.archive(thread.id).then((result) => {
      if (!result.ok) {
        failed();
        return;
      }
      useThreads.getState().remove(thread.id);
      useApplicationTabs.getState().closeTab(`thread:${thread.id}`, false);
      if (
        currentPath.current === getThreadRoutePath(thread.id) ||
        currentPath.current === getThreadRoutePath(thread.id, thread.projectId)
      )
        void navigate(fallback);
    }, failed);
  };
  const views = open.flatMap((tab): ApplicationTabView[] => {
    const id = applicationTabId(tab);
    if (tab.kind === 'setup') {
      const page = setups.find((page) => page.id === tab.setupId);
      if (!page) return [];
      return [
        {
          id,
          kind: 'setup',
          title: page.title,
          label: page.title,
          context: page.busy ? 'Setup · In progress' : 'Setup',
          active: location.pathname === path(tab),
          busy: page.busy,
          closeHint: page.busy
            ? 'Setup is in progress'
            : 'Close setup and discard its draft',
          icon: page.busy ? (
            <LoaderCircle size={13} className="spin" />
          ) : page.request.kind === 'machine' ? (
            <Server size={13} />
          ) : (
            <FolderPlus size={13} />
          ),
          actions: []
        }
      ];
    }
    if (!includeThreads) return [];
    const thread = validThread(tab);
    if (!thread) return [];
    const project = projects.find((project) => project.id === tab.projectId)!;
    const active = route.threadId === thread.id;
    const state = threadStatusToAgentState(
      thread.status,
      thread.hasPendingInteraction,
      thread.activity
    );
    const status =
      thread.status === 'error'
        ? 'Error'
        : state === 'blocked'
          ? 'Needs you'
          : state === 'working'
            ? 'Working'
            : 'Idle';
    const StatusIcon =
      status === 'Error'
        ? TriangleAlert
        : status === 'Needs you'
          ? MessageSquareText
          : status === 'Working'
            ? LoaderCircle
            : null;
    const unread = !active && (thread.maxSeq ?? 0) > (thread.lastReadSeq ?? 0);
    const title = thread.title || 'Untitled thread';
    return [
      {
        id,
        kind: 'thread',
        title,
        context: project.name,
        label: `${title} — ${project.name}${unread ? ' — Unread' : ''}`,
        tooltip: `${title}\n${project.name} · ${status}${unread ? ' · Unread' : ''}`,
        active,
        busy: false,
        unread,
        closeHint: 'Close tab (keeps thread running)',
        icon: <ProjectDot project={project} />,
        status: StatusIcon && (
          <span
            className={`titlebar-thread-status status-${status.toLowerCase().replace(' ', '-')}`}
            role="img"
            aria-label={status}
          >
            <StatusIcon size={12} aria-hidden="true" />
          </span>
        ),
        actions: [
          {
            label: 'Copy thread link',
            run: () => {
              void copyTextOrFail(
                new URL(path(tab), window.location.origin).href
              ).then(
                () => useUi.getState().pushToast('Thread link copied'),
                () =>
                  useUi
                    .getState()
                    .pushToast('Could not copy thread link', 'error')
              );
            }
          },
          {
            label: 'Open project',
            run: () => void navigate(getProjectRoutePath(project.id))
          }
        ],
        footerActions: [
          {
            label: 'Archive',
            separatorBefore: true,
            run: () => archive(thread)
          }
        ]
      }
    ];
  });
  const lastClosed = includeThreads
    ? [...closed].reverse().find((tab) => validThread(tab))
    : undefined;
  const select = (id: string) => {
    const tab = open.find((tab) => applicationTabId(tab) === id);
    if (tab) void navigate(path(tab));
  };
  const close = (ids: string[]) => {
    const selected = views.find((tab) => tab.active);
    const targets = new Set<string>();
    let busy = 0;
    for (const id of ids) {
      const tab = useApplicationTabs
        .getState()
        .open.find((tab) => applicationTabId(tab) === id);
      if (!tab) continue;
      if (tab.kind === 'setup') {
        if (!useSetupPages.getState().close(tab.setupId)) {
          busy++;
          continue;
        }
      } else useApplicationTabs.getState().closeTab(id);
      targets.add(id);
    }
    if (selected && targets.has(selected.id)) {
      const index = views.indexOf(selected);
      const neighbor =
        views.slice(index + 1).find((tab) => !targets.has(tab.id)) ??
        views
          .slice(0, index)
          .reverse()
          .find((tab) => !targets.has(tab.id));
      if (neighbor) select(neighbor.id);
      else void navigate(fallback);
    }
    if (busy)
      useUi
        .getState()
        .pushToast(
          `${busy === 1 ? '1 tab stays' : `${busy} tabs stay`} open while setup is in progress`
        );
  };
  return (
    <ApplicationTabBar
      tabs={views}
      leading={project ? <TitlebarProjectButton key={project.id} project={project} /> : undefined}
      onSelect={select}
      onClose={close}
      onMove={(id, to) => useApplicationTabs.getState().moveTab(id, to)}
      locationKey={location.pathname + location.search + location.hash}
      onNewThread={
        includeThreads
          ? () =>
              void navigate(
                getNewThreadRoutePath(
                  scope ?? route.focusedProjectId ?? undefined
                )
              )
          : undefined
      }
      onReopen={
        lastClosed
          ? () => {
              useApplicationTabs.getState().openTab(lastClosed);
              void navigate(path(lastClosed));
            }
          : undefined
      }
    />
  );
}
