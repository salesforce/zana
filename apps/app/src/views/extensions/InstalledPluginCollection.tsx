import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import './installed-plugin-collection.css';
import { ArrowDownAZ, ArrowUpAZ, ChevronRight, Search } from 'lucide-react';
import { InstalledPluginCard } from './InstalledPluginCard.js';
import {
  filterInstalledRows, installedPublisher, rowEnabled,
  type HubRow, type InstalledPublisherFilter
} from './installed-plugins.js';
import { filterCollectionRows, groupInstalledRows, type InstalledStatusFilter } from './installed-collection.js';
import { pluginAvailableVersion } from './plugin-row-update.js';

const PUBLISHERS: { id: InstalledPublisherFilter; label: string }[] = [
  { id: 'all', label: 'All publishers' },
  { id: 'official', label: 'Official' },
  { id: 'local', label: 'Local' },
  { id: 'community', label: 'Community' },
  { id: 'user', label: 'User' }
];
const STATUS_FILTERS: { id: InstalledStatusFilter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'enabled', label: 'Enabled' }, { id: 'disabled', label: 'Disabled' }
];

export function InstalledPluginCollection({ rows, onOpen, onBrowse, headerActions, mobileHeader }: {
  rows: HubRow[];
  onOpen: (id: string) => void;
  onBrowse: () => void;
  headerActions?: ReactNode;
  mobileHeader?: ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [publisher, setPublisher] = useState<InstalledPublisherFilter>('all');
  const [status, setStatus] = useState<InstalledStatusFilter>('all');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [updatesOnly, setUpdatesOnly] = useState(false);
  const [agentsExpanded, setAgentsExpanded] = useState(false);
  const agentsId = useId();
  const publishers = new Set(rows.map(installedPublisher));
  const offeredPublishers = PUBLISHERS.filter((p) => p.id === 'all' || publishers.has(p.id));
  const selectedPublisher = offeredPublishers.some((p) => p.id === publisher) ? publisher : 'all';
  const visible = useMemo(() => filterCollectionRows(
    filterInstalledRows(rows, query, selectedPublisher, sortDir), status, updatesOnly
  ), [rows, query, selectedPublisher, sortDir, status, updatesOnly]);
  const { tools, agents } = groupInstalledRows(visible);
  const enabledCount = rows.filter(rowEnabled).length;
  const updateCount = rows.filter((row) => pluginAvailableVersion(row) !== null).length;
  // A collapsed category must never hide a search/filter result.
  useEffect(() => {
    if (query.trim() || status !== 'all' || selectedPublisher !== 'all' || updatesOnly) setAgentsExpanded(true);
  }, [query, status, selectedPublisher, updatesOnly]);
  const showAgents = agentsExpanded;

  const selectCollection = (updates: boolean) => {
    setUpdatesOnly(updates);
    setQuery('');
    setStatus('all');
    setPublisher('all');
  };
  const renderCard = (row: HubRow) => <InstalledPluginCard key={row.module.id} row={row} onOpen={() => onOpen(row.module.id)} />;

  return (
    <section className="ext-installed ext-installed-collection">
      {mobileHeader}
      <header className="ext-installed-header">
        <div><h3>Plugins</h3><p className="settings-help">Your tools, ready when you need them.</p></div>
        <div className="ext-installed-header-actions">{headerActions}</div>
      </header>
      <nav className="ext-installed-collection-tabs" aria-label="Plugin collections">
        <button type="button" className={!updatesOnly ? 'is-active' : ''} aria-pressed={!updatesOnly}
          onClick={() => selectCollection(false)}>Installed <span className="ext-installed-count">{rows.length}</span></button>
        <button type="button" onClick={onBrowse}>Browse</button>
        <button type="button" className={updatesOnly ? 'is-active' : ''} aria-pressed={updatesOnly}
          onClick={() => selectCollection(true)}>Updates <span className="ext-installed-count ext-installed-count--updates">{updateCount}</span></button>
      </nav>
      <div className="ext-installed-toolbar">
        <div className="ext-market-search">
          <Search size={15} className="ext-market-search-icon" aria-hidden="true" />
          <input type="search" className="ext-market-search-input" placeholder="Find a plugin…"
            aria-label="Search installed plugins" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="ext-installed-filters" role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map((filter) => <button key={filter.id} type="button" aria-pressed={status === filter.id}
            className={status === filter.id ? 'is-active' : ''} onClick={() => setStatus(filter.id)}>{filter.label}</button>)}
        </div>
        {offeredPublishers.length > 1 ? (
          <select className="ext-installed-publisher-filter" aria-label="Filter by publisher" value={selectedPublisher}
            onChange={(e) => setPublisher(e.target.value as InstalledPublisherFilter)}>
            {offeredPublishers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        ) : null}
        <button type="button" className="ext-installed-sort" title={sortDir === 'asc' ? 'Name A–Z' : 'Name Z–A'}
          aria-label={`Sort by name ${sortDir === 'asc' ? 'descending' : 'ascending'}`}
          onClick={() => setSortDir((dir) => dir === 'asc' ? 'desc' : 'asc')}>
          {sortDir === 'asc' ? <ArrowUpAZ size={14} /> : <ArrowDownAZ size={14} />} Name
        </button>
      </div>
      <div className="ext-installed-scroller">
        {visible.length === 0 ? (
          <p className="ext-installed-empty" role="status">
            {rows.length === 0 ? 'No plugins installed. Browse plugins or add your own.'
              : query.trim() ? `No plugins match “${query.trim()}”.`
              : updatesOnly ? 'No updates match these filters. Check for updates from the More menu.'
              : 'No plugins match these filters.'}
          </p>
        ) : <>
          {tools.length > 0 ? <section aria-label={updatesOnly ? 'Plugin updates' : 'Your everyday tools'}>
            <div className="ext-installed-section-heading"><h4>{updatesOnly ? 'Ready for a refresh' : 'Your everyday tools'}</h4>
              <span className="ext-installed-section-count">{tools.length}</span></div>
            <div className="ext-installed-panel" role="list" aria-label="Installed plugins">{tools.map(renderCard)}</div>
          </section> : null}
          {agents.length > 0 ? <section className="ext-installed-agents" aria-label="Coding agents">
            <button type="button" className="ext-installed-group-toggle" aria-expanded={showAgents} aria-controls={agentsId}
              onClick={() => setAgentsExpanded(!showAgents)}>
              <ChevronRight size={14} aria-hidden="true" /><span>Coding agents</span>
              <span className="ext-installed-section-count">{agents.length}</span>
              <span className="ext-installed-group-meta">{agents.filter(rowEnabled).length} enabled</span>
            </button>
            {!showAgents ? <p className="ext-installed-group-help">Your providers and CLI integrations, together in one place.</p> : null}
            <div id={agentsId} hidden={!showAgents}>
              <div className="ext-installed-panel" role="list" aria-label="Installed coding agents">{agents.map(renderCard)}</div>
            </div>
          </section> : null}
        </>}
        <footer className="ext-installed-collection-footer">
          <span>{enabledCount} {enabledCount === 1 ? 'plugin' : 'plugins'} enabled</span>
          <span aria-live="polite">{visible.length} of {rows.length} plugins</span>
        </footer>
      </div>
    </section>
  );
}
