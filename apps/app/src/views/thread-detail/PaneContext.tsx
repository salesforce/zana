import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react';
import type { SplitSide } from '../../lib/split-layout/types.js';

export interface PaneContextValue {
  paneId: string;
  isFocused: boolean;
  isSplitPane: boolean;
  secondaryPanelHost: PaneSecondaryPanelRegistration | null;
  onRequestClose: (() => void) | null;
  isMaximized: boolean;
  onToggleMaximize: (() => void) | null;
  onMoveToSide?: (side: SplitSide) => void;
  isBoundedPane: boolean;
  beginPaneDrag?: (event: ReactPointerEvent, label: string) => void;
  navigateInPane: (threadId: string, projectId: string | null) => void;
}

export interface PaneSecondaryPanelViewModel {
  contentKey: string;
  isOpen: boolean;
  panel: ReactNode;
  onToggle: () => void;
}

export interface PaneSecondaryPanelRegistration {
  clear: () => void;
  publish: (model: PaneSecondaryPanelViewModel) => void;
}

type Listener = () => void;

export interface PaneSecondaryPanelRegistry {
  clear: (paneId: string) => void;
  getSnapshot: (paneId: string) => PaneSecondaryPanelViewModel | null;
  publish: (paneId: string, model: PaneSecondaryPanelViewModel) => void;
  subscribe: (paneId: string, listener: Listener) => () => void;
}

export function createPaneSecondaryPanelRegistry(): PaneSecondaryPanelRegistry {
  const models = new Map<string, PaneSecondaryPanelViewModel>();
  const listeners = new Map<string, Set<Listener>>();
  const notify = (paneId: string) => {
    listeners.get(paneId)?.forEach((listener) => listener());
  };
  return {
    clear: (paneId) => {
      models.delete(paneId);
      notify(paneId);
    },
    getSnapshot: (paneId) => models.get(paneId) ?? null,
    publish: (paneId, model) => {
      models.set(paneId, model);
      notify(paneId);
    },
    subscribe: (paneId, listener) => {
      const set = listeners.get(paneId) ?? new Set();
      set.add(listener);
      listeners.set(paneId, set);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(paneId);
      };
    }
  };
}

const PaneContext = createContext<PaneContextValue | null>(null);

export function PaneContextProvider({
  value,
  children
}: {
  value: PaneContextValue;
  children: ReactNode;
}) {
  return <PaneContext.Provider value={value}>{children}</PaneContext.Provider>;
}

export function useOptionalPaneContext(): PaneContextValue | null {
  return useContext(PaneContext);
}

export function usePaneSecondaryPanelModel(
  registry: PaneSecondaryPanelRegistry,
  paneId: string
): PaneSecondaryPanelViewModel | null {
  const subscribe = useCallback(
    (onStoreChange: () => void) => registry.subscribe(paneId, onStoreChange),
    [paneId, registry]
  );
  const getSnapshot = useCallback(() => registry.getSnapshot(paneId), [paneId, registry]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function usePaneSecondaryPanelRegistration(
  model: PaneSecondaryPanelViewModel | null
): void {
  const pane = useOptionalPaneContext();
  const host = pane?.secondaryPanelHost ?? null;
  useLayoutEffect(() => {
    if (!host) return;
    if (model) host.publish(model);
    else host.clear();
    return () => host.clear();
  }, [host, model]);
}

export function usePaneContextValue(args: {
  paneId: string;
  isFocused: boolean;
  isSplitPane: boolean;
  secondaryPanelRegistry: PaneSecondaryPanelRegistry | null;
  onRequestClose: (() => void) | null;
  isMaximized: boolean;
  onToggleMaximize: (() => void) | null;
  onMoveToSide?: (side: SplitSide) => void;
  isBoundedPane: boolean;
  beginPaneDrag?: (event: ReactPointerEvent, label: string) => void;
  navigateInPane: (threadId: string, projectId: string | null) => void;
}): PaneContextValue {
  const secondaryPanelHost = useMemo<PaneSecondaryPanelRegistration | null>(
    () =>
      args.secondaryPanelRegistry === null
        ? null
        : {
            publish: (model) => args.secondaryPanelRegistry?.publish(args.paneId, model),
            clear: () => args.secondaryPanelRegistry?.clear(args.paneId)
          },
    [args.paneId, args.secondaryPanelRegistry]
  );
  return useMemo(
    () => ({
      paneId: args.paneId,
      isFocused: args.isFocused,
      isSplitPane: args.isSplitPane,
      secondaryPanelHost,
      onRequestClose: args.onRequestClose,
      isMaximized: args.isMaximized,
      onToggleMaximize: args.onToggleMaximize,
      onMoveToSide: args.onMoveToSide,
      isBoundedPane: args.isBoundedPane,
      beginPaneDrag: args.beginPaneDrag,
      navigateInPane: args.navigateInPane
    }),
    [
      args.beginPaneDrag,
      args.isBoundedPane,
      args.isFocused,
      args.isMaximized,
      args.isSplitPane,
      args.navigateInPane,
      args.onMoveToSide,
      args.onRequestClose,
      args.onToggleMaximize,
      args.paneId,
      secondaryPanelHost
    ]
  );
}
