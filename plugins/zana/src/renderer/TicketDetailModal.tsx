/**
 * Detail modal for a single Zana ticket OR artifact OR profile. Opens when a
 * card is clicked. A ticket renders its facts (status/priority/labels/assignee/
 * sprint/blockedBy), description, result summary and comments from the
 * already-loaded snapshot record — tickets are small, so the first paint is the
 * lean snapshot, then it enriches with the full on-disk detail. An artifact
 * lazy-loads its full markdown `content` and a profile lazy-loads its full
 * detail; both soft-fail to the snapshot on error.
 *
 * Follows the app's modal convention (`palette-backdrop` + stop-propagation +
 * Escape to close), matching GusDetailModal / ShortcutsHelp.
 *
 * Part of the zana-tickets DISK extension. Ticket / artifact / profile DATA is
 * fetched through the `ticketsApi` seam (which reaches the `zana` built-in main
 * module over the module bus); the injected `ModuleHost` supplies the shell
 * affordances — `host.toast`, `host.launchSession`, and `host.getActiveProject()`
 * / `host.listProjects()` for resolving the launch target. Markdown renders
 * through the bundle-local {@link MarkdownContent}.
 *
 * Rule 5 (no per-mount IPC storm): `profileMap` is supplied by the parent (no
 *   per-mount profile fetch); the lazy `getTicket`/`getArtifact`/`getProfile`
 *   are single-shot on open, guarded by the `live` flag.
 */

import { useEffect, useState } from 'react';
import type { ModuleHost } from '@zana-ai/zcc-extension-sdk/renderer';
import {
  X,
  Loader2,
  MessageSquare,
  Tag,
  Ban,
  FileText,
  History,
  ArrowRight,
  ChevronDown,
  CheckCircle2,
  XCircle,
  Cpu,
  Play,
  User,
  Ticket as TicketIcon
} from 'lucide-react';
import type {
  ZanaArtifact,
  ZanaAuditEntry,
  ZanaProfile,
  ZanaProfileDetail,
  ZanaSprint,
  ZanaTicket,
  ZanaTicketDetail
} from '@shared/zana-types';
import { ticketsApi, type TicketSource } from './ticketsApi';
import { MarkdownContent } from './Markdown';
import { AssignMenu, profileLabel, type AssignChoice, type ProfileMap } from './AssignMenu';

/** Either kind of record the modal can show, tagged by `kind`. */
export type ZanaSelection =
  | { kind: 'ticket'; ticket: ZanaTicket }
  | { kind: 'artifact'; artifact: ZanaArtifact }
  | { kind: 'profile'; profile: ZanaProfile };

interface Props {
  /** Injected shell bridge — used for toast + session launch (ticket detail only). */
  host: ModuleHost;
  selection: ZanaSelection;
  /** Resolved sprints, so a ticket can show its sprint name not just the id. */
  sprints: ZanaSprint[];
  /** All snapshot tickets, so blocker ids can resolve to ticket titles. */
  tickets: ZanaTicket[];
  /** Workspace profiles for the assignment picker + profile chip. */
  profiles: ZanaProfile[];
  /** Profile id → profile lookup, for resolving the assignee's profile. */
  profileMap: ProfileMap;
  /** Source coords for fetching an artifact's full content / ticket detail. */
  projectPath?: string;
  useGlobal: boolean;
  /** Apply an assignment choice (optimistic patch + deferred write live in the store). */
  onAssign: (choice: AssignChoice) => void;
  onClose: () => void;
}

/** Shape the modal's `{ projectPath, useGlobal }` props into a B2 `TicketSource`. */
function ticketSource(projectPath: string | undefined, useGlobal: boolean): TicketSource {
  return useGlobal ? { kind: 'global' } : { kind: 'project', projectPath: projectPath ?? '' };
}

function fmtDateTime(iso?: string): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function TicketDetailModal({
  host,
  selection,
  sprints,
  tickets,
  profiles,
  profileMap,
  projectPath,
  useGlobal,
  onAssign,
  onClose
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="gus-modal zana-modal"
        role="dialog"
        aria-modal="true"
        aria-label={
          selection.kind === 'ticket'
            ? selection.ticket.title
            : selection.kind === 'artifact'
              ? selection.artifact.title
              : selection.profile.displayName
        }
        onMouseDown={(e) => e.stopPropagation()}
      >
        {selection.kind === 'ticket' ? (
          <TicketDetail
            host={host}
            ticket={selection.ticket}
            sprints={sprints}
            tickets={tickets}
            profiles={profiles}
            profileMap={profileMap}
            projectPath={projectPath}
            useGlobal={useGlobal}
            onAssign={onAssign}
            onClose={onClose}
          />
        ) : selection.kind === 'artifact' ? (
          <ArtifactDetail
            artifact={selection.artifact}
            projectPath={projectPath}
            useGlobal={useGlobal}
            onClose={onClose}
          />
        ) : (
          <ProfileDetail profile={selection.profile} tickets={tickets} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

// ── Ticket ───────────────────────────────────────────────────────────────

/** Coerce an unknown detail value to a short, displayable string. */
function detailValue(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Human rendering of an audit entry's `details`, with nice special-cases for
 * the common actions and a generic key/value pill fallback for everything else.
 */
function AuditDetail({ entry }: { entry: ZanaAuditEntry }) {
  const d = entry.details ?? {};
  const action = entry.action;

  if (action === 'status_changed' && ('from' in d || 'to' in d)) {
    return (
      <div className="zana-timeline-detail">
        {d.from != null && <span className="zana-status-from">{detailValue(d.from)}</span>}
        <ArrowRight size={11} className="zana-status-arrow" aria-hidden />
        <span className="zana-status-to">{detailValue(d.to)}</span>
      </div>
    );
  }

  if (action === 'claimed' && 'agentName' in d) {
    return (
      <div className="zana-timeline-detail">
        claimed by <strong>{detailValue(d.agentName)}</strong>
      </div>
    );
  }

  if (action === 'assigned') {
    // Backend appends details:{ profileId, assigneeName, from }.
    const who = d.assigneeName != null ? detailValue(d.assigneeName) : detailValue(d.profileId);
    return (
      <div className="zana-timeline-detail">
        assigned to <strong>{who || 'someone'}</strong>
        {d.from != null && detailValue(d.from) && (
          <span className="zana-detail-pill">
            <span className="zana-detail-key">from</span>
            {detailValue(d.from)}
          </span>
        )}
      </div>
    );
  }

  if (action === 'unassigned') {
    return (
      <div className="zana-timeline-detail">
        unassigned
        {d.from != null && detailValue(d.from) && (
          <span className="zana-detail-pill">
            <span className="zana-detail-key">was</span>
            {detailValue(d.from)}
          </span>
        )}
      </div>
    );
  }

  if (action === 'created') {
    return (
      <div className="zana-timeline-detail">
        created
        {d.priority != null && (
          <span className={`zana-prio zana-prio--${detailValue(d.priority).toLowerCase()}`}>
            {detailValue(d.priority)}
          </span>
        )}
      </div>
    );
  }

  const keys = Object.keys(d);
  if (keys.length === 0) return null;
  return (
    <div className="zana-timeline-detail">
      {keys.map((k) => (
        <span key={k} className="zana-detail-pill">
          <span className="zana-detail-key">{k}</span>
          {detailValue(d[k])}
        </span>
      ))}
    </div>
  );
}

/**
 * Build the `claude` CLI `extraArgs` that turn a ticket + its assigned profile
 * into a launchable agent session. Profile flags map 1:1 onto args the pty
 * layer already understands (`pty.ts`); they're appended last so they win over
 * global / project defaults. The final positional element becomes Claude's
 * opening prompt (same mechanism the scheduler uses to seed a run).
 */
export function buildLaunchArgs(profile: ZanaProfileDetail, ticket: ZanaTicketDetail): string[] {
  const args: string[] = [];
  if (profile.model) args.push('--model', profile.model);
  if (profile.systemPrompt) args.push('--append-system-prompt', profile.systemPrompt);
  if ((profile.allowedTools ?? []).length > 0) {
    args.push('--allowedTools', profile.allowedTools!.join(','));
  }
  if ((profile.disallowedTools ?? []).length > 0) {
    args.push('--disallowedTools', profile.disallowedTools!.join(','));
  }
  if (profile.permissionMode) args.push('--permission-mode', profile.permissionMode);

  const who = profile.displayName || profile.id;
  const desc = ticket.description ? `\n\n${ticket.description}` : '';
  const prompt =
    `Work Zana ticket ${shortId(ticket.id)}: ${ticket.title}${desc}\n\n` +
    `You are acting as the "${who}" profile. Begin work on this ticket now.`;
  args.push(prompt);
  return args;
}

function TicketDetail({
  host,
  ticket,
  sprints,
  tickets,
  profiles,
  profileMap,
  projectPath,
  useGlobal,
  onAssign,
  onClose
}: {
  host: ModuleHost;
  ticket: ZanaTicket;
  sprints: ZanaSprint[];
  tickets: ZanaTicket[];
  profiles: ZanaProfile[];
  profileMap: ProfileMap;
  projectPath?: string;
  useGlobal: boolean;
  onAssign: (choice: AssignChoice) => void;
  onClose: () => void;
}) {
  // Imperative toast via the injected shell bridge.
  const toast = (msg: string, kind?: 'info' | 'error') => host.toast(msg, kind);
  // Start from the lean snapshot ticket so the modal renders immediately, then
  // enrich with the full on-disk detail (audit log + heavier fields). Soft-fails
  // to the lean ticket on error.
  const [detail, setDetail] = useState<ZanaTicketDetail>({ ...ticket, audit: [] });
  const [loading, setLoading] = useState(true);
  // Whether the in-modal assign dropdown is open.
  const [assignOpen, setAssignOpen] = useState(false);
  // Local optimistic assignee fields so the modal reflects an in-modal assign
  // immediately (the parent patches snapshot state, but our `ticket` prop is a
  // captured snapshot that doesn't update live).
  const [localAssignee, setLocalAssignee] = useState<
    Pick<ZanaTicket, 'assigneeName' | 'assigneeProfileId'> | null
  >(null);
  // True while a launch is in flight, so the Start button can disable + spin.
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    ticketsApi
      .getTicket(ticketSource(projectPath, useGlobal), ticket.id)
      .then((full) => {
        if (live && full) setDetail({ ...ticket, ...full, audit: full.audit ?? [] });
      })
      .catch(() => {
        /* keep the lean snapshot ticket */
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [ticket, projectPath, useGlobal]);

  const sprint = detail.sprintId ? sprints.find((s) => s.id === detail.sprintId) : undefined;
  const sprintLabel = sprint?.name ?? (detail.sprintId ? shortId(detail.sprintId) : undefined);

  // Effective assignee = the local optimistic override (if an in-modal assign
  // happened) else the fetched/snapshot value.
  const assigneeName = localAssignee ? localAssignee.assigneeName : detail.assigneeName;
  const assigneeProfileId = localAssignee
    ? localAssignee.assigneeProfileId
    : detail.assigneeProfileId;
  const prof = profileLabel(assigneeProfileId, profileMap);

  const facts: Array<[string, string | undefined | null]> = [
    ['Status', detail.status],
    ['Priority', detail.priority],
    ['Type', detail.type],
    // Assignee is surfaced in the action bar below, not duplicated here.
    ['Created by', detail.createdBy],
    ['Sprint', sprintLabel],
    ['Review phase', detail.reviewPhase],
    ['Rework count', detail.reworkCount && detail.reworkCount > 0 ? String(detail.reworkCount) : undefined],
    ['Created', fmtDateTime(detail.createdAt) || undefined],
    ['Updated', fmtDateTime(detail.updatedAt) || undefined],
    ['Closed', fmtDateTime(detail.closedAt) || undefined]
  ];
  const shownFacts = facts.filter(([, v]) => v);

  const handleAssign = (choice: AssignChoice) => {
    setAssignOpen(false);
    // Mirror the parent's optimistic patch locally for instant modal feedback.
    if (choice.kind === 'clear') {
      setLocalAssignee({ assigneeName: undefined, assigneeProfileId: undefined });
    } else if (choice.kind === 'profile') {
      setLocalAssignee({ assigneeName: choice.displayName, assigneeProfileId: choice.profileId });
    } else {
      setLocalAssignee({ assigneeName: choice.assigneeName, assigneeProfileId: undefined });
    }
    onAssign(choice);
  };
  // Resolve the project this ticket should launch in. A project-scoped source
  // matches by path against the shell's known projects; a global source falls
  // back to the active project. Null when nothing resolves — Start is then
  // disabled (a session needs a real project id + cwd).
  const targetProject = (() => {
    if (projectPath) {
      return host.listProjects().find((p) => p.path === projectPath) ?? null;
    }
    return host.getActiveProject();
  })();

  // Start is available only when the ticket is assigned to a resolvable profile
  // AND we have a project to launch in. Also gated on `!loading` so the launch
  // prompt is built from the enriched on-disk detail, not the lean snapshot.
  const canStart = !!assigneeProfileId && !!prof && !!targetProject && !loading && !launching;
  const startTitle = !assigneeProfileId
    ? 'Assign this ticket to a profile to start it.'
    : !prof
      ? 'The assigned profile is unavailable.'
      : !targetProject
        ? "Open this ticket's project to start it."
        : loading
          ? 'Loading ticket…'
          : `Start with ${prof.displayName}`;

  const handleStart = async () => {
    if (!assigneeProfileId || !targetProject) return;
    setLaunching(true);
    try {
      // Fail closed: the profile's full detail (system prompt, tools, model,
      // permission mode) IS the point of launching from a profile. If we can't
      // fetch it, don't silently launch a bare session that the toast would
      // misleadingly attribute to the profile.
      const full = await ticketsApi.getProfile(assigneeProfileId).catch(() => null);
      if (!full) {
        toast(
          `Couldn't load the “${prof?.displayName ?? assigneeProfileId}” profile — not started`,
          'error'
        );
        return;
      }
      const extraArgs = buildLaunchArgs(full, detail);
      const res = await host.launchSession({
        projectId: targetProject.id,
        cwd: targetProject.path,
        extraArgs,
        title: `Zana: ${detail.title.slice(0, 40)}`
      });
      if (res) {
        toast(`Started “${detail.title}” with ${full.displayName}`);
        onClose();
      } else {
        toast("Couldn't start session", 'error');
      }
    } catch (err) {
      toast(
        `Couldn't start session — ${err instanceof Error ? err.message : String(err)}`,
        'error'
      );
    } finally {
      setLaunching(false);
    }
  };

  const comments = detail.comments ?? [];
  // Activity log newest-first (snapshot stores it chronologically).
  const audit = [...detail.audit].reverse();
  const ticketTitleById = (id: string) => tickets.find((t) => t.id === id)?.title;

  return (
    <>
      <header className="gus-modal-header">
        <div className="gus-modal-title">
          <span className="gus-card-type">
            <TicketIcon size={14} aria-hidden />
            <span>{shortId(detail.id)}</span>
          </span>
          {detail.priority && (
            <span className={`zana-prio zana-prio--${detail.priority.toLowerCase()}`}>
              {detail.priority}
            </span>
          )}
          {detail.blockedBy.length > 0 && (
            <span className="zana-blocked-tag" title={`Blocked by ${detail.blockedBy.length}`}>
              <Ban size={11} aria-hidden /> Blocked
            </span>
          )}
        </div>
        <div className="gus-modal-header-actions">
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
      </header>

      <div className="gus-modal-body">
        <h3 className="gus-modal-subject">{detail.title}</h3>

        <dl className="gus-facts">
          {shownFacts.map(([k, v]) => (
            <div key={k} className="gus-fact">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>

        {/* Action bar — assignee on the left, Start + (re)assign on the right.
            Start only appears once the ticket is assigned to a profile, so an
            unassigned ticket shows a single clean Assign action. */}
        <div className="zana-action-bar">
          <div className="zana-action-assignee">
            {assigneeName ? (
              <>
                <span className="zana-action-avatar" aria-hidden>
                  {prof ? prof.icon : initials(assigneeName)}
                </span>
                <span className="zana-action-assignee-text">
                  <span className="zana-action-assignee-name">{assigneeName}</span>
                  {prof && (
                    <span className="zana-action-assignee-sub">{prof.displayName}</span>
                  )}
                </span>
              </>
            ) : (
              <>
                <span className="zana-action-avatar zana-action-avatar--empty" aria-hidden>
                  <User size={13} />
                </span>
                <span className="zana-card-unassigned">Unassigned</span>
              </>
            )}
          </div>

          <div className="zana-action-controls">
            {/* Start — spin up a Claude session from the assigned profile, seeded
                with this ticket. Shown only when assigned to a profile. */}
            {assigneeProfileId && (
              <button
                type="button"
                className="zana-start-btn"
                onClick={handleStart}
                disabled={!canStart}
                title={startTitle}
              >
                {launching ? (
                  <Loader2 size={14} className="gus-spin" aria-hidden />
                ) : (
                  <Play size={14} aria-hidden />
                )}
                {launching ? 'Starting…' : 'Start'}
              </button>
            )}
            <span className="zana-assign-row-control">
              <button
                type="button"
                className={`zana-assign-dropdown-btn ${assigneeName ? 'zana-assign-dropdown-btn--secondary' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setAssignOpen((o) => !o);
                }}
                aria-haspopup="menu"
                aria-expanded={assignOpen}
              >
                {assigneeName ? 'Reassign' : 'Assign'}
                <ChevronDown size={12} aria-hidden />
              </button>
              {assignOpen && (
                <AssignMenu
                  profiles={profiles}
                  onPick={handleAssign}
                  onClose={() => setAssignOpen(false)}
                  align="right"
                />
              )}
            </span>
          </div>
        </div>

        {detail.labels.length > 0 && (
          <div className="zana-modal-labels">
            {detail.labels.map((l) => (
              <span key={l} className="zana-label-chip">
                <Tag size={10} aria-hidden /> {l}
              </span>
            ))}
          </div>
        )}

        {detail.blockedBy.length > 0 && (
          <div className="zana-modal-section">
            <div className="gus-modal-section-label">
              <Ban size={12} aria-hidden /> Blocked by
            </div>
            <div className="zana-modal-blocked-ids">
              {detail.blockedBy.map((id) => {
                const title = ticketTitleById(id);
                return (
                  <span key={id} className="gus-chip zana-blocker-chip" title={id}>
                    {title ?? shortId(id)}
                    {title && <span className="zana-blocker-id">{shortId(id)}</span>}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        <div className="zana-modal-section">
          <div className="gus-modal-section-label">Description</div>
          {detail.description ? (
            <MarkdownContent text={detail.description} />
          ) : (
            <div className="gus-modal-empty">No description.</div>
          )}
        </div>

        {detail.resultSummary && (
          <div className="zana-modal-section">
            <div className="gus-modal-section-label">Result summary</div>
            <MarkdownContent text={detail.resultSummary} />
          </div>
        )}

        <div className="zana-modal-section gus-modal-chatter">
          <div className="gus-modal-section-label">
            <MessageSquare size={12} aria-hidden /> Comments
            {comments.length > 0 && <span className="gus-chatter-count">{comments.length}</span>}
          </div>
          {comments.length === 0 ? (
            <div className="gus-modal-empty">No comments.</div>
          ) : (
            <ul className="gus-chatter-list">
              {comments.map((c, i) => (
                <li key={i} className="gus-chatter-post">
                  <div className="gus-chatter-avatar" aria-hidden>
                    {initials(c.author ?? '?')}
                  </div>
                  <div className="gus-chatter-main">
                    <div className="gus-chatter-head">
                      <span className="gus-chatter-author">{c.author ?? 'Unknown'}</span>
                      <span className="gus-chatter-time">{fmtDateTime(c.createdAt)}</span>
                    </div>
                    <div className="gus-chatter-body">
                      <MarkdownContent text={c.body} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="zana-modal-section">
          <div className="gus-modal-section-label">
            <History size={12} aria-hidden /> Activity
            {audit.length > 0 && <span className="gus-chatter-count">{audit.length}</span>}
            {loading && (
              <Loader2 size={12} className="gus-spin zana-timeline-spinner" aria-label="Loading activity" />
            )}
          </div>
          {audit.length === 0 ? (
            <div className="gus-modal-empty">
              {loading ? 'Loading activity…' : 'No activity recorded.'}
            </div>
          ) : (
            <ol className="zana-timeline">
              {audit.map((entry, i) => (
                <li key={entry.id ?? i} className="zana-timeline-item">
                  <span className="zana-timeline-dot" aria-hidden />
                  <div className="zana-timeline-main">
                    <div className="zana-timeline-head">
                      <span className="zana-timeline-action">{entry.action || 'event'}</span>
                      {entry.actor && <span className="zana-timeline-actor">{entry.actor}</span>}
                      {entry.timestamp && (
                        <span className="zana-timeline-time">{fmtDateTime(entry.timestamp)}</span>
                      )}
                    </div>
                    <AuditDetail entry={entry} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </>
  );
}

// ── Artifact ─────────────────────────────────────────────────────────────

function ArtifactDetail({
  artifact,
  projectPath,
  useGlobal,
  onClose
}: {
  artifact: ZanaArtifact;
  projectPath?: string;
  useGlobal: boolean;
  onClose: () => void;
}) {
  // Start with whatever content the snapshot shipped; replace with the full
  // body once fetched. Soft-fails to the inline content on error.
  const [content, setContent] = useState<string>(artifact.content);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    ticketsApi
      .getArtifact(ticketSource(projectPath, useGlobal), artifact.id)
      .then((full) => {
        if (live && full && typeof full.content === 'string') setContent(full.content);
      })
      .catch(() => {
        /* keep inline content */
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [artifact.id, projectPath, useGlobal]);

  const facts: Array<[string, string | undefined]> = [
    ['Type', artifact.type],
    ['Created by', artifact.createdBy],
    ['Created', fmtDateTime(artifact.createdAt) || undefined],
    ['Linked tickets', artifact.linkedTickets.length ? String(artifact.linkedTickets.length) : undefined]
  ];
  const shownFacts = facts.filter(([, v]) => v);

  return (
    <>
      <header className="gus-modal-header">
        <div className="gus-modal-title">
          <span className="gus-card-type">
            <FileText size={14} aria-hidden />
            <span>Doc</span>
          </span>
          {artifact.type && <span className="zana-type-badge">{artifact.type}</span>}
        </div>
        <div className="gus-modal-header-actions">
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
      </header>

      <div className="gus-modal-body">
        <h3 className="gus-modal-subject">{artifact.title}</h3>

        {shownFacts.length > 0 && (
          <dl className="gus-facts">
            {shownFacts.map(([k, v]) => (
              <div key={k} className="gus-fact">
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}

        {artifact.tags.length > 0 && (
          <div className="zana-modal-labels">
            {artifact.tags.map((t) => (
              <span key={t} className="zana-label-chip">
                <Tag size={10} aria-hidden /> {t}
              </span>
            ))}
          </div>
        )}

        <div className="zana-modal-section">
          <div className="gus-modal-section-label">Content</div>
          {loading && !content ? (
            <div className="gus-modal-loading">
              <Loader2 size={14} className="gus-spin" /> Loading content…
            </div>
          ) : content ? (
            <div className="zana-doc-reader">
              <MarkdownContent text={content} />
            </div>
          ) : (
            <div className="gus-modal-empty">No content.</div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Profile ──────────────────────────────────────────────────────────────

/**
 * Detail for one agent profile. Starts from the lean list profile (icon, name,
 * origin, category, model, tool lists) so it renders instantly, then lazy-loads
 * the full `ZanaProfileDetail` (system prompt, permission mode, effort level)
 * via `getProfile`. Soft-fails to the lean profile on error. Also surfaces how
 * many of the loaded tickets are assigned to this profile — tying the profile
 * back to the board. Read-only.
 */
function ProfileDetail({
  profile,
  tickets,
  onClose
}: {
  profile: ZanaProfile;
  tickets: ZanaTicket[];
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<ZanaProfileDetail>({ ...profile });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setDetail({ ...profile });
    ticketsApi
      .getProfile(profile.id)
      .then((full) => {
        if (live && full) setDetail({ ...profile, ...full });
      })
      .catch(() => {
        /* keep the lean list profile */
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [profile]);

  const assignedCount = tickets.filter((t) => t.assigneeProfileId === profile.id).length;
  const allowed = detail.allowedTools ?? [];
  const disallowed = detail.disallowedTools ?? [];

  const facts: Array<[string, string | undefined]> = [
    ['Origin', detail.origin === 'workspace' ? 'Workspace' : 'Built-in'],
    ['Category', detail.category],
    ['Model', detail.model],
    ['Permission mode', detail.permissionMode],
    ['Effort', detail.effortLevel],
    ['Tickets assigned', assignedCount > 0 ? String(assignedCount) : undefined]
  ];
  const shownFacts = facts.filter(([, v]) => v);

  return (
    <>
      <header className="gus-modal-header">
        <div className="gus-modal-title">
          <span className="zana-profile-modal-icon" aria-hidden>
            {detail.icon ?? '🤖'}
          </span>
          <span
            className={`zana-profile-origin zana-profile-origin--${detail.origin}`}
            title={detail.origin === 'workspace' ? 'Workspace profile' : 'Zana built-in profile'}
          >
            {detail.origin === 'workspace' ? 'Workspace' : 'Built-in'}
          </span>
          {detail.model && (
            <span className="zana-type-badge zana-profile-model">
              <Cpu size={11} aria-hidden /> {detail.model}
            </span>
          )}
        </div>
        <div className="gus-modal-header-actions">
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
      </header>

      <div className="gus-modal-body">
        <h3 className="gus-modal-subject">{detail.displayName}</h3>

        {detail.description && <p className="zana-profile-desc">{detail.description}</p>}

        {shownFacts.length > 0 && (
          <dl className="gus-facts">
            {shownFacts.map(([k, v]) => (
              <div key={k} className="gus-fact">
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}

        {(allowed.length > 0 || disallowed.length > 0) && (
          <div className="zana-modal-section">
            <div className="gus-modal-section-label">Tools</div>
            {allowed.length > 0 && (
              <div className="zana-profile-tools">
                <span className="zana-profile-tools-label">
                  <CheckCircle2 size={12} aria-hidden /> Allowed
                </span>
                <div className="zana-profile-tool-chips">
                  {allowed.map((t) => (
                    <span key={t} className="zana-label-chip zana-tool-chip zana-tool-chip--allow">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {disallowed.length > 0 && (
              <div className="zana-profile-tools">
                <span className="zana-profile-tools-label">
                  <XCircle size={12} aria-hidden /> Denied
                </span>
                <div className="zana-profile-tool-chips">
                  {disallowed.map((t) => (
                    <span key={t} className="zana-label-chip zana-tool-chip zana-tool-chip--deny">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="zana-modal-section">
          <div className="gus-modal-section-label">
            System prompt
            {loading && (
              <Loader2
                size={12}
                className="gus-spin zana-timeline-spinner"
                aria-label="Loading system prompt"
              />
            )}
          </div>
          {detail.systemPrompt ? (
            <pre className="zana-profile-prompt">{detail.systemPrompt}</pre>
          ) : (
            <div className="gus-modal-empty">
              {loading ? 'Loading system prompt…' : 'No system prompt.'}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
