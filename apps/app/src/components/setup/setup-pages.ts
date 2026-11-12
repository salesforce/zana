import { create } from 'zustand';
import type { MachineProjectGroup } from '../../lib/machine-projects.js';
import type { PluginCreateProjectDialogState } from '../../plugins/PluginCreateProjectDialog.js';
import { useApplicationTabs } from '../../lib/application-tabs.js';

export const SETUP_ROUTE_PATH = '/setup/:setupId';
export const setupPath = (id: string) => `/setup/${encodeURIComponent(id)}`;
export type ProjectSetupMode = 'open' | 'create' | 'clone';
export type SetupRequest =
  | { kind: 'project'; group: MachineProjectGroup; mode: ProjectSetupMode }
  | {
      kind: 'plugin';
      group: MachineProjectGroup;
      state: PluginCreateProjectDialogState;
    }
  | { kind: 'machine' };
export interface SetupPage {
  id: string;
  title: string;
  returnPath: string;
  request: SetupRequest;
  busy: boolean;
}
const titles = {
  open: 'Add folder',
  create: 'New folder',
  clone: 'Clone from Git'
};
/** Window-local drafts. Keeping their components mounted also preserves in-flight work. */
export const useSetupPages = create<{
  pages: SetupPage[];
  open(request: SetupRequest, returnPath: string): string | null;
  close(id: string): boolean;
  setBusy(id: string, busy: boolean): void;
}>((set, get) => ({
  pages: [],
  open(request, returnPath) {
    const id =
      request.kind === 'machine'
        ? 'machine'
        : request.kind === 'project'
          ? `project:${request.group.id}:${request.mode}`
          : `plugin:${request.group.id}:${request.state.action.pluginId}:${request.state.action.id}:${request.state.action.generation}`;
    if (get().pages.some((page) => page.id === id)) {
      useApplicationTabs.getState().openTab({ kind: 'setup', setupId: id });
      return id;
    }
    // Never evict an unfinished form or a running clone to make room.
    if (get().pages.length >= 12) return null;
    const title =
      request.kind === 'machine'
        ? 'Connect a machine'
        : `${request.kind === 'project' ? titles[request.mode] : request.state.title} · ${request.group.name}`;
    set((state) => ({
      pages: [
        ...state.pages,
        {
          id,
          title,
          request,
          busy: false,
          returnPath: returnPath.startsWith('/setup/') ? '/' : returnPath
        }
      ]
    }));
    useApplicationTabs.getState().openTab({ kind: 'setup', setupId: id });
    return id;
  },
  close(id) {
    if (get().pages.find((page) => page.id === id)?.busy) return false;
    set((state) => ({ pages: state.pages.filter((page) => page.id !== id) }));
    useApplicationTabs.getState().closeTab(`setup:${id}`, false);
    return true;
  },
  setBusy(id, busy) {
    set((state) => ({
      pages: state.pages.map((page) =>
        page.id === id && page.busy !== busy ? { ...page, busy } : page
      )
    }));
  }
}));
