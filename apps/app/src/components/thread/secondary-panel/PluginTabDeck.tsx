import { useRef, type ReactNode } from 'react';
import type { ClosableSecondaryTab } from './threadSecondaryPanelState.js';

/** Hidden plugin tabs kept mounted per panel, beyond the active one. */
export const PLUGIN_TAB_KEEP_ALIVE = 4;

/**
 * Recency-ordered ids of the plugin tabs to keep mounted. Only tabs that have
 * been active are mounted (a restored panel does not mount every plugin tab);
 * closed tabs drop out; the least recently active hidden tabs beyond `cap` are
 * evicted and later restore from their persisted `tabState`.
 */
export function nextLivePluginTabIds(
  previous: readonly string[],
  pluginTabIds: readonly string[],
  activeId: string | null,
  cap: number = PLUGIN_TAB_KEEP_ALIVE
): string[] {
  const open = new Set(pluginTabIds);
  const kept = previous.filter((id) => open.has(id) && id !== activeId);
  const activeIsPlugin = activeId !== null && open.has(activeId);
  const ordered = activeIsPlugin ? [activeId, ...kept] : kept;
  return ordered.slice(0, activeIsPlugin ? cap + 1 : cap);
}

interface PluginTabDeckProps {
  /** Every tab in the panel; the deck picks the plugin tabs `accepts` allows. */
  tabs: readonly ClosableSecondaryTab[];
  activeId: string | null;
  /** Thread, session or page that owns the panel; a new owner starts empty. */
  ownerId: string | undefined;
  accepts?: (tab: ClosableSecondaryTab) => boolean;
  cap?: number;
  render: (tab: ClosableSecondaryTab, active: boolean) => ReactNode;
}

/**
 * Keeps opened plugin tabs mounted and hides the inactive ones, so switching
 * tabs does not discard a plugin's in-memory state.
 */
export function PluginTabDeck({ tabs, activeId, ownerId, accepts, cap = PLUGIN_TAB_KEEP_ALIVE, render }: PluginTabDeckProps) {
  const live = useRef<{ ownerId: string | undefined; ids: string[] }>({ ownerId, ids: [] });
  if (live.current.ownerId !== ownerId) live.current = { ownerId, ids: [] };
  const pluginTabs = tabs.filter((tab) => tab.kind === 'plugin' && !!tab.moduleId && (accepts?.(tab) ?? true));
  live.current.ids = nextLivePluginTabIds(live.current.ids, pluginTabs.map((tab) => tab.id), activeId, cap);
  const mounted = new Set(live.current.ids);
  return (
    <>
      {pluginTabs.filter((tab) => mounted.has(tab.id)).map((tab) => {
        const active = tab.id === activeId;
        return (
          <div key={`${ownerId ?? ''}:${tab.id}`} className="thread-plugin-tab-slot" hidden={!active} data-testid="plugin-tab-slot" data-tab-id={tab.id}>
            {render(tab, active)}
          </div>
        );
      })}
    </>
  );
}
