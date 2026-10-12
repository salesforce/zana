import type { ReactNode } from 'react';
import { AppWindow, ExternalLink, PanelLeftClose } from 'lucide-react';
import type { PluginProjectTabRegistration } from '@zana-ai/zcc-plugin-sdk/app';
import { PaneEmptyState } from '@/components/PaneEmptyState';
import { PluginSlotBoundary } from '@/plugins/PluginSlotBoundary';
import {
  closePluginViewWindow,
  isPluginViewOpen,
  openPluginViewWindow,
  usePluginViewWindows
} from '@/plugins/plugin-view-windows';
import { hasDesktopBridge } from '@/lib/app-surface';

export function pluginTabTarget(tab: PluginProjectTabRegistration, projectId: string) {
  return { pluginId: tab.pluginId, tabId: tab.id, projectId };
}

/** Whether this tab is open in its own window right now. */
export function usePluginTabDetached(tab: PluginProjectTabRegistration | undefined, projectId: string): boolean {
  const open = usePluginViewWindows();
  return !!tab && tab.detachable === true && isPluginViewOpen(open, pluginTabTarget(tab, projectId));
}

/** Header button that moves a detachable tab into its own window. Desktop only. */
export function OpenInWindowButton({ tab, projectId }: { tab: PluginProjectTabRegistration; projectId: string }) {
  if (tab.detachable !== true || !hasDesktopBridge()) return null;
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={() => void openPluginViewWindow(pluginTabTarget(tab, projectId))}
      aria-label={`Open ${tab.label} in a new window`}
      title="Open in new window"
      data-testid="plugin-tab-open-in-window"
    >
      <AppWindow size={14} aria-hidden="true" />
    </button>
  );
}

/** Custom-header tabs draw their own toolbar; give them the window button with the host actions. */
export function withOpenInWindow(
  tab: PluginProjectTabRegistration,
  projectId: string,
  actions: ReactNode
): ReactNode {
  if (tab.detachable !== true || !hasDesktopBridge()) return actions;
  return (
    <>
      <OpenInWindowButton tab={tab} projectId={projectId} />
      {actions}
    </>
  );
}

/**
 * Shown in place of a tab that lives in its own window, so only that window
 * runs the tab. A plugin can supply `detachedPlaceholder` to show its own
 * status; the host card is the fallback.
 */
export function DetachedPluginTab({ tab, projectId }: { tab: PluginProjectTabRegistration; projectId: string }) {
  const target = pluginTabTarget(tab, projectId);
  const focusWindow = () => void openPluginViewWindow(target);
  const bringBack = () => void closePluginViewWindow(target);
  const Placeholder = tab.detachedPlaceholder;
  if (Placeholder) {
    return (
      <div className="plugin-tab-detached" data-testid="plugin-tab-detached">
        <PluginSlotBoundary pluginId={tab.pluginId} generation={tab.generation}>
          <Placeholder pluginId={tab.pluginId} projectId={projectId} focusWindow={focusWindow} bringBack={bringBack} />
        </PluginSlotBoundary>
      </div>
    );
  }
  return (
    <div className="plugin-tab-detached" data-testid="plugin-tab-detached">
      <PaneEmptyState art="desktop" title={`${tab.label} is open in its own window`} hint="Work there, or bring the tab back to this window.">
        <div className="plugin-tab-detached-actions">
          <button type="button" className="btn primary" onClick={focusWindow} data-testid="plugin-tab-detached-focus">
            <ExternalLink size={14} aria-hidden="true" />
            Focus window
          </button>
          <button type="button" className="btn" onClick={bringBack} data-testid="plugin-tab-detached-bring-back">
            <PanelLeftClose size={14} aria-hidden="true" />
            Bring back
          </button>
        </div>
      </PaneEmptyState>
    </div>
  );
}
