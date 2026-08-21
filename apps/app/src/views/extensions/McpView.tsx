import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Globe,
  Plug,
  Search,
  Terminal
} from 'lucide-react';
import type { McpServerEntry, McpSource, McpTransport } from '@zana-ai/zcc-domain/product';
import { useMcpCatalogue, useUi } from '@/store';

const SOURCE_FILTERS: Array<{ id: 'all' | McpSource; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'user', label: 'User' },
  { id: 'plugin', label: 'Plugin' },
  { id: 'project', label: 'Project' }
];

/**
 * MCP servers catalogue, rendered on the Extensions workspace MCP page.
 * Returns tab content only — the host panel supplies the `settings-panel` /
 * `settings-inner` shell, so this must NOT render its own `<main>`.
 */
export function McpBody({ showHeader = true }: { showHeader?: boolean } = {}) {
  const entries = useMcpCatalogue((s) => s.entries);
  const loading = useMcpCatalogue((s) => s.loading);
  const setExtensionsTab = useUi((s) => s.setExtensionsTab);
  const catalogueFilter = useUi((s) => s.catalogueFilter);
  const setCatalogueFilter = useUi((s) => s.setCatalogueFilter);
  const pushToast = useUi((s) => s.pushToast);

  const [filter, setFilter] = useState<'all' | McpSource>('all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [savedFlash, setSavedFlash] = useState(false);
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});

  // Honour cross-panel deep-link prefilter (e.g., a plugin row's "1 MCP" chip).
  useEffect(() => {
    if (catalogueFilter.mcp) {
      setQuery(catalogueFilter.mcp);
      setCatalogueFilter('mcp', undefined);
    }
  }, [catalogueFilter.mcp, setCatalogueFilter]);

  // Drop only the optimistic overrides whose truth has caught up. A blanket
  // wipe would flicker when the user toggles two rows in quick succession.
  useEffect(() => {
    setOptimistic((prev) => {
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const [id, expected] of Object.entries(prev)) {
        const actual = entries.find((e) => e.id === id)?.enabled;
        if (actual === expected) {
          changed = true;
        } else {
          next[id] = expected;
        }
      }
      return changed ? next : prev;
    });
  }, [entries]);

  const merged = useMemo(
    () =>
      entries.map((e) =>
        e.id in optimistic ? { ...e, enabled: optimistic[e.id] } : e
      ),
    [entries, optimistic]
  );

  const counts = useMemo(() => {
    const c = { all: merged.length, user: 0, plugin: 0, project: 0 };
    for (const m of merged) c[m.source] += 1;
    return c;
  }, [merged]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return merged.filter((m) => {
      if (filter !== 'all' && m.source !== filter) return false;
      if (!q) return true;
      const haystack = `${m.name} ${m.command ?? ''} ${m.url ?? ''} ${m.pluginName ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [merged, filter, query]);

  const flashSaved = () => {
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1400);
  };

  const toggleEntry = async (entry: McpServerEntry, enabled: boolean) => {
    if (entry.enabledLockedBy === 'plugin') {
      pushToast(
        `"${entry.name}" is provided by plugin "${entry.pluginName}". Toggle the plugin instead.`,
        'info'
      );
      return;
    }
    setOptimistic((prev) => ({ ...prev, [entry.id]: enabled }));
    const res = await window.cc.mcp.setEnabledById(entry.id, enabled);
    if (!res.ok) {
      setOptimistic((prev) => {
        const next = { ...prev };
        delete next[entry.id];
        return next;
      });
      pushToast(res.message || 'Failed to toggle MCP server', 'error');
      return;
    }
    flashSaved();
  };

  const reveal = (entry: McpServerEntry) => {
    void window.cc.mcp.reveal(entry.id);
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="settings-catalogue mcp-catalogue">
      {showHeader && (
        <div className="scheduler-header">
          <div className="scheduler-header-text">
            <h2>MCP servers</h2>
            <p className="settings-help scheduler-subtitle">
              MCP servers from <code>~/.claude.json</code> (user), each
              installed plugin's <code>.mcp.json</code>, and per-project{' '}
              <code>.mcp.json</code>. User-scope toggles write to{' '}
              <code>disabledMcpServers</code> in{' '}
              <code>~/.claude/settings.json</code>; project toggles write to{' '}
              <code>.claude/settings.local.json</code>. Plugin-sourced rows are
              read-only — disable the plugin to disable its servers.
            </p>
          </div>
        </div>
      )}

        <div className="skills-layout skills-layout--single">
          <section className="skills-left">
            <div className="skills-toolbar">
              <div className="skills-search">
                <Search size={14} aria-hidden />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search MCP servers…"
                  aria-label="Search MCP servers"
                />
              </div>
              <div className="skills-filter" role="tablist" aria-label="Source filter">
                {SOURCE_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="tab"
                    aria-selected={filter === f.id}
                    className={`skills-filter-btn ${filter === f.id ? 'is-active' : ''}`}
                    onClick={() => setFilter(f.id)}
                  >
                    {f.label}
                    <span className="skills-filter-count">
                      {f.id === 'all' ? counts.all : counts[f.id]}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="scheduler-empty">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="scheduler-empty">
                <Plug size={28} className="scheduler-empty-icon" />
                <div className="scheduler-empty-title">
                  {merged.length === 0 ? 'No MCP servers found' : 'No matches'}
                </div>
                <div className="scheduler-empty-hint">
                  {merged.length === 0
                    ? 'Add a server to ~/.claude.json under "mcpServers", or drop a .mcp.json into a project.'
                    : 'Try a different search or filter.'}
                </div>
              </div>
            ) : (
              <ul className="skills-list">
                {filtered.map((entry) => (
                  <McpRow
                    key={entry.id}
                    entry={entry}
                    expanded={expanded.has(entry.id)}
                    onToggle={(enabled) => toggleEntry(entry, enabled)}
                    onReveal={() => reveal(entry)}
                    onExpandToggle={() => toggleExpand(entry.id)}
                    onOpenPlugins={() => setExtensionsTab('installed')}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>

        {savedFlash && <div className="settings-saved">Saved</div>}
    </div>
  );
}

function TransportIcon({ transport }: { transport: McpTransport }) {
  if (transport === 'http') return <Globe size={14} aria-label="HTTP" />;
  if (transport === 'stdio') return <Terminal size={14} aria-label="stdio" />;
  return <Plug size={14} aria-label="unknown transport" />;
}

function McpRow({
  entry,
  expanded,
  onToggle,
  onReveal,
  onExpandToggle,
  onOpenPlugins
}: {
  entry: McpServerEntry;
  expanded: boolean;
  onToggle: (enabled: boolean) => void;
  onReveal: () => void;
  onExpandToggle: () => void;
  onOpenPlugins: () => void;
}) {
  const sourceLabel = (() => {
    if (entry.source === 'plugin') return `Plugin · ${entry.pluginName ?? ''}`;
    if (entry.source === 'project') return 'Project';
    return 'User';
  })();
  const summary = entry.command
    ? `${entry.command}${entry.args && entry.args.length > 0 ? ' ' + entry.args[0] : ''}`
    : entry.url
      ? entry.url
      : '—';
  const locked = entry.enabledLockedBy === 'plugin';

  return (
    <li className={`skills-row mcp-row ${entry.enabled ? '' : 'is-disabled'}`}>
      <label
        className="skills-row-toggle"
        title={
          locked
            ? 'Toggle in Plugins panel'
            : entry.enabled
              ? 'Disable'
              : 'Enable'
        }
      >
        <input
          type="checkbox"
          checked={entry.enabled}
          disabled={locked}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span aria-hidden />
      </label>
      <div className="skills-row-body">
        <div className="skills-row-head">
          <button
            type="button"
            className="mcp-expand-btn"
            onClick={onExpandToggle}
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse details' : 'Expand details'}
            title={expanded ? 'Collapse' : 'Expand details'}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          <span className="skills-row-name">{entry.name}</span>
          <span className={`scheduler-pill scheduler-pill--source skills-source-${entry.source}`}>
            {sourceLabel}
          </span>
          <span className="scheduler-pill mcp-transport-pill">
            <TransportIcon transport={entry.transport} /> {entry.transport}
          </span>
          {!entry.enabled && (
            <span className="scheduler-pill plugin-off-pill">off</span>
          )}
          {locked && (
            <button
              type="button"
              className="mcp-locked-link"
              onClick={onOpenPlugins}
              title="Open Plugins panel"
            >
              toggle in Plugins →
            </button>
          )}
        </div>
        <div className="mcp-row-summary">
          <code className="mcp-row-cmd" title={summary}>
            {summary}
          </code>
        </div>
        {expanded && <McpDetails entry={entry} />}
      </div>
      <button
        type="button"
        className="scheduler-icon-btn"
        onClick={onReveal}
        title="Reveal source file"
        aria-label="Reveal source file"
      >
        <FolderOpen size={14} />
      </button>
    </li>
  );
}

function McpDetails({ entry }: { entry: McpServerEntry }) {
  return (
    <div className="mcp-row-detail">
      {entry.command && <DetailRow label="command" value={entry.command} />}
      {entry.args && entry.args.length > 0 && (
        <DetailRow label="args" value={entry.args.join(' ')} />
      )}
      {entry.url && <DetailRow label="url" value={entry.url} />}
      {entry.envKeys && entry.envKeys.length > 0 && (
        <DetailKeys label="env" keys={entry.envKeys} />
      )}
      {entry.headerKeys && entry.headerKeys.length > 0 && (
        <DetailKeys label="headers" keys={entry.headerKeys} />
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mcp-detail-row">
      <span className="mcp-detail-label">{label}</span>
      <code className="mcp-detail-value">{value}</code>
    </div>
  );
}

function DetailKeys({ label, keys }: { label: string; keys: string[] }) {
  return (
    <div className="mcp-detail-row mcp-detail-kv">
      <span className="mcp-detail-label">{label}</span>
      <ul className="mcp-detail-kv-list">
        {keys.map((key) => (
          <li key={key} className="mcp-detail-kv-row">
            <code className="mcp-detail-kv-key">{key}</code>
            <code className="mcp-detail-kv-val">set</code>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function McpView() {
  return <McpBody />;
}

export { McpView as McpPanel };
