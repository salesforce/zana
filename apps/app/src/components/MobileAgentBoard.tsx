import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface MobileAgentLane {
  key: string;
  label: string;
  count: number;
  icon: ReactNode;
}

/** One readable column at a time, with every status reachable from the tab strip. */
export function MobileAgentBoard({ lanes, renderLane }: {
  lanes: readonly MobileAgentLane[];
  renderLane(key: string): ReactNode;
}) {
  const first = lanes.find((lane) => lane.count > 0) ?? lanes[0];
  const [selected, setSelected] = useState<string>();
  const active = lanes.find((lane) => lane.key === selected) ?? first;
  const id = useId();
  const tabs = useRef<HTMLDivElement>(null);

  useEffect(() => {
    tabs.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [active?.key]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % lanes.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + lanes.length) % lanes.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = lanes.length - 1;
    else return;
    event.preventDefault();
    setSelected(lanes[next].key);
    tabs.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  return (
    <div className="mobile-agent-board" data-testid="mobile-agent-board">
      <div ref={tabs} className="mobile-agent-lanes" role="tablist" aria-label="Agent status">
        {lanes.map((lane, index) => (
          <button
            key={lane.key}
            type="button"
            role="tab"
            id={`${id}-tab-${lane.key}`}
            className={`mobile-agent-lane lane-${lane.key}`}
            aria-selected={active?.key === lane.key}
            aria-controls={`${id}-panel-${lane.key}`}
            tabIndex={active?.key === lane.key ? 0 : -1}
            onClick={() => setSelected(lane.key)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <span aria-hidden="true">{lane.icon}</span>
            <span>{lane.label}</span>
            <span className="mobile-agent-lane-count">{lane.count}</span>
          </button>
        ))}
      </div>
      {lanes.map((lane) => (
        <section
          key={lane.key}
          id={`${id}-panel-${lane.key}`}
          className={`mobile-agent-panel lane-${lane.key}`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${lane.key}`}
          hidden={active?.key !== lane.key}
          tabIndex={0}
        >
          {active?.key === lane.key && (
            lane.count > 0 ? renderLane(lane.key) : (
              <div className="mobile-agent-empty">
                <span aria-hidden="true">{lane.icon}</span>
                <p>No agents in this column</p>
              </div>
            )
          )}
        </section>
      ))}
    </div>
  );
}
