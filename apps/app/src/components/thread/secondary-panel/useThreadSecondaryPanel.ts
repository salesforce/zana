import { useCallback, useEffect, useState } from 'react';
import { createSecondaryPanelCommands } from './threadSecondaryPanelLogic.js';
import {
  persistSecondaryPanel,
  restoreSecondaryPanel,
  type ThreadSecondaryPanelState
} from './threadSecondaryPanelState.js';

export function useSecondaryPanel(
  ownerId: string | undefined,
  options?: { defaultOpen?: boolean }
) {
  const defaultOpen = options?.defaultOpen === true;
  const [state, setState] = useState<ThreadSecondaryPanelState>(() => (
    restoreSecondaryPanel(ownerId, { defaultOpen })
  ));

  useEffect(() => {
    if (!ownerId) return;
    setState(restoreSecondaryPanel(ownerId, { defaultOpen }));
  }, [defaultOpen, ownerId]);

  useEffect(() => {
    persistSecondaryPanel(ownerId, state);
  }, [ownerId, state]);

  const update = useCallback((recipe: (current: ThreadSecondaryPanelState) => ThreadSecondaryPanelState) => {
    setState((current) => recipe(current));
  }, []);

  return {
    state,
    ...createSecondaryPanelCommands(update)
  };
}

export function useThreadSecondaryPanel(threadId: string | undefined) {
  return useSecondaryPanel(threadId);
}
