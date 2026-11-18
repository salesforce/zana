import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Project } from '@zana-ai/zcc-domain/product';
import {
  FolderPlus,
  MessageSquareText,
  Pin,
  Server,
  TriangleAlert
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useData, useUi, useAgentStatus } from '../store.js';
import {
  onThreadArchived,
  useThreads,
  type ThreadListItem
} from '../thread-store.js';
import { useRouteState } from '../hooks/useRouteState.js';
import {
  getAgentSessionRoutePath,
  getAgentsRoutePath,
  getNewThreadRoutePath,
  getProjectRoutePath,
  getThreadRoutePath,
  sessionIdFromPath
} from '../lib/route-paths.js';
import { getScopedProjectId } from '../lib/windowScope.js';
import {
  applicationTabId,
  saveApplicationTabs,
  useApplicationTabs,
  type ApplicationTab,
  type ClosedApplicationTab,
  type PluginApplicationTab
} from '../lib/application-tabs.js';
import { agentTabStatus, isListedAgent } from '../lib/agent-tab-status.js';
import { resumingAgents } from '../lib/agent-tab-resume.js';
import { pluginTabPath } from '../lib/plugin-tab-route.js';
import { usePluginAppModules } from '../plugins/plugin-app-loader.js';
import {
  getItemState,
  getTabDisplayTitle,
  REFUSAL_MESSAGES,
  usePinnedItemOverrides
} from '../plugins/plugin-pinned-tabs.js';
import { usePluginPinResolver } from '../plugins/plugin-pin-resolver.js';
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
import { ZanaSpinner } from './fairy/ZanaSpinner.js';

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
  const projectsLoaded = useData((s) => s.configLoaded);
  const terminals = useData((s) => s.terminals);
  const terminalsLoaded = useData((s) => s.terminalsLoaded);
  const agentStates = useAgentStatus((s) => s.byId);
  const unreadAgents = useUi((s) => s.unread);
  const setups = useSetupPages((s) => s.pages);
  const open = useApplicationTabs((s) => s.open);
  const closed = useApplicationTabs((s) => s.closed);
  const initialized = useApplicationTabs((s) => s.initializedScope);
  // Plugin tab state is read through plain getters; these subscriptions re-render when it changes.
  usePluginAppModules((s) => s.reconciled && s.modules);
  usePinnedItemOverrides((s) => s.byId);
  const { resolve } = usePluginPinResolver();
  // Last-seen host per session: a vanished host-owned session may only be unreachable.
  const hostOf = useRef(new Map<string, string>());
  for (const list of Object.values(terminals))
    for (const session of list)
      if (session.hostId) hostOf.current.set(session.id, session.hostId);
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

  useEffect(() => {
    if (!includeThreads) return;
    const sessionId = sessionIdFromPath(location.pathname);
    if (!sessionId) return;
    for (const [projectId, list] of Object.entries(terminals)) {
      const session = list.find((row) => row.id === sessionId);
      if (!session || !isListedAgent(session)) continue;
      if (scope && projectId !== scope) return;
      useApplicationTabs.getState().openTab({
        kind: 'agent',
        sessionId,
        projectId,
        projectScoped: !!route.focusedProjectId || !!scope
      });
      return;
    }
  }, [includeThreads, location.pathname, terminals, scope, route.focusedProjectId]);
  // Drop tabs whose session is gone from a project whose list was read successfully.
  useEffect(() => {
    if (!includeThreads) return;
    for (const tab of open) {
      if (tab.kind !== 'agent' || !terminalsLoaded[tab.projectId]) continue;
      if (scope && tab.projectId !== scope) continue;
      if (resumingAgents.has(tab.sessionId)) continue;
      const session = (terminals[tab.projectId] ?? []).find(
        (row) => row.id === tab.sessionId
      );
      if (isListedAgent(session)) continue;
      if (session?.hostId || hostOf.current.get(tab.sessionId)) continue; // host loss is unknown, not gone
      useApplicationTabs.getState().closeTab(applicationTabId(tab), false);
      if (sessionIdFromPath(currentPath.current) === tab.sessionId)
        void navigate(fallback);
    }
  }, [includeThreads, open, terminals, terminalsLoaded, scope, navigate, fallback]);

  const validAgent = (tab: Extract<ApplicationTab, { kind: 'agent' }>) => {
    if (!projects.some((project) => project.id === tab.projectId)) return null;
    if (scope && tab.projectId !== scope) return null;
    const session = (terminals[tab.projectId] ?? []).find(
      (row) => row.id === tab.sessionId
    );
    return session && isListedAgent(session) ? session : null;
  };
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
  const validPlugin = (tab: PluginApplicationTab) =>
    (!projectsLoaded || projects.some((project) => project.id === tab.projectId)) &&
    (!scope || tab.projectId === scope);
  const path = (tab: ApplicationTab) =>
    tab.kind === 'thread'
      ? getThreadRoutePath(
          tab.threadId,
          scope ?? (tab.projectScoped ? tab.projectId : null)
        )
      : tab.kind === 'agent'
        ? getAgentSessionRoutePath(
            tab.sessionId,
            scope ?? (tab.projectScoped ? tab.projectId : null)
          )
        : tab.kind === 'setup'
          ? setupPath(tab.setupId)
          : (pluginTabPath(tab) ?? currentPath.current);
  // Opening a pinned item happens under the project it was pinned in.
  const activate = (tab: ApplicationTab) => {
    if (tab.kind === 'plugin') {
      resolve(tab);
      if (!scope && useUi.getState().selectedProjectId !== tab.projectId)
        useUi.getState().selectProject(tab.projectId);
    }
    void navigate(path(tab));
  };
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
  const closeAgent = (session: { id: string; title: string; projectId: string }) => {
    if (
      !window.confirm(
        `Close “${session.title || 'Untitled agent'}”? This ends the running agent.`
      )
    )
      return;
    const store = useData.getState();
    void store.closeTerminal(session.id, session.projectId).then(
      () => {
        useApplicationTabs.getState().closeTab(`agent:${session.id}`, false);
        if (sessionIdFromPath(currentPath.current) === session.id)
          void navigate(fallback);
      },
      () => useUi.getState().pushToast('Could not close agent', 'error')
    );
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
            <ZanaSpinner size={13} className="spin" />
          ) : page.request.kind === 'machine' ? (
            <Server size={13} />
          ) : (
            <FolderPlus size={13} />
          ),
          actions: []
        }
      ];
    }
    if (tab.kind === 'plugin') {
      if (!validPlugin(tab)) return [];
      const state = getItemState(tab);
      const unavailable = state === 'unavailable';
      const title = getTabDisplayTitle(tab);
      const projectName =
        projects.find((project) => project.id === tab.projectId)?.name ?? '';
      const context = unavailable ? 'Unavailable' : projectName;
      return [
        {
          id,
          kind: 'plugin',
          title,
          context,
          label: context ? `${title} — ${context}` : title,
          active: pluginTabPath(tab) === location.pathname,
          busy: false,
          dimmed: unavailable,
          closeHint: unavailable
            ? 'Remove unavailable tab'
            : 'Remove tab (keeps the item)',
          icon: <Pin size={13} />,
          actions: []
        }
      ];
    }
    if (!includeThreads) return [];
    if (tab.kind === 'agent') {
      const session = validAgent(tab);
      if (!session) return [];
      const project = projects.find((project) => project.id === tab.projectId)!;
      const active = sessionIdFromPath(location.pathname) === tab.sessionId;
      const status = agentTabStatus(session, agentStates[session.id]);
      const StatusIcon =
        status === 'Error'
          ? TriangleAlert
          : status === 'Needs you'
            ? MessageSquareText
            : status === 'Working'
              ? ZanaSpinner
              : null;
      const unread = !active && !!unreadAgents[session.id];
      const title = session.title || 'Untitled agent';
      return [
        {
          id,
          kind: 'agent',
          title,
          context: project.name,
          label: `${title} — ${project.name}${unread ? ' — Unread' : ''}`,
          tooltip: `${title}\n${project.name} · ${status}${unread ? ' · Unread' : ''}`,
          active,
          busy: false,
          unread,
          closeHint: 'Close tab (keeps agent running)',
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
              label: 'Copy agent link',
              run: () => {
                void copyTextOrFail(
                  new URL(path(tab), window.location.origin).href
                ).then(
                  () => useUi.getState().pushToast('Agent link copied'),
                  () =>
                    useUi
                      .getState()
                      .pushToast('Could not copy agent link', 'error')
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
              label: 'Close agent',
              separatorBefore: true,
              run: () => closeAgent(session)
            }
          ]
        }
      ];
    }
    if (tab.kind !== 'thread') return [];
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
            ? ZanaSpinner
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
  const lastClosed: ClosedApplicationTab | undefined = [...closed]
    .reverse()
    .find((tab) =>
      tab.kind === 'plugin'
        ? validPlugin(tab)
        : includeThreads &&
          (tab.kind === 'agent' ? !!validAgent(tab) : !!validThread(tab))
    );
  const activePluginTab = open.find(
    (tab): tab is PluginApplicationTab =>
      tab.kind === 'plugin' && pluginTabPath(tab) === location.pathname
  );
  const activePluginId = activePluginTab && applicationTabId(activePluginTab);
  useEffect(() => {
    if (activePluginTab) resolve(activePluginTab);
    // Keyed on identity so a re-render alone does not ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePluginId, resolve]);
  const select = (id: string) => {
    const tab = open.find((tab) => applicationTabId(tab) === id);
    if (tab) activate(tab);
  };
  const hover = (id: string) => {
    const tab = open.find((tab) => applicationTabId(tab) === id);
    if (tab?.kind === 'plugin') resolve(tab);
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
      onHover={hover}
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
              const refusal = useApplicationTabs.getState().openTab(lastClosed);
              if (refusal && refusal !== 'invalid')
                useUi
                  .getState()
                  .pushToast(REFUSAL_MESSAGES[refusal], 'error');
              else if (!refusal) activate(lastClosed);
            }
          : undefined
      }
    />
  );
}
