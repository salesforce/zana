import { useEffect } from 'react';
import { THREAD_PANEL_TERMINAL_ANCHOR_ID } from '../../TerminalSurface.js';
import { useUi } from '../../../store.js';
import { onThreadPanelTerminalUnmount } from './threadSecondaryPanelLogic.js';

export function ThreadTerminalTab({
  sessionId,
  projectId
}: {
  sessionId: string;
  projectId: string;
}) {
  const selectThreadPanelTerminal = useUi((s) => s.selectThreadPanelTerminal);
  const clearThreadPanelTerminal = useUi((s) => s.clearThreadPanelTerminal);

  useEffect(() => {
    selectThreadPanelTerminal(sessionId, projectId);
    return () => {
      const current = useUi.getState().threadPanelTerminal;
      onThreadPanelTerminalUnmount(current, sessionId, clearThreadPanelTerminal);
    };
  }, [clearThreadPanelTerminal, projectId, selectThreadPanelTerminal, sessionId]);

  return (
    <div
      className="thread-terminal-tab"
      data-testid="thread-terminal-tab"
      id={THREAD_PANEL_TERMINAL_ANCHOR_ID}
    />
  );
}
