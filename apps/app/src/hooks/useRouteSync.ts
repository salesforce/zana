import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useUi, type ExtensionsTab, type NavId, type ProjectView, type SettingsTab } from '../store.js';
import { registerAppNavigate } from '../lib/app-navigate.js';
import { decodeRoutePath, scopedProjectIdFromSearch, scopedWindowLockReplace } from '../lib/decode-route.js';
import { getScopedProjectId, isScopedWindow } from '../lib/windowScope.js';

const RAIL_KEEPING_NAVS = new Set(['projects', 'inbox', 'suggestions', 'settings']);

function splitDestination(to: string): { pathname: string; search: string; hash: string } {
  const url = new URL(to, 'http://zcc.local');
  return { pathname: url.pathname, search: url.search, hash: url.hash };
}

/**
 * Registers store-level `navigate` and mirrors the URL into destination
 * fields on the UI store. URL is the source of truth; the store is a mirror
 * so existing readers keep working.
 */
export function useRouteSync(): void {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    registerAppNavigate((to, options) => {
      const parts = splitDestination(to);
      let search = parts.search;
      if (isScopedWindow()) {
        const scoped = getScopedProjectId();
        if (scoped) {
          const params = new URLSearchParams(search);
          if (!params.has('projectId')) {
            params.set('projectId', scoped);
            search = `?${params.toString()}`;
          }
        }
      }
      void navigate(
        { pathname: parts.pathname, search, hash: parts.hash },
        { replace: options?.replace }
      );
    });
    return () => {
      registerAppNavigate(null);
    };
  }, [navigate]);

  useEffect(() => {
    const scoped = getScopedProjectId();
    const queryProject = scopedProjectIdFromSearch(location.search);
    const lockId = scoped ?? queryProject;
    if (!lockId) return;
    const next = scopedWindowLockReplace(location, lockId);
    if (!next) return;
    void navigate(next, { replace: true });
  }, [location.hash, location.pathname, location.search, navigate]);

  useEffect(() => {
    const decoded = decodeRoutePath(location.pathname, location.hash);
    const current = useUi.getState();
    const keepFocus =
      current.focusedProjectId != null &&
      decoded.focusedProjectId == null &&
      RAIL_KEEPING_NAVS.has(decoded.nav) &&
      !isScopedWindow();
    const focusedProjectId =
      decoded.focusedProjectId ?? (keepFocus ? current.focusedProjectId : null);

    const patch: {
      nav?: NavId;
      settingsTab?: SettingsTab;
      settingsAnchor?: string | null;
      extensionsTab?: ExtensionsTab;
      settingsExtensionId?: string | null;
      focusedProjectId?: string | null;
      workspaceMode?: Record<string, ProjectView>;
    } = {};
    if (current.nav !== decoded.nav) patch.nav = decoded.nav;
    if (current.settingsTab !== decoded.settingsTab) {
      patch.settingsTab = decoded.settingsTab as SettingsTab;
    }
    if (current.settingsAnchor !== decoded.settingsAnchor) {
      patch.settingsAnchor = decoded.settingsAnchor;
    }
    if (current.extensionsTab !== decoded.extensionsTab) {
      patch.extensionsTab = decoded.extensionsTab;
    }
    if (current.settingsExtensionId !== decoded.settingsExtensionId) {
      patch.settingsExtensionId = decoded.settingsExtensionId;
    }
    if (current.focusedProjectId !== focusedProjectId) patch.focusedProjectId = focusedProjectId;
    if (decoded.workspaceMode && decoded.focusedProjectId) {
      const prev = current.workspaceMode[decoded.focusedProjectId];
      if (prev !== decoded.workspaceMode) {
        patch.workspaceMode = {
          ...current.workspaceMode,
          [decoded.focusedProjectId]: decoded.workspaceMode as ProjectView
        };
      }
    }
    if (Object.keys(patch).length > 0) useUi.setState(patch);
    if (decoded.focusedProjectId && decoded.focusedProjectId !== current.selectedProjectId) {
      useUi.getState().selectProject(decoded.focusedProjectId);
    }
    if (patch.focusedProjectId !== undefined && typeof window.cc?.config?.set === 'function') {
      window.cc.config.set({ focusedProjectId: patch.focusedProjectId }).catch(() => {});
    }
  }, [location.hash, location.pathname]);
}
