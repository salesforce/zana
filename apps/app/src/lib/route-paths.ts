import { matchPath } from 'react-router-dom';

export const APP_ROOT_ROUTE_PATH = '/';
export const INBOX_ROUTE_PATH = '/inbox';
export const AGENTS_ROUTE_PATH = '/agents';
export const NEW_THREAD_ROUTE_PATH = '/threads/new';
export const THREAD_ROUTE_PATH = '/threads/:threadId';
export const FOLLOWUPS_ROUTE_PATH = '/followups';
export const SUGGESTIONS_ROUTE_PATH = '/suggestions';
export const SCHEDULER_ROUTE_PATH = '/scheduler';
export const GOALS_ROUTE_PATH = '/goals';

export const SETTINGS_ROUTE_PATH = '/settings';
export const SETTINGS_SECTION_ROUTE_PATH = '/settings/:section';
export const SETTINGS_PROJECT_ALIAS_ROUTE_PATH = '/settings/project';

export const TOOLS_ROUTE_PATH = '/extensions';
export const TOOLS_PLUGINS_ROUTE_PATH = '/extensions/plugins';
export const TOOLS_PLUGIN_BROWSE_ROUTE_PATH = '/extensions/plugins/browse';
export const TOOLS_PLUGIN_DETAIL_ROUTE_PATH = '/extensions/plugins/:pluginId';
export const TOOLS_SKILLS_ROUTE_PATH = '/extensions/skills';
export const TOOLS_MCP_ROUTE_PATH = '/extensions/mcp';
export const TOOLS_HUB_PAGE_ROOT_ROUTE_PATH = '/extensions/pages/:pluginId/:pageId';
export const TOOLS_HUB_PAGE_ROUTE_PATH = '/extensions/pages/:pluginId/:pageId/*';

export const PROJECT_ROUTE_PATH = '/projects/:projectId';
export const PROJECT_SETTINGS_ROUTE_PATH = '/projects/:projectId/settings';
export const PROJECT_NEW_THREAD_ROUTE_PATH = '/projects/:projectId/threads/new';
export const PROJECT_THREAD_ROUTE_PATH = '/projects/:projectId/threads/:threadId';
export const PROJECT_WORKSPACE_ROUTE_PATH = '/projects/:projectId/:mode';

export const DEFAULT_PLUGIN_PANEL_PATH = 'panel';
export const PLUGIN_PANEL_ROOT_ROUTE_PATH = '/plugins/:pluginId/:panelPath';
export const PLUGIN_PANEL_ROUTE_PATH = '/plugins/:pluginId/:panelPath/*';

export const PROJECT_WORKSPACE_MODES = [
  'agents',
  'terminals',
  'explorer',
  'skills',
  'library',
  'scheduler',
  'goals',
  'followups',
  'feed'
] as const;

export type ProjectWorkspaceMode = (typeof PROJECT_WORKSPACE_MODES)[number];

export const PROJECT_WORKSPACE_MODE_SET = new Set<string>(PROJECT_WORKSPACE_MODES);

export interface PluginPanelRoutePathArgs {
  pluginId: string;
  /** The nav panel's registered path segment (validated: [a-zA-Z0-9_-]+). */
  path: string;
  /** Location inside the panel; segments are encoded, slashes preserved. */
  subPath?: string;
}

export interface IsRoutePathArgs {
  path: string;
}

export interface ResolveRouteHrefArgs {
  currentOrigin: string;
  href: string;
}

export interface RouteHrefResolution {
  path: string;
}

export function getRootRoutePath(): string {
  return APP_ROOT_ROUTE_PATH;
}

export function getInboxRoutePath(): string {
  return INBOX_ROUTE_PATH;
}

export function getAgentsRoutePath(): string {
  return AGENTS_ROUTE_PATH;
}

export function getThreadRoutePath(threadId: string, projectId?: string | null): string {
  if (!projectId) return `/threads/${encodeURIComponent(threadId)}`;
  return `/projects/${encodeURIComponent(projectId)}/threads/${encodeURIComponent(threadId)}`;
}

export function threadIdFromPath(pathname: string): string | undefined {
  if (pathname === NEW_THREAD_ROUTE_PATH || matchPath(PROJECT_NEW_THREAD_ROUTE_PATH, pathname)) {
    return undefined;
  }
  return (
    matchPath(THREAD_ROUTE_PATH, pathname)?.params.threadId ??
    matchPath(PROJECT_THREAD_ROUTE_PATH, pathname)?.params.threadId
  );
}

export function projectIdFromThreadPath(pathname: string): string | undefined {
  return matchPath(PROJECT_THREAD_ROUTE_PATH, pathname)?.params.projectId;
}

export function getNewThreadRoutePath(projectId?: string): string {
  if (!projectId) return NEW_THREAD_ROUTE_PATH;
  return `/projects/${encodeURIComponent(projectId)}/threads/new`;
}

export function getFollowUpsRoutePath(): string {
  return FOLLOWUPS_ROUTE_PATH;
}

export function getSuggestionsRoutePath(): string {
  return SUGGESTIONS_ROUTE_PATH;
}

export function getSchedulerRoutePath(): string {
  return SCHEDULER_ROUTE_PATH;
}

export function getGoalsRoutePath(): string {
  return GOALS_ROUTE_PATH;
}

export function getSettingsRoutePath(section?: string, anchor?: string): string {
  const base =
    section === undefined || section === ''
      ? SETTINGS_ROUTE_PATH
      : `/settings/${encodeURIComponent(section)}`;
  if (!anchor) return base;
  return `${base}#${encodeURIComponent(anchor)}`;
}

export function getProjectSettingsRoutePath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/settings`;
}

export function getProjectRoutePath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}`;
}

export function getProjectWorkspaceRoutePath(projectId: string, mode: string): string {
  if (mode === 'agents') return getProjectRoutePath(projectId);
  return `/projects/${encodeURIComponent(projectId)}/${encodeURIComponent(mode)}`;
}

/**
 * True on Extensions and every canonical route nested under it.
 */
export function isExtensionsRoutePath(pathname: string): boolean {
  return (
    pathname === TOOLS_ROUTE_PATH ||
    matchPath(`${TOOLS_ROUTE_PATH}/*`, pathname) !== null
  );
}

export function isSettingsRoutePath(pathname: string): boolean {
  return (
    pathname === SETTINGS_ROUTE_PATH ||
    matchPath(`${SETTINGS_ROUTE_PATH}/*`, pathname) !== null
  );
}

export function isProjectRoutePath(pathname: string): boolean {
  return (
    matchPath(PROJECT_ROUTE_PATH, pathname) !== null ||
    matchPath(`${PROJECT_ROUTE_PATH}/*`, pathname) !== null
  );
}

export function getSkillsRoutePath(): string {
  return TOOLS_SKILLS_ROUTE_PATH;
}

export function getMcpRoutePath(): string {
  return TOOLS_MCP_ROUTE_PATH;
}

export function getPluginsRoutePath(): string {
  return TOOLS_PLUGINS_ROUTE_PATH;
}

export function getPluginBrowseRoutePath(): string {
  return TOOLS_PLUGIN_BROWSE_ROUTE_PATH;
}

export function getPluginDetailRoutePath(pluginId: string): string {
  return `${TOOLS_PLUGINS_ROUTE_PATH}/${encodeURIComponent(pluginId)}`;
}

export function getExtensionsTabRoutePath(
  tab: 'marketplace' | 'installed' | 'skills' | 'mcp' | 'page',
  pluginId?: string | null
): string {
  switch (tab) {
    case 'marketplace':
      return TOOLS_PLUGIN_BROWSE_ROUTE_PATH;
    case 'installed':
      return pluginId ? getPluginDetailRoutePath(pluginId) : TOOLS_PLUGINS_ROUTE_PATH;
    case 'skills':
      return TOOLS_SKILLS_ROUTE_PATH;
    case 'mcp':
      return TOOLS_MCP_ROUTE_PATH;
    case 'page':
      return TOOLS_PLUGINS_ROUTE_PATH;
  }
}

export function getExtensionsHubPageRoutePath({
  pluginId,
  pageId,
  subPath
}: {
  pluginId: string;
  pageId: string;
  subPath?: string;
}): string {
  const root = `/extensions/pages/${encodeURIComponent(pluginId)}/${encodeURIComponent(pageId)}`;
  if (subPath === undefined || subPath === '') return root;
  const encoded = subPath
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return encoded.length > 0 ? `${root}/${encoded}` : root;
}

export function getPluginPanelRoutePath({
  pluginId,
  path,
  subPath
}: PluginPanelRoutePathArgs): string {
  const root = `/plugins/${encodeURIComponent(pluginId)}/${encodeURIComponent(path)}`;
  if (subPath === undefined || subPath === '') return root;
  const encoded = subPath
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return encoded.length > 0 ? `${root}/${encoded}` : root;
}

const GLOBAL_NAV_PATHS: Record<string, string> = {
  home: APP_ROOT_ROUTE_PATH,
  inbox: INBOX_ROUTE_PATH,
  agents: AGENTS_ROUTE_PATH,
  followups: FOLLOWUPS_ROUTE_PATH,
  suggestions: SUGGESTIONS_ROUTE_PATH,
  scheduler: SCHEDULER_ROUTE_PATH,
  extensions: TOOLS_ROUTE_PATH,
  settings: SETTINGS_ROUTE_PATH,
  projects: APP_ROOT_ROUTE_PATH,
  goals: GOALS_ROUTE_PATH
};

/**
 * Map a shell nav id to its canonical path. Module ids become plugin-panel URLs.
 * `projects` without a project falls back to the app root — callers that have a
 * project should use {@link getProjectWorkspaceRoutePath}.
 */
export function getNavRoutePath(nav: string): string {
  const known = GLOBAL_NAV_PATHS[nav];
  if (known !== undefined) return known;
  return getPluginPanelRoutePath({ pluginId: nav, path: DEFAULT_PLUGIN_PANEL_PATH });
}

export function getSettingsTabRoutePath(tab: string, projectId?: string | null): string {
  if (tab === 'project') {
    return projectId ? getProjectSettingsRoutePath(projectId) : SETTINGS_ROUTE_PATH;
  }
  return getSettingsRoutePath(tab);
}

const baseRoutePatterns: readonly string[] = [
  APP_ROOT_ROUTE_PATH,
  INBOX_ROUTE_PATH,
  AGENTS_ROUTE_PATH,
  NEW_THREAD_ROUTE_PATH,
  THREAD_ROUTE_PATH,
  FOLLOWUPS_ROUTE_PATH,
  SUGGESTIONS_ROUTE_PATH,
  SCHEDULER_ROUTE_PATH,
  GOALS_ROUTE_PATH,
  SETTINGS_ROUTE_PATH,
  SETTINGS_SECTION_ROUTE_PATH,
  SETTINGS_PROJECT_ALIAS_ROUTE_PATH,
  TOOLS_ROUTE_PATH,
  TOOLS_PLUGINS_ROUTE_PATH,
  TOOLS_PLUGIN_BROWSE_ROUTE_PATH,
  TOOLS_PLUGIN_DETAIL_ROUTE_PATH,
  TOOLS_SKILLS_ROUTE_PATH,
  TOOLS_MCP_ROUTE_PATH,
  TOOLS_HUB_PAGE_ROOT_ROUTE_PATH,
  TOOLS_HUB_PAGE_ROUTE_PATH,
  PROJECT_ROUTE_PATH,
  PROJECT_SETTINGS_ROUTE_PATH,
  PROJECT_NEW_THREAD_ROUTE_PATH,
  PROJECT_THREAD_ROUTE_PATH,
  PROJECT_WORKSPACE_ROUTE_PATH,
  PLUGIN_PANEL_ROOT_ROUTE_PATH,
  PLUGIN_PANEL_ROUTE_PATH
];

export const ROUTE_PATTERNS = baseRoutePatterns;

const ABSOLUTE_HTTP_URL_PATTERN = /^https?:\/\//iu;

function stripPathSuffix(path: string): string {
  const queryIndex = path.indexOf('?');
  const hashIndex = path.indexOf('#');
  const suffixIndex =
    queryIndex === -1
      ? hashIndex
      : hashIndex === -1
        ? queryIndex
        : Math.min(queryIndex, hashIndex);
  return suffixIndex === -1 ? path : path.slice(0, suffixIndex);
}

export function isRoutePath({ path }: IsRoutePathArgs): boolean {
  const pathname = stripPathSuffix(path);
  return ROUTE_PATTERNS.some((pattern) => matchPath(pattern, pathname) !== null);
}

export function resolveRouteHref({
  currentOrigin,
  href
}: ResolveRouteHrefArgs): RouteHrefResolution | null {
  if (
    href.length === 0 ||
    href.startsWith('//') ||
    (!href.startsWith('/') && !ABSOLUTE_HTTP_URL_PATTERN.test(href))
  ) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(href, currentOrigin);
  } catch {
    return null;
  }

  if (url.origin !== currentOrigin || !isRoutePath({ path: url.pathname })) {
    return null;
  }

  return {
    path: `${url.pathname}${url.search}${url.hash}`
  };
}

export function getLocationRoutePath(location: {
  pathname: string;
  search: string;
  hash: string;
}): string {
  return `${location.pathname}${location.search}${location.hash}`;
}
