import { Calendar, LayoutGrid, List, Workflow } from 'lucide-react';
import { useData, useUi, useRunningSchedulerCount } from '../store.js';
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

/** Button title / aria for the Calendar toggle, including a live running count. */
export function scheduledColumnToggleLabel(includeScheduled: boolean, running: number): string {
  const action = includeScheduled ? 'Hide scheduled agents' : 'Show scheduled agents';
  return running > 0 ? `${running} running · ${action}` : action;
}

/**
 * Show/hide scheduled agents on the Agents board (and the matching list/flow
 * groups) — waiting jobs, armed schedules, and currently working/blocked runs.
 * Owns the AppConfig round-trip — same flag as Settings → Agents → Scheduled,
 * so the two stay in lockstep. A gold count badge appears while any scheduled
 * task has a live session, even when the toggle is off.
 */
export function ScheduledColumnToggle() {
  const includeScheduled = useData((s) => s.includeScheduledAgentsInAgentView);
  const setIncludeScheduled = useData((s) => s.setIncludeScheduledAgentsInAgentView);
  const runningSchedules = useRunningSchedulerCount();
  const label = scheduledColumnToggleLabel(includeScheduled, runningSchedules);

  return (
    <div className="agents-view-toggle" role="group" aria-label="Scheduled column">
      <button
        type="button"
        className={`agents-view-toggle-btn ${includeScheduled ? 'active' : ''}`}
        data-testid="agents-board-scheduled-toggle"
        onClick={() => void setIncludeScheduled(!includeScheduled)}
        aria-pressed={includeScheduled}
        title={label}
        aria-label={label}
      >
        <Calendar size={14} />
        {runningSchedules > 0 && (
          <span className="agents-scheduled-toggle-badge nav-badge nav-badge--running" aria-hidden="true">
            {runningSchedules > 99 ? '99+' : runningSchedules}
          </span>
        )}
      </button>
    </div>
  );
}
