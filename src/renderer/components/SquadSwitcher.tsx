/**
 * Generic chip-row switcher for the Agents "Flow" view — a horizontal row of
 * chips, one per item, shown only when 2+ items exist. Used at TWO levels:
 *   1. project level   — one chip per running squad-project (label = squad/project
 *                        name + accent color, count = that project's working total)
 *   2. squad level      — one chip per team launch WITHIN the selected project,
 *                        plus an "All squads" chip (label = orchestrator card, etc.)
 * Each chip carries a live working-count dot. Pure presentational — selection
 * state lives in the parent (SquadFlowView). Reuses the shared `agent-*`
 * status-dot vocabulary; all other styling is `squad-flow-*`.
 */

export interface SquadSwitcherItem {
  /** Stable selection key (a projectId for the project row, a launchId for the
   *  squad row). Used as the React key and the value passed to `onSelect`. */
  id: string;
  /** Display label — squad name when known, else project / orchestrator label. */
  label: string;
  /** Squad icon hint, or a generic fallback. */
  icon: string;
  /** Accent color (optional). */
  color?: string;
  /** Live working count (drives the dot + count). */
  working: number;
  /** Appeared after the user's current selection was established. */
  isNew: boolean;
}

interface SquadSwitcherProps {
  items: SquadSwitcherItem[];
  selected: string | undefined;
  onSelect: (id: string) => void;
  /** Accessible name for the chip group (defaults to "Squads"). */
  ariaLabel?: string;
}

export function SquadSwitcher({ items, selected, onSelect, ariaLabel = 'Squads' }: SquadSwitcherProps) {
  return (
    <div className="squad-flow-switcher" role="group" aria-label={ariaLabel}>
      {items.map((item) => {
        const isSelected = item.id === selected;
        const aria = item.working > 0 ? `${item.label}, ${item.working} working` : item.label;
        return (
          <button
            key={item.id}
            type="button"
            className={`squad-flow-tab ${isSelected ? 'active' : ''} ${item.isNew && !isSelected ? 'squad-flow-tab--new' : ''}`}
            style={item.color ? { ['--squad-tab-accent' as string]: item.color } : undefined}
            aria-pressed={isSelected}
            aria-label={aria}
            onClick={() => onSelect(item.id)}
          >
            <span className="squad-flow-tab-icon" aria-hidden="true">{item.icon}</span>
            <span className="squad-flow-tab-label">{item.label}</span>
            {item.working > 0 && (
              <span className="squad-flow-tab-count">
                <span className="tab-agent-dot agent-working" aria-hidden="true" />
                {item.working}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
