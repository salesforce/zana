import { ArrowLeft, FolderCog, Search, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState, useId, useSyncExternalStore } from 'react';
import { useData, useUi } from '../../store.js';
import { SETTINGS_SECTIONS, SETTINGS_GROUPS } from '@/views/settings/settings-navigation';
import { SidebarResizer } from '../SidebarResizer.js';
import { useAppSettingsRouteMemory } from '../../hooks/useAppSettingsRouteMemory.js';
import { getSettingsTabRoutePath } from '../../lib/route-paths.js';
import { searchSettings, type SettingsSearchHit, type SettingsSnippet } from '../../lib/settings-search/index.js';
import { openSettingsHit } from '../../lib/settings-search/links.js';
import { getSettingsSearchSourcesVersion, subscribeSettingsSearchSources } from '../../lib/settings-search/registry.js';
import { ensureSettingsSearchProviders } from '../../lib/settings-search/runtime.js';
import { buildCorpus } from '../../lib/settings-search/corpus.js';
import { useSettingsSnapshot } from '../../lib/settings-search/snapshot.js';
import { settingsNavGroups } from '../../lib/settings-nav-search.js';
import { useMobileNavDismiss } from '../mobile-nav-context.js';

/**
 * Focused Settings rail. Each Settings section (Global · Prompts · Personas ·
 * Squads · Usage · …, + the project-scoped Project settings) is a row that
 * navigates to `/settings/:section` (project settings live at
 * `/projects/:id/settings`). Scope (Global vs a single project) is chosen in the
 * content header's scope control (see `ScopeControl` in SettingsPanel.tsx),
 * NOT here. Plugins / Skills / MCP live on the top-level Extensions workspace.
 *
 * `SETTINGS_SECTIONS` is the shared source of truth for labels/icons/descs.
 */
function sectionTitle(section: string): string {
  if (section === 'project') return 'Project settings';
  return SETTINGS_SECTIONS.find((s) => s.id === section)?.label ?? section;
}

export interface SettingsResultPage {
  key: string;
  section: string;
  title: string;
  hits: SettingsSearchHit[];
  /** In the "Close matches" band (letters-in-order / typo hits). */
  close: boolean;
}

/**
 * Group ranked hits by page in two bands: exact (tier 1) pages first, then
 * "close matches" (tiers 2 and 3). Within a band, pages appear in the order of
 * their best hit (Map insertion order follows the engine's ranking). So the
 * flattened list, which the arrow keys walk and Enter opens, never puts a fuzzy
 * row above an exact one, not even across pages.
 */
export function groupHitsByPage(hits: readonly SettingsSearchHit[]): SettingsResultPage[] {
  const bands = [new Map<string, SettingsSearchHit[]>(), new Map<string, SettingsSearchHit[]>()];
  for (const hit of hits) {
    const band = bands[hit.tier === 1 ? 0 : 1];
    const list = band.get(hit.entry.section) ?? [];
    list.push(hit);
    band.set(hit.entry.section, list);
  }
  return bands.flatMap((band, i) =>
    [...band.entries()].map(([section, list]) => ({
      key: `${i}:${section}`,
      section,
      title: sectionTitle(section),
      hits: list,
      close: i === 1
    }))
  );
}

function Highlighted({ snippet }: { snippet: SettingsSnippet }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  snippet.ranges.forEach(([rawStart, end], i) => {
    const start = Math.max(rawStart, at); // ranges arrive merged; never re-emit text
    if (end <= start) return;
    if (start > at) parts.push(snippet.text.slice(at, start));
    parts.push(<mark key={i}>{snippet.text.slice(start, end)}</mark>);
    at = end;
  });
  if (at < snippet.text.length) parts.push(snippet.text.slice(at));
  return <>{parts}</>;
}

/** The ranked results list (listbox): page groups, the "Close matches" band, rows. */
function SettingsSearchResults({
  listId,
  pages,
  activeHit,
  optionId,
  parentLabel,
  onOpen
}: {
  listId: string;
  pages: SettingsResultPage[];
  activeHit: SettingsSearchHit | undefined;
  optionId: (hit: SettingsSearchHit) => string;
  parentLabel: (id: string) => string | undefined;
  onOpen: (hit: SettingsSearchHit) => void;
}) {
  return (
    <div className="settings-results" role="listbox" id={listId} aria-label="Settings search results">
      {pages.map((page, index) => (
        <div key={page.key} className="settings-group" role="group" aria-label={page.close ? `${page.title} (close matches)` : page.title}>
          {page.close && index > 0 && !pages[index - 1].close ? (
            <div className="settings-group-label settings-results-close" role="presentation">Close matches</div>
          ) : null}
          <div className="settings-group-label">{page.title}</div>
          {page.hits.map((hit) => (
            <div
              key={hit.entry.id}
              id={optionId(hit)}
              role="option"
              aria-selected={hit === activeHit}
              data-testid={`settings-result-${hit.entry.id}`}
              className="settings-result"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onOpen(hit)}
            >
              <span className="settings-result-label">{hit.entry.label}</span>
              <span className="settings-result-crumb">{hit.breadcrumb}</span>
              {hit.snippet ? (
                <span className="settings-result-snippet"><Highlighted snippet={hit.snippet} /></span>
              ) : null}
              {hit.matchedValue ? <span className="settings-result-value">Current: {hit.matchedValue}</span> : null}
              {hit.entry.dependsOn ? (
                <span className="settings-result-gate">
                  Appears when {parentLabel(hit.entry.dependsOn) ?? 'its parent setting'} is on
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function SettingsPane() {
  const dismissMobileNav = useMobileNavDismiss();
  const settingsTab = useUi((s) => s.settingsTab);
  const setSettingsAnchor = useUi((s) => s.setSettingsAnchor);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const focusedProjectId = useUi((s) => s.focusedProjectId);
  const projects = useData((s) => s.projects);
  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;
  const routeMemory = useAppSettingsRouteMemory();
  const projectId = focusedProjectId ?? selectedProjectId ?? selectedProject?.id ?? null;
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [active, setActive] = useState(0);
  // Moves when a runtime source changes (plugin settings land, harness probe resolves),
  // so an open query re-ranks with the new data.
  const sourcesVersion = useSyncExternalStore(subscribeSettingsSearchSources, getSettingsSearchSourcesVersion);
  const navigate = useNavigate();
  const listId = useId();
  const searching = query.trim().length > 0;
  const snapshot = useSettingsSnapshot(projectId, searchFocused || searching);
  const hits = useMemo(() => {
    if (!searching) return [];
    ensureSettingsSearchProviders();
    return searchSettings(query, snapshot);
  }, [searching, query, snapshot, sourcesVersion]);
  const pages = useMemo(() => groupHitsByPage(hits), [hits]);
  const flat = useMemo(() => pages.flatMap((p) => p.hits), [pages]);
  const activeHit = flat[Math.min(active, flat.length - 1)];
  const optionId = (hit: SettingsSearchHit) => `${listId}-${hit.entry.id}`;
  const activeOptionId = searching && activeHit ? optionId(activeHit) : undefined;
  useEffect(() => {
    if (activeOptionId) document.getElementById(activeOptionId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeOptionId]);
  // One label lookup per corpus (not a scan per gated row on every render).
  const labelById = useMemo(
    () => (searching ? new Map(buildCorpus(snapshot).entries.map((r) => [r.entry.id, r.entry.label])) : new Map<string, string>()),
    [searching, snapshot, sourcesVersion]
  );

  const open = (hit: SettingsSearchHit) => {
    openSettingsHit(hit, { projectId, navigate: (path) => void navigate(path), setAnchor: setSettingsAnchor });
    dismissMobileNav?.();
  };
  const groups = useMemo(() => settingsNavGroups(SETTINGS_GROUPS, SETTINGS_SECTIONS), []);

  const renderRow = (section: { id: string; label: string }) => {
    const meta = SETTINGS_SECTIONS.find((row) => row.id === section.id);
    const Icon = meta?.icon ?? FolderCog;
    return (
      <div key={section.id} className="settings-section-group">
        <Link
          to={getSettingsTabRoutePath(section.id, projectId)}
          data-testid={`settings-nav-${section.id}`}
          className={`settings-section-item ${settingsTab === section.id ? 'active' : ''}`}
          aria-current={settingsTab === section.id ? 'page' : undefined}
          onClick={() => { setSettingsAnchor(null); dismissMobileNav?.(); }}
        >
          <Icon size={16} strokeWidth={1.7} aria-hidden="true" />
          <span className="settings-section-copy">
            <span className="settings-section-label">{section.label}</span>
          </span>
        </Link>
      </div>
    );
  };

  return (
    <aside className="sidebar settings-pane">
      <Link to={routeMemory.appRoutePath} className="settings-app-back" onClick={() => dismissMobileNav?.()}>
        <ArrowLeft size={16} strokeWidth={1.7} aria-hidden="true" />
        Back to app
      </Link>
      <div className="settings-search">
        <Search size={14} className="settings-search-icon" aria-hidden="true" />
        <input
          type="text"
          className="settings-search-input"
          data-testid="settings-search"
          aria-label="Search settings"
          placeholder="Search settings…"
          value={query}
          role="combobox"
          aria-expanded={searching && flat.length > 0}
          aria-autocomplete="list"
          aria-controls={searching && flat.length > 0 ? listId : undefined}
          aria-activedescendant={activeOptionId}
          // Values are only read while the box is focused or has a query.
          onBlur={() => { if (!query.trim()) setSearchFocused(false); }}
          onFocus={() => {
            setSearchFocused(true);
            void ensureSettingsSearchProviders().prefetchPluginSettings();
          }}
          onChange={(event) => { setQuery(event.target.value); setActive(0); }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && query) {
              event.stopPropagation();
              setQuery('');
            } else if (searching && flat.length > 0 && event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((i) => Math.min(i + 1, flat.length - 1));
            } else if (searching && flat.length > 0 && event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (searching && event.key === 'Enter' && activeHit && !event.nativeEvent.isComposing) {
              event.preventDefault();
              open(activeHit);
            }
          }}
        />
        {query ? (
          <button
            type="button"
            className="settings-search-clear"
            aria-label="Clear search"
            onClick={() => setQuery('')}
          >
            <X size={12} />
          </button>
        ) : null}
      </div>
      {searching ? (
        flat.length === 0 ? (
          <p className="settings-search-empty" role="status">No matching settings</p>
        ) : (
          <SettingsSearchResults
            listId={listId}
            pages={pages}
            activeHit={activeHit}
            optionId={optionId}
            parentLabel={(id) => labelById.get(id)}
            onOpen={open}
          />
        )
      ) : (
      <nav className="settings-picker" aria-label="Settings navigation">
            {groups.map((group) => (
              <div key={group.id} className="settings-group">
                <div className="settings-group-label">{group.label}</div>
                {group.sections.map(renderRow)}
              </div>
            ))}
      </nav>
      )}
      <SidebarResizer />
    </aside>
  );
}
