import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MessageCircleQuestion,
  Plus,
  Check,
  RotateCcw,
  CircleSlash,
  Pencil,
  Trash2,
  X,
  ChevronDown,
  Bot,
  User,
  Sparkles,
  Scale,
  StickyNote,
  Rocket,
  Send,
  CornerDownLeft,
  ArrowRight,
  type LucideIcon
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  FollowUp,
  FollowUpCreateInput,
  FollowUpKind,
  FollowUpStatus,
  Project,
  TerminalSession
} from '@shared/types';
import { FOLLOWUP_SPAWN_LOCK_MS } from '@shared/types';
import { seedPromptArgs } from '@shared/launch-provider';
import { answerFollowUp, useData, useFollowUps, useUi } from '../store';
import { isClaudeProfile, knownProfile, projectDefaultProfile } from '../util/launchProfile';
import { buildFollowUpPrompt, followUpAgentTitle } from '../util/followUpPrompt';
import { PopoverPicklist } from './ui/PopoverPicklist';

/** Status → pill label / class suffix. Reuses the scheduler pill palette. */
const STATUS_META: Record<FollowUpStatus, { label: string; cls: string }> = {
  open: { label: 'open', cls: 'running' },
  resolved: { label: 'resolved', cls: 'success' },
  dismissed: { label: 'dismissed', cls: 'skipped' }
};

const KIND_LABEL: Record<FollowUpKind, string> = {
  question: 'question',
  decision: 'decision',
  note: 'note'
};

/** Kind → the leading glyph that types the row at a glance. */
const KIND_ICON: Record<FollowUpKind, LucideIcon> = {
  question: MessageCircleQuestion,
  decision: Scale,
  note: StickyNote
};

/** Origin → icon + human label, for the provenance chip on each row. */
const ORIGIN_ICON: Record<FollowUp['origin']['source'], LucideIcon> = {
  'idle-triage': Sparkles,
  agent: Bot,
  user: User
};
const ORIGIN_LABEL: Record<FollowUp['origin']['source'], string> = {
  'idle-triage': 'parked from idle',
  agent: 'filed by agent',
  user: 'added by you'
};

/**
 * The Follow-ups view. Two shapes from one component (mirrors {@link GoalsPanel}):
 *  - **global** (no `projectId`): the cross-project Follow-ups nav tab — every
 *    follow-up, a project column on each row, scope picker in the create modal.
 *  - **project-scoped** (`projectId` set): mounted in a project's workspace as
 *    the Follow-ups tab. Filtered to that project, project column dropped, the
 *    create modal's project locked to it.
 *
 * Unlike Goals there is no spawn/evaluate loop: a follow-up is an inert parked
 * question/decision that a human (or the filing agent) resolves or dismisses.
 */
export function FollowUpsPanel({ projectId }: { projectId?: string } = {}) {
  const scoped = Boolean(projectId);
  const followups = useFollowUps((s) => s.followups);
  const loading = useFollowUps((s) => s.loading);
  const allProjects = useData((s) => s.projects);
  const setNav = useUi((s) => s.setNav);
  const [editing, setEditing] = useState<FollowUp | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<FollowUp | null>(null);
  const [search, setSearch] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const [kindFilter, setKindFilter] = useState<'all' | FollowUpKind>('all');

  // Deep-link: another surface (the Home dashboard) asked to open a specific
  // follow-up. Latch the id locally and clear the STORE key at once so a
  // re-render doesn't re-trigger the reveal; then resolve it against
  // `followups` (which may still be loading on a cold mount), clearing any
  // filter that would hide the row. Twin of LibraryView's revealLibraryDocId
  // handling / SchedulerPanel's revealSchedule.
  const revealFollowUpId = useUi((s) => s.revealFollowUpId);
  const [pendingRevealId, setPendingRevealId] = useState<string | null>(null);
  useEffect(() => {
    if (!revealFollowUpId) return;
    setPendingRevealId(revealFollowUpId);
    useUi.getState().clearRevealFollowUp();
  }, [revealFollowUpId]);
  useEffect(() => {
    if (!pendingRevealId) return;
    const match = followups.find((f) => f.id === pendingRevealId);
    if (!match) return; // still loading — wait
    setSearch('');
    setKindFilter('all');
    if (match.status !== 'open') setShowResolved(true);
    // Leave pendingRevealId set — it's threaded to FollowUpRow as the `reveal`
    // prop below, which clears it (via onRevealed) once it has scrolled to and
    // expanded the row. Clearing filters may take a render to reach `filtered`,
    // so the row picks this reveal signal up whenever it actually mounts.
  }, [pendingRevealId, followups]);

  const projects = useMemo(
    () => (scoped ? allProjects.filter((p) => p.id === projectId) : allProjects),
    [scoped, allProjects, projectId]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = scoped ? followups.filter((f) => f.projectId === projectId) : followups;
    if (!showResolved) list = list.filter((f) => f.status === 'open');
    if (kindFilter !== 'all') list = list.filter((f) => f.kind === kindFilter);
    // Open first, then most-recently-updated.
    const sorted = [...list].sort((a, b) => {
      if (a.status === 'open' !== (b.status === 'open')) return a.status === 'open' ? -1 : 1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
    if (!q) return sorted;
    return sorted.filter((f) => {
      const project = allProjects.find((p) => p.id === f.projectId);
      const haystack = [f.title, f.detail ?? '', project?.name ?? '', f.status, f.kind]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [followups, allProjects, search, scoped, projectId, showResolved, kindFilter]);

  const scopedAll = scoped ? followups.filter((f) => f.projectId === projectId) : followups;
  const hasAny = scopedAll.length > 0;
  const openCount = scopedAll.filter((f) => f.status === 'open').length;
  const kindCounts = useMemo(() => {
    const source = showResolved ? scopedAll : scopedAll.filter((f) => f.status === 'open');
    return {
      all: source.length,
      question: source.filter((f) => f.kind === 'question').length,
      decision: source.filter((f) => f.kind === 'decision').length,
      note: source.filter((f) => f.kind === 'note').length
    };
  }, [scopedAll, showResolved]);

  return (
    <main
      className={`settings-panel scheduler-panel scheduler-panel--full ${
        scoped ? 'scheduler-panel--embedded' : 'followups-panel'
      }`}
    >
      <div className="settings-inner">
        <div className="scheduler-header">
          <div className="scheduler-header-text">
            <h2>Follow-ups</h2>
            <p className="settings-help scheduler-subtitle">
              Parked questions and decisions an agent left for you instead of
              blocking — plus anything you jot down yourself. Each one persists
              across runs until you resolve or dismiss it.
            </p>
          </div>
          <div className="scheduler-header-actions">
            <button
              className="settings-btn settings-btn--primary"
              onClick={() => setEditing('new')}
              disabled={projects.length === 0}
              title={projects.length === 0 ? 'Add a project first' : 'New follow-up'}
            >
              <Plus size={14} /> New follow-up
            </button>
          </div>
        </div>

        {projects.length === 0 ? (
          <div className="scheduler-empty">
            <MessageCircleQuestion size={28} className="scheduler-empty-icon" />
            <div className="scheduler-empty-title">No projects yet</div>
            <div className="scheduler-empty-hint">
              Add a project before creating a follow-up.{' '}
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
        ) : !hasAny ? (
          <div className="scheduler-empty">
            <MessageCircleQuestion size={28} className="scheduler-empty-icon" />
            <div className="scheduler-empty-title">No follow-ups yet</div>
            <div className="scheduler-empty-hint">
              When an agent pauses with a question it can't resolve, it lands
              here. You can also add one manually.{' '}
              <button
                className="settings-btn settings-btn--primary"
                onClick={() => setEditing('new')}
                style={{ marginLeft: 6 }}
              >
                <Plus size={12} /> New follow-up
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
                placeholder="Search by title, detail, project…"
              />
              <div className="followup-kind-filter" role="group" aria-label="Filter by type">
                <button
                  type="button"
                  className={`settings-btn ${kindFilter === 'all' ? 'settings-btn--primary' : ''}`}
                  onClick={() => setKindFilter('all')}
                  title="All follow-up kinds"
                >
                  All ({kindCounts.all})
                </button>
                <button
                  type="button"
                  className={`settings-btn ${kindFilter === 'question' ? 'settings-btn--primary' : ''}`}
                  onClick={() => setKindFilter('question')}
                  title="Questions only"
                >
                  Question ({kindCounts.question})
                </button>
                <button
                  type="button"
                  className={`settings-btn ${kindFilter === 'decision' ? 'settings-btn--primary' : ''}`}
                  onClick={() => setKindFilter('decision')}
                  title="Decisions only"
                >
                  Decision ({kindCounts.decision})
                </button>
                <button
                  type="button"
                  className={`settings-btn ${kindFilter === 'note' ? 'settings-btn--primary' : ''}`}
                  onClick={() => setKindFilter('note')}
                  title="Notes only"
                >
                  Note ({kindCounts.note})
                </button>
              </div>
              <label className="scheduler-checkbox-row" style={{ whiteSpace: 'nowrap' }}>
                <input
                  type="checkbox"
                  checked={showResolved}
                  onChange={(e) => setShowResolved(e.target.checked)}
                />
                <span>
                  Show resolved
                  {openCount > 0 ? ` (${openCount} open)` : ''}
                </span>
              </label>
            </div>
            {filtered.length === 0 ? (
              <div className="scheduler-empty">
                <div className="scheduler-empty-title">
                  {showResolved ? 'No follow-ups match' : 'Nothing open'}
                </div>
                <div className="scheduler-empty-hint">
                  {showResolved
                    ? 'Try a different search term or clear the filter.'
                    : 'All caught up — tick "Show resolved" to see past ones.'}
                </div>
              </div>
            ) : (
              <ul className="scheduler-list">
                {filtered.map((f) => (
                  <FollowUpRow
                    key={f.id}
                    followUp={f}
                    projectName={allProjects.find((p) => p.id === f.projectId)?.name ?? '⟨missing⟩'}
                    hideProject={scoped}
                    reveal={pendingRevealId === f.id}
                    onRevealed={() => setPendingRevealId(null)}
                    onEdit={() => setEditing(f)}
                    onAskDelete={() => setConfirmDelete(f)}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {editing && (
        <FollowUpModal
          followUp={editing === 'new' ? null : editing}
          lockedProjectId={scoped ? projectId : undefined}
          onClose={() => setEditing(null)}
        />
      )}
      {confirmDelete && (
        <DeleteConfirmModal
          followUp={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            const id = confirmDelete.id;
            setConfirmDelete(null);
            const result = await window.cc.followups.delete(id);
            if (!result.ok) {
              useUi.getState().pushToast(`Delete failed: ${result.message}`, 'error');
            }
          }}
        />
      )}
    </main>
  );
}

function FollowUpRow({
  followUp,
  projectName,
  hideProject,
  reveal,
  onRevealed,
  onEdit,
  onAskDelete
}: {
  followUp: FollowUp;
  projectName: string;
  hideProject?: boolean;
  reveal?: boolean;
  onRevealed?: () => void;
  onEdit: () => void;
  onAskDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [spawning, setSpawning] = useState(false);
  const cardRef = useRef<HTMLLIElement | null>(null);
  const [highlighted, setHighlighted] = useState(false);
  const highlightTimerRef = useRef<number | null>(null);

  // Deep-link from Home: scroll into view, expand, and pulse a highlight, then
  // tell the panel we've picked it up so it clears pendingRevealId. Mirrors
  // ScheduleRow's revealScheduleId handling. The highlight timer lives in a
  // ref (not the effect cleanup) so calling onRevealed — which flips `reveal`
  // back to false — doesn't cancel the timer before it fires.
  useEffect(() => {
    if (!reveal) return;
    onRevealed?.();
    setExpanded(true);
    setHighlighted(true);
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (highlightTimerRef.current !== null) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlighted(false);
      highlightTimerRef.current = null;
    }, 1600);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current !== null) clearTimeout(highlightTimerRef.current);
    };
  }, []);
  const pushToast = useUi((s) => s.pushToast);
  const meta = STATUS_META[followUp.status];
  const open = followUp.status === 'open';
  const OriginIcon = ORIGIN_ICON[followUp.origin.source];
  const KindIcon = KIND_ICON[followUp.kind];

  // "Work in progress" lock: for FOLLOWUP_SPAWN_LOCK_MS after the last spawn we
  // disable the spawn buttons so a second agent can't be launched against the
  // same follow-up (double-click, or two people both picking it up). Derived
  // from the persisted `spawnedAt` so the lock survives a window reload; a timer
  // re-renders the row exactly once when the window elapses to lift the lock.
  const spawnedAtMs = followUp.spawnedAt ? Date.parse(followUp.spawnedAt) : NaN;
  const [now, setNow] = useState(() => Date.now());
  const lockRemaining = Number.isNaN(spawnedAtMs)
    ? 0
    : Math.max(0, spawnedAtMs + FOLLOWUP_SPAWN_LOCK_MS - now);
  const locked = lockRemaining > 0;
  useEffect(() => {
    if (lockRemaining <= 0) return;
    const t = setTimeout(() => setNow(Date.now()), lockRemaining);
    return () => clearTimeout(t);
  }, [lockRemaining]);
  const spawnDisabled = spawning || locked;

  const setStatus = async (status: FollowUpStatus, verb: string, resolution?: string) => {
    const result = await window.cc.followups.setStatus(followUp.id, status, resolution);
    if (!result.ok) pushToast(`${verb} failed: ${result.message}`, 'error');
  };

  // Experimental interactive picker: when a follow-up carries concrete options and
  // the flag is on, show them as a lettered form. The follow-up model has no live
  // pty to inject into, so a pick RESOLVES the record with that label recorded as
  // the outcome (the durable analogue of the inbox QuestionBlock's inject).
  const structuredQuestions = useData((s) => s.structuredQuestionsEnabled);
  const showOptions = open && structuredQuestions && (followUp.options?.length ?? 0) > 0;
  const chooseOption = (label: string) => setStatus('resolved', 'Resolve', label);

  /**
   * Spawn a Claude agent to pick up this follow-up. Lands in the follow-up's own
   * project (so the agent's `followup_*` MCP tools are scoped to it), seeds the
   * first turn with the full context via {@link buildFollowUpPrompt}, then jumps
   * into the new agent's terminal so the user can follow along / intervene. The
   * prompt instructs the agent to `followup_resolve` the record when done.
   */
  const spawnAgent = async () => {
    // Guard the lock window client-side too (the buttons are disabled, but a
    // stale render or keyboard path could still fire): no double-spawn within
    // FOLLOWUP_SPAWN_LOCK_MS of the last one.
    if (spawnDisabled) return;
    const project = useData.getState().projects.find((p) => p.id === followUp.projectId);
    if (!project) {
      pushToast('Spawn failed: this follow-up’s project is no longer registered.', 'error');
      return;
    }
    setSpawning(true);
    try {
      const prompt = buildFollowUpPrompt(followUp);
      const profile = projectDefaultProfile(project);
      const session = await useData.getState().createTerminal(project.id, profile, 80, 24, {
        // Seed the prompt via the shared per-harness helper: a positional
        // `[prompt]` for claude/cursor/codex/pi, `--prompt <text>` for OpenCode
        // (whose positional is a project DIR).
        extraArgs: seedPromptArgs(profile, prompt),
        title: followUpAgentTitle(followUp)
      });
      if (session) {
        // Stamp `spawnedAt` so the row shows "in progress" and both spawn
        // buttons stay locked for the next minute (survives a window reload).
        // Best-effort: the agent is already launched, so a failed stamp only
        // means the visual lock is skipped — don't surface it as a spawn error.
        void window.cc.followups.markSpawned(followUp.id);
        const ui = useUi.getState();
        ui.setNav('projects');
        ui.selectProject(project.id);
        ui.selectTab(project.id, session.id);
      }
      // createTerminal surfaces its own error on failure; nothing else to do.
    } catch (err) {
      pushToast(`Spawn failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setSpawning(false);
    }
  };

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <li
      ref={cardRef}
      className={`scheduler-card ${!open ? 'is-disabled' : ''} ${expanded ? 'is-expanded' : ''} ${
        open ? 'is-running' : ''
      } ${highlighted ? 'is-revealed' : ''}`}
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
        <span
          className={`followup-kind-icon followup-kind-icon--${meta.cls}`}
          title={KIND_LABEL[followUp.kind]}
          aria-hidden
        >
          <KindIcon size={16} />
        </span>
        <div className="scheduler-card-compact-body">
          <span className="scheduler-card-title">
            {followUp.title}
            {/* "open" is already conveyed by the active row + its actions; only a
                terminal (resolved/dismissed) status earns a pill, so an open row
                shows exactly one status axis, never a pill pair. */}
            {!open && (
              <span className={`scheduler-pill scheduler-pill--${meta.cls}`}>{meta.label}</span>
            )}
          </span>
          <span className="scheduler-card-compact-meta followup-meta">
            {hideProject ? null : (
              <>
                <span className="followup-meta-project">{projectName}</span>
                <span className="followup-meta-sep" aria-hidden>·</span>
              </>
            )}
            <span className="followup-meta-kind">{KIND_LABEL[followUp.kind]}</span>
            <span className="followup-meta-sep" aria-hidden>·</span>
            <span className="followup-meta-origin">
              <OriginIcon size={11} /> {ORIGIN_LABEL[followUp.origin.source]}
            </span>
            {/* Re-filed under the same host-derived dedupeKey: one recurring row
                reading "×N" instead of a pile of duplicates. */}
            {(followUp.occurrences ?? 1) > 1 && (
              <>
                <span className="followup-meta-sep" aria-hidden>·</span>
                <span
                  className="followup-meta-count"
                  title={`Filed ${followUp.occurrences}× — same question re-raised`}
                >
                  ×{followUp.occurrences}
                </span>
              </>
            )}
            {showOptions && (
              <>
                <span className="followup-meta-sep" aria-hidden>·</span>
                <span
                  className="followup-meta-count"
                  title={`${followUp.options!.length} answer choices — expand to pick`}
                >
                  {followUp.options!.length} choices
                </span>
              </>
            )}
            {/* When it last landed here — the re-file bumps updatedAt, so for a
                recurring "×N" row this is the most-recent raise, not the first. */}
            <span className="followup-meta-sep" aria-hidden>·</span>
            <span
              className="followup-meta-time"
              title={`${(followUp.occurrences ?? 1) > 1 ? 'Last raised' : 'Parked'} ${new Date(
                followUp.updatedAt
              ).toLocaleString()}`}
            >
              {formatRelative(new Date(followUp.updatedAt))}
            </span>
          </span>
        </div>
        <div className="scheduler-card-actions" onClick={stop}>
          {open ? (
            <>
              {/* The 60s post-spawn lock lives ONLY on the button it gates (below,
                  disabled + a countdown title) — never as a standalone pill that
                  would masquerade as a second status and evaporate mid-run. */}
              <button
                className="scheduler-icon-btn scheduler-icon-btn--accent"
                onClick={spawnAgent}
                disabled={spawnDisabled}
                title={
                  locked
                    ? 'An agent was just spawned for this — try again in a moment'
                    : 'Spawn an agent to work on this in its project'
                }
                aria-label="Spawn agent"
              >
                <Rocket size={14} />
              </button>
              <button
                className="scheduler-icon-btn"
                onClick={() => setStatus('resolved', 'Resolve')}
                title="Mark resolved"
                aria-label="Resolve"
              >
                <Check size={14} />
              </button>
              <button
                className="scheduler-icon-btn"
                onClick={() => setStatus('dismissed', 'Dismiss')}
                title="Dismiss (no longer relevant)"
                aria-label="Dismiss"
              >
                <CircleSlash size={14} />
              </button>
            </>
          ) : (
            <button
              className="scheduler-icon-btn"
              onClick={() => setStatus('open', 'Reopen')}
              title="Reopen"
              aria-label="Reopen"
            >
              <RotateCcw size={14} />
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
          {followUp.detail ? (
            <div className="inbox-md scheduler-card-desc">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{ a: (props) => <a {...props} target="_blank" rel="noreferrer" /> }}
              >
                {followUp.detail}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="scheduler-card-desc scheduler-run-empty">No further detail.</div>
          )}
          {followUp.resolution && (
            <div className="scheduler-card-status">
              <span className="scheduler-status-item">
                <span className="scheduler-status-label">Resolution</span>
                <span className="scheduler-status-value">{followUp.resolution}</span>
              </span>
            </div>
          )}
          {open && (
            <FollowUpAnswerBox followUp={followUp} spawnDisabled={spawnDisabled} />
          )}
          {showOptions && (
            <div className="inbox-question followup-question">
              <span className="inbox-question-caption">
                <MessageCircleQuestion size={12} strokeWidth={2} />
                Pick one to resolve
              </span>
              <div className="inbox-question-options" role="radiogroup">
                {followUp.options!.map((label, i) => (
                  <button
                    key={`${i}-${label}`}
                    type="button"
                    className="inbox-question-option"
                    role="radio"
                    aria-checked={false}
                    onClick={() => void chooseOption(label)}
                    title={`Resolve with "${label}"`}
                  >
                    <span className="inbox-question-key">
                      {String.fromCharCode(65 + i)}
                    </span>
                    <span className="inbox-question-label">{label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="scheduler-card-status">
            <span className="scheduler-status-item">
              <span className="scheduler-status-label">Created</span>
              <span className="scheduler-status-value" title={new Date(followUp.createdAt).toLocaleString()}>
                {formatRelative(new Date(followUp.createdAt))}
              </span>
            </span>
            {followUp.resolvedAt && (
              <span className="scheduler-status-item">
                <span className="scheduler-status-label">Closed</span>
                <span
                  className="scheduler-status-value"
                  title={new Date(followUp.resolvedAt).toLocaleString()}
                >
                  {formatRelative(new Date(followUp.resolvedAt))}
                </span>
              </span>
            )}
            {followUp.sessionId && (
              <span className="scheduler-status-item">
                <span className="scheduler-status-label">Session</span>
                <span className="scheduler-status-value followup-session-id" title={followUp.sessionId}>
                  {followUp.sessionId.slice(0, 8)}
                </span>
              </span>
            )}
          </div>
          <div className="scheduler-card-detail-actions">
            {open && (
              <button
                className="settings-btn settings-btn--primary followup-spawn-btn"
                onClick={spawnAgent}
                disabled={spawnDisabled}
                title={
                  locked
                    ? 'An agent was just spawned for this — try again in a moment'
                    : 'Spawn an agent in this project, pre-loaded with this follow-up'
                }
              >
                <Rocket size={13} />{' '}
                {spawning
                  ? 'Spawning…'
                  : locked
                    ? `In progress (${Math.ceil(lockRemaining / 1000)}s)`
                    : 'Spawn agent'}
              </button>
            )}
            <span className="followup-detail-actions-spacer" />
            <button className="scheduler-icon-btn" onClick={onEdit} title="Edit" aria-label="Edit">
              <Pencil size={14} />
            </button>
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
    </li>
  );
}

/**
 * The answer box on an open follow-up — the durable analogue of the inbox
 * ReplyBox. This is what makes Follow-ups THE place to answer a parked question:
 * the user types an answer and {@link answerFollowUp} routes it to the RIGHT
 * agent via the three-tier ladder (inject the live tab → resume the exact
 * transcript → spawn a fresh agent seeded with question + answer), then resolves
 * the record with the answer as its resolution and navigates to whatever agent
 * ran. The label previews the tier so the user knows what "Send" will do before
 * they click (inject vs resume vs spawn), computed from the same host-stamped
 * origin coords the store routes on.
 *
 * ⌘/Ctrl+Enter submits; Enter alone inserts a newline (answers can be
 * multi-line). Disabled while a spawn lock is active so a just-launched agent
 * can't be double-fired.
 */
function FollowUpAnswerBox({
  followUp,
  spawnDisabled
}: {
  followUp: FollowUp;
  /** True while the post-spawn lock is active — mirrors the spawn buttons. */
  spawnDisabled: boolean;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  // Live terminals for this project drive the tier preview: an alive originating
  // tab means the answer will inject (tier 1) rather than resume/spawn.
  const terminals = useData((s) => s.terminals[followUp.projectId]);
  const projects = useData((s) => s.projects);

  const tier = useMemo(
    () => previewAnswerTier(followUp, terminals ?? [], projects),
    [followUp, terminals, projects]
  );

  const submit = async () => {
    if (sending || spawnDisabled || !text.trim()) return;
    setSending(true);
    const result = await answerFollowUp(followUp, text);
    setSending(false);
    if (result.ok) {
      setText('');
      // Land on the agent that ran the answer (resume/spawn open a new tab; an
      // inject to a live tab focuses it). An inject into a headless session has
      // no tab to show — leave the user in the Follow-ups view in that case.
      if (result.session && result.project) {
        const ui = useUi.getState();
        ui.setNav('projects');
        ui.selectProject(result.project.id);
        ui.selectTab(result.project.id, result.session.id);
      }
    }
  };

  const label = TIER_LABEL[tier];
  return (
    <div className="inbox-reply followup-answer">
      <span className="inbox-question-caption">
        <CornerDownLeft size={12} strokeWidth={2} />
        {TIER_CAPTION[tier]}
      </span>
      <textarea
        className="inbox-reply-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            void submit();
          }
        }}
        rows={2}
        placeholder="Answer this — it goes straight to the agent…"
        aria-label="Answer this follow-up"
      />
      <div className="inbox-reply-actions">
        <span className="inbox-reply-hint">⌘↵ to send · resolves this follow-up</span>
        <button
          type="button"
          className="inbox-reply-send"
          onClick={() => void submit()}
          disabled={sending || spawnDisabled || !text.trim()}
          title={spawnDisabled ? 'An agent was just spawned — try again in a moment' : label}
        >
          {tier === 'inject' ? (
            <Send size={13} strokeWidth={1.75} />
          ) : (
            <ArrowRight size={13} strokeWidth={1.75} />
          )}
          {sending ? 'Sending…' : label}
        </button>
      </div>
    </div>
  );
}

/** The three delivery tiers, mirrored from {@link answerFollowUp}'s ladder. */
type AnswerTier = 'inject' | 'resume' | 'spawn';

const TIER_LABEL: Record<AnswerTier, string> = {
  inject: 'Send',
  resume: 'Resume & answer',
  spawn: 'Answer & spawn'
};

const TIER_CAPTION: Record<AnswerTier, string> = {
  inject: 'The agent is still live — your answer goes to it',
  resume: 'Answering resumes the original agent with full history',
  spawn: 'Answering spawns a fresh agent with the question + your answer'
};

/**
 * Preview which tier {@link answerFollowUp} will fire, from the SAME signals it
 * routes on — so the button label is honest before the click. Pure + UI-only:
 * the store re-authorizes at delivery, this just picks the label.
 */
function previewAnswerTier(
  followUp: FollowUp,
  terminals: TerminalSession[],
  projects: Project[]
): AnswerTier {
  const origin = followUp.origin;
  const originSessionId = origin.source !== 'user' ? origin.sessionId : undefined;
  const liveOrigin = originSessionId
    ? terminals.find((t) => t.id === originSessionId && t.status !== 'exited')
    : undefined;
  if (liveOrigin) return 'inject';
  const resume = origin.source !== 'user' ? origin.resume : undefined;
  const project = projects.find((p) => p.id === followUp.projectId);
  const resumeProfile = knownProfile(resume?.profile) ?? 'claude';
  const canResume =
    !!resume?.claudeSessionId && isClaudeProfile(resumeProfile) && Boolean(project);
  return canResume ? 'resume' : 'spawn';
}

function FollowUpModal({
  followUp,
  lockedProjectId,
  onClose
}: {
  followUp: FollowUp | null;
  /** When set (project-scoped tab), the project is fixed and scope forced to it. */
  lockedProjectId?: string;
  onClose: () => void;
}) {
  const projects = useData((s) => s.projects);
  const isNew = followUp === null;

  const [title, setTitle] = useState(followUp?.title ?? '');
  const [detail, setDetail] = useState(followUp?.detail ?? '');
  const [kind, setKind] = useState<FollowUpKind>(followUp?.kind ?? 'question');
  const [projectId, setProjectId] = useState(
    followUp?.projectId ?? lockedProjectId ?? projects[0]?.id ?? ''
  );
  const [scope, setScope] = useState<'global' | 'project'>(
    followUp?.source && followUp.source !== 'global' ? 'project' : isNew ? 'project' : 'global'
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canSave = title.trim().length > 0 && Boolean(projectId);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        const input: FollowUpCreateInput = {
          projectId,
          title: title.trim(),
          detail: detail.trim() || undefined,
          kind,
          origin: { source: 'user' },
          scope: scope === 'project' ? { projectId } : 'global'
        };
        const result = await window.cc.followups.create(input);
        if (!result.ok) {
          setError(result.message);
          setSaving(false);
          return;
        }
      } else {
        const result = await window.cc.followups.update(followUp!.id, {
          title: title.trim(),
          detail: detail.trim() || undefined,
          kind
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
        aria-label={isNew ? 'New follow-up' : 'Edit follow-up'}
        tabIndex={-1}
      >
        <header className="modal-header">
          <h3>{isNew ? 'New follow-up' : 'Edit follow-up'}</h3>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">
          <div className="scheduler-form-field">
            <label htmlFor="fu-title">Title</label>
            <input
              id="fu-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              placeholder="Should I commit these changes?"
            />
          </div>
          <div className="scheduler-form-field">
            <label htmlFor="fu-detail">
              Detail <span className="scheduler-form-optional">(optional, markdown)</span>
            </label>
            <textarea
              id="fu-detail"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              rows={4}
              placeholder="Context to remember when you come back to this."
            />
          </div>
          <div className="scheduler-form-row">
            <div className="scheduler-form-field">
              <label htmlFor="fu-kind">Kind</label>
              <PopoverPicklist
                id="fu-kind"
                ariaLabel="Kind"
                value={kind}
                searchable={false}
                onChange={(nextKind) => setKind(nextKind as FollowUpKind)}
                options={[
                  { value: 'question', label: 'Question' },
                  { value: 'decision', label: 'Decision' },
                  { value: 'note', label: 'Note' }
                ]}
              />
            </div>
            <div className="scheduler-form-field">
              <label htmlFor="fu-project">Project</label>
              <PopoverPicklist
                id="fu-project"
                ariaLabel="Project"
                value={projectId}
                disabled={!isNew || Boolean(lockedProjectId)}
                onChange={setProjectId}
                placeholder="Choose project"
                searchPlaceholder="Search projects"
                options={projects.map((project) => ({ value: project.id, label: project.name }))}
              />
            </div>
          </div>
          {isNew && !lockedProjectId && (
            <div className="scheduler-form-field">
              <label>Scope</label>
              <div className="scheduler-scope-picker" role="radiogroup">
                <label className={`scheduler-scope-option ${scope === 'project' ? 'is-active' : ''}`}>
                  <input
                    type="radio"
                    name="fu-scope"
                    checked={scope === 'project'}
                    onChange={() => setScope('project')}
                  />
                  <div className="scheduler-scope-option-body">
                    <span className="scheduler-scope-title">Project</span>
                    <span className="scheduler-scope-hint">
                      &lt;project&gt;/.zcc/followups — checked in with the repo
                    </span>
                  </div>
                </label>
                <label className={`scheduler-scope-option ${scope === 'global' ? 'is-active' : ''}`}>
                  <input
                    type="radio"
                    name="fu-scope"
                    checked={scope === 'global'}
                    onChange={() => setScope('global')}
                  />
                  <div className="scheduler-scope-option-body">
                    <span className="scheduler-scope-title">Global</span>
                    <span className="scheduler-scope-hint">~/.zcc/followups — visible across the app</span>
                  </div>
                </label>
              </div>
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
            title={canSave ? '⌘+Enter to save' : 'Fill in a title'}
          >
            {saving ? 'Saving…' : isNew ? 'Create follow-up' : 'Save changes'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function DeleteConfirmModal({
  followUp,
  onCancel,
  onConfirm
}: {
  followUp: FollowUp;
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
        aria-label="Delete follow-up"
        tabIndex={-1}
      >
        <header className="modal-header">
          <h3>Delete follow-up?</h3>
          <button className="icon-button" onClick={onCancel} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="modal-body scheduler-confirm-body">
          This will permanently remove <strong>{followUp.title}</strong> and its
          on-disk JSON.
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
