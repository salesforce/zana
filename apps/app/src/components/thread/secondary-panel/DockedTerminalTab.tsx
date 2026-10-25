import { useLayoutEffect, useRef } from 'react';
import { registerTerminalDock } from '../../../lib/terminal-dock-targets.js';

export function DockedTerminalTab({ sessionId }: { sessionId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    return registerTerminalDock(sessionId, ref.current!);
  }, [sessionId]);
  return <div ref={ref} className="thread-terminal-tab" data-testid="thread-terminal-tab" data-terminal-session={sessionId} />;
}
