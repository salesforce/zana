import { Calendar, LayoutGrid, List, Workflow } from 'lucide-react';
import { useData, useUi } from '../store.js';
import type { AgentsBoardView } from '../store.js';

/**
 * Segmented kanban/list switch for the Agents boards. Flips the single global
 * {@link AgentsBoardView} preference (persisted), so both the cross-project and
 * per-project boards stay in the layout you last chose. Sits in the board
 * toolbar, just left of the Scheduled-column toggle and the filter.
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

/**
 * Show/hide the Agents board Scheduled column (and the matching list/flow
 * groups). Owns the AppConfig round-trip — same flag as Settings → Agents →
 * Scheduled, so the two stay in lockstep.
 */
export function ScheduledColumnToggle() {
  const includeScheduled = useData((s) => s.includeScheduledAgentsInAgentView);
  const setIncludeScheduled = useData((s) => s.setIncludeScheduledAgentsInAgentView);

  return (
    <div className="agents-view-toggle" role="group" aria-label="Scheduled column">
      <button
        type="button"
        className={`agents-view-toggle-btn ${includeScheduled ? 'active' : ''}`}
        data-testid="agents-board-scheduled-toggle"
        onClick={() => void setIncludeScheduled(!includeScheduled)}
        aria-pressed={includeScheduled}
        title={includeScheduled ? 'Hide Scheduled column' : 'Show Scheduled column'}
        aria-label={includeScheduled ? 'Hide Scheduled column' : 'Show Scheduled column'}
      >
        <Calendar size={14} />
      </button>
    </div>
  );
}
