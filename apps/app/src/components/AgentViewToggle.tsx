import { LayoutGrid, List, Workflow } from 'lucide-react';
import { useUi } from '../store.js';
import type { AgentsBoardView } from '../store.js';

/**
 * Segmented kanban/list switch for the Agents boards. Flips the single global
 * {@link AgentsBoardView} preference (persisted), so both the cross-project and
 * per-project boards stay in the layout you last chose. Sits in the board
 * header, just left of the filter.
 */

const OPTIONS: Array<{ view: AgentsBoardView; icon: typeof LayoutGrid; label: string }> = [
  { view: 'board', icon: LayoutGrid, label: 'Board' },
  { view: 'list', icon: List, label: 'List' },
  { view: 'flow', icon: Workflow, label: 'Flow' }
];

export function AgentViewToggle() {
  const view = useUi((s) => s.agentsBoardView);
  const setView = useUi((s) => s.setAgentsBoardView);

  return (
    <div className="agents-view-toggle" role="group" aria-label="Agents view">
      {OPTIONS.map(({ view: v, icon: Icon, label }) => (
        <button
          key={v}
          type="button"
          className={`agents-view-toggle-btn ${view === v ? 'active' : ''}`}
          onClick={() => setView(v)}
          aria-pressed={view === v}
          title={`${label} view`}
          aria-label={`${label} view`}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}
