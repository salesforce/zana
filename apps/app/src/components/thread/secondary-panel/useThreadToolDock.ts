import { useCallback, useEffect, useRef, useState } from 'react';
import type { ThreadSecondaryPanelState } from './threadSecondaryPanelState.js';
import { loadToolDock, moveDockTab, resolveToolDock, saveToolDock, type ThreadToolDock, type ToolDockSide } from './threadToolDock.js';

export function useThreadToolDock(owner: string, state: ThreadSecondaryPanelState, enabled: boolean) {
  const [stored, setStored] = useState(() => ({ owner, dock: loadToolDock(owner, undefined, state.activeId) }));
  const previousState = useRef({ owner, state, enabled });
  if (stored.owner !== owner) {
    setStored({ owner, dock: loadToolDock(owner) });
  }
  const dock = stored.owner === owner ? stored.dock : loadToolDock(owner);
  const update = useCallback((recipe: (current: ThreadToolDock) => ThreadToolDock) => {
    setStored(current => ({ owner, dock: recipe(current.owner === owner ? current.dock : loadToolDock(owner)) }));
  }, [owner]);
  useEffect(() => {
    const previous = previousState.current;
    previousState.current = { owner, state, enabled };
    if (!enabled || previous.owner !== owner) return;
    // A launcher replaces its New Tab with the selected tool. Keep that slot
    // in the bottom group rather than treating the replacement as a new owner.
    const replacements = previous.state.tabs.flatMap((tab, index) => {
      const next = state.tabs[index];
      return tab.kind === 'new-tab' && !state.tabs.some(row => row.id === tab.id) && next && !previous.state.tabs.some(row => row.id === next.id)
        ? [{ from: tab.id, to: next.id }] : [];
    });
    const removed = previous.state.tabs.filter(tab => !state.tabs.some(row => row.id === tab.id)).map(tab => tab.id);
    const selectionChanged = !previous.enabled || previous.state.activeId !== state.activeId;
    if (!removed.length && !selectionChanged) return;
    update(current => {
      const closedBottomSelection = current.bottomIds.includes(previous.state.activeId) && removed.includes(previous.state.activeId);
      const bottomIds = current.bottomIds.flatMap(id => {
        const replacement = replacements.find(row => row.from === id);
        return replacement ? [replacement.to] : removed.includes(id) ? [] : [id];
      });
      const next = { ...current, bottomIds, bottomActiveId: replacements.find(row => row.from === current.bottomActiveId)?.to
        ?? (removed.includes(current.bottomActiveId ?? '') ? null : current.bottomActiveId) };
      if (!selectionChanged) return next;
      if (bottomIds.includes(state.activeId)) return { ...next, bottomActiveId: state.activeId, collapsed: false };
      // Closing a bottom tool resets the legacy global selection to Info. The
      // independent right group keeps its own selection through that fallback.
      return closedBottomSelection ? next : { ...next, rightActiveId: state.activeId };
    });
  }, [enabled, owner, state.activeId, state.tabs, update]);
  useEffect(() => { if (stored.owner === owner) saveToolDock(owner, stored.dock); }, [owner, stored]);
  const move = (id: string, side: ToolDockSide) => update(current => moveDockTab(current, state, id, side));
  return { dock, update, move, ...resolveToolDock(dock, state) };
}
