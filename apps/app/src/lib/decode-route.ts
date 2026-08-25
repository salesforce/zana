import { matchPath } from 'react-router-dom';
import {
  AGENTS_ROUTE_PATH,
  APP_ROOT_ROUTE_PATH,
  FOLLOWUPS_ROUTE_PATH,
  GOALS_ROUTE_PATH,
  INBOX_ROUTE_PATH,
  PLUGIN_PANEL_ROOT_ROUTE_PATH,
  PLUGIN_PANEL_ROUTE_PATH,
  PROJECT_ROUTE_PATH,
  PROJECT_SETTINGS_ROUTE_PATH,
  PROJECT_NEW_THREAD_ROUTE_PATH,
  PROJECT_THREAD_ROUTE_PATH,
  PROJECT_WORKSPACE_ROUTE_PATH,
  SCHEDULER_ROUTE_PATH,
  SETTINGS_PROJECT_ALIAS_ROUTE_PATH,
  SETTINGS_ROUTE_PATH,
  SETTINGS_SECTION_ROUTE_PATH,
  SUGGESTIONS_ROUTE_PATH,
  NEW_THREAD_ROUTE_PATH,
  THREAD_ROUTE_PATH,
  TOOLS_MCP_ROUTE_PATH,
  TOOLS_PLUGIN_BROWSE_ROUTE_PATH,
  TOOLS_PLUGIN_DETAIL_ROUTE_PATH,
  TOOLS_PLUGINS_ROUTE_PATH,
  TOOLS_ROUTE_PATH,
  TOOLS_SKILLS_ROUTE_PATH,
  getProjectRoutePath
} from './route-paths.js';

export interface DecodedRoute {
  nav: string;
  settingsTab: string;
  settingsAnchor: string | null;
  extensionsTab: 'marketplace' | 'installed' | 'skills' | 'mcp';
  settingsExtensionId: string | null;
  focusedProjectId: string | null;
  workspaceMode: string | null;
  isProjectSettings: boolean;
  isProjectWorkspace: boolean;
  isNewThread: boolean;
  isThreadView: boolean;
  threadId: string | null;
}

const DEFAULT_DECODED: DecodedRoute = {
  nav: 'home',
  settingsTab: 'global',
  settingsAnchor: null,
  extensionsTab: 'installed',
  settingsExtensionId: null,
  focusedProjectId: null,
  workspaceMode: null,
  isProjectSettings: false,
  isProjectWorkspace: false,
  isNewThread: false,
  isThreadView: false,
  threadId: null
};

function hashAnchor(hash: string): string | null {
  if (hash.length <= 1) return null;
  try {
    return decodeURIComponent(hash.slice(1)) || null;
  } catch {
    return hash.slice(1) || null;
  }
}

function param(match: ReturnType<typeof matchPath>, name: string): string | undefined {
  const value = match?.params[name];
  if (typeof value !== 'string' || value.length === 0) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Pure pathname (+ optional hash) → shell destination. The only decoder the
 * URL layer uses; keep matching order so static segments win over params.
 */
export function decodeRoutePath(pathname: string, hash = ''): DecodedRoute {
  const anchor = hashAnchor(hash);

  if (pathname === APP_ROOT_ROUTE_PATH) {
    return { ...DEFAULT_DECODED, settingsAnchor: anchor };
  }

  if (pathname === INBOX_ROUTE_PATH) {
    return { ...DEFAULT_DECODED, nav: 'inbox', settingsAnchor: anchor };
  }
  if (pathname === AGENTS_ROUTE_PATH) {
    return { ...DEFAULT_DECODED, nav: 'agents', settingsAnchor: anchor };
  }
  if (pathname === NEW_THREAD_ROUTE_PATH) {
    return { ...DEFAULT_DECODED, nav: 'agents', settingsAnchor: anchor };
  }
  const threadMatch = matchPath(THREAD_ROUTE_PATH, pathname);
  if (threadMatch) {
    return {
      ...DEFAULT_DECODED,
      nav: 'agents',
      settingsAnchor: anchor,
      threadId: param(threadMatch, 'threadId') ?? null
    };
  }
  if (pathname === FOLLOWUPS_ROUTE_PATH) {
    return { ...DEFAULT_DECODED, nav: 'followups', settingsAnchor: anchor };
  }
  if (pathname === SUGGESTIONS_ROUTE_PATH) {
    return { ...DEFAULT_DECODED, nav: 'suggestions', settingsAnchor: anchor };
  }
  if (pathname === SCHEDULER_ROUTE_PATH) {
    return { ...DEFAULT_DECODED, nav: 'scheduler', settingsAnchor: anchor };
  }
  if (pathname === GOALS_ROUTE_PATH) {
    return { ...DEFAULT_DECODED, nav: 'goals', settingsAnchor: anchor };
  }

  if (pathname === SETTINGS_ROUTE_PATH || pathname === SETTINGS_PROJECT_ALIAS_ROUTE_PATH) {
    return {
      ...DEFAULT_DECODED,
      nav: 'settings',
      settingsTab: pathname === SETTINGS_PROJECT_ALIAS_ROUTE_PATH ? 'project' : 'global',
      settingsAnchor: anchor
    };
  }
  const settingsSection = matchPath(SETTINGS_SECTION_ROUTE_PATH, pathname);
  if (settingsSection) {
    const section = param(settingsSection, 'section') ?? 'global';
    return {
      ...DEFAULT_DECODED,
      nav: 'settings',
      settingsTab: section === 'project' ? 'project' : section,
      settingsAnchor: anchor
    };
  }

  if (pathname === TOOLS_ROUTE_PATH || pathname === TOOLS_PLUGINS_ROUTE_PATH) {
    return { ...DEFAULT_DECODED, nav: 'extensions', extensionsTab: 'installed' };
  }
  if (pathname === TOOLS_PLUGIN_BROWSE_ROUTE_PATH) {
    return { ...DEFAULT_DECODED, nav: 'extensions', extensionsTab: 'marketplace' };
  }
  if (pathname === TOOLS_SKILLS_ROUTE_PATH) {
    return { ...DEFAULT_DECODED, nav: 'extensions', extensionsTab: 'skills' };
  }
  if (pathname === TOOLS_MCP_ROUTE_PATH) {
    return { ...DEFAULT_DECODED, nav: 'extensions', extensionsTab: 'mcp' };
  }
  const pluginDetail = matchPath(TOOLS_PLUGIN_DETAIL_ROUTE_PATH, pathname);
  if (pluginDetail) {
    const pluginId = param(pluginDetail, 'pluginId');
    return {
      ...DEFAULT_DECODED,
      nav: 'extensions',
      extensionsTab: 'installed',
      settingsExtensionId: pluginId ?? null
    };
  }

  const projectSettings = matchPath(PROJECT_SETTINGS_ROUTE_PATH, pathname);
  if (projectSettings) {
    const projectId = param(projectSettings, 'projectId') ?? null;
    return {
      ...DEFAULT_DECODED,
      nav: 'settings',
      settingsTab: 'project',
      settingsAnchor: anchor,
      focusedProjectId: projectId,
      isProjectSettings: true
    };
  }

  const projectNewThread = matchPath(PROJECT_NEW_THREAD_ROUTE_PATH, pathname);
  if (projectNewThread) {
    const projectId = param(projectNewThread, 'projectId') ?? null;
    return {
      ...DEFAULT_DECODED,
      nav: 'projects',
      focusedProjectId: projectId,
      workspaceMode: 'agents',
      isProjectWorkspace: true,
      isNewThread: true
    };
  }

  const projectThread = matchPath(PROJECT_THREAD_ROUTE_PATH, pathname);
  if (projectThread) {
    const projectId = param(projectThread, 'projectId') ?? null;
    return {
      ...DEFAULT_DECODED,
      nav: 'projects',
      focusedProjectId: projectId,
      workspaceMode: 'agents',
      isProjectWorkspace: true,
      isThreadView: true,
      threadId: param(projectThread, 'threadId') ?? null
    };
  }

  const projectHome = matchPath(PROJECT_ROUTE_PATH, pathname);
  if (projectHome) {
    const projectId = param(projectHome, 'projectId') ?? null;
    return {
      ...DEFAULT_DECODED,
      nav: 'projects',
      focusedProjectId: projectId,
      workspaceMode: 'agents',
      isProjectWorkspace: true
    };
  }

  const projectMode = matchPath(PROJECT_WORKSPACE_ROUTE_PATH, pathname);
  if (projectMode) {
    const projectId = param(projectMode, 'projectId') ?? null;
    const mode = param(projectMode, 'mode') ?? 'agents';
    return {
      ...DEFAULT_DECODED,
      nav: 'projects',
      focusedProjectId: projectId,
      workspaceMode: mode,
      isProjectWorkspace: true
    };
  }

  const pluginPanel =
    matchPath(PLUGIN_PANEL_ROUTE_PATH, pathname) ??
    matchPath(PLUGIN_PANEL_ROOT_ROUTE_PATH, pathname);
  if (pluginPanel) {
    const pluginId = param(pluginPanel, 'pluginId');
    if (pluginId) return { ...DEFAULT_DECODED, nav: pluginId };
  }

  return { ...DEFAULT_DECODED, settingsAnchor: anchor };
}

/** Query-param alias used by dedicated project windows. */
export function scopedProjectIdFromSearch(search: string): string | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const id = params.get('projectId');
  return id && id.trim() ? id : null;
}

/**
 * Where a project-locked window must sit. Returns null when the URL is already
 * on `/projects/:lockId` (settings or workspace). Any other path — including a
 * query-less `/inbox` after a full document load — is replaced back onto that
 * project, keeping `?projectId=`.
 */
export function scopedWindowLockReplace(
  location: { pathname: string; search: string; hash: string },
  lockId: string
): { pathname: string; search: string; hash: string } | null {
  const decoded = decodeRoutePath(location.pathname, location.hash);
  if (decoded.focusedProjectId === lockId) return null;
  const params = new URLSearchParams(
    location.search.startsWith('?') ? location.search.slice(1) : location.search
  );
  params.set('projectId', lockId);
  return {
    pathname: getProjectRoutePath(lockId),
    search: `?${params.toString()}`,
    hash: location.hash
  };
}
