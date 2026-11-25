import { useSyncExternalStore } from 'react';
import { listAgentsBoardThreadToggles, listAgentsViews, subscribePluginSlots } from '../plugins/plugin-slots.js';
import { useAgentsBoardThreadToggles } from '../plugins/agents-board-thread-toggles.js';
import { agentsViewKey, resolveAgentsView } from '../plugins/agents-view-model.js';
import { resolveIcon } from '../lib/resolveIcon.js';
import { Calendar, LayoutGrid, List, Workflow } from 'lucide-react';
import { useData, useUi, useRunningSchedulerCount } from '../store.js';
import type { AgentsBoardView } from '../store.js';
import { useCompactLayout } from '../hooks/useCompactLayout.js';

/** View switch shared by global and project boards. Desktop persists its choice;
 * phones keep an independent choice for the current app session. */

const OPTIONS: Array<{ view: AgentsBoardView; icon: typeof LayoutGrid; label: string }> = [
  { view: 'board', icon: LayoutGrid, label: 'Board' },
  { view: 'list', icon: List, label: 'List' },
  { view: 'flow', icon: Workflow, label: 'Squads' }
];

/** Squads is opt-in on phones; switching mobile views leaves desktop alone. */
export function useAgentsBoardView() {
  const preferred = useUi((s) => s.agentsBoardView);
  const compact = useCompactLayout();
  const mobileView = useUi((s) => s.mobileAgentsBoardView);
  const setDesktopView = useUi((s) => s.setAgentsBoardView);
  const setMobileView = useUi((s) => s.setMobileAgentsBoardView);
  const pluginViews = useSyncExternalStore(subscribePluginSlots, listAgentsViews, listAgentsViews);
  const requested = compact ? mobileView ?? (preferred === 'flow' || preferred.startsWith('plugin:') ? 'board' : preferred) : preferred;
  return {
    view: resolveAgentsView(requested, pluginViews),
    pluginViews,
    compact,
    setView: compact ? setMobileView : setDesktopView
  };
}

export function AgentViewToggle() {
  const { view, compact, setView, pluginViews } = useAgentsBoardView();
  const options = [...OPTIONS, ...pluginViews.map((slot) => ({ view: agentsViewKey(slot), icon: resolveIcon(slot.icon ?? 'Puzzle'), label: slot.title }))];

  return (
    <div className="agents-view-toggle" role="group" aria-label="Agents view">
      {options.map(({ view: v, icon: Icon, label }) => (
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
          {compact && <span className="agents-view-toggle-label">{label}</span>}
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
  const compact = useCompactLayout();
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
        {compact && <span>Scheduled agents</span>}
        {runningSchedules > 0 && (
          <span className="agents-scheduled-toggle-badge nav-badge nav-badge--running" aria-hidden="true">
            {runningSchedules > 99 ? '99+' : runningSchedules}
          </span>
        )}
      </button>
    </div>
  );
}

/** Button title / aria for a plugin's show/hide-threads toggle. */
export function pluginThreadToggleLabel(title: string, shown: boolean): string {
  return `${shown ? 'Hide' : 'Show'} ${title}`;
}

/**
 * One toggle per plugin that registered `experimental_agentsBoardThreadToggle`.
 * Each shows or hides the threads that plugin created; they start hidden.
 */
export function PluginThreadToggles() {
  const compact = useCompactLayout();
  const toggles = useSyncExternalStore(subscribePluginSlots, listAgentsBoardThreadToggles, listAgentsBoardThreadToggles);
  const shown = useAgentsBoardThreadToggles((s) => s.shown);
  const setShown = useAgentsBoardThreadToggles((s) => s.setShown);
  if (toggles.length === 0) return null;
  return (
    <div className="agents-view-toggle" role="group" aria-label="Plugin threads">
      {toggles.map((slot) => {
        const on = Boolean(shown[slot.pluginId]);
        const Icon = resolveIcon(slot.icon ?? 'Puzzle');
        const label = pluginThreadToggleLabel(slot.title, on);
        return (
          <button
            key={`${slot.pluginId}/${slot.id}`}
            type="button"
            className={`agents-view-toggle-btn ${on ? 'active' : ''}`}
            data-testid={`agents-board-thread-toggle-${slot.pluginId}-${slot.id}`}
            onClick={() => setShown(slot.pluginId, !on)}
            aria-pressed={on}
            title={label}
            aria-label={label}
          >
            <Icon size={14} />
            {compact && <span>{slot.title}</span>}
          </button>
        );
      })}
    </div>
  );
}
