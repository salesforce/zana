import type { AgentsBoardView } from '../store';

/**
 * The compact quick-agent list and the full List monitor both enumerate the
 * fleet. The monitor owns List mode, so it needs column 2 as well as column 3.
 */
export function shouldHideListPane(
  nav: string,
  boardView: AgentsBoardView,
  hasScopedOrFocusedProject: boolean
): boolean {
  return (
    (hasScopedOrFocusedProject && nav === 'projects') ||
    (nav === 'agents' && boardView === 'list')
  );
}
