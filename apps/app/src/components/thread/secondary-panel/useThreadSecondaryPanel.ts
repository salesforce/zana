import { useCallback, useEffect, useMemo, useState } from 'react';
import { createSecondaryPanelCommands } from './threadSecondaryPanelLogic.js';
import {
  persistSecondaryPanel,
  restoreSecondaryPanel,
  secondaryPanelStatesEqual,
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
    const next = restoreSecondaryPanel(ownerId, { defaultOpen });
    setState((current) => (secondaryPanelStatesEqual(current, next) ? current : next));
  }, [defaultOpen, ownerId]);

  useEffect(() => {
    persistSecondaryPanel(ownerId, state);
  }, [ownerId, state]);

  useEffect(() => {
    if (!ownerId) return;
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ threadId?: string }>).detail;
      if (detail?.threadId && detail.threadId !== ownerId) return;
      setState((current) => {
        const next = restoreSecondaryPanel(ownerId, { defaultOpen });
        return secondaryPanelStatesEqual(current, next) ? current : next;
      });
    };
    window.addEventListener('zcc:secondary-panel-changed', onChanged);
    return () => window.removeEventListener('zcc:secondary-panel-changed', onChanged);
  }, [defaultOpen, ownerId]);

  const update = useCallback((recipe: (current: ThreadSecondaryPanelState) => ThreadSecondaryPanelState) => {
    setState((current) => recipe(current));
  }, []);

  const commands = useMemo(() => createSecondaryPanelCommands(update), [update]);
  return useMemo(() => ({ state, ...commands }), [commands, state]);
}

export function useThreadSecondaryPanel(threadId: string | undefined) {
  return useSecondaryPanel(threadId);
}
