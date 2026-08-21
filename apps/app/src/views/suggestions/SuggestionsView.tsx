import { useMemo, useState, type ReactNode } from 'react';
import {
  Sparkles,
  Play,
  X,
  Search,
  ChevronRight,
  TerminalSquare,
  Bot,
  AppWindow,
  ExternalLink,
  Layers
} from 'lucide-react';
import { useData, useUi, useSuggestions, useInboxScopeProjectId, type NavId } from '@/store';
import type { Suggestion, SuggestedActionKind } from '@zana-ai/zcc-domain/product';
import { AppPageHeader } from '@/components/AppPageHeader';

/** The STANDALONE action kinds, in display order — drives the filter-chip row.
 *  (open-view/navigate are combo-tail only, so a top-level card is always one of
 *  these three; the icon/label helpers still cover the nav kinds for combo-step
 *  previews.) */
const KIND_ORDER: SuggestedActionKind['kind'][] = ['start-terminal', 'start-agent', 'combo'];

/** One project's suggestions, grouped for the collapsible-section layout. */
interface ProjectGroup {
  projectId: string;
  projectLabel: string;
  color?: string;
  items: Suggestion[];
  /** Newest `ts` in the group — groups sort most-recent-first. */
  latestTs: number;
}

/**
 * Next Steps launcher (afl-03) — a SIBLING to the inbox, NOT a feed category.
 * "Next Steps" is the user-facing name; the internal ids (`suggestions`,
 * `suggest_action`, the IPC channels, the on-disk store) stay stable. Renders
 * the live `useSuggestions` slice as a responsive card grid. Each card proposes
 * a runnable next step an agent surfaced via `suggest_action`; "Run" hands the
 * id to main (`window.cc.suggestions.run`), which reads the suggestion from its
 * OWN store and re-authorizes every step (Rule 1/2) — the renderer never
 * supplies the action. Any returned nav directive is applied to `useUi` here
 * (spawns happen in main; navigation is a renderer concern).
 *
 * Generic + core: no extension id is ever hardcoded (Rule 6) — suggestions
 * arrive as structured data.
 */
export function SuggestionsView() {
  const allEntries = useSuggestions((s) => s.entries);
  const loading = useSuggestions((s) => s.loading);
  const removeLocal = useSuggestions((s) => s.removeLocal);
  const projects = useData((s) => s.projects);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Scope to the focused/scoped project — the twin of the Inbox. When the shell
  // is drilled into one project (a per-project window's hard URL lock, or the
  // main window's soft focus), show ONLY that project's next steps; on the
  // all-projects home, `scopeProjectId` is null and every project's steps show.
  // Because the store already project-filters a scoped WINDOW's entries at the
  // source, this filter is what narrows a focused MAIN window.
  const scopeProjectId = useInboxScopeProjectId();
  const scoped = scopeProjectId !== null;
  const entries = useMemo(
    () => (scopeProjectId ? allEntries.filter((e) => e.projectId === scopeProjectId) : allEntries),
    [allEntries, scopeProjectId]
  );

  // Triage controls — a text query over title/detail/project, plus a set of
  // action-kind filters. Both narrow the list before it's grouped. Kept as
  // ephemeral component state: they're a transient lens, not a saved preference.
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<Set<SuggestedActionKind['kind']>>(new Set());
  // Which project groups are collapsed. Ephemeral (resets on remount) — the set
  // of projects with suggestions changes often enough that persistence buys
  // little, and it keeps this a pure renderer concern (zero store surface).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Which kinds are actually present — so the filter row only offers chips that
  // match something (an empty "combo" chip would be dead weight).
  const presentKinds = useMemo(() => {
    const set = new Set<SuggestedActionKind['kind']>();
    for (const e of entries) set.add(e.action.kind);
    return KIND_ORDER.filter((k) => set.has(k));
  }, [entries]);

  // Filtered list — text match (title/detail/projectLabel) AND kind match. An
  // empty query or empty kind set is a pass-through for that dimension.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (kindFilter.size > 0 && !kindFilter.has(e.action.kind)) return false;
      if (!q) return true;
      const hay = `${e.title} ${e.detail ?? ''} ${e.projectLabel ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [entries, query, kindFilter]);

  // Group the filtered list by project, newest group first, newest card first
  // within each group. Project color is resolved from the live project list.
  const groups = useMemo<ProjectGroup[]>(() => {
    const byId = new Map<string, ProjectGroup>();
    for (const s of filtered) {
      let g = byId.get(s.projectId);
      if (!g) {
        const proj = projects.find((p) => p.id === s.projectId);
        g = {
          projectId: s.projectId,
          projectLabel: proj?.name ?? s.projectLabel ?? s.projectId,
          color: proj?.color,
          items: [],
          latestTs: 0
        };
        byId.set(s.projectId, g);
      }
      g.items.push(s);
      if (s.ts > g.latestTs) g.latestTs = s.ts;
    }
    return Array.from(byId.values()).sort((a, b) => b.latestTs - a.latestTs);
  }, [filtered, projects]);

  const toggleKind = (kind: SuggestedActionKind['kind']): void =>
    setKindFilter((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });

  const toggleGroup = (projectId: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });

  const applyDirective = (d: { nav?: string; projectId?: string; tabId?: string }): void => {
    if (d.projectId) {
    useUi.getState().enterProjectFocus(d.projectId);
      return;
    }
    if (d.nav) useUi.getState().setNav(d.nav as NavId);
  };

  const run = async (id: string): Promise<void> => {
    setBusyId(id);
    try {
      const res = await window.cc.suggestions.run(id);
      if (res.ok) {
        // A durable open-view stays; everything else is a one-shot removed in
        // main. Optimistically drop the row unless it's a pure view directive
        // that main kept (the onRemoved push reconciles either way).
        applyDirective(res);
      }
    } catch {
      /* main-side failure — leave the card in place */
    } finally {
      setBusyId(null);
    }
  };

  const dismiss = async (id: string): Promise<void> => {
    removeLocal(id); // optimistic; onRemoved push reconciles
    try {
      await window.cc.suggestions.dismiss(id);
    } catch {
      /* the row will reappear on next reconcile if the delete failed */
    }
  };

  return (
    <section className="suggestions-view">
      <AppPageHeader
        title={<><Sparkles size={16} aria-hidden /> <h1>Next Steps</h1></>}
        actions={entries.length > 0 ? <span className="suggestions-count">{entries.length}</span> : undefined}
      />

      <div className="settings-inner">
      {/* Triage bar — search + kind-filter chips. Only shown once there's more
          than a card or two to sift, so a near-empty launcher stays clean. */}
      {!loading && entries.length > 2 && (
        <div className="suggestions-toolbar">
          <div className="suggestions-search">
            <Search size={13} aria-hidden />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search next steps…"
              aria-label="Search next steps"
            />
            {query && (
              <button
                type="button"
                className="suggestions-search-clear"
                aria-label="Clear search"
                onClick={() => setQuery('')}
              >
                <X size={12} aria-hidden />
              </button>
            )}
          </div>
          {presentKinds.length > 1 && (
            <div className="suggestions-kind-filter" role="group" aria-label="Filter by action kind">
              {presentKinds.map((kind) => {
                const on = kindFilter.has(kind);
                return (
                  <button
                    key={kind}
                    type="button"
                    className={`suggestions-kind-chip suggestion-kind-${kind} ${on ? 'is-on' : ''}`}
                    aria-pressed={on}
                    onClick={() => toggleKind(kind)}
                  >
                    {kindIcon(kind)}
                    <span>{kindLabel(kind)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <p className="suggestions-empty">Loading…</p>
      ) : entries.length === 0 ? (
        <div className="suggestions-empty-state">
          <Sparkles size={44} strokeWidth={1.5} className="suggestions-empty-icon" aria-hidden />
          <p className="suggestions-empty-title">No next steps yet</p>
          <p className="suggestions-empty-hint">
            Agents propose runnable next steps here via <code>suggest_action</code> —
            a seeded agent, a project-scoped terminal, or a multi-step combo, each
            with a one-line reason. Every one is re-authorized when you Run it.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="suggestions-empty-state">
          <Search size={40} strokeWidth={1.5} className="suggestions-empty-icon" aria-hidden />
          <p className="suggestions-empty-title">No matches</p>
          <p className="suggestions-empty-hint">
            No next steps match your search or filters.{' '}
            <button
              type="button"
              className="suggestions-clear-filters"
              onClick={() => {
                setQuery('');
                setKindFilter(new Set());
              }}
            >
              Clear filters
            </button>
          </p>
        </div>
      ) : scoped ? (
        // Drilled into one project — grouping would be a single redundant
        // section, so render a flat grid of that project's cards.
        <div className="suggestions-grid">
          {filtered.map((s) => (
            <SuggestionCard
              key={s.id}
              suggestion={s}
              busy={busyId === s.id}
              onRun={() => run(s.id)}
              onDismiss={() => dismiss(s.id)}
            />
          ))}
        </div>
      ) : (
        <div className="suggestions-groups">
          {groups.map((group) => {
            const isCollapsed = collapsed.has(group.projectId);
            return (
              <section key={group.projectId} className="suggestions-project-group">
                <button
                  type="button"
                  className="suggestions-group-header"
                  aria-expanded={!isCollapsed}
                  onClick={() => toggleGroup(group.projectId)}
                >
                  <ChevronRight
                    size={14}
                    aria-hidden
                    className={`suggestions-group-caret ${isCollapsed ? '' : 'is-open'}`}
                  />
                  {group.color && (
                    <span
                      className="suggestions-group-dot"
                      style={{ background: group.color }}
                      aria-hidden
                    />
                  )}
                  <span className="suggestions-group-name">{group.projectLabel}</span>
                  <span className="suggestions-group-count">{group.items.length}</span>
                </button>
                {!isCollapsed && (
                  <div className="suggestions-grid">
                    {group.items.map((s) => (
                      <SuggestionCard
                        key={s.id}
                        suggestion={s}
                        busy={busyId === s.id}
                        onRun={() => run(s.id)}
                        onDismiss={() => dismiss(s.id)}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
      </div>
    </section>
  );
}

/** Icon + short label for an action kind, so a card's affordance reads at a
 *  glance (terminal vs agent vs navigation). Falls through to a generic label
 *  for any future kind — never throws (Rule 6: kinds are data, not ids). */
function kindIcon(kind: SuggestedActionKind['kind']): ReactNode {
  switch (kind) {
    case 'start-terminal':
      return <TerminalSquare size={12} aria-hidden />;
    case 'start-agent':
      return <Bot size={12} aria-hidden />;
    case 'open-view':
      return <AppWindow size={12} aria-hidden />;
    case 'navigate':
      return <ExternalLink size={12} aria-hidden />;
    case 'combo':
      return <Layers size={12} aria-hidden />;
    default:
      return <Sparkles size={12} aria-hidden />;
  }
}

const KIND_LABELS: Record<string, string> = {
  'start-terminal': 'Terminal',
  'start-agent': 'Agent',
  'open-view': 'View',
  navigate: 'Navigate',
  combo: 'Combo'
};

function kindLabel(kind: SuggestedActionKind['kind']): string {
  return KIND_LABELS[kind] ?? 'Action';
}

/** Coarse relative timestamp for the card footer — no live ticking (the grid
 *  re-renders on store pushes, which is frequent enough for a launcher). */
function relativeTime(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** One payload line for a single action step — the pre-assembled work the agent
 *  did so the operator doesn't have to. Empty string when a step has nothing
 *  worth previewing (so callers can skip it). */
function stepPreview(step: SuggestedActionKind): string {
  switch (step.kind) {
    case 'start-agent': {
      const persona = step.persona ? `${step.persona}: ` : '';
      const prompt = step.prompt?.trim();
      if (prompt) return `${persona}“${prompt}”`;
      return persona ? persona.replace(/: $/, '') : '';
    }
    case 'start-terminal': {
      const parts = [step.profile, step.cwd].filter(Boolean);
      return parts.join(' · ');
    }
    case 'open-view':
      return `→ ${step.nav}`;
    case 'navigate':
      return `→ ${step.tabId ?? 'project'}`;
    case 'combo':
      return '';
    default:
      return '';
  }
}

/** The card's payload preview: for a combo, the ordered step list; otherwise the
 *  single step's preview. Returns [] when there's nothing to show. */
function actionPreview(action: SuggestedActionKind): { kind: SuggestedActionKind['kind']; text: string }[] {
  if (action.kind === 'combo') {
    return action.steps
      .map((s) => ({ kind: s.kind, text: stepPreview(s) }))
      .filter((s) => s.text.length > 0);
  }
  const text = stepPreview(action);
  return text ? [{ kind: action.kind, text }] : [];
}

function SuggestionCard({
  suggestion,
  busy,
  onRun,
  onDismiss
}: {
  suggestion: Suggestion;
  busy: boolean;
  onRun: () => void;
  onDismiss: () => void;
}) {
  const kind = suggestion.action.kind;
  const occurrences = suggestion.occurrences ?? 0;
  const preview = useMemo(() => actionPreview(suggestion.action), [suggestion.action]);
  // Tie the card to its project's color via a 3px left border — mirrors the
  // project-list accent. Derived once per render from the store (cheap; the
  // grid already re-renders on pushes). Falls back to no accent when unknown.
  const projectColor = useData(
    (s) => s.projects.find((p) => p.id === suggestion.projectId)?.color
  );
  const cardStyle = useMemo(
    () => (projectColor ? { borderLeftColor: projectColor, borderLeftWidth: '3px' } : undefined),
    [projectColor]
  );

  return (
    <article className="suggestion-card" style={cardStyle}>
      <button
        type="button"
        className="suggestion-dismiss"
        aria-label="Dismiss next step"
        title="Dismiss"
        onClick={onDismiss}
      >
        <X size={14} aria-hidden />
      </button>
      <div className="suggestion-head">
        <span className={`suggestion-kind suggestion-kind-${kind}`}>
          {kindIcon(kind)}
          <span>{kindLabel(kind)}</span>
        </span>
        {occurrences > 1 && (
          <span className="suggestion-occurrences" title={`Suggested ${occurrences} times`}>
            ×{occurrences}
          </span>
        )}
      </div>
      <div className="suggestion-body">
        <h3 className="suggestion-title">{suggestion.title}</h3>
        {suggestion.projectLabel && (
          <span className="suggestion-project">{suggestion.projectLabel}</span>
        )}
        {/* The "why now" — the rationale the operator reads to decide. Leads the
            body because it's the field that makes the card understandable. */}
        {suggestion.reason && <p className="suggestion-reason">{suggestion.reason}</p>}
        {/* Pre-assembled payload — the proof the agent composed real work
            (a seeded prompt, a target cwd, the ordered combo steps). */}
        {preview.length > 0 && (
          <ul className="suggestion-payload">
            {preview.map((step, i) => (
              <li key={i} className={`suggestion-payload-step suggestion-kind-${step.kind}`}>
                {kindIcon(step.kind)}
                <span className="suggestion-payload-text">{step.text}</span>
              </li>
            ))}
          </ul>
        )}
        {suggestion.detail && <p className="suggestion-detail">{suggestion.detail}</p>}
      </div>
      <div className="suggestion-footer">
        <span className="suggestion-time" title={new Date(suggestion.ts).toLocaleString()}>
          {relativeTime(suggestion.ts)}
        </span>
        <button type="button" className="suggestion-run" disabled={busy} onClick={onRun}>
          <Play size={13} aria-hidden />
          {busy ? 'Running…' : 'Run'}
        </button>
      </div>
    </article>
  );
}
