import { nativeCapabilities } from '../../lib/native-capabilities.js';
import { product } from '../../lib/product-client.js';
import { DelayedStencilList } from '../../components/ui/Skeleton.js';
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  BookOpen,
  FolderOpen,
  Layers,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X
} from 'lucide-react';
import type {
  SkillBundle,
  SkillBundleApplyMode,
  SkillEntry,
  SkillSource,
  SkillState
} from '@zana-ai/zcc-domain/product';
import { useData, useUi } from '@/store';
import { fileManagerName } from '@/lib/file-manager';
import {
  filterSkills,
  harnessOptions,
  skillState,
  stateCounts,
  type StateFilter
} from './skills-filter.js';

const SOURCE_FILTERS: Array<{ id: 'all' | SkillSource; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'user', label: 'User' },
  { id: 'plugin', label: 'Plugins' },
  { id: 'project', label: 'Project' }
];

const STATE_FILTERS: Array<{ id: StateFilter; label: string }> = [
  { id: 'all', label: 'Any state' },
  { id: 'on', label: 'On' },
  { id: 'manual', label: 'Manual' },
  { id: 'off', label: 'Off' }
];

const STATE_LABEL: Record<SkillState, string> = { on: 'On', manual: 'Manual', off: 'Off' };

const STATE_HINT: Record<SkillState, string> = {
  on: 'Listed to the agent, which loads it when relevant',
  manual: 'Hidden from the agent; invoke it yourself with /name',
  off: 'Not loaded at all'
};

const SOURCE_LABEL: Record<SkillSource, string> = {
  user: 'User',
  plugin: 'Plugin',
  project: 'Project'
};

/**
 * Skills catalogue, rendered on the Extensions workspace Skills page AND
 * (scoped to one project) as the per-project Skills tab. Returns the tab
 * content only — the host panel supplies the surrounding `settings-panel` /
 * `settings-inner` shell, so this must NOT render its own `<main>` (that
 * would double-nest two settings-panel mains).
 *
 * `projectId` (optional) locks the project scope for the per-project view (via
 * {@link ProjectSkillsView}); when omitted, the panel follows the globally
 * selected project.
 */
export function SkillsBody({
  projectId,
  initialFilter = 'all',
  showHeader = true
}: {
  projectId?: string;
  initialFilter?: 'all' | SkillSource;
  showHeader?: boolean;
} = {}) {
  const projects = useData((s) => s.projects);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const scopedProjectId = projectId ?? selectedProjectId;
  const selectedProject = projects.find((p) => p.id === scopedProjectId) ?? null;
  const catalogueFilter = useUi((s) => s.catalogueFilter);
  const setCatalogueFilter = useUi((s) => s.setCatalogueFilter);

  const loadRevision = useRef(0);
  const [discoveryNotes, setDiscoveryNotes] = useState<string[]>([]);
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [bundles, setBundles] = useState<SkillBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | SkillSource>(initialFilter);
  const [harness, setHarness] = useState('all');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [query, setQuery] = useState('');
  const [editingBundle, setEditingBundle] = useState<SkillBundle | 'new' | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [applyNote, setApplyNote] = useState<string | null>(null);
  const [pluginBannerDismissed, setPluginBannerDismissed] = useState(() => {
    try {
      return localStorage.getItem('zcc.skills.pluginBannerDismissed') === '1';
    } catch {
      return false;
    }
  });
  const dismissPluginBanner = () => {
    setPluginBannerDismissed(true);
    try {
      localStorage.setItem('zcc.skills.pluginBannerDismissed', '1');
    } catch {
      // ignore quota errors
    }
  };

  // Reload callback kept stable for use by applyBundle and other callers.
  // Uses useCallback so it only changes when selectedProject?.path changes.
  const reload = useCallback(async () => {
    const revision = ++loadRevision.current;
    try {
      const [list, bundleList, legacyRules] = await Promise.all([
        nativeCapabilities({ projectId: selectedProject?.id }),
        product.skills.bundles.list().catch(() => []),
        // Rule files remain visible through the existing local catalogue.
        product.skills.list(selectedProject?.path).then(rows => rows.filter(row => row.kind === 'rule')).catch(() => [])
      ]);
      if (revision !== loadRevision.current) return;
      setSkills([...list.skills, ...legacyRules]);
      setDiscoveryNotes(list.diagnostics);
      setBundles(bundleList);
    } catch (error) {
      if (revision !== loadRevision.current) return;
      setSkills([]);
      setDiscoveryNotes([error instanceof Error ? error.message : String(error)]);
    } finally {
      if (revision === loadRevision.current) setLoading(false);
    }
  }, [selectedProject?.id, selectedProject?.path]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  }, [reload]);

  // Consolidated effect: initial load, change subscriptions, and deep-link honor.
  // Runs once per project (when selectedProject?.path changes via reload deps)
  // to avoid races where rapid project switches trigger multiple concurrent reloads.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    // Initial load
    if (!cancelled) void reload();

    // Subscribe to live changes
    const offSkills = product.skills.onChanged(() => {
      if (!cancelled) void reload();
    });
    const offProviders = product.pluginApps.onChanged(() => {
      if (!cancelled) void reload();
    });
    const offBundles = product.skills.bundles.onChanged((next) => {
      if (!cancelled) setBundles(next);
    });

    // Honour cross-panel deep-links (e.g., a plugin row's "4 skills" chip).
    // Fire once per mount, then clear the filter so it doesn't re-fire on
    // every re-render of the parent that shares catalogueFilter state.
    if (catalogueFilter.skills) {
      setQuery(catalogueFilter.skills);
      setCatalogueFilter('skills', undefined);
    }

    return () => {
      cancelled = true;
      loadRevision.current++;
      offSkills();
      offProviders();
      offBundles();
    };
  }, [reload, catalogueFilter.skills, setCatalogueFilter]);

  const flashSaved = useCallback(() => {
    setSavedFlash(true);
    const t = window.setTimeout(() => setSavedFlash(false), 1400);
    return () => window.clearTimeout(t);
  }, []);

  const filtered = useMemo(
    () => filterSkills(skills, { source: filter, harness, state: stateFilter, query }),
    [skills, filter, harness, stateFilter, query]
  );

  const harnesses = useMemo(() => harnessOptions(skills), [skills]);
  const states = useMemo(() => stateCounts(skills), [skills]);
  // A harness that disappeared after a reload must not leave the list empty.
  useEffect(() => {
    if (harness !== 'all' && !harnesses.some((h) => h.label === harness)) setHarness('all');
  }, [harness, harnesses]);

  const counts = useMemo(() => {
    const c = { all: skills.length, user: 0, plugin: 0, project: 0 };
    for (const s of skills) c[s.source] += 1;
    return c;
  }, [skills]);

  // Show the per-row tool chip only when the catalogue actually spans more than
  // one agent tool — otherwise every row would carry a redundant "Claude" chip.
  const showTool = useMemo(
    () => new Set(skills.map((s) => s.tool)).size > 1,
    [skills]
  );

  const toggleSkill = async (skill: SkillEntry, enabled: boolean) => {
    // Only skills whose tool supports toggling are writable: Claude user/project
    // skills go through `skillOverrides`. Plugin skills (installed ZCC plugin / `zcc plugin dev`) and
    // read-only tools (Cursor rules today) declare `toggle.supported === false`;
    // the UI renders them without a switch, but defend in depth here too.
    if (!skill.toggle.supported) return;
    setSkills((prev) =>
      prev.map((s) => (s.id === skill.id ? { ...s, enabled, toggle: { ...s.toggle, enabled } } : s))
    );
    try {
      await product.skills.setEnabled(skill.name, enabled);
      flashSaved();
    } catch {
      // revert on failure
      setSkills((prev) =>
        prev.map((s) =>
          s.id === skill.id ? { ...s, enabled: !enabled, toggle: { ...s.toggle, enabled: !enabled } } : s
        )
      );
    }
  };

  const setSkillLoadState = async (skill: SkillEntry, state: SkillState) => {
    if (!skill.toggle.supported || !skill.toggle.states?.includes(state)) return;
    const withState = (s: SkillEntry, next: SkillState): SkillEntry => ({
      ...s,
      enabled: next !== 'off',
      toggle: { ...s.toggle, state: next, enabled: next !== 'off' }
    });
    const previous = skillState(skill);
    setSkills((prev) => prev.map((s) => (s.id === skill.id ? withState(s, state) : s)));
    try {
      const result = await product.skills.setState([{ id: skill.id, name: skill.name, state }]);
      if (!result.ok) throw new Error('Skill state was rejected');
      flashSaved();
    } catch {
      setSkills((prev) => prev.map((s) => (s.id === skill.id ? withState(s, previous) : s)));
    }
  };

  const reveal = (skill: SkillEntry) => {
    product.skills.reveal(skill.id, selectedProject?.path).catch(() => {});
  };

  const applyBundle = async (bundle: SkillBundle, mode: SkillBundleApplyMode) => {
    const result = await product.skills.bundles.apply(
      bundle.id,
      mode,
      selectedProject?.path
    );
    if (result.ok) {
      await reload();
      flashSaved();
      if (result.skippedPlugin > 0) {
        const skill = result.skippedPlugin === 1 ? 'skill' : 'skills';
        setApplyNote(
          `${result.skippedPlugin} plugin ${skill} skipped (managed by the installed plugin; reload with zcc plugin dev).`
        );
        window.setTimeout(() => setApplyNote(null), 5000);
      } else {
        setApplyNote(null);
      }
    }
  };

  const deleteBundle = async (bundle: SkillBundle) => {
    if (!confirm(`Delete bundle "${bundle.name}"?`)) return;
    await product.skills.bundles.delete(bundle.id);
    setBundles((prev) => prev.filter((b) => b.id !== bundle.id));
  };

  return (
    <>
      <div className="settings-catalogue skills-catalogue">
        {showHeader && (
          <div className="scheduler-header">
            <div className="scheduler-header-text">
              <h2>Skills</h2>
              <p className="settings-help scheduler-subtitle">
                Skills and slash commands available to your agent providers on the project's execution host.
                Author restrictions and installed plugin settings determine how each entry can be invoked.
              </p>
            </div>
          </div>
        )}

        {!pluginBannerDismissed && (
          <aside className="skills-plugin-banner" role="note">
            <div>
              <strong>Every skill starts On.</strong> To trim what agents load, set a skill to{' '}
              <strong>Manual</strong> (hidden from the agent, still available as{' '}
              <code>/name</code>) or <strong>Off</strong>. Skills from installed ZCC plugins
              apply to every harness and take effect in new threads. Claude Code marketplace
              plugins under <code>~/.claude/plugins</code> still use Claude&apos;s{' '}
              <code>/plugin</code> command.
            </div>
            <button
              type="button"
              className="skills-plugin-banner-dismiss"
              onClick={dismissPluginBanner}
              aria-label="Dismiss"
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </aside>
        )}

        {discoveryNotes.length > 0 && (
          <div role="status" className="skills-apply-note">{discoveryNotes.join(' ')}</div>
        )}
        <div className="skills-layout">
          <section className="skills-left">
            <div className="skills-toolbar">
              <div className="skills-toolbar-row">
                <div className="skills-search">
                  <Search size={14} aria-hidden />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search skills…  harness:codex  state:manual  plugin:gus"
                    aria-label="Search skills"
                  />
                </div>
                <button
                  type="button"
                  className="settings-btn"
                  onClick={() => void refresh()}
                  disabled={refreshing || loading}
                  title="Refresh skills"
                  aria-label="Refresh skills"
                >
                  <RefreshCw
                    size={14}
                    className={refreshing ? 'ext-spin' : undefined}
                    aria-hidden
                  />
                  Refresh
                </button>
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
              {harnesses.length > 1 && (
                <div className="skills-filter" role="tablist" aria-label="Harness filter">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={harness === 'all'}
                    className={`skills-filter-btn ${harness === 'all' ? 'is-active' : ''}`}
                    onClick={() => setHarness('all')}
                  >
                    All harnesses
                  </button>
                  {harnesses.map((h) => (
                    <button
                      key={h.label}
                      type="button"
                      role="tab"
                      aria-selected={harness === h.label}
                      className={`skills-filter-btn ${harness === h.label ? 'is-active' : ''}`}
                      onClick={() => setHarness(h.label)}
                      title={`Skills ${h.label} sessions receive, including ZCC-injected skills`}
                    >
                      {h.label}
                      <span className="skills-filter-count">{h.count}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="skills-filter" role="tablist" aria-label="State filter">
                {STATE_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="tab"
                    aria-selected={stateFilter === f.id}
                    className={`skills-filter-btn ${stateFilter === f.id ? 'is-active' : ''}`}
                    onClick={() => setStateFilter(f.id)}
                  >
                    {f.label}
                    <span className="skills-filter-count">{states[f.id]}</span>
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <DelayedStencilList label="Loading skills" className="scheduler-empty" />
            ) : filtered.length === 0 ? (
              <div className="scheduler-empty">
                <BookOpen size={28} className="scheduler-empty-icon" />
                <div className="scheduler-empty-title">
                  {skills.length === 0 ? 'No skills found' : 'No matches'}
                </div>
                <div className="scheduler-empty-hint">
                  {filter === 'project' && !selectedProject
                    ? 'Select a project in the sidebar to see project-scoped skills.'
                    : skills.length === 0
                      ? 'Drop a skill in ~/.claude/skills or ~/.config/opencode/skills, or install a plugin that ships skills.'
                      : 'Try a different search or filter.'}
                </div>
              </div>
            ) : (
              <ul className="skills-list">
                {filtered.map((skill) => (
                  <SkillRow
                    key={skill.id}
                    skill={skill}
                    showTool={showTool}
                    onToggle={(enabled) => toggleSkill(skill, enabled)}
                    onSetState={(next) => void setSkillLoadState(skill, next)}
                    onReveal={() => reveal(skill)}
                  />
                ))}
              </ul>
            )}
          </section>

          <aside className="skills-right">
            <div className="skills-bundles-header">
              <h3>
                <Layers size={14} /> Bundles
              </h3>
              <button
                type="button"
                className="settings-btn settings-btn--primary"
                onClick={() => setEditingBundle('new')}
              >
                <Plus size={12} /> New
              </button>
            </div>
            <p className="settings-help">
              A bundle is a saved set of skills you can enable in one click.
              Apply additively to layer it on, or exclusively to enable only the
              bundle's skills.
            </p>
            {bundles.length === 0 ? (
              <div className="skills-bundles-empty">
                No bundles yet. Click <strong>New</strong> to create one.
              </div>
            ) : (
              <ul className="skills-bundles-list">
                {bundles.map((bundle) => (
                  <BundleRow
                    key={bundle.id}
                    bundle={bundle}
                    skills={skills}
                    onApply={(mode) => applyBundle(bundle, mode)}
                    onEdit={() => setEditingBundle(bundle)}
                    onDelete={() => deleteBundle(bundle)}
                  />
                ))}
              </ul>
            )}
          </aside>
        </div>

        {savedFlash && <div className="settings-saved">Saved</div>}
        {applyNote && <div className="skills-apply-note">{applyNote}</div>}
      </div>

      {editingBundle && (
        <BundleEditorModal
          bundle={editingBundle === 'new' ? null : editingBundle}
          allSkills={skills}
          onClose={() => setEditingBundle(null)}
          onSaved={() => {
            setEditingBundle(null);
            flashSaved();
          }}
        />
      )}
    </>
  );
}

function SkillStateControl({
  skill,
  onSetState
}: {
  skill: SkillEntry;
  onSetState: (state: SkillState) => void;
}) {
  const current = skillState(skill);
  return (
    <div className="skills-state" role="radiogroup" aria-label={`Load state for ${skill.name}`}>
      {(skill.toggle.states ?? []).map((state) => (
        <button
          key={state}
          type="button"
          role="radio"
          aria-checked={current === state}
          className={`skills-state-btn skills-state-btn--${state} ${current === state ? 'is-active' : ''}`}
          title={STATE_HINT[state]}
          onClick={() => current !== state && onSetState(state)}
        >
          {STATE_LABEL[state]}
        </button>
      ))}
    </div>
  );
}

function SkillRow({
  skill,
  showTool,
  onToggle,
  onSetState,
  onReveal
}: {
  skill: SkillEntry;
  /** Show the tool chip — true only when the catalogue spans >1 tool. */
  showTool: boolean;
  onToggle: (enabled: boolean) => void;
  onSetState: (state: SkillState) => void;
  onReveal: () => void;
}) {
  const subtitle = (() => {
    if (skill.allHarnesses) return `ZCC · ${skill.pluginName ?? 'injected'}`;
    if (skill.source === 'plugin' && skill.pluginName) {
      return `Installed plugin · ${skill.pluginName}`;
    }
    if (skill.source === 'project') return 'Project';
    return 'User';
  })();

  // A row is read-only when its tool doesn't support toggling — plugin skills
  // (managed by the installed plugin / zcc plugin dev) and read-only tools like Cursor rules.
  // the tool's own hint (`toggle.reason`) rather than assuming "plugin".
  const isReadOnly = !skill.toggle.supported;
  const readOnlyReason = skill.toggle.reason ?? 'Read-only';
  const readOnlyChip = skill.source === 'plugin' ? 'plugin' : 'read-only';
  const triState = !isReadOnly && (skill.toggle.states?.length ?? 0) > 0;
  return (
    <li className={`skills-row ${skill.enabled ? '' : 'is-disabled'} ${isReadOnly ? 'is-plugin-managed' : ''} ${triState ? 'has-state' : ''}`}>
      {triState ? (
        <SkillStateControl skill={skill} onSetState={onSetState} />
      ) : isReadOnly ? (
        <span
          className="skills-row-managed"
          title={readOnlyReason}
          aria-label={readOnlyReason}
        >
          {readOnlyChip}
        </span>
      ) : (
        <label className="skills-row-toggle" title={skill.enabled ? 'Disable' : 'Enable'}>
          <input
            type="checkbox"
            checked={skill.enabled}
            onChange={(e) => onToggle(e.target.checked)}
          />
          <span aria-hidden />
        </label>
      )}
      <div className="skills-row-body">
        <div className="skills-row-head">
          <span className="skills-row-name">{skill.name}</span>
          {skill.kind === 'command' && <span className="scheduler-pill">Command</span>}
          {skill.kind === 'rule' && <span className="scheduler-pill">Rule</span>}
          {skill.linked && <span className="scheduler-pill">Linked</span>}
          {skill.disableModelInvocation && <span className="scheduler-pill">Manual only</span>}
          {skill.userInvocable === false && <span className="scheduler-pill">Agent only</span>}
          {/* Tool chip — the agent tool a skill belongs to (Claude Code, Cursor,
              …). Only rendered when the catalogue actually spans more than one
              tool (`showTool`), so the common single-tool case stays uncluttered.
              Label is derived from the entry's own `tool` id — no core-hardcoded
              tool switch (the tool set is data-driven). */}
          {showTool && skill.toolLabel && (
            <span className="scheduler-pill skills-tool-pill" title={`Tool: ${skill.toolLabel}`}>
              {skill.toolLabel}
            </span>
          )}
          <span className={`scheduler-pill scheduler-pill--source skills-source-${skill.source}`}>
            {subtitle}
          </span>
        </div>
        {skill.description && (
          <p className="skills-row-desc">{skill.description}</p>
        )}
      </div>
      {skill.revealable !== false && (
        <button
          type="button"
          className="scheduler-icon-btn"
          onClick={onReveal}
          title={`Reveal in ${fileManagerName()}`}
          aria-label={`Reveal in ${fileManagerName()}`}
        >
          <FolderOpen size={14} />
        </button>
      )}
    </li>
  );
}

function BundleRow({
  bundle,
  skills,
  onApply,
  onEdit,
  onDelete
}: {
  bundle: SkillBundle;
  skills: SkillEntry[];
  onApply: (mode: SkillBundleApplyMode) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const known = useMemo(() => {
    const ids = new Set(skills.map((s) => s.id));
    let resolved = 0;
    for (const id of bundle.skillIds) if (ids.has(id)) resolved += 1;
    return { resolved, total: bundle.skillIds.length };
  }, [bundle.skillIds, skills]);

  return (
    <li className="skills-bundle-card">
      <div className="skills-bundle-head">
        <button
          type="button"
          className="skills-bundle-name"
          onClick={onEdit}
          title="Edit bundle"
        >
          {bundle.name}
        </button>
        <button
          type="button"
          className="scheduler-icon-btn scheduler-icon-btn--danger"
          onClick={onDelete}
          title="Delete bundle"
          aria-label="Delete bundle"
        >
          <Trash2 size={12} />
        </button>
      </div>
      {bundle.description && (
        <p className="skills-bundle-desc">{bundle.description}</p>
      )}
      <div className="skills-bundle-meta">
        <span className="scheduler-pill">
          {known.resolved} / {known.total} skills
        </span>
      </div>
      <div className="skills-bundle-actions">
        <button
          type="button"
          className="settings-btn"
          onClick={() => onApply('additive')}
          title="Enable bundle's skills; leave others alone"
        >
          Apply (additive)
        </button>
        <button
          type="button"
          className="settings-btn"
          onClick={() => onApply('exclusive')}
          title="Enable bundle's skills; disable everything else"
        >
          Apply (exclusive)
        </button>
      </div>
    </li>
  );
}

function BundleEditorModal({
  bundle,
  allSkills,
  onClose,
  onSaved
}: {
  bundle: SkillBundle | null;
  allSkills: SkillEntry[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = bundle === null;
  const [name, setName] = useState(bundle?.name ?? '');
  const [description, setDescription] = useState(bundle?.description ?? '');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(bundle?.skillIds ?? [])
  );
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allSkills;
    return allSkills.filter((s) =>
      `${s.name} ${s.description ?? ''} ${s.pluginName ?? ''}`
        .toLowerCase()
        .includes(q)
    );
  }, [allSkills, query]);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canSave = name.trim().length > 0;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const input = {
        name: name.trim(),
        description: description.trim() || undefined,
        skillIds: [...selectedIds]
      };
      if (isNew) {
        await product.skills.bundles.create(input);
      } else {
        await product.skills.bundles.update(bundle!.id, input);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal skills-bundle-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={isNew ? 'New bundle' : 'Edit bundle'}
      >
        <header className="modal-header">
          <h3>{isNew ? 'New bundle' : `Edit bundle · ${bundle?.name}`}</h3>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">
          <div className="scheduler-form-field">
            <label htmlFor="bundle-name">Name</label>
            <input
              id="bundle-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              placeholder="Frontend skills"
            />
          </div>
          <div className="scheduler-form-field">
            <label htmlFor="bundle-desc">
              Description <span className="scheduler-form-optional">(optional)</span>
            </label>
            <input
              id="bundle-desc"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="scheduler-form-field">
            <label>
              Skills{' '}
              <span className="scheduler-form-optional">
                ({selectedIds.size} selected)
              </span>
            </label>
            <div className="skills-search skills-search--modal">
              <Search size={14} aria-hidden />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter…"
              />
            </div>
            <ul className="skills-bundle-picker">
              {filtered.map((s) => (
                <li key={s.id} className="skills-bundle-picker-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(s.id)}
                      onChange={() => toggle(s.id)}
                    />
                    <span className="skills-bundle-picker-name">{s.name}</span>
                    <span className="scheduler-pill scheduler-pill--source">
                      {SOURCE_LABEL[s.source]}
                      {s.pluginName ? ` · ${s.pluginName}` : ''}
                    </span>
                  </label>
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="skills-bundle-picker-empty">No skills match.</li>
              )}
            </ul>
          </div>
          {error && <div className="modal-error">{error}</div>}
        </div>
        <footer className="modal-footer">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={save}
            disabled={!canSave || saving}
          >
            {saving ? 'Saving…' : isNew ? 'Create bundle' : 'Save changes'}
          </button>
        </footer>
      </div>
    </div>
  );
}

export function SkillsView(props: {
  projectId?: string;
  initialFilter?: 'all' | SkillSource;
  showHeader?: boolean;
} = {}) {
  return <SkillsBody {...props} />;
}

export { SkillsView as SkillsPanel };
