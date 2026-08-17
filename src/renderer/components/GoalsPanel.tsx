import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Target,
  Plus,
  Play,
  Pause,
  PlayCircle,
  Pencil,
  Trash2,
  X,
  ChevronDown,
  History,
  CheckCircle2,
  XCircle,
  CircleSlash,
  AlertTriangle,
  Flag,
  type LucideIcon
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  Goal,
  GoalCreateInput,
  GoalIteration,
  GoalStatus,
  GoalVerdict,
  LaunchProfileId
} from '@shared/types';
import { useData, useGoals, useUi } from '../store';
import { ImprovePromptButton } from './ImprovePromptButton';
import { PopoverPicklist } from './ui/PopoverPicklist';
import { VALID_PROFILES } from '@shared/launch-provider';

const PROFILES = VALID_PROFILES;
const PROFILE_LABEL: Record<LaunchProfileId, string> = {
  shell: 'Shell',
  claude: 'claude',
  'claude-resume': 'claude --resume',
  'claude-yolo': 'claude --yolo',
  cursor: 'cursor',
  'cursor-resume': 'cursor --resume',
  'cursor-yolo': 'cursor --force',
  codex: 'codex',
  'codex-resume': 'codex resume',
  'codex-yolo': 'codex --yolo',
  pi: 'pi',
  'pi-resume': 'pi --continue',
  opencode: 'opencode',
  'opencode-resume': 'opencode --continue'
};

/** Status → pill label / class suffix. Reuses the scheduler pill palette. */
const STATUS_META: Record<GoalStatus, { label: string; cls: string }> = {
  draft: { label: 'draft', cls: 'skipped' },
  active: { label: 'active', cls: 'running' },
  paused: { label: 'paused', cls: 'app-open' },
  achieved: { label: 'achieved', cls: 'success' },
  exhausted: { label: 'exhausted', cls: 'error' },
  escalated: { label: 'escalated', cls: 'error' },
  cancelled: { label: 'cancelled', cls: 'skipped' }
};

const VERDICT_ICON: Record<GoalVerdict, LucideIcon> = {
  pass: CheckCircle2,
  partial: CircleSlash,
  fail: XCircle,
  unknown: CircleSlash
};

/** A goal is terminal when its loop has stopped for good. */
function isTerminal(status: GoalStatus): boolean {
  return (
    status === 'achieved' ||
    status === 'exhausted' ||
    status === 'escalated' ||
    status === 'cancelled'
  );
}

/**
 * The Goals view. Two shapes from one component:
 *  - **global** (no `projectId`): the cross-project Goals nav tab — every goal,
 *    a project column on each row, scope picker in the create modal.
 *  - **project-scoped** (`projectId` set): mounted in a project's workspace as
 *    the Goals tab. Filtered to that project, project column dropped, the create
 *    modal's project locked to it, and the goal is written under the project.
 */
export function GoalsPanel({ projectId }: { projectId?: string } = {}) {
  const scoped = Boolean(projectId);
  const goals = useGoals((s) => s.goals);
  const loading = useGoals((s) => s.loading);
  const allProjects = useData((s) => s.projects);
  const setNav = useUi((s) => s.setNav);
  const [editing, setEditing] = useState<Goal | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Goal | null>(null);
  const [report, setReport] = useState<{ goal: Goal; iteration: GoalIteration } | null>(null);
  const [search, setSearch] = useState('');

  // In project scope only the owning project is offered to the create modal, and
  // we ignore the (irrelevant) "no projects at all" empty state.
  const projects = useMemo(
    () => (scoped ? allProjects.filter((p) => p.id === projectId) : allProjects),
    [scoped, allProjects, projectId]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const scopedGoals = scoped ? goals.filter((g) => g.projectId === projectId) : goals;
    const sorted = [...scopedGoals].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (!q) return sorted;
    return sorted.filter((g) => {
      const project = allProjects.find((p) => p.id === g.projectId);
      const haystack = [g.title, g.statement, project?.name ?? '', g.status]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [goals, allProjects, search, scoped, projectId]);

  // The owning project's goals (unfiltered by search) drive the scoped empty state.
  const hasProjectGoals = scoped
    ? goals.some((g) => g.projectId === projectId)
    : goals.length > 0;

  return (
    <main className={`settings-panel scheduler-panel scheduler-panel--full ${scoped ? 'scheduler-panel--embedded' : ''}`}>
      <div className="settings-inner">
        <div className="scheduler-header">
          <div className="scheduler-header-text">
            <h2>Goals</h2>
            <p className="settings-help scheduler-subtitle">
              A persistent objective plus falsifiable success criteria. The app
              spawns a worker, evaluates it, and re-spawns with feedback until
              the criteria pass — or it caps out / stalls.
            </p>
          </div>
          <div className="scheduler-header-actions">
            <button
              className="settings-btn settings-btn--primary"
              onClick={() => setEditing('new')}
              disabled={projects.length === 0}
              title={projects.length === 0 ? 'Add a project first' : 'New goal'}
            >
              <Plus size={14} /> New goal
            </button>
          </div>
        </div>

        <aside className="scheduler-banner-info" role="note">
          <AlertTriangle size={14} />
          <div>
            <strong>Goals only advance while this app is running.</strong>{' '}
            Closing the app suspends the loop; active goals re-arm on next launch.
            Each iteration spawns a real agent session — mind the iteration cap.
          </div>
        </aside>

        {projects.length === 0 ? (
          <div className="scheduler-empty">
            <Target size={28} className="scheduler-empty-icon" />
            <div className="scheduler-empty-title">No projects yet</div>
            <div className="scheduler-empty-hint">
              Add a project before creating a goal.{' '}
              <button
                className="settings-btn settings-btn--primary"
                onClick={() => setNav('projects')}
                style={{ marginTop: 8 }}
              >
                Go to Projects
              </button>
            </div>
          </div>
        ) : loading ? (
          <div className="scheduler-empty">Loading…</div>
        ) : !hasProjectGoals ? (
          <div className="scheduler-empty">
            <Target size={28} className="scheduler-empty-icon" />
            <div className="scheduler-empty-title">No goals yet</div>
            <div className="scheduler-empty-hint">
              Define an objective and let the app work toward it.{' '}
              <button
                className="settings-btn settings-btn--primary"
                onClick={() => setEditing('new')}
                style={{ marginLeft: 6 }}
              >
                <Plus size={12} /> New goal
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="scheduler-list-toolbar">
              <input
                className="scheduler-list-search"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by title, statement, project…"
              />
            </div>
            {filtered.length === 0 ? (
              <div className="scheduler-empty">
                <div className="scheduler-empty-title">No goals match</div>
                <div className="scheduler-empty-hint">
                  Try a different search term or clear the filter.
                </div>
              </div>
            ) : (
              <ul className="scheduler-list">
                {filtered.map((g) => (
                  <GoalRow
                    key={g.id}
                    goal={g}
                    projectName={allProjects.find((p) => p.id === g.projectId)?.name ?? '⟨missing⟩'}
                    hideProject={scoped}
                    onEdit={() => setEditing(g)}
                    onAskDelete={() => setConfirmDelete(g)}
                    onShowReport={(iteration) => setReport({ goal: g, iteration })}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {editing && (
        <GoalModal
          goal={editing === 'new' ? null : editing}
          lockedProjectId={scoped ? projectId : undefined}
          onClose={() => setEditing(null)}
        />
      )}
      {confirmDelete && (
        <DeleteConfirmModal
          goal={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            const id = confirmDelete.id;
            setConfirmDelete(null);
            const result = await window.cc.goals.delete(id);
            if (!result.ok) {
              useUi.getState().pushToast(`Delete failed: ${result.message}`, 'error');
            }
          }}
        />
      )}
      {report && (
        <ReportModal
          goal={report.goal}
          iteration={report.iteration}
          onClose={() => setReport(null)}
        />
      )}
    </main>
  );
}

function GoalRow({
  goal,
  projectName,
  hideProject,
  onEdit,
  onAskDelete,
  onShowReport
}: {
  goal: Goal;
  projectName: string;
  hideProject?: boolean;
  onEdit: () => void;
  onAskDelete: () => void;
  onShowReport: (iteration: GoalIteration) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const pushToast = useUi((s) => s.pushToast);
  const meta = STATUS_META[goal.status];
  const terminal = isTerminal(goal.status);
  const iterations = goal.history?.iterations ?? [];
  const latest = iterations[0];

  const setStatus = async (status: GoalStatus, verb: string) => {
    const result = await window.cc.goals.setStatus(goal.id, status);
    if (!result.ok) pushToast(`${verb} failed: ${result.message}`, 'error');
  };
  const runNow = async () => {
    const result = await window.cc.goals.runNow(goal.id);
    if (!result.ok) {
      pushToast(`Run failed: ${result.message}`, 'error');
      return;
    }
    pushToast(`Started an iteration of "${goal.title}"`, 'info');
  };

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <li
      className={`scheduler-card ${terminal ? 'is-disabled' : ''} ${expanded ? 'is-expanded' : ''} ${
        goal.status === 'active' ? 'is-running' : ''
      }`}
    >
      <div
        className="scheduler-card-main scheduler-card-main--compact"
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        aria-expanded={expanded}
        title={expanded ? 'Click to collapse' : 'Click to expand'}
      >
        <span className={`scheduler-status-dot scheduler-status-dot--${meta.cls}`} aria-hidden />
        <div className="scheduler-card-compact-body">
          <span className="scheduler-card-title">
            {goal.title}
            <span className={`scheduler-pill scheduler-pill--${meta.cls}`}>{meta.label}</span>
          </span>
          <span className="scheduler-card-compact-meta">
            {hideProject ? '' : `${projectName} · `}iteration {goal.iteration}/{goal.maxIterations}
            {goal.assignment.kind === 'profile' && goal.assignment.profile
              ? ` · ${PROFILE_LABEL[goal.assignment.profile]}`
              : ''}
          </span>
        </div>
        <div className="scheduler-card-actions" onClick={stop}>
          {goal.status === 'draft' && (
            <button
              className="scheduler-icon-btn"
              onClick={() => setStatus('active', 'Activate')}
              title="Activate (arm the loop)"
              aria-label="Activate"
            >
              <Play size={14} />
            </button>
          )}
          {goal.status === 'active' && (
            <button
              className="scheduler-icon-btn"
              onClick={() => setStatus('paused', 'Pause')}
              title="Pause the loop"
              aria-label="Pause"
            >
              <Pause size={14} />
            </button>
          )}
          {goal.status === 'paused' && (
            <button
              className="scheduler-icon-btn"
              onClick={() => setStatus('active', 'Resume')}
              title="Resume the loop"
              aria-label="Resume"
            >
              <PlayCircle size={14} />
            </button>
          )}
          {!terminal && (
            <button
              className="scheduler-icon-btn"
              onClick={runNow}
              title="Run one iteration now"
              aria-label="Run now"
            >
              <Flag size={14} />
            </button>
          )}
          <button
            className={`scheduler-icon-btn scheduler-icon-btn--chevron ${expanded ? 'is-open' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            title={expanded ? 'Hide details' : 'Show details'}
            aria-label="Toggle details"
            aria-expanded={expanded}
          >
            <ChevronDown size={14} />
          </button>
        </div>
      </div>
      {expanded && (
        <div className="scheduler-card-detail">
          <div className="scheduler-card-desc">{goal.statement}</div>
          {goal.successCriteria.length > 0 && (
            <ul className="goal-criteria">
              {goal.successCriteria.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}
          {latest?.rationale && (
            <div className="scheduler-card-status">
              <span className="scheduler-status-item">
                <span className="scheduler-status-label">Last verdict</span>
                <span
                  className={`scheduler-status-value scheduler-status-value--${
                    latest.verdict === 'pass' ? 'success' : latest.verdict === 'fail' ? 'error' : 'none'
                  }`}
                >
                  {latest.verdict ?? 'pending'}
                  {typeof latest.confidence === 'number'
                    ? ` · ${Math.round(latest.confidence * 100)}%`
                    : ''}
                </span>
              </span>
            </div>
          )}
          <div className="scheduler-card-detail-actions">
            <button className="scheduler-icon-btn" onClick={onEdit} title="Edit" aria-label="Edit">
              <Pencil size={14} />
            </button>
            {!terminal && (
              <button
                className="scheduler-icon-btn scheduler-icon-btn--danger"
                onClick={() => setStatus('cancelled', 'Cancel')}
                title="Cancel the goal"
                aria-label="Cancel"
              >
                <CircleSlash size={14} />
              </button>
            )}
            <button
              className="scheduler-icon-btn scheduler-icon-btn--danger"
              onClick={onAskDelete}
              title="Delete"
              aria-label="Delete"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      )}
      {expanded && (
        <div className="scheduler-card-history">
          <div className="scheduler-card-history-header">
            <History size={12} />
            <span>Iterations</span>
            <span className="scheduler-card-history-count">
              {iterations.length ? `${iterations.length} of ${goal.history.retain}` : 'none yet'}
            </span>
          </div>
          {iterations.length ? (
            <ul className="scheduler-run-list">
              {iterations.map((it, i) => {
                const Icon = it.verdict ? VERDICT_ICON[it.verdict] : CircleSlash;
                const cls = it.verdict === 'pass' ? 'success' : it.verdict === 'fail' ? 'error' : 'skipped';
                return (
                  <li key={it.id ?? i} className={`scheduler-run-row scheduler-run-row--${cls}`}>
                    <span className={`scheduler-run-dot scheduler-run-dot--${cls}`} />
                    <span
                      className="scheduler-run-when"
                      title={new Date(it.at).toLocaleString()}
                    >
                      {formatRelative(new Date(it.at))}
                    </span>
                    <span className="scheduler-run-result">
                      <Icon size={12} /> {it.verdict ?? 'pending'}
                    </span>
                    {it.rationale && (
                      <span className="scheduler-run-message" title={it.rationale}>
                        {it.rationale}
                      </span>
                    )}
                    {(it.report || it.error) && (
                      <button
                        type="button"
                        className="scheduler-run-report-btn"
                        title={it.error ? 'View error' : 'View report'}
                        aria-label="View iteration report"
                        onClick={(e) => {
                          e.stopPropagation();
                          onShowReport(it);
                        }}
                      >
                        <History size={13} strokeWidth={1.75} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="scheduler-run-empty">
              No iterations yet. Activate the goal or run one now.
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function GoalModal({
  goal,
  lockedProjectId,
  onClose
}: {
  goal: Goal | null;
  /** When set (project-scoped Goals tab), the project is fixed and the scope is forced to that project. */
  lockedProjectId?: string;
  onClose: () => void;
}) {
  const projects = useData((s) => s.projects);
  const isNew = goal === null;

  const [title, setTitle] = useState(goal?.title ?? '');
  const [statement, setStatement] = useState(goal?.statement ?? '');
  const [criteriaText, setCriteriaText] = useState((goal?.successCriteria ?? []).join('\n'));
  const [projectId, setProjectId] = useState(goal?.projectId ?? lockedProjectId ?? projects[0]?.id ?? '');
  const [profile, setProfile] = useState<LaunchProfileId>(
    goal?.assignment.kind === 'profile' ? goal.assignment.profile ?? 'claude-yolo' : 'claude-yolo'
  );
  const [maxIterations, setMaxIterations] = useState<number>(goal?.maxIterations ?? 10);
  const [noProgressLimit, setNoProgressLimit] = useState<number>(goal?.noProgressLimit ?? 2);
  const [scope, setScope] = useState<'global' | 'project'>(
    goal?.source && goal.source !== 'global' ? 'project' : isNew ? 'project' : 'global'
  );
  const [activate, setActivate] = useState<boolean>(isNew);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const criteria = useMemo(
    () =>
      criteriaText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    [criteriaText]
  );
  const canSave = title.trim().length > 0 && statement.trim().length > 0 && Boolean(projectId);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        const input: GoalCreateInput = {
          projectId,
          title: title.trim(),
          statement: statement.trim(),
          successCriteria: criteria,
          assignment: { kind: 'profile', profile },
          maxIterations,
          noProgressLimit,
          scope: scope === 'project' ? { projectId } : 'global',
          activate
        };
        const result = await window.cc.goals.create(input);
        if (!result.ok) {
          setError(result.message);
          setSaving(false);
          return;
        }
      } else {
        const result = await window.cc.goals.update(goal!.id, {
          title: title.trim(),
          statement: statement.trim(),
          successCriteria: criteria,
          assignment: { kind: 'profile', profile },
          maxIterations,
          noProgressLimit
        });
        if (!result.ok) {
          setError(result.message);
          setSaving(false);
          return;
        }
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  const modalRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = modalRef.current;
    if (!node) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (canSave && !saving) void save();
      }
    };
    node.addEventListener('keydown', onKey);
    return () => node.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSave, saving]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal scheduler-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={isNew ? 'New goal' : 'Edit goal'}
        tabIndex={-1}
      >
        <header className="modal-header">
          <h3>{isNew ? 'New goal' : 'Edit goal'}</h3>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">
          <div className="scheduler-form-field">
            <label htmlFor="goal-title">Title</label>
            <input
              id="goal-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              placeholder="Get the test suite green"
            />
          </div>
          <div className="scheduler-form-field">
            <label htmlFor="goal-statement">Objective</label>
            <textarea
              id="goal-statement"
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              rows={4}
              placeholder="What the worker should accomplish. Handed to the agent as its opening prompt each iteration."
            />
            <ImprovePromptButton value={statement} onChange={setStatement} />
          </div>
          <div className="scheduler-form-field">
            <label htmlFor="goal-criteria">
              Success criteria <span className="scheduler-form-optional">(one per line)</span>
            </label>
            <textarea
              id="goal-criteria"
              value={criteriaText}
              onChange={(e) => setCriteriaText(e.target.value)}
              rows={4}
              placeholder={'`npm test` exits 0\nNo TypeScript errors\nCI is green'}
            />
            <p className="modal-hint">
              Falsifiable checks the evaluator scores each iteration against. The
              clearer these are, the more reliable the “achieved” verdict.
            </p>
          </div>
          <div className="scheduler-form-row">
            <div className="scheduler-form-field">
              <label htmlFor="goal-project">Project</label>
              <PopoverPicklist
                id="goal-project"
                ariaLabel="Project"
                value={projectId}
                disabled={!isNew || Boolean(lockedProjectId)}
                onChange={setProjectId}
                placeholder="Choose project"
                searchPlaceholder="Search projects"
                options={projects.map((project) => ({ value: project.id, label: project.name }))}
              />
            </div>
            <div className="scheduler-form-field">
              <label htmlFor="goal-profile">Launch profile</label>
              <PopoverPicklist
                id="goal-profile"
                ariaLabel="Launch profile"
                value={profile}
                searchable={false}
                onChange={(nextProfile) => setProfile(nextProfile as LaunchProfileId)}
                options={PROFILES.map((profile) => ({ value: profile, label: PROFILE_LABEL[profile] }))}
              />
            </div>
          </div>
          <div className="scheduler-form-row">
            <div className="scheduler-form-field">
              <label htmlFor="goal-max">Max iterations</label>
              <input
                id="goal-max"
                type="number"
                min={1}
                max={100}
                value={maxIterations}
                onChange={(e) => setMaxIterations(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
              />
              <p className="modal-hint">Hard ceiling — runaway/cost safety.</p>
            </div>
            <div className="scheduler-form-field">
              <label htmlFor="goal-stall">No-progress limit</label>
              <input
                id="goal-stall"
                type="number"
                min={1}
                max={20}
                value={noProgressLimit}
                onChange={(e) => setNoProgressLimit(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              />
              <p className="modal-hint">Stalled rounds before escalating to you.</p>
            </div>
          </div>
          {isNew && !lockedProjectId && (
            <div className="scheduler-form-field">
              <label>Scope</label>
              <div className="scheduler-scope-picker" role="radiogroup">
                <label className={`scheduler-scope-option ${scope === 'project' ? 'is-active' : ''}`}>
                  <input
                    type="radio"
                    name="goal-scope"
                    checked={scope === 'project'}
                    onChange={() => setScope('project')}
                  />
                  <div className="scheduler-scope-option-body">
                    <span className="scheduler-scope-title">Project</span>
                    <span className="scheduler-scope-hint">
                      &lt;project&gt;/.zcc/goals — checked in with the repo
                    </span>
                  </div>
                </label>
                <label className={`scheduler-scope-option ${scope === 'global' ? 'is-active' : ''}`}>
                  <input
                    type="radio"
                    name="goal-scope"
                    checked={scope === 'global'}
                    onChange={() => setScope('global')}
                  />
                  <div className="scheduler-scope-option-body">
                    <span className="scheduler-scope-title">Global</span>
                    <span className="scheduler-scope-hint">~/.zcc/goals — visible across the app</span>
                  </div>
                </label>
              </div>
            </div>
          )}
          {isNew && (
            <div className="scheduler-form-field">
              <label className="scheduler-checkbox-row">
                <input
                  type="checkbox"
                  checked={activate}
                  onChange={(e) => setActivate(e.target.checked)}
                />
                <span>
                  Activate immediately
                  <span className="scheduler-form-optional">
                    {' '}— arm the loop on save. Otherwise it's created as a draft you
                    activate later.
                  </span>
                </span>
              </label>
            </div>
          )}
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
            title={canSave ? '⌘+Enter to save' : 'Fill in title + objective'}
          >
            {saving ? 'Saving…' : isNew ? 'Create goal' : 'Save changes'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function DeleteConfirmModal({
  goal,
  onCancel,
  onConfirm
}: {
  goal: Goal;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    node.addEventListener('keydown', onKey);
    node.focus();
    return () => node.removeEventListener('keydown', onKey);
  }, [onCancel, onConfirm]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        ref={ref}
        className="modal scheduler-confirm-modal"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-label="Delete goal"
        tabIndex={-1}
      >
        <header className="modal-header">
          <h3>Delete goal?</h3>
          <button className="icon-button" onClick={onCancel} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="modal-body scheduler-confirm-body">
          This will permanently remove <strong>{goal.title}</strong> and its
          on-disk JSON. Any iteration session in progress is not interrupted.
        </div>
        <footer className="modal-footer">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn danger" onClick={onConfirm} autoFocus>
            Delete
          </button>
        </footer>
      </div>
    </div>
  );
}

function ReportModal({
  goal,
  iteration,
  onClose
}: {
  goal: Goal;
  iteration: GoalIteration;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    node.addEventListener('keydown', onKey);
    node.focus();
    return () => node.removeEventListener('keydown', onKey);
  }, [onClose]);

  const badge = iteration.verdict ?? 'pending';
  const badgeCls =
    iteration.verdict === 'pass' ? 'success' : iteration.verdict === 'fail' ? 'error' : 'skipped';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={ref}
        className="modal scheduler-report-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Iteration report"
        tabIndex={-1}
      >
        <header className="modal-header">
          <h3>{goal.title} — iteration report</h3>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="scheduler-report-meta">
          <span className={`scheduler-pill scheduler-pill--${badgeCls}`}>{badge}</span>
          <span className="scheduler-report-meta-when">{new Date(iteration.at).toLocaleString()}</span>
          {iteration.rationale && (
            <span className="scheduler-report-meta-dur">{iteration.rationale}</span>
          )}
        </div>
        <div className="modal-body scheduler-report-body">
          {iteration.error && <div className="modal-error">{iteration.error}</div>}
          <div className="inbox-md">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: (props) => <a {...props} target="_blank" rel="noreferrer" />
              }}
            >
              {iteration.report ?? '_No report filed for this iteration._'}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatRelative(d: Date): string {
  const ms = Math.max(0, Date.now() - d.getTime());
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}
