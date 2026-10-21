import { useMemo, useState } from 'react';
import { Bot, ChevronDown, Search } from 'lucide-react';
import { groupAgents } from './bundle-format.js';

/** Chips shown before "+N more"; a list that needs "+N more" also gets a filter box. */
export const USED_BY_LIMITS = { chips: 8 } as const;

/**
 * The "Used by" row of a read-only tab: agent chips, numbered series folded into one chip, the first few shown with
 * "+N more", and a filter once the list is long. Renders a `sf-lt-relrow` for a `sf-lt-rel` list.
 */
export function UsedByAgents({ usedBy, onOpenAgent }: { usedBy: readonly string[]; onOpenAgent(path: string): void }) {
  const [filter, setFilter] = useState('');
  const [all, setAll] = useState(false);
  const [openSeries, setOpenSeries] = useState<string | null>(null);
  const query = filter.trim().toLowerCase();
  const matching = useMemo(() => query ? usedBy.filter(path => (path.split('/').pop() ?? path).replace(/\.agent$/, '').toLowerCase().includes(query)) : usedBy, [usedBy, query]);
  const groups = useMemo(() => groupAgents(matching), [matching]);
  // Series count as one chip, so 15 agents in one series stay a short row with no filter.
  const long = useMemo(() => groupAgents(usedBy).length > USED_BY_LIMITS.chips, [usedBy]);
  const shown = all || query ? groups : groups.slice(0, USED_BY_LIMITS.chips);
  const hidden = groups.slice(shown.length).reduce((sum, group) => sum + (group.kind === 'one' ? 1 : group.agents.length), 0);
  const series = shown.find(group => group.kind === 'series' && group.prefix === openSeries);
  return <div className="sf-lt-relrow">
    <dt>Used by <span className="sf-lt-count">{usedBy.length}</span></dt>
    <dd>
      {long && <label className="sf-lt-filter">
        <Search size={12} aria-hidden="true" />
        <input type="search" value={filter} placeholder="Filter agents" aria-label="Filter agents" onChange={event => setFilter(event.target.value)} />
        {query && <span className="sf-lt-chip-n">{matching.length} of {usedBy.length}</span>}
      </label>}
      <div className="sf-lt-chips">
        {shown.map(group => group.kind === 'one'
          ? <button key={group.agent.path} type="button" className="sf-lt-chip" title={group.agent.path} onClick={() => onOpenAgent(group.agent.path)}><Bot size={13} className="is-agent" aria-hidden="true" />{group.agent.label}</button>
          : <button key={group.prefix} type="button" className="sf-lt-chip is-series" aria-expanded={openSeries === group.prefix}
              aria-label={`${group.prefix}${group.first} to ${group.last}, ${group.agents.length} agents`}
              onClick={() => setOpenSeries(current => current === group.prefix ? null : group.prefix)}>
              <Bot size={13} className="is-agent" aria-hidden="true" />{group.prefix}<b>{group.first}–{group.last}</b><span className="sf-lt-chip-n">{group.agents.length}</span>
              <ChevronDown size={12} aria-hidden="true" />
            </button>)}
        {hidden > 0 && <button type="button" className="sf-lt-chip is-more" onClick={() => setAll(true)}>+{hidden} more</button>}
        {all && !query && groups.length > USED_BY_LIMITS.chips && <button type="button" className="sf-lt-chip is-more" onClick={() => setAll(false)}>Show less</button>}
        {query && groups.length === 0 && <span className="sf-lt-chip-n">No matching agents.</span>}
      </div>
      {series?.kind === 'series' && <div className="sf-lt-series" role="group" aria-label={`${series.prefix} agents`}>
        <span className="sf-lt-series-head">{series.prefix}…</span>
        {series.agents.map(agent => <button key={agent.path} type="button" title={agent.path} aria-label={agent.label} onClick={() => onOpenAgent(agent.path)}>{agent.suffix}</button>)}
      </div>}
    </dd>
  </div>;
}
