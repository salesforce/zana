import React from 'react';
import { Search } from 'lucide-react';
import type { ScheduleFilter } from './schedule-filter.js';

export function ScheduleFilters({ search, filter, onSearch, onFilter }: {
  search: string;
  filter: ScheduleFilter;
  onSearch: (value: string) => void;
  onFilter: (value: ScheduleFilter) => void;
}) {
  return <div className="schedule-filters">
    <label className="schedule-search"><Search size={15} aria-hidden />
      <input type="search" aria-label="Search schedules" placeholder="Search schedules or projects…"
        value={search} onChange={event => onSearch(event.target.value)} />
    </label>
    <select aria-label="Filter schedules" value={filter} onChange={event => onFilter(event.target.value as ScheduleFilter)}>
      <option value="all">All schedules</option>
      <option value="enabled">Enabled</option>
      <option value="paused">Paused</option>
      <option value="attention">Needs attention</option>
    </select>
  </div>;
}
