import { product } from '../lib/product-client.js';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { ArrowLeft, ArrowRight, Bookmark, BookmarkCheck, BotMessageSquare, Code2, Copy, CornerDownLeft, Download, ExternalLink, FileText, FolderOpen, MessageSquare, Send, Sparkles, Star, Trash2 } from 'lucide-react';
import { inboxQuestions } from '@zana-ai/zcc-domain/product';
import type { InboxQuestion, Suggestion } from '@zana-ai/zcc-domain/product';
import {
  deleteInboxEntry,
  replyToInboxEntry,
  saveInboxEntry,
  toggleInboxKeep,
  useData,
  useInbox,
  useInboxAnswered,
  useInboxKeep,
  useInboxRead,
  useInboxSelection,
  useSavedMark,
  useSuggestions,
  useUi
} from '../store.js';
import { AgentLauncher } from './AgentLauncher.js';
import { QuestionBlock } from './InboxQuestionBlock.js';
import { InboxGuidance } from './InboxGuidance.js';
import { DocContent, MarkdownContent } from './MarkdownContent.js';
import { renderReportHtml, type ReportDoc } from '../lib/renderReportHtml.js';
import { inboxPrimaryTitle, inboxShortTitle, inboxContextLine } from '../lib/inboxPresentation.js';
import { classifyEntry } from '@zana-ai/zcc-domain/feed-categories';
import { resolveAnswerSurface } from '../lib/answerSurface.js';
import { isClaudeProfile, knownProfile, projectDefaultProfile } from '../lib/launchProfile.js';
import type {
  InboxDoc,
  InboxEntry,
  FsReadResult,
  LaunchProfileId,
  Project,
  SavedDoc,
  SavedRecordInput,
  TerminalSession
} from '@zana-ai/zcc-domain/product';

interface InboxDetailProps {
  /**
   * Gates the page-level Delete/Backspace shortcut so the inbox view only
   * intercepts when it's actually visible.
   */
  visible: boolean;
}

/**
 * Inbox detail pane.
 *
 * Header (project label · timestamp · trash button) on top, docs (live
 * fetch via cc.fs.readFile) below, comments (markdown) at the bottom.
 *
 * Selection is owned by useInboxSelection; the sidebar drives it. Read-state
 * mutation happens at the sidebar selection site — this pane just renders
 * whatever is selected. Delete is owned here because it needs the full
 * entry list to advance selection after removal.
 */
export function InboxDetail({ visible }: InboxDetailProps) {
  const entries = useInbox((s) => s.entries);
  const loading = useInbox((s) => s.loading);
  const selectedId = useInboxSelection((s) => s.selectedEntryId);
  const select = useInboxSelection((s) => s.select);
  const markRead = useInboxRead((s) => s.markRead);

  const selected = entries.find((e) => e.id === selectedId) ?? null;

  /**
   * Hard-delete an entry. Optimistically removes from local state, advances
   * selection to the next-older entry (or previous if last), then fires
   * the IPC. The main process echoes the removal back via `onRemoved` —
   * a no-op locally because we already filtered.
   */
  const handleDelete = useCallback(
    async (id: string) => {
      const idx = entries.findIndex((e) => e.id === id);
      if (idx < 0) return;

      // entries are newest-first; "the one after this" is the next older.
      const nextId = entries[idx + 1]?.id ?? entries[idx - 1]?.id ?? null;

      if (nextId) {
        select(nextId);
        markRead(nextId);
      } else {
        select(null);
      }

      await deleteInboxEntry(id);
    },
    [entries, select, markRead]
  );

  useEffect(() => {
    if (!visible) return;
    if (!selectedId) return;
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      e.preventDefault();
      void handleDelete(selectedId!);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, selectedId, handleDelete]);

  if (loading && entries.length === 0) {
    return <div className="inbox-detail-empty">Loading…</div>;
  }
  if (entries.length === 0) {
    return <EmptyState />;
  }
  if (!selected) {
    return <div className="inbox-detail-empty">Select an entry from the sidebar.</div>;
  }
  return <Detail entry={selected} onDelete={() => handleDelete(selected.id)} />;
}

// Cumulative byte budget for a single PDF export / Save. Each doc is capped at
// 2 MB by main's fs.readFile, but the doc COUNT is agent-controlled and
// unbounded — 500 docs would accumulate ~1 GB of strings in the renderer and
// OOM it. Bound the total: once the budget is spent, remaining docs are recorded
// as skipped (visible in the output, per "no silent caps"), not read.
const EXPORT_TOTAL_BYTES_CAP = 32 * 1024 * 1024; // 32 MB of source markdown

function EmptyState() {
  return (
    <div className="inbox-detail-empty-state">
      <div className="inbox-detail-empty-title">No inbox messages yet</div>
      <p className="inbox-detail-empty-body">
        Projects will push status updates here as they work — finished
        analyses, blocked tasks, questions back to you.
      </p>
      <InboxGuidance />
    </div>
  );
}

function Detail({ entry, onDelete }: { entry: InboxEntry; onDelete: () => void }) {
  const projects = useData((s) => s.projects);
  const terminals = useData((s) => s.terminals);
  const structuredQuestions = useData((s) => s.structuredQuestionsEnabled);
  const restoreTerminal = useData((s) => s.restoreTerminal);
  const createTerminal = useData((s) => s.createTerminal);
  // Clearing the selection returns the detail column to the Inbox Overview
  // landing page (see `InboxView`).
  const clearSelection = useInboxSelection((s) => s.select);
  const setNav = useUi((s) => s.setNav);
  const selectTab = useUi((s) => s.selectTab);
  const pushToast = useUi((s) => s.pushToast);

  const [exporting, setExporting] = useState(false);
  const [reopening, setReopening] = useState(false);
  // Open the "new agent" launcher (project mode) prefilled with this report, so
  // the user can spawn a fresh agent to act on the message.
  const [launcherOpen, setLauncherOpen] = useState(false);
  // When we spawn a replacement agent (the originating tab was gone), point the
  // reply/question box at THAT new live session for the rest of this view, so a
  // follow-up answer lands on the agent the user just reopened.
  const [reopenedSessionId, setReopenedSessionId] = useState<string | null>(null);
  // In reopen mode, a plain (non-question) report doesn't auto-open the answer
  // box — it shows a quiet "Reply…" button. This tracks the user expanding it.
  const [replyExpanded, setReplyExpanded] = useState(false);

  const aliveProject = projects.find((p) => p.id === entry.projectId) ?? null;
  const projectAlive = aliveProject !== null;
  const displayLabel =
    aliveProject?.name ?? entry.projectLabel ?? entry.projectId;

  const projectTerminals = terminals[entry.projectId] ?? [];
  // Resolve the originating session, when one was recorded and is still
  // alive. An EXITED tombstone still lingers in the terminal list (see
  // store.ts's onExit), but its pty is dead — a reply would be dropped and
  // `replyToInboxEntry` now reports that. Exclude it here so the UI collapses to
  // the reopen (resume/fresh) path instead of offering a reply that can't land.
  // A dead/missing sessionId falls back to reopen the same way.
  const originalSession = entry.sessionId
    ? projectTerminals.find((t) => t.id === entry.sessionId && t.status !== 'exited') ?? null
    : null;
  // A session we spawned from this pane (reopen) takes over as the live target.
  const reopenedSession = reopenedSessionId
    ? projectTerminals.find((t) => t.id === reopenedSessionId) ?? null
    : null;
  const aliveSession = originalSession ?? reopenedSession;
  const sessionTombstoned = !!entry.sessionId && originalSession === null && !reopenedSession;

  // Can we resume the EXACT prior conversation? Only when the origin captured a
  // claude transcript id and a claude-family profile to relaunch on.
  const resumable =
    !!entry.origin?.claudeSessionId &&
    isClaudeProfile(entry.origin.profile ?? projectDefaultProfile(aliveProject ?? ({} as Project)));

  // Related "Next Steps" — suggestions an agent surfaced for the SAME work,
  // correlated implicitly by identity the two surfaces ALREADY share (no
  // cross-reference field, no schema change). The workhorse is `sessionId`:
  // both `inbox_push` and `suggest_action` host-stamp it from the MCP route, so
  // a report and the next steps the same agent proposed link automatically with
  // zero agent cooperation. `dedupeKey` is the precise opt-in on top — but note
  // a manual `inbox_push` carries none (the inbox dedupeKey is host-stamped for
  // recurring producers only), so it only ever matches a suggestion an agent
  // deliberately keyed the same. Select the STABLE `entries` array (a filtering
  // selector returns a fresh array each render → the zustand infinite-loop trap)
  // and filter under useMemo.
  const allSuggestions = useSuggestions((s) => s.entries);
  const relatedSuggestions = useMemo(() => {
    if (!entry.sessionId && !entry.dedupeKey) return [];
    return allSuggestions.filter(
      (sug) =>
        sug.projectId === entry.projectId &&
        ((!!entry.sessionId && sug.sessionId === entry.sessionId) ||
          (!!entry.dedupeKey && sug.dedupeKey === entry.dedupeKey))
    );
  }, [allSuggestions, entry.projectId, entry.sessionId, entry.dedupeKey]);

  const hasDocs = (entry.docs?.length ?? 0) > 0;
  const hasComments = (entry.comments ?? '').trim().length > 0;
  // One-or-many questions, normalized to a flat list (see inboxQuestions).
  // The interactive lettered-option form is an experimental display choice; when
  // it's off we fall back to the plain free-text ReplyBox everywhere (the options
  // are still spelled out in the entry's Comments text, so nothing is lost — it's
  // just not an interactive form).
  const questionSet = structuredQuestions ? inboxQuestions(entry) : [];
  // Does this entry read as a QUESTION the user should answer? Independent of
  // the `structuredQuestions` display flag: `classifyEntry` reports 'question'
  // from the entry's own structured question field, so a user who disabled the
  // interactive picker still gets an answer box for a real question (never null).
  const answerable = questionSet.length > 0 || classifyEntry(entry) === 'question';
  // Single deterministic decision for the answer surface (see resolveAnswerSurface):
  //  live   → inject into the originating/reopened pty.
  //  reopen → no live session but project survives → reopen the agent with the
  //           answer (covers tombstoned AND no-sessionId prose questions).
  //  none   → project gone → honest disabled panel, never a blank surface.
  const { mode: deliveryMode, showBox } = resolveAnswerSurface({
    hasLiveSession: !!aliveSession,
    hasAliveProject: projectAlive,
    answerable
  });
  // In reopen mode a plain report shows a quiet "Reply…" button first; expanding
  // it (or an actual question) reveals the dead-session box.
  const showReopenBox = showBox || replyExpanded;

  /**
   * Open the entry's agent. Three-way, best-to-worst:
   *  1. The originating tab is still live → focus it (resume via restore for a
   *     headless/background session, else just select the tab).
   *  2. The tab is gone but we captured a resumable conversation → spawn
   *     `claude --resume <id>` in the original cwd/profile/persona — full
   *     history intact.
   *  3. No resumable conversation (legacy entry / non-claude) → spawn a FRESH
   *     agent seeded with this report (docs + comments) so it starts with the
   *     context the old agent left behind.
   * In every case navigate to the project first so the user lands on the agent.
   */
  const handleOpen = async () => {
    if (!aliveProject || reopening) return;
    useUi.getState().enterProjectFocus(aliveProject.id);

    // 1. Live originating tab (or one we already reopened) → focus it.
    if (originalSession || reopenedSession) {
      const target = (originalSession ?? reopenedSession)!;
      void restoreTerminal(target.id, aliveProject.id);
      return;
    }

    setReopening(true);
    try {
      const created = resumable
        ? await reopenResumed(aliveProject)
        : await reopenFresh(aliveProject);
      if (created) {
        setReopenedSessionId(created.id);
        selectTab(aliveProject.id, created.id);
      }
    } finally {
      setReopening(false);
    }
  };

  /**
   * Answer a question (or send a free-text reply) whose originating session has
   * ENDED. Unlike the live path (`replyToInboxEntry` → inject into a running
   * pty), there's no pty to write to, so we REOPEN the agent with the answer as
   * its opening turn:
   *   • resumable (claude transcript captured) → `claude --resume <id> "<answer>"`
   *     — the agent wakes with full history and the answer as the next message.
   *   • otherwise → a FRESH agent seeded with the report context AND the answer.
   * Marks the entry answered on success and lands the user on the reopened tab.
   * Returns true when the agent was reopened. Shared by the QuestionBlock and
   * the ReplyBox dead-session paths.
   */
  const answerOnDeadSession = async (answer: string): Promise<boolean> => {
    const body = answer.trim();
    if (!aliveProject || reopening || !body) return false;
    useUi.getState().enterProjectFocus(aliveProject.id);
    setReopening(true);
    try {
      const opening = resumable ? body : `${buildSeedPrompt(entry)}\n\nMy answer: ${body}`;
      const created = resumable
        ? await reopenResumed(aliveProject, opening)
        : await reopenFresh(aliveProject, opening);
      if (!created) return false;
      setReopenedSessionId(created.id);
      selectTab(aliveProject.id, created.id);
      useInboxAnswered.getState().markAnswered(entry.id);
      pushToast('Agent reopened with your answer', 'info');
      return true;
    } finally {
      setReopening(false);
    }
  };

  // Branch 2: resume the exact conversation. The captured cwd is re-confined to
  // the project in main (createTerminalConfined realpaths it), so a stale cwd
  // just falls back to the project root. `opening` is an optional first turn —
  // for a plain reopen it's undefined (the report is already in the resumed
  // transcript); when the user answers a question on a DEAD session we pass
  // their answer here so `claude --resume <id> "<answer>"` delivers it as the
  // agent's next turn (claude reads the positional [prompt] as the first turn).
  const reopenResumed = async (
    project: Project,
    opening?: string
  ): Promise<TerminalSession | null> => {
    const profile = (knownProfile(entry.origin?.profile) ?? 'claude') as LaunchProfileId;
    const created = await createTerminal(project.id, profile, 80, 24, {
      extraArgs: ['--resume', entry.origin!.claudeSessionId!],
      prompt: opening,
      personaId: entry.origin?.personaId,
      cwd: entry.origin?.cwd,
      title: `↺ ${deriveTitle(entry)}`
    });
    if (!created) pushToast('Could not resume the agent', 'error');
    return created;
  };

  // Branch 3: fresh agent seeded with the report so it picks up the context the
  // old agent left behind. Prefer the origin's profile/persona when we captured
  // them, else the project default. `opening` overrides the default seed prompt
  // — used when answering a question on a non-resumable dead session, where the
  // seed carries both the report context AND the user's answer.
  const reopenFresh = async (
    project: Project,
    opening?: string
  ): Promise<TerminalSession | null> => {
    const profile =
      knownProfile(entry.origin?.profile) ?? projectDefaultProfile(project);
    const created = await createTerminal(project.id, profile, 80, 24, {
      prompt: opening ?? buildSeedPrompt(entry),
      personaId: entry.origin?.personaId,
      cwd: entry.origin?.cwd,
      title: `↺ ${deriveTitle(entry)}`
    });
    if (!created) pushToast('Could not open a new agent', 'error');
    return created;
  };

  /**
   * Export the entry (docs + comments) to a PDF rendered from the *source*
   * markdown, not a screen snapshot. We re-read each doc fresh, render it
   * through the shared MarkdownContent pipeline into an off-screen root (so
   * mermaid → SVG and code highlighting run), then hand the standalone HTML to
   * the main process to print via a hidden window. Reading fresh avoids the
   * inbox panel's 2 MB render cap, and rendering clean drops the panel chrome.
   */
  const exportPdf = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const docs: ReportDoc[] = [];
      let totalBytes = 0;
      for (const d of entry.docs ?? []) {
        if (!aliveProject) {
          docs.push({ path: d.path, error: 'Project no longer exists' });
          continue;
        }
        if (totalBytes >= EXPORT_TOTAL_BYTES_CAP) {
          docs.push({ path: d.path, error: 'Skipped: export size limit reached' });
          continue;
        }
        try {
          const r = await product.fs.readFile(joinPath(aliveProject.path, d.path));
          if (r.ok && typeof r.content === 'string') {
            totalBytes += r.content.length;
            docs.push({ path: d.path, content: r.content });
          } else {
            docs.push({ path: d.path, error: docReadError(r) });
          }
        } catch (e) {
          docs.push({ path: d.path, error: e instanceof Error ? e.message : 'Read failed' });
        }
      }
      if (totalBytes >= EXPORT_TOTAL_BYTES_CAP) {
        pushToast('Export truncated: total document size exceeded the limit', 'info');
      }

      const title = `${displayLabel} — ${formatAbsolute(entry.ts)}`;
      const html = await renderReportHtml({ title, docs, comments: entry.comments });
      const result = await product.inbox.exportPdf({ html, suggestedName: title });
      if (result.ok) {
        pushToast(result.path ? `PDF saved to ${result.path}` : 'PDF saved', 'info');
      } else if (result.message) {
        pushToast(result.message, 'error');
      }
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'PDF export failed', 'error');
    } finally {
      setExporting(false);
    }
  };

  const canExport = hasDocs || hasComments;

  // Save: freeze a reusable copy of this report (comments + a snapshot of each
  // doc's current content) under ~/.zcc/saved/. Docs are re-read fresh on
  // click so the snapshot is current; the saved-state marker is per-entry.
  const alreadySaved = useSavedMark((s) => !!s.savedEntryIds[entry.id]);
  const kept = useInboxKeep((s) => !!s.keptIds[entry.id]);
  const [saving, setSaving] = useState(false);
  const onSave = async () => {
    if (saving || alreadySaved) return;
    setSaving(true);
    try {
      const docs: SavedDoc[] = [];
      let totalBytes = 0;
      for (const d of entry.docs ?? []) {
        if (!aliveProject) {
          docs.push({ path: d.path, error: 'Project no longer exists' });
          continue;
        }
        if (totalBytes >= EXPORT_TOTAL_BYTES_CAP) {
          docs.push({ path: d.path, error: 'Skipped: save size limit reached' });
          continue;
        }
        try {
          const r = await product.fs.readFile(joinPath(aliveProject.path, d.path));
          if (r.ok && typeof r.content === 'string') totalBytes += r.content.length;
          docs.push({
            path: d.path,
            content: r.ok ? r.content : undefined,
            truncated: r.truncated,
            binary: r.binary,
            error: r.ok ? undefined : r.message ?? 'Read failed'
          });
        } catch (e) {
          docs.push({ path: d.path, error: e instanceof Error ? e.message : 'Read failed' });
        }
      }
      const input: SavedRecordInput = {
        sourceEntryId: entry.id,
        projectId: entry.projectId,
        projectLabel: displayLabel,
        title: deriveTitle(entry),
        comments: entry.comments,
        docs: docs.length ? docs : undefined
      };
      await saveInboxEntry(input, entry.id);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="inbox-detail">
      <div className="inbox-detail-header">
        <button
          type="button"
          className="inbox-detail-overview-back"
          onClick={() => clearSelection(null)}
          title="Back to inbox overview"
        >
          <ArrowLeft size={13} aria-hidden />
          <span>Overview</span>
        </button>
        <span
          className={`inbox-detail-label ${projectAlive ? '' : 'tombstoned'}`}
          title={projectAlive ? undefined : 'Project no longer exists'}
        >
          {displayLabel}
        </span>
        {aliveSession && (
          <>
            <span className="inbox-detail-ts-sep">·</span>
            <span className="inbox-detail-session" title="Originating terminal">
              {aliveSession.title}
            </span>
          </>
        )}
        {sessionTombstoned && (
          <>
            <span className="inbox-detail-ts-sep">·</span>
            <span
              className="inbox-detail-session tombstoned"
              title="Original terminal session has ended"
            >
              {/* Name the task even though its tab is gone — the author-set
                  subject or the persisted origin title survives the session,
                  unlike aliveSession.title. */}
              {(entry.subject?.trim() || entry.origin?.title?.trim())
                ? `${(entry.subject?.trim() || entry.origin?.title?.trim())} · session ended`
                : 'session ended'}
            </span>
          </>
        )}
        <span className="inbox-detail-ts">
          {formatAbsolute(entry.ts)}
          <span className="inbox-detail-ts-sep">·</span>
          {formatRelative(entry.ts)}
        </span>
        <div className="inbox-detail-actions">
          <div className="inbox-detail-actions-group">
            <button
              type="button"
              onClick={() => toggleInboxKeep(entry.id)}
              className={`inbox-detail-keep ${kept ? 'is-kept' : ''}`}
              title={kept ? 'Kept — protected from Clear inbox' : 'Keep (protect from Clear inbox)'}
              aria-label={kept ? 'Remove keep flag' : 'Keep this entry'}
              aria-pressed={kept}
            >
              <Star size={14} strokeWidth={1.75} fill={kept ? 'currentColor' : 'none'} />
            </button>
            {canExport && (
              <button
                type="button"
                onClick={() => void onSave()}
                className={`inbox-detail-save ${alreadySaved ? 'is-saved' : ''}`}
                disabled={saving || alreadySaved}
                title={alreadySaved ? 'Saved for later' : 'Save this report for later reuse'}
                aria-label={alreadySaved ? 'Saved for later' : 'Save this report for later'}
              >
                {alreadySaved ? (
                  <BookmarkCheck size={14} strokeWidth={1.75} />
                ) : (
                  <Bookmark size={14} strokeWidth={1.75} />
                )}
              </button>
            )}
          </div>
          <div className="inbox-detail-actions-group">
            {projectAlive && (
              <button
                type="button"
                onClick={() => setLauncherOpen(true)}
                className="inbox-detail-spawn"
                title="Spawn a new agent against this message"
                aria-label="Spawn a new agent seeded with this inbox entry"
              >
                <BotMessageSquare size={14} strokeWidth={1.75} />
              </button>
            )}
            {canExport && (
              <button
                type="button"
                onClick={() => void exportPdf()}
                className="inbox-detail-download"
                disabled={exporting}
                title="Download as PDF"
                aria-label="Download this inbox entry as PDF"
              >
                <Download size={14} strokeWidth={1.75} />
              </button>
            )}
            <button
              type="button"
              onClick={onDelete}
              className="inbox-detail-trash"
              title="Delete this entry (Delete / Backspace)"
              aria-label="Delete this inbox entry"
            >
              <Trash2 size={14} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </div>

      <div className="inbox-detail-title">{inboxPrimaryTitle(entry)}</div>

      {inboxContextLine(entry) && (
        <div className="inbox-detail-context" title="What the agent/user was trying to achieve">
          <span className="inbox-detail-context-label">Context</span>
          <span className="inbox-detail-context-text">{inboxContextLine(entry)}</span>
        </div>
      )}

      {/* A structured-question entry shows its question text INSIDE the
          "Your input" card (QuestionBlock `prompt`), so it's self-contained and
          the user sees what they're answering right above the options. Rendering
          the same `comments` here too would duplicate it, so suppress this
          standalone block for question entries. */}
      {hasComments && questionSet.length === 0 && (
        <div className="inbox-detail-comments">
          <MarkdownContent text={entry.comments!} exportable />
        </div>
      )}

      {hasDocs && (
        <div className={`inbox-detail-docs ${hasComments ? 'has-divider' : ''}`}>
          <DocExplorer
            docs={entry.docs!}
            project={aliveProject}
            originCwd={entry.origin?.cwd}
          />
        </div>
      )}

      {relatedSuggestions.length > 0 && (
        <RelatedNextSteps
          suggestions={relatedSuggestions}
          onOpen={() => {
            setNav('suggestions');
          }}
        />
      )}

      <div className="inbox-detail-footer">
        {projectAlive ? (
          <button
            type="button"
            onClick={() => void handleOpen()}
            className="inbox-detail-open"
            disabled={reopening}
          >
            <MessageSquare size={15} strokeWidth={1.75} />
            <span>
              {reopening ? (
                resumable ? (
                  <>Resuming…</>
                ) : (
                  <>Opening…</>
                )
              ) : aliveSession ? (
                <>
                  Open in <span className="strong">{aliveSession.title}</span>…
                </>
              ) : resumable ? (
                <>
                  Resume <span className="strong">{deriveTitle(entry)}</span>…
                </>
              ) : sessionTombstoned ? (
                <>
                  Reopen in a new agent <span className="strong">{displayLabel}</span>…
                </>
              ) : (
                <>
                  Open <span className="strong">{displayLabel}</span>…
                </>
              )}
            </span>
            <ArrowRight size={15} strokeWidth={1.75} />
          </button>
        ) : (
          <div className="inbox-detail-open disabled">
            Project no longer exists — nowhere to open.
          </div>
        )}
      </div>

      {/* Answer surface — one deterministic decision (resolveAnswerSurface):
          • live   → the originating (or a reopened) session is alive → inject
                     the answer into its pty.
          • reopen → no live session but the project survives → deliver by
                     reopening the agent (resume, or a fresh seeded agent) with
                     the answer as its opening turn. Covers BOTH a tombstoned
                     session AND a question-shaped entry that never had a
                     sessionId (e.g. a manual push phrased as a question) — the
                     case the old session-liveness ternary dropped to `null`.
                     A plain report shows a quiet "Reply…" button first so every
                     report doesn't sprout a textarea; a real question auto-opens.
          • none   → project gone → honest disabled panel, never a blank node. */}
      {deliveryMode === 'live' && aliveSession ? (
        questionSet.length > 0 ? (
          <QuestionBlock
            key={entry.id}
            entry={entry}
            questions={questionSet}
            prompt={entry.comments}
            sessionId={aliveSession.id}
            sessionTitle={aliveSession.title}
          />
        ) : (
          <ReplyBox entry={entry} sessionId={aliveSession.id} sessionTitle={aliveSession.title} />
        )
      ) : deliveryMode === 'reopen' ? (
        showReopenBox ? (
          questionSet.length > 0 ? (
            <QuestionBlock
              key={entry.id}
              entry={entry}
              questions={questionSet}
              prompt={entry.comments}
              sessionTitle={sessionTitleForTombstone(entry)}
              onAnswerDeadSession={answerOnDeadSession}
              deadSessionBusy={reopening}
            />
          ) : (
            <ReplyBox
              entry={entry}
              sessionTitle={sessionTitleForTombstone(entry)}
              onAnswerDeadSession={answerOnDeadSession}
              deadSessionBusy={reopening}
            />
          )
        ) : (
          <div className="inbox-reply">
            <button
              type="button"
              className="inbox-reply-again"
              onClick={() => setReplyExpanded(true)}
            >
              Reply / pick this back up…
            </button>
          </div>
        )
      ) : answerable ? (
        // mode === 'none' AND the entry is a question: the project is gone so
        // there's nowhere to route an answer, but a question must never render a
        // blank surface — show an honest explanation instead of nothing.
        <div className="inbox-reply">
          <div className="inbox-detail-open disabled">
            This project no longer exists — there's no agent to route an answer to.
          </div>
        </div>
      ) : null}

      <div className="inbox-detail-meta-id">project: {entry.projectId}</div>

      {launcherOpen && aliveProject && (
        <AgentLauncher
          project={aliveProject}
          initialPrompt={buildSpawnPrompt(entry)}
          onClose={() => setLauncherOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * "Related next steps" — the pointer FROM an inbox entry TO the Next Steps
 * launcher. An agent that reports to the inbox AND proposes a runnable next step
 * via `suggest_action` under the SAME `dedupeKey` links the two surfaces
 * implicitly (shared `(projectId, dedupeKey)` — no cross-reference field). This
 * renders the matches as compact chips that jump to the Next Steps view, so a
 * user reading a report can navigate straight to the action it produced.
 *
 * Chips only navigate — they never Run (that stays a deliberate, re-authorized
 * action in the Next Steps view itself). Hidden entirely when nothing matches.
 */
function RelatedNextSteps({
  suggestions,
  onOpen
}: {
  suggestions: Suggestion[];
  onOpen: () => void;
}) {
  return (
    <div className="inbox-related">
      <div className="inbox-related-label">
        <Sparkles size={12} strokeWidth={2} aria-hidden />
        {suggestions.length === 1 ? 'Related next step' : `Related next steps · ${suggestions.length}`}
      </div>
      <div className="inbox-related-chips">
        {suggestions.map((sug) => (
          <button
            key={sug.id}
            type="button"
            className="inbox-related-chip"
            onClick={onOpen}
            title={sug.detail?.trim() || 'Open in Next Steps'}
          >
            <span className="inbox-related-chip-title">{sug.title}</span>
            {(sug.occurrences ?? 0) > 1 && (
              <span className="inbox-related-chip-count">×{sug.occurrences}</span>
            )}
            <ArrowRight size={12} strokeWidth={1.75} aria-hidden />
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Reply-back box — the write-half of the inbox question loop.
 *
 * TWO modes, chosen by the caller from session liveness:
 *  • LIVE (`sessionId` set) — the originating (or reopened) tab is running;
 *    inject the typed answer into its pty via `replyToInboxEntry`, so an agent
 *    that pushed a question via `inbox_push` and blocked for input gets the
 *    answer without the user leaving the inbox.
 *  • DEAD (`onAnswerDeadSession` set, no `sessionId`) — the originating session
 *    has ended; there's no pty to write to, so the answer REOPENS the agent
 *    (resume / fresh) with the text as its opening turn. Same box, same submit
 *    affordance — the delivery path differs, handled by the caller.
 *
 * ⌘/Ctrl+Enter submits (Enter alone inserts a newline — replies can be
 * multi-line). Once sent, the entry is marked answered and the box collapses
 * to a confirmation line; the user can reply again via the "reply again" link
 * if the agent asks a follow-up on the same session.
 */
function ReplyBox({
  entry,
  sessionId,
  sessionTitle,
  onAnswerDeadSession,
  deadSessionBusy = false
}: {
  entry: InboxEntry;
  /** The LIVE session to inject into — the originating tab, or a reopened one.
   *  Absent in dead-session mode (the session ended); then `onAnswerDeadSession`
   *  carries the answer by reopening the agent. */
  sessionId?: string;
  sessionTitle: string;
  /** Dead-session delivery: reopen the agent with the answer as its first turn.
   *  Set (with no `sessionId`) when the originating session has ended. */
  onAnswerDeadSession?: (answer: string) => Promise<boolean>;
  /** True while a reopen is in flight (disables submit in dead-session mode). */
  deadSessionBusy?: boolean;
}) {
  const answered = useInboxAnswered((s) => !!s.answeredIds[entry.id]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [reopened, setReopened] = useState(false);

  const dead = !sessionId && !!onAnswerDeadSession;
  const busy = sending || deadSessionBusy;
  const collapsed = answered && !reopened;

  const submit = async () => {
    if (busy || !text.trim()) return;
    setSending(true);
    const ok = dead
      ? await onAnswerDeadSession!(text)
      : await replyToInboxEntry(entry.id, sessionId!, text);
    setSending(false);
    if (ok) {
      setText('');
      setReopened(false);
    }
  };

  if (collapsed) {
    return (
      <div className="inbox-reply answered">
        <span className="inbox-reply-answered-label">
          <CornerDownLeft size={13} strokeWidth={1.75} />
          Replied to <span className="strong">{sessionTitle}</span>
        </span>
        <button
          type="button"
          className="inbox-reply-again"
          onClick={() => setReopened(true)}
        >
          Reply again
        </button>
      </div>
    );
  }

  return (
    <div className="inbox-reply">
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
        placeholder={`Reply to ${sessionTitle}…`}
        aria-label="Reply to the originating terminal session"
      />
      <div className="inbox-reply-actions">
        <span className="inbox-reply-hint">⌘↵ to send</span>
        <button
          type="button"
          className="inbox-reply-send"
          onClick={() => void submit()}
          disabled={busy || !text.trim()}
        >
          <Send size={13} strokeWidth={1.75} />
          {busy ? (dead ? 'Reopening…' : 'Sending…') : dead ? 'Reopen & send' : 'Send'}
        </button>
      </div>
    </div>
  );
}

/**
 * File-explorer view of an entry's docs: a compact file list (basename + dir
 * subpath, one line each) on the left, and a single live preview pane on the
 * right for the selected file. Replaces the old stack of one-big-card-per-doc,
 * which turned a multi-doc entry (or a batch of 404s) into a wall of repeated
 * error boxes. A lone doc skips the list and previews directly.
 *
 * Each doc's fetch/resolve state is loaded lazily by {@link DocPreview} when it
 * becomes the selected file, so opening an entry doesn't fan out N reads at once.
 */
function DocExplorer({
  docs,
  project,
  originCwd
}: {
  docs: InboxDoc[];
  project: Project | null;
  originCwd?: string;
}) {
  const [selectedPath, setSelectedPath] = useState(docs[0]?.path ?? '');
  // Keep selection valid if the entry (and its docs) changes under us.
  useEffect(() => {
    if (!docs.some((d) => d.path === selectedPath)) {
      setSelectedPath(docs[0]?.path ?? '');
    }
  }, [docs, selectedPath]);

  const selectedDoc = docs.find((d) => d.path === selectedPath) ?? docs[0] ?? null;
  const multi = docs.length > 1;

  return (
    <div className={`inbox-docs-explorer ${multi ? 'is-multi' : ''}`}>
      {multi && (
        <div className="inbox-docs-filelist" role="listbox" aria-label="Files in this message">
          {docs.map((doc) => {
            const { name, dir } = splitPath(doc.path);
            const on = doc.path === selectedPath;
            return (
              <button
                key={doc.path}
                type="button"
                role="option"
                aria-selected={on}
                className={`inbox-docs-fileitem ${on ? 'is-selected' : ''}`}
                onClick={() => setSelectedPath(doc.path)}
                title={doc.path}
              >
                <FileText size={13} strokeWidth={1.75} className="inbox-docs-fileicon" aria-hidden />
                <span className="inbox-docs-filename">{name}</span>
                {dir && <span className="inbox-docs-filedir">{dir}</span>}
              </button>
            );
          })}
        </div>
      )}
      {selectedDoc && (
        <DocPreview
          key={selectedDoc.path}
          project={project}
          doc={selectedDoc}
          originCwd={originCwd}
        />
      )}
    </div>
  );
}

/**
 * Render one doc, fetched live via product.fs.readFile against the project's
 * root path. Re-fetches on doc change. If the project is tombstoned (deleted)
 * we render a "project missing" message — without a project root, we have no
 * anchor to resolve the relative path.
 *
 * A slim header row (path + open-in actions) sits above the preview body. When
 * the reported path 404s, we ask main to RESOLVE it — agents often `cd` into a
 * subdir and report a path relative to there, so the file exists nearby under a
 * different relative path. On a hit we render/act on the resolved location and
 * note where it was actually found.
 */
function DocPreview({
  project,
  doc,
  originCwd
}: {
  project: Project | null;
  doc: InboxDoc;
  /** The originating agent's cwd, when captured — a resolution hint for main. */
  originCwd?: string;
}) {
  const [result, setResult] = useState<FsReadResult | null>(null);
  // The path we actually resolved the file at (project-root-relative). Defaults
  // to the reported path; updated when main relocates a 404'd doc.
  const [resolvedPath, setResolvedPath] = useState(doc.path);
  // True once main confirmed the file lives somewhere other than reported.
  const [relocated, setRelocated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setResolvedPath(doc.path);
    setRelocated(false);
    if (!project) {
      // No live project — show the tombstone after a microtask so the
      // "Loading" flash doesn't render.
      setResult({ ok: false, message: 'Project no longer exists' });
      return;
    }
    const projectPath = project.path;
    const load = async () => {
      const abs = joinPath(projectPath, doc.path);
      let r: FsReadResult;
      try {
        r = await product.fs.readFile(abs);
      } catch (err) {
        r = { ok: false, message: err instanceof Error ? err.message : 'Read failed' };
      }
      if (r.ok || cancelled) {
        if (!cancelled) setResult(r);
        return;
      }
      // Missing at the reported path — ask main to locate it (subdir / library /
      // origin cwd). On a hit, re-read at the resolved location.
      try {
        const found = await product.fs.resolveDoc(projectPath, doc.path, originCwd);
        if (cancelled) return;
        if (found.ok && found.rel) {
          setResolvedPath(found.rel);
          setRelocated(!!found.relocated);
          const r2 = await product.fs.readFile(joinPath(projectPath, found.rel));
          if (!cancelled) setResult(r2);
          return;
        }
      } catch {
        /* resolver failed — fall through to the original error */
      }
      if (!cancelled) setResult(r);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [project, doc.path, originCwd]);

  const pushToast = useUi((s) => s.pushToast);
  const canPreview = !!result && result.ok && typeof result.content === 'string';

  const absResolved = project ? joinPath(project.path, resolvedPath) : null;
  const openIn = async (target: 'finder' | 'cursor' | 'code') => {
    if (!absResolved) return;
    const r = await product.openers.openIn(target, absResolved);
    if (!r.ok) pushToast(r.message ?? `Failed to open in ${target}`, 'error');
  };
  const copyPath = async () => {
    if (!absResolved) return;
    try {
      const r = await product.clipboard.writeText(absResolved);
      if (!r.ok) throw new Error('write failed');
      pushToast('Path copied', 'info');
    } catch {
      pushToast('Could not copy path', 'error');
    }
  };

  return (
    <div className="inbox-doc-preview">
      <div className="inbox-doc-header">
        <FileText size={13} strokeWidth={1.75} className="inbox-doc-icon" aria-hidden />
        <span className="inbox-doc-path" title={resolvedPath}>{resolvedPath}</span>
        {relocated && (
          <span
            className="inbox-doc-relocated"
            title={`The entry reported "${doc.path}", but the file was found here.`}
          >
            relocated
          </span>
        )}
        {project && absResolved && (
          <DocActions
            onReveal={() => void openIn('finder')}
            onCursor={() => void openIn('cursor')}
            onCode={() => void openIn('code')}
            onCopy={() => void copyPath()}
            label={resolvedPath}
          />
        )}
      </div>
      <div className="inbox-doc-body">
        {result === null ? (
          <div className="inbox-doc-loading">Loading…</div>
        ) : canPreview ? (
          <DocContent path={resolvedPath} content={result!.content as string} exportable />
        ) : (
          <DocTombstone result={result!} project={project} />
        )}
      </div>
    </div>
  );
}

/**
 * Secondary "open the actual file" affordances for a doc row. A small cluster
 * of icon buttons — reveal in Finder, open in Cursor / VS Code, copy path.
 * These sit inside the (clickable) header, so each stops propagation to avoid
 * toggling the preview.
 */
function DocActions({
  onReveal,
  onCursor,
  onCode,
  onCopy,
  label
}: {
  onReveal: () => void;
  onCursor: () => void;
  onCode: () => void;
  onCopy: () => void;
  label: string;
}) {
  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  return (
    <div className="inbox-doc-actions">
      <button
        type="button"
        className="inbox-doc-open"
        onClick={stop(onReveal)}
        title="Reveal in Finder"
        aria-label={`Reveal ${label} in Finder`}
      >
        <FolderOpen size={12} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        className="inbox-doc-open"
        onClick={stop(onCursor)}
        title="Open in Cursor"
        aria-label={`Open ${label} in Cursor`}
      >
        <ExternalLink size={12} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        className="inbox-doc-open"
        onClick={stop(onCode)}
        title="Open in VS Code"
        aria-label={`Open ${label} in VS Code`}
      >
        <Code2 size={12} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        className="inbox-doc-open"
        onClick={stop(onCopy)}
        title="Copy absolute path"
        aria-label={`Copy path to ${label}`}
      >
        <Copy size={12} strokeWidth={1.75} />
      </button>
    </div>
  );
}

/**
 * Shown when a doc can't be rendered. For a genuine miss (the file isn't at the
 * reported path and main's resolver found nothing either) we make the dead end
 * actionable: a button to reveal the project folder in Finder so the user can
 * hunt for it themselves, rather than stranding them on a raw ENOENT string.
 */
function DocTombstone({
  result,
  project
}: {
  result: FsReadResult;
  project: Project | null;
}) {
  const pushToast = useUi((s) => s.pushToast);
  const missing = !result.binary && !result.truncated;
  const revealProject = async () => {
    if (!project) return;
    const r = await product.openers.openIn('finder', project.path);
    if (!r.ok) pushToast(r.message ?? 'Could not open the project folder', 'error');
  };
  return (
    <div className="inbox-doc-tombstone">
      <span>{docReadError(result)}</span>
      {missing && project && (
        <button type="button" className="inbox-doc-tombstone-action" onClick={() => void revealProject()}>
          <FolderOpen size={12} strokeWidth={1.75} />
          Reveal project folder
        </button>
      )}
    </div>
  );
}

/** Human-readable reason a doc read produced no renderable content. */
function docReadError(result: FsReadResult): string {
  if (result.binary) return 'File is binary — not rendered.';
  if (result.truncated) return 'File too large to render in inbox.';
  if (result.message) return result.message;
  return 'File could not be read.';
}

// ============================================================================
// Helpers
// ============================================================================

function joinPath(root: string, rel: string): string {
  // The renderer doesn't have access to Node's `path`. Inbox docs are
  // documented as relative paths against the project root. Strip any
  // leading slash to keep the join sane on both POSIX and Windows.
  const cleanRel = rel.replace(/^[/\\]+/, '');
  if (root.endsWith('/') || root.endsWith('\\')) return root + cleanRel;
  return `${root}/${cleanRel}`;
}

/**
 * Split a project-relative doc path into its basename and the directory prefix,
 * for a two-tone file-list row (bold name + dim dir). Trailing slashes are
 * stripped; a bare filename has an empty dir.
 */
function splitPath(rel: string): { name: string; dir: string } {
  const clean = rel.replace(/^[/\\]+/, '').replace(/[/\\]+$/, '');
  const idx = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  if (idx < 0) return { name: clean, dir: '' };
  return { name: clean.slice(idx + 1), dir: clean.slice(0, idx) };
}

/**
 * Derive a short, scannable title using the shared inbox presentation model
 * (subject -> origin title -> preview), capped for chips/buttons.
 */
function deriveTitle(entry: InboxEntry): string {
  return inboxShortTitle(entry);
}

/**
 * Session label shown in the answer form when the originating session has
 * ENDED. There's no live tab to name, so we surface the reopened agent's title
 * (`↺ <work>`) — the answer will land there once the reopen completes. Mirrors
 * the `↺ ${deriveTitle(entry)}` title the reopen paths mint.
 */
function sessionTitleForTombstone(entry: InboxEntry): string {
  return `↺ ${deriveTitle(entry)}`;
}

/**
 * Seed prompt for a FRESH reopened agent (branch 3): the old conversation is
 * gone, so hand the new agent the report the old one left in the inbox — the
 * doc paths (relative to the project root, exactly as the inbox stores them) and
 * the comments — so it can pick the thread back up. Kept plain-text and bounded;
 * the docs are pointers the agent reads itself, not pasted content.
 */
function buildSeedPrompt(entry: InboxEntry): string {
  const parts: string[] = [
    'Picking up earlier work. A previous agent in this project posted the following to the inbox and its session has since closed. Please continue from here.'
  ];
  const docs = entry.docs ?? [];
  if (docs.length > 0) {
    parts.push('', 'Related documents (paths relative to the project root):');
    for (const d of docs) parts.push(`- ${d.path}`);
  }
  const comments = (entry.comments ?? '').trim();
  if (comments) {
    // Bound the pasted comments so a huge report can't blow the opening prompt.
    const clipped = comments.length > 4000 ? `${comments.slice(0, 4000)}\n…(truncated)` : comments;
    parts.push('', 'What the previous agent reported:', clipped);
  }
  return parts.join('\n');
}

/**
 * Prompt for a NEW agent spawned against an inbox message (the header's
 * "spawn an agent" button). Unlike {@link buildSeedPrompt} (which frames a
 * reopen of a closed session), this frames a fresh agent picking up whatever
 * the message describes — the doc paths (relative to the project root) and the
 * comments — as its opening context. The user can edit it before launching.
 */
function buildSpawnPrompt(entry: InboxEntry): string {
  const parts: string[] = [
    'Act on the following inbox message from this project.'
  ];
  const docs = entry.docs ?? [];
  if (docs.length > 0) {
    parts.push('', 'Related documents (paths relative to the project root):');
    for (const d of docs) parts.push(`- ${d.path}`);
  }
  const comments = (entry.comments ?? '').trim();
  if (comments) {
    const clipped = comments.length > 4000 ? `${comments.slice(0, 4000)}\n…(truncated)` : comments;
    parts.push('', 'Message:', clipped);
  }
  return parts.join('\n');
}

function formatAbsolute(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
