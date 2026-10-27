import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import './installed-plugin-collection.css';
import { ArrowDownAZ, ArrowUpAZ, AlertTriangle, CheckCircle2, ChevronRight, Search } from 'lucide-react';
import { InstalledPluginCard } from './InstalledPluginCard.js';
import {
  filterInstalledRows, rowEnabled, type HubRow
} from './installed-plugins.js';
import { filterCollectionRows, groupInstalledRows, type InstalledStatusFilter } from './installed-collection.js';
import { installedCapabilities, installedSource } from './plugin-presentation.js';
import { installedRuntimeStatus } from './installed-row-status.js';
import { pluginUpdateDelivery } from './PluginUpdateDetails.js';
import { pluginAvailableVersion } from './plugin-row-update.js';

const STATUS_FILTERS: { id: InstalledStatusFilter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'enabled', label: 'Enabled' }, { id: 'disabled', label: 'Disabled' }
];

export function InstalledPluginCollection({ rows, onOpen, onBrowse, headerActions, mobileHeader, selectedId, defaultUpdates = false }: {
  rows: HubRow[];
  onOpen: (id: string) => void;
  onBrowse: () => void;
  headerActions?: ReactNode;
  mobileHeader?: ReactNode;
  selectedId?: string | null;
  defaultUpdates?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [capability, setCapability] = useState('all');
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [status, setStatus] = useState<InstalledStatusFilter>('all');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [updatesOnly, setUpdatesOnly] = useState(defaultUpdates);
  const [agentsExpanded, setAgentsExpanded] = useState(false);
  const agentsId = useId();
  const sources = [...new Set(rows.map(installedSource))].sort();
  const selectedSource = sources.includes(source) ? source : 'all';
  const capabilities = [...new Set(rows.flatMap(installedCapabilities))].sort();
  const selectedCapability = capabilities.includes(capability) ? capability : 'all';
  const attentionCount = rows.filter((row) => installedRuntimeStatus(row) !== null).length;
  const visible = useMemo(() => filterCollectionRows(
    filterInstalledRows(rows, query, 'all', sortDir), status, updatesOnly
  ).filter((row) => (selectedSource === 'all' || installedSource(row) === selectedSource) &&
    (selectedCapability === 'all' || installedCapabilities(row).includes(selectedCapability)) &&
    (!issuesOnly || installedRuntimeStatus(row) !== null)),
  [rows, query, selectedSource, sortDir, status, updatesOnly, selectedCapability, issuesOnly]);
  const { tools, agents } = groupInstalledRows(visible);
  const enabledCount = rows.filter(rowEnabled).length;
  const updateCount = rows.filter((row) => pluginAvailableVersion(row) !== null).length;
  // A collapsed category must never hide a search/filter result.
  useEffect(() => {
    if (query.trim() || status !== 'all' || selectedSource !== 'all' || capability !== 'all' || issuesOnly || updatesOnly) setAgentsExpanded(true);
  }, [query, status, selectedSource, updatesOnly, capability, issuesOnly]);
  const showAgents = agentsExpanded;

  const selectCollection = (updates: boolean) => {
    setUpdatesOnly(updates);
    setQuery('');
    setStatus('all');
    setSource('all');
    setCapability('all');
    setIssuesOnly(false);
  };
  const renderCard = (row: HubRow) => <InstalledPluginCard key={row.module.id} row={row} selected={row.module.id === selectedId} onOpen={() => onOpen(row.module.id)} />;

  return (
    <section className="ext-installed ext-installed-collection">
      {mobileHeader}
      <header className="ext-installed-header">
        <div><h3>Plugins</h3><p className="settings-help">Manage your tools, skills, and integrations.</p></div>
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
        {capabilities.length > 0 ? <select className="ext-installed-publisher-filter" aria-label="Filter by capability" value={selectedCapability}
          onChange={(e) => setCapability(e.target.value)}>
          <option value="all">All capabilities</option>{capabilities.map((item) => <option key={item}>{item}</option>)}
        </select> : null}
        {sources.length > 1 ? <select className="ext-installed-publisher-filter" aria-label="Filter by source" value={selectedSource}
          onChange={(e) => setSource(e.target.value)}>
          <option value="all">All sources</option>{sources.map((item) => <option key={item}>{item}</option>)}
        </select> : null}
        <button type="button" className="ext-installed-sort" title={sortDir === 'asc' ? 'Name A–Z' : 'Name Z–A'}
          aria-label={`Sort by name ${sortDir === 'asc' ? 'descending' : 'ascending'}`}
          onClick={() => setSortDir((dir) => dir === 'asc' ? 'desc' : 'asc')}>
          {sortDir === 'asc' ? <ArrowUpAZ size={14} /> : <ArrowDownAZ size={14} />} Name
        </button>
      </div>
      <div className="ext-plugin-workbench">
      <div className="ext-installed-scroller ext-plugin-collection-main">
        {!updatesOnly && attentionCount > 0 ? <div className="ext-plugin-attention">
          <AlertTriangle size={19} aria-hidden="true" /><div><strong>{attentionCount} {attentionCount === 1 ? 'plugin needs' : 'plugins need'} attention</strong>
          <p>Review runtime issues and configuration requests.</p></div>
          <button type="button" className="settings-btn" aria-pressed={issuesOnly} onClick={() => {
            setIssuesOnly(!issuesOnly); setQuery(''); setStatus('all'); setSource('all'); setCapability('all');
          }}>{issuesOnly ? 'Show all' : `Review ${attentionCount}`}</button>
        </div> : null}
        {updatesOnly && updateCount === 0 ? <div className="ext-plugin-current" role="status"><CheckCircle2 size={30} />
          <h4>No pending updates</h4><p>Check for updates from the More menu to refresh your sources.</p></div> : null}
        {visible.length === 0 && !(updatesOnly && updateCount === 0) ? (
          <p className="ext-installed-empty" role="status">
            {rows.length === 0 ? 'No plugins installed. Browse plugins or add your own.'
              : query.trim() ? `No plugins match “${query.trim()}”.`
              : updatesOnly ? 'No updates match these filters. Check for updates from the More menu.'
              : 'No plugins match these filters.'}
          </p>
        ) : <>
          {tools.length > 0 ? <section aria-label={updatesOnly ? 'Plugin updates' : 'Tools & integrations'}>
            <div className="ext-installed-section-heading"><h4>{updatesOnly ? 'Ready for a refresh' : 'Tools & integrations'}</h4>
              <span className="ext-installed-section-count">{tools.length}</span></div>
            <div className="ext-installed-table-heading" aria-hidden="true"><span>Plugin</span><span>What it adds</span><span>Installed from</span><span>Status</span><span /><span /></div>
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
        {updatesOnly ? <section className="ext-plugin-update-policies" aria-label="Update delivery">
          {[...new Set(rows.map((row) => pluginUpdateDelivery(row.plugin)))].map((delivery) => <div key={delivery}><strong>{delivery}</strong>
            <span>{rows.filter((row) => pluginUpdateDelivery(row.plugin) === delivery).length} plugins</span></div>)}
        </section> : null}
        <footer className="ext-installed-collection-footer">
          <span>{enabledCount} {enabledCount === 1 ? 'plugin' : 'plugins'} enabled</span>
          <span aria-live="polite">{visible.length} of {rows.length} plugins</span>
        </footer>
      </div>
      </div>
    </section>
  );
}
