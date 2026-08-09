import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  FolderOpen,
  Puzzle,
  Search
} from 'lucide-react';
import type { McpServerEntry, PluginEntry, PluginSource, SkillEntry } from '@shared/types';
import { usePlugins, useUi } from '../store';

const SOURCE_FILTERS: Array<{ id: 'all' | PluginSource; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'user', label: 'User' },
  { id: 'marketplace', label: 'Marketplace' }
];

/**
 * Plugins catalogue, rendered as the Settings → Plugins tab. Returns tab
 * content only — SettingsPanel supplies the `settings-panel` / `settings-inner`
 * shell, so this must NOT render its own `<main>`.
 */
export function PluginsBody() {
  const entries = usePlugins((s) => s.entries);
  const loading = usePlugins((s) => s.loading);
  const setSettingsTab = useUi((s) => s.setSettingsTab);
  const setCatalogueFilter = useUi((s) => s.setCatalogueFilter);
  const pushToast = useUi((s) => s.pushToast);

  const [filter, setFilter] = useState<'all' | PluginSource>('all');
  const [query, setQuery] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);
  const [allSkills, setAllSkills] = useState<SkillEntry[]>([]);
  const [allMcp, setAllMcp] = useState<McpServerEntry[]>([]);

  // Pull the full skills + MCP catalogues so we can render each plugin's
  // contributed items inline (name + description) on demand. We join on
  // `pluginName` since both stores already qualify rows by their owning plugin.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void window.cc.skills.list().then((s) => {
        if (!cancelled) setAllSkills(s);
      });
      void window.cc.mcp.listAll().then((m) => {
        if (!cancelled) setAllMcp(m);
      });
    };
    load();
    const offSkills = window.cc.skills.onChanged(() => load());
    const offMcp = window.cc.mcp.onChanged(() => load());
    return () => {
      cancelled = true;
      offSkills();
      offMcp();
    };
  }, []);

  const skillsByPlugin = useMemo(() => {
    const m = new Map<string, SkillEntry[]>();
    for (const s of allSkills) {
      if (s.source !== 'plugin' || !s.pluginName) continue;
      const list = m.get(s.pluginName) ?? [];
      list.push(s);
      m.set(s.pluginName, list);
    }
    return m;
  }, [allSkills]);

  const mcpByPlugin = useMemo(() => {
    const m = new Map<string, McpServerEntry[]>();
    for (const e of allMcp) {
      if (e.source !== 'plugin' || !e.pluginName) continue;
      const list = m.get(e.pluginName) ?? [];
      list.push(e);
      m.set(e.pluginName, list);
    }
    return m;
  }, [allMcp]);

  // Optimistic-but-revert toggling: we update local state immediately and
  // restore on a Result.ok=false reply. We clear an entry's optimistic state
  // once the next push from main matches what we expected, rather than wiping
  // wholesale on every push — that prevents flicker when the user toggles
  // two rows quickly.
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setOptimistic((prev) => {
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const [id, expected] of Object.entries(prev)) {
        const actual = entries.find((p) => p.id === id)?.enabled;
        if (actual === expected) {
          changed = true; // truth caught up — drop the override
        } else {
          next[id] = expected;
        }
      }
      return changed ? next : prev;
    });
  }, [entries]);

  const merged = useMemo(
    () =>
      entries.map((p) =>
        p.id in optimistic ? { ...p, enabled: optimistic[p.id] } : p
      ),
    [entries, optimistic]
  );

  const counts = useMemo(() => {
    const c = { all: merged.length, user: 0, marketplace: 0 };
    for (const p of merged) c[p.source] += 1;
    return c;
  }, [merged]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return merged.filter((p) => {
      if (filter !== 'all' && p.source !== filter) return false;
      if (!q) return true;
      const haystack = `${p.name} ${p.description ?? ''} ${p.marketplace ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [merged, filter, query]);

  const flashSaved = () => {
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1400);
  };

  const togglePlugin = async (plugin: PluginEntry, enabled: boolean) => {
    setOptimistic((prev) => ({ ...prev, [plugin.id]: enabled }));
    const res = await window.cc.plugins.setEnabled(plugin.id, enabled);
    if (!res.ok) {
      setOptimistic((prev) => {
        const next = { ...prev };
        delete next[plugin.id];
        return next;
      });
      pushToast(res.message || 'Failed to toggle plugin', 'error');
      return;
    }
    flashSaved();
  };

  const reveal = (plugin: PluginEntry) => {
    void window.cc.plugins.reveal(plugin.id);
  };

  const openSkillsFor = (plugin: PluginEntry) => {
    setCatalogueFilter('skills', plugin.name);
    setSettingsTab('skills');
  };
  const openMcpFor = (plugin: PluginEntry) => {
    setCatalogueFilter('mcp', plugin.name);
    setSettingsTab('mcp');
  };

  return (
    <div className="settings-catalogue plugins-catalogue">
      <div className="scheduler-header">
        <div className="scheduler-header-text">
          <h2>Plugins</h2>
            <p className="settings-help scheduler-subtitle">
              Plugins installed under <code>~/.claude/plugins</code>. Toggling a
              plugin writes to <code>enabledPlugins</code> in{' '}
              <code>~/.claude/settings.json</code>; the Claude CLI honours that
              flag on next launch. Install/uninstall happens via{' '}
              <code>claude plugin …</code>.
            </p>
          </div>
        </div>

        <div className="skills-layout skills-layout--single">
          <section className="skills-left">
            <div className="skills-toolbar">
              <div className="skills-search">
                <Search size={14} aria-hidden />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search plugins…"
                  aria-label="Search plugins"
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
                <Puzzle size={28} className="scheduler-empty-icon" />
                <div className="scheduler-empty-title">
                  {merged.length === 0 ? 'No plugins installed' : 'No matches'}
                </div>
                <div className="scheduler-empty-hint">
                  {merged.length === 0
                    ? 'Install a plugin via `claude plugin install <name>` to see it here.'
                    : 'Try a different search or filter.'}
                </div>
              </div>
            ) : (
              <ul className="skills-list">
                {filtered.map((plugin) => (
                  <PluginRow
                    key={plugin.id}
                    plugin={plugin}
                    skills={skillsByPlugin.get(plugin.name) ?? []}
                    mcpServers={mcpByPlugin.get(plugin.name) ?? []}
                    onToggle={(enabled) => togglePlugin(plugin, enabled)}
                    onReveal={() => reveal(plugin)}
                    onOpenSkills={() => openSkillsFor(plugin)}
                    onOpenMcp={() => openMcpFor(plugin)}
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

function PluginRow({
  plugin,
  skills,
  mcpServers,
  onToggle,
  onReveal,
  onOpenSkills,
  onOpenMcp
}: {
  plugin: PluginEntry;
  skills: SkillEntry[];
  mcpServers: McpServerEntry[];
  onToggle: (enabled: boolean) => void;
  onReveal: () => void;
  onOpenSkills: () => void;
  onOpenMcp: () => void;
}) {
  const sourceLabel =
    plugin.source === 'marketplace' && plugin.marketplace
      ? plugin.marketplace
      : 'User';
  const [expanded, setExpanded] = useState(false);
  const hasDetails = skills.length > 0 || mcpServers.length > 0;

  return (
    <li className={`skills-row plugin-row ${plugin.enabled ? '' : 'is-disabled'} ${expanded ? 'is-expanded' : ''}`}>
      <label
        className="skills-row-toggle"
        title={plugin.enabled ? 'Disable' : 'Enable'}
      >
        <input
          type="checkbox"
          checked={plugin.enabled}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span aria-hidden />
      </label>
      <div className="skills-row-body">
        <div className="skills-row-head">
          <span className="plugin-row-icon" aria-hidden>
            <Puzzle size={13} />
          </span>
          <span className="skills-row-name">{plugin.name}</span>
          <span className={`scheduler-pill scheduler-pill--source skills-source-${plugin.source}`}>
            {sourceLabel}
          </span>
          {plugin.version && (
            <span className="scheduler-pill plugin-version-pill">v{plugin.version}</span>
          )}
          {!plugin.manifestValid && (
            <span
              className="scheduler-pill plugin-warning-pill"
              title="Manifest missing or unparseable — toggling disabled"
            >
              <AlertTriangle size={11} /> Manifest
            </span>
          )}
          {!plugin.enabled && plugin.manifestValid && (
            <span className="scheduler-pill plugin-off-pill">off</span>
          )}
        </div>
        {plugin.description && (
          <p className="skills-row-desc">{plugin.description}</p>
        )}
        <div className="plugin-provides">
          <ProvidesChip
            count={plugin.provides.skills.length}
            label="skills"
            onClick={plugin.provides.skills.length > 0 ? onOpenSkills : undefined}
          />
          <ProvidesChip
            count={plugin.provides.commands.length}
            label="commands"
            // No commands surface yet — chip is decorative for v1.
            tooltip={
              plugin.provides.commands.length > 0
                ? 'Commands surface coming soon'
                : undefined
            }
          />
          <ProvidesChip
            count={plugin.provides.mcpServers.length}
            label="MCP"
            onClick={plugin.provides.mcpServers.length > 0 ? onOpenMcp : undefined}
          />
        </div>
      </div>
      <div className="plugin-row-actions">
        <button
          type="button"
          className="scheduler-icon-btn"
          onClick={onReveal}
          title="Reveal in Finder"
          aria-label="Reveal in Finder"
        >
          <FolderOpen size={14} />
        </button>
        {hasDetails && (
          <button
            type="button"
            className={`scheduler-icon-btn scheduler-icon-btn--chevron ${expanded ? 'is-open' : ''}`}
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? 'Hide details' : 'Show details'}
            aria-label="Toggle details"
            aria-expanded={expanded}
          >
            <ChevronDown size={14} />
          </button>
        )}
      </div>
      {expanded && hasDetails && (
        <PluginDetail skills={skills} mcpServers={mcpServers} />
      )}
    </li>
  );
}

function PluginDetail({
  skills,
  mcpServers
}: {
  skills: SkillEntry[];
  mcpServers: McpServerEntry[];
}) {
  return (
    <div className="plugin-row-detail">
      {skills.length > 0 && (
        <section className="plugin-row-detail-section">
          <header>Skills · {skills.length}</header>
          <ul>
            {skills.map((s) => (
              <li key={s.id}>
                <span className="plugin-detail-name">{s.name}</span>
                {s.description && (
                  <span className="plugin-detail-desc">{s.description}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {mcpServers.length > 0 && (
        <section className="plugin-row-detail-section">
          <header>MCP servers · {mcpServers.length}</header>
          <ul>
            {mcpServers.map((m) => (
              <li key={m.id}>
                <span className="plugin-detail-name">{m.name}</span>
                <span className="plugin-detail-meta">
                  {m.transport === 'http' && m.url
                    ? `http · ${m.url}`
                    : m.transport === 'stdio' && m.command
                    ? `stdio · ${m.command}${m.args && m.args.length > 0 ? ' ' + m.args.join(' ') : ''}`
                    : m.transport}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ProvidesChip({
  count,
  label,
  onClick,
  tooltip
}: {
  count: number;
  label: string;
  onClick?: () => void;
  tooltip?: string;
}) {
  // Hide the chip entirely when this plugin doesn't provide anything of this
  // kind — empty chips are noise that hurt scanability of populated rows.
  if (count === 0) return null;
  if (!onClick) {
    return (
      <span className="plugin-provides-chip" title={tooltip}>
        {count} {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="plugin-provides-chip is-link"
      onClick={onClick}
      title={tooltip ?? `Open ${label}`}
    >
      {count} {label}
    </button>
  );
}
