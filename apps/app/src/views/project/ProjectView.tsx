import { useEffect } from 'react';
import { product } from '../../lib/product-client.js';
import { PROJECTS_TERMINAL_ANCHOR_ID } from '@/components/TerminalSurface';
import { useData } from '@/store';

/**
 * Hidden park for the live xterm grid. Project modes now render inside the
 * split workspace; this shell stays mounted (CSS-hidden) so TerminalSurface
 * always has a fallback anchor when no terminals pane is on screen.
 */
export function ProjectView() {
  const markExited = useData((s) => s.markExited);
  useEffect(() => {
    const off = product.terminals.onExit((id, code) => markExited(id, code));
    return off;
  }, [markExited]);

  return (
    <div className="project-shell panel-body--full" aria-hidden>
      <div className="project-body">
        <div id={PROJECTS_TERMINAL_ANCHOR_ID} className="terminal-host" style={{ display: 'none' }} />
      </div>
    </div>
  );
}
