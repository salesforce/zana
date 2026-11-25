import { useRef, useState, type ReactNode } from 'react';
import { Check, ListFilter } from 'lucide-react';
import type { LaneKey } from './AgentBoard.js';
import { MobileActionSheet } from './MobilePageHeader.js';

export interface MobileAgentLane {
  key: LaneKey;
  label: string;
  count: number;
  icon: ReactNode;
}

/** All agent statuses share one roster. The status sheet narrows the same list. */
export function MobileAgentBoard({ lanes, search, renderLane }: {
  lanes: readonly MobileAgentLane[];
  search?: ReactNode;
  renderLane(key?: LaneKey): ReactNode;
}) {
  const [selection, setSelection] = useState<LaneKey>();
  const [filterOpen, setFilterOpen] = useState(false);
  const list = useRef<HTMLElement>(null);
  const filterButton = useRef<HTMLButtonElement>(null);
  const active = lanes.find((lane) => lane.key === selection);
  const needsYou = lanes.find((lane) => lane.key === 'blocked');
  const hasAgents = active ? active.count > 0 : lanes.some((lane) => lane.count > 0);

  const select = (key?: LaneKey) => {
    setSelection(key);
    if (list.current) list.current.scrollTop = 0;
  };

  return (
    <div className="mobile-agent-board" data-testid="mobile-agent-board">
      <div className="agents-board-toolbar">
        {search}
        <button ref={filterButton} type="button" className="mobile-agent-filter" aria-haspopup="dialog" aria-expanded={filterOpen}
          aria-label={active ? `Filter by status, ${active.label} selected` : 'Filter by status'}
          data-filtered={Boolean(active)}
          onClick={(event) => { event.currentTarget.focus(); setFilterOpen(true); }}>
          <ListFilter size={16} aria-hidden="true" /><span>{active?.label ?? 'Filter'}</span>
        </button>
      </div>
      {filterOpen && <MobileActionSheet title="Filter by status" onClose={() => setFilterOpen(false)}>
        <button type="button" aria-pressed={!active} onClick={() => select()}>
          <ListFilter size={16} aria-hidden="true" /> All agents
          {!active && <Check className="mobile-sheet-selection" size={18} aria-hidden="true" />}
        </button>
        {lanes.map((lane) => (
          <button key={lane.key} type="button" aria-pressed={lane.key === active?.key} onClick={() => select(lane.key)}>
            <span aria-hidden="true">{lane.icon}</span>{lane.label}
            <span className="mobile-sheet-selection mobile-agent-lane-count">{lane.count}</span>
          </button>
        ))}
      </MobileActionSheet>}
      <section ref={list} className="mobile-agent-panel" aria-label={active?.label ?? 'All agents'} tabIndex={0}>
        {!active && needsYou && needsYou.count > 0 && (
          <button type="button" className="mobile-agent-needs-you" onClick={() => {
            select(needsYou.key);
            filterButton.current?.focus();
          }}>
            <span aria-hidden="true">{needsYou.icon}</span> {needsYou.label}
            <span className="mobile-agent-lane-count">{needsYou.count}</span>
          </button>
        )}
        {hasAgents ? renderLane(active?.key) : (
          <div className="mobile-agent-empty">
            <p>{active?.key === 'blocked' ? 'No agents need you.' : 'No agents match your filters.'}</p>
          </div>
        )}
      </section>
    </div>
  );
}
