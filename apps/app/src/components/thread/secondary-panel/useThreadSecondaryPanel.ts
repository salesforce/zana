import { useCallback, useEffect, useState } from 'react';
import { createSecondaryPanelCommands } from './threadSecondaryPanelLogic.js';
import {
  persistIfThread,
  restoreIfThread,
  type ThreadSecondaryPanelState
} from './threadSecondaryPanelState.js';

export function useThreadSecondaryPanel(threadId: string | undefined) {
  const [state, setState] = useState<ThreadSecondaryPanelState>(() => restoreIfThread(threadId));

  useEffect(() => {
    if (!threadId) return;
    setState(restoreIfThread(threadId));
  }, [threadId]);

  useEffect(() => {
    persistIfThread(threadId, state);
  }, [state, threadId]);

  const update = useCallback((recipe: (current: ThreadSecondaryPanelState) => ThreadSecondaryPanelState) => {
    setState((current) => recipe(current));
  }, []);

  return {
    state,
    ...createSecondaryPanelCommands(update)
  };
}
