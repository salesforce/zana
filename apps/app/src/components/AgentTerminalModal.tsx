import { product } from '../lib/product-client.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { X, Square, Inbox, Loader2, RefreshCw, TerminalSquare, FileDiff, FileText, Sparkles, MailCheck, BellOff, Maximize2, Minimize2 } from 'lucide-react';
import { inboxQuestions } from '@zana-ai/zcc-domain/product';
import type { AgentState, InboxEntry, TerminalSession } from '@zana-ai/zcc-domain/product';
import { profileIcon, personaIcon } from '../lib/profileIcon.js';
import { isClaudeProfile } from '../lib/launchProfile.js';
import { providerCapabilities } from '@zana-ai/zcc-domain/launch-provider';
import { useData, usePersonas, useAgentStatus, useCatchUpSummary, useAgentPanel, useSubagents, useOverseerActivity, useIdleTriage, useInbox, useInboxAnswered } from '../store.js';
import { idleSurfacesToNeedsYou } from './AgentBoard.js';
import { inboxPrimaryTitle } from '../lib/inboxPresentation.js';
import { QuestionBlock } from './InboxQuestionBlock.js';
import { AGENT_MODAL_TERMINAL_ANCHOR_ID } from './TerminalSurface.js';
import { AgentDetailPanel } from './AgentDetailPanel.js';
import { AgentDiffPanel } from './AgentDiffPanel.js';
import { AgentReportPanel } from './AgentReportPanel.js';
import { useSessionStats } from './AgentInsights.js';
import { FavoriteStar } from './FavoriteStar.js';
import { TaskShelvesPopover } from './TaskShelvesPopover.js';
import { buildShelves } from '../lib/taskShelves.js';
import { MarkdownContent } from './MarkdownContent.js';
import { mdToPlainText } from '../lib/plainText.js';
import { isReport } from '@zana-ai/zcc-domain/feed-categories';

/**
 * Agent-inspector modal: a peek at one agent's LIVE terminal plus its metadata,
 * opened by clicking a tray row or a board card. The terminal itself is not
 * re-created here — TerminalSurface portals the session's already-live xterm
 * into the {@link AGENT_MODAL_TERMINAL_ANCHOR_ID} anchor below (the
 * one-xterm-per-session invariant), so scrollback is shared with the agent's
 * workspace tab rather than duplicated.
 */

const STATE_LABEL: Record<AgentState, string> = {
  blocked: 'Needs you',
  working: 'Working',
  idle: 'Idle',
  done: 'Done',
  unknown: 'Idle'
};

interface Props {
  session: TerminalSession;
  projectId: string;
  projectName: string;
  projectColor?: string;
  projectRemote?: boolean;
  state: AgentState;
  onClose: () => void;
}

export function AgentTerminalModal({
  session,
  projectId,
  projectName,
  projectColor,
  projectRemote = false,
  state,
  onClose
}: Props) {
  // PERF FIX: wrap array selector in useShallow to prevent re-renders when the
  // array content is unchanged (personas is an array).
  const personas = usePersonas(useShallow((s) => s.personas));
  const heartbeatEnabled = useData((s) => s.heartbeatEnabled);
  const panelCollapsed = useAgentPanel((s) => s.collapsed.modal);
  const togglePanel = useAgentPanel((s) => s.toggle);
  const ref = useRef<HTMLDivElement | null>(null);

  // The stage shows the live terminal, the working-tree diff, or this agent's
  // reports. The terminal's xterm anchor stays mounted in every mode (the
  // one-xterm-per-session invariant — TerminalSurface portals into it and
  // re-parenting/unmounting it would tear down the live view); diff/report
  // overlay the stage and the anchor is just hidden behind them. Default to
  // the terminal.
  const [stageView, setStageView] = useState<'terminal' | 'diff' | 'report'>('terminal');

  // Full screen: the modal already sizes to ~94vh, so the CSS side just
  // stretches it to fill the viewport and hides its rounded-corner chrome — no
  // new terminal/anchor is created (same live xterm, just a bigger box). The
  // button ALSO drives the OS window into real fullscreen (Electron
  // `win.setFullScreen`, over the `app.setFullScreen` IPC) so the whole app —
  // not just this modal — goes edge-to-edge, matching what a user expects from
  // a "full screen" control. `onFullScreenChanged` keeps this in sync when the
  // OS state changes from elsewhere (the green traffic-light button, a
  // fullscreen keyboard shortcut).
  const [fullScreen, setFullScreen] = useState(false);
  const fullScreenRef = useRef(false);
  fullScreenRef.current = fullScreen;
  useEffect(() => product.app.onFullScreenChanged(setFullScreen), []);
  const toggleFullScreen = () => {
    const next = !fullScreen;
    setFullScreen(next);
    void product.app.setFullScreen(next);
  };
  // Leaving the modal shouldn't strand the user in OS fullscreen — drop it on
  // unmount if THIS control put the window there.
  useEffect(() => {
    return () => {
      if (fullScreenRef.current) void product.app.setFullScreen(false);
    };
  }, []);

  // Drive the live "running for X" timer the same way the board does: a 1s tick
  // while the agent is live, recomputed from createdAt at render.
  const exited = session.status === 'exited';
  const [, setTick] = useState(0);
  useEffect(() => {
    if (exited) return;
    const id = setInterval(() => setTick((n) => (n + 1) % 1_000_000), 1000);
    return () => clearInterval(id);
  }, [exited]);

  // Mount-only: grab focus ONCE. Must not depend on any per-render value —
  // otherwise the 1s tick and agent status polling re-run this ~once/second and
  // node.focus() repeatedly yanks focus off the live xterm the user is typing
  // into. Escape is intentionally NOT intercepted here: it must reach the
  // embedded terminal as Claude's interrupt. The dismiss chord is ⌘. (see
  // shortcuts.ts); backdrop-click and the X button also close the modal.
  useEffect(() => {
    ref.current?.focus();
  }, []);

  // Heartbeat is offered only when the master switch is on, the profile can
  // actually wire the idle-nudge hooks (a shell can't), the session is live and
  // FOREGROUND — a background agent (scheduled/hidden) is detached work we never
  // auto-nudge, so the toggle is hidden for it.
  const canHeartbeat =
    heartbeatEnabled &&
    providerCapabilities(session.profile).supportsHooks &&
    !exited &&
    !session.scheduled &&
    !session.headless;
  const toggleHeartbeat = () => {
    void useData.getState().setHeartbeat(session.id, projectId, !session.heartbeat);
  };

  const persona = session.personaId
    ? personas.find((p) => p.id === session.personaId)
    : undefined;
  const subtitle = persona?.name ?? session.profile;

  // The agent's transcript-derived write-set — the absolute paths it actually
  // Wrote/Edited (op 'C'/'W'; a bare 'R' read doesn't change a file, so it's
  // excluded). We pass this to the Changes tab so it shows only what THIS agent
  // touched, not the whole repo's dirty tree. `null` when there's no transcript
  // signal (a shell session, or stats not yet loaded) ⇒ the diff falls back to
  // the full working tree rather than hiding everything.
  const stats = useSessionStats(session.id, projectId, exited);
  // Count of this agent's flagged reports (inbox_push({ report: true }) on the
  // session-scoped MCP route, which stamps sessionId) — shown as a badge on the
  // Report tab so it's clear at a glance whether there's anything to see.
  const inboxEntries = useInbox((s) => s.entries);
  const reportCount = useMemo(
    () => inboxEntries.filter((e) => e.sessionId === session.id && isReport(e)).length,
    [inboxEntries, session.id]
  );
  const project = useData((s) => s.projects.find((p) => p.id === projectId) ?? null);
  const writeScope = useMemo(() => {
    // No stats object at all ⇒ no transcript signal (shell session, or the
    // first read hasn't resolved) ⇒ null ⇒ full working tree. But a LOADED
    // transcript that simply contains no writes is a real signal ("this agent
    // changed nothing"), so we return an (empty) Set, not null — otherwise a
    // read-only agent would fall back to showing the whole repo again.
    if (!stats) return null;
    return new Set(stats.files.filter((f) => f.op !== 'R').map((f) => f.path));
  }, [stats]);

  // Task Shelves (afl-04): a compact ledger of this agent's Sources / Background
  // / Outputs, derived PURELY from signals the renderer already holds — the
  // polled file touches, the live sub-agent count, the overseer activity stream,
  // and the agent's rollup state. Read-only; the popover lives in the header.
  const subagentCount = useSubagents((s) => s.byId[session.id] ?? 0);
  const overseer = useOverseerActivity((s) => s.byId[session.id]);
  const shelves = useMemo(
    () =>
      buildShelves({
        files: stats?.files ?? [],
        subagentCount,
        overseer,
        session,
        agentState: state
      }),
    [stats, subagentCount, overseer, session, state]
  );
  // Row-click routes a Sources/Outputs file row to the working-tree diff;
  // background rows are informational (no file target), so they're a no-op.
  const onSelectShelfRow = (row: { id: string }) => {
    if (row.id.startsWith('R:') || row.id.startsWith('C:') || row.id.startsWith('W:')) {
      setStageView('diff');
    }
  };

  // Kill the agent's process from the modal. Mirrors the board card's delete:
  // a confirm guards a live session so a stray click can't silently terminate a
  // running agent. closeTerminal tears down the pty and drops the session, so we
  // close the modal afterwards (the live xterm it was peeking is now gone).
  const stopProcess = () => {
    if (!window.confirm(`Stop “${session.title}”? The process will be terminated.`)) return;
    void useData.getState().closeTerminal(session.id, projectId);
    onClose();
  };

  // Close the agent AND leave a paper trail: main summarizes its work to the
  // inbox and files a follow-up if it left something unfinished, THEN the store
  // closes it. Only claude-family sessions have a transcript to summarize, so
  // this is hidden for shells (mirrors "Summarize to inbox"). Guard the async
  // close against a double-click; close the modal once it kicks off.
  const [closingWithFollowup, setClosingWithFollowup] = useState(false);
  const closeWithFollowup = async () => {
    if (closingWithFollowup) return;
    if (!window.confirm(`Close “${session.title}” and file a follow-up if work is left?`)) return;
    setClosingWithFollowup(true);
    try {
      // Reuse the board's Close path with summarize=on: it folds a summary and
      // files a follow-up if work is left, then closes the one agent.
      await useData.getState().closeIdleAgents(projectId, [session.id], true);
    } finally {
      setClosingWithFollowup(false);
      onClose();
    }
  };

  // Summarize this agent's work to the inbox. Only claude-family sessions leave
  // a transcript to summarize, so the button is hidden for shells. The modal
  // stays open (the agent keeps running) — the result lands in the inbox feed,
  // and the store toasts the outcome. Guard against double-clicks while the
  // main-side LLM micro-call is in flight.
  // The manual "Summarize to inbox" button rides the same experimental toggle as
  // the auto catch-up summary card — one "Summary" switch governs both affordances.
  const summaryEnabled = useData((s) => s.catchUpSummaryEnabled);
  const canSummarize = summaryEnabled && isClaudeProfile(session.profile);
  const [summarizing, setSummarizing] = useState(false);
  const summarize = async () => {
    if (summarizing) return;
    setSummarizing(true);
    try {
      await useData.getState().summarizeSession(session.id, projectId);
    } finally {
      setSummarizing(false);
    }
  };

  // Re-tag a "Needs you" agent as Idle without touching the process. A card
  // reaches "Needs you" two ways: a sticky `blocked` overlay main set from the
  // notification hook, OR a triage-promoted idle verdict (advisory, renderer
  // side). Clear BOTH — drop the blocked flag in main (the same clear the Stop
  // hook does) and the triage slice here — so an agent the user has decided to
  // leave stops nagging in every fleet view regardless of which path promoted
  // it. Offered whenever the agent is live and currently surfacing for attention.
  const triageVerdict = useIdleTriage((s) => s.byId[session.id]);
  const sensitivity = useData((s) => s.idleAttentionSensitivity);
  const surfacingForAttention =
    !exited &&
    (state === 'blocked' ||
      (state !== 'working' &&
        !!triageVerdict &&
        idleSurfacesToNeedsYou(triageVerdict.resolution, triageVerdict.confidence ?? 0, sensitivity)));
  const markIdle = () => {
    void product.terminals.clearAgentBlocked(projectId, session.id);
    useIdleTriage.getState().clear(session.id);
  };

  // Modal action semantics differ from the monitor's: here "Stop process" is a
  // KILL (terminate + close the modal), matching the old footer button — not the
  // monitor's non-destructive Ctrl-C. Rendered with the shared action-button
  // class so the look matches inside the shared panel.
  const modalActions = (
    <>
      {surfacingForAttention && (
        <button
          type="button"
          className="agent-monitor-action"
          onClick={markIdle}
          title="Clear the “Needs you” flag and mark this agent as Idle. The process keeps running."
        >
          <BellOff size={13} /> Mark as Idle
        </button>
      )}
      {!exited && (
        <button
          type="button"
          className="agent-monitor-action danger"
          onClick={stopProcess}
          title="Terminate the agent's process and close this view"
        >
          <Square size={13} /> Close Session
        </button>
      )}
      {!exited && isClaudeProfile(session.profile) && (
        <button
          type="button"
          className="agent-monitor-action"
          onClick={closeWithFollowup}
          disabled={closingWithFollowup}
          title="Close the agent, summarising its work to your inbox and filing a follow-up if it left something unfinished"
        >
          {closingWithFollowup ? <Loader2 size={13} className="spin" /> : <MailCheck size={13} />}
          {closingWithFollowup ? 'Closing…' : 'Close with follow-up'}
        </button>
      )}
      {canSummarize && (
        <button
          type="button"
          className="agent-monitor-action"
          onClick={summarize}
          disabled={summarizing}
          title="Summarize this agent's work and send it to your inbox"
        >
          {summarizing ? <Loader2 size={13} className="spin" /> : <Inbox size={13} />}
          {summarizing ? 'Summarizing…' : 'Summarize to inbox'}
        </button>
      )}
    </>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={ref}
        data-testid="agent-terminal-modal"
        className={`modal agent-terminal-modal ${fullScreen ? 'is-fullscreen' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Agent ${session.title}`}
        tabIndex={-1}
      >
        <header className="modal-header agent-modal-header">
          <span
            className={`agent-modal-icon tab-profile-icon profile-${session.profile}`}
          >
            {persona ? personaIcon(persona, 15) : profileIcon(session.profile, 15)}
          </span>
          <span className="agent-modal-heading">
            <span className="agent-modal-title">{session.title}</span>
            <span className="agent-modal-sub">{subtitle}</span>
          </span>
          {!exited && (
            <span
              className={`agent-modal-state agent-${state}`}
              data-testid="agent-modal-state"
              data-state={state}
            >
              <span className={`tab-agent-dot agent-${state}`} aria-hidden="true" />
              {STATE_LABEL[state]}
            </span>
          )}
          <div className="agent-modal-stage-toggle" role="tablist" aria-label="Stage view">
            <button
              type="button"
              role="tab"
              aria-selected={stageView === 'terminal'}
              className={stageView === 'terminal' ? 'is-active' : ''}
              onClick={() => setStageView('terminal')}
              title="Live terminal"
            >
              <TerminalSquare size={13} /> Terminal
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={stageView === 'diff'}
              className={stageView === 'diff' ? 'is-active' : ''}
              onClick={() => setStageView('diff')}
              title="Working-tree changes"
            >
              <FileDiff size={13} /> Changes
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={stageView === 'report'}
              className={stageView === 'report' ? 'is-active' : ''}
              onClick={() => setStageView('report')}
              title="Reports this agent pushed to your inbox"
            >
              <FileText size={13} /> Report
              {reportCount > 0 && <span className="agent-modal-stage-toggle-count">{reportCount}</span>}
            </button>
          </div>
          <TaskShelvesPopover shelves={shelves} onSelectRow={onSelectShelfRow} />
          <FavoriteStar session={session} size={16} className="agent-modal-fav" />
          <button
            className="icon-button"
            onClick={toggleFullScreen}
            aria-label={fullScreen ? 'Exit full screen' : 'Full screen'}
            title={fullScreen ? 'Exit full screen' : 'Full screen'}
          >
            {fullScreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        {/* Body: the live terminal (with its catch-up card) beside the shared
            agent detail panel — the same panel the List-view monitor renders, so
            the two surfaces can't drift. The panel is collapsible; collapsed, it
            folds to a thin rail and the terminal claims the width. */}
        <div className={`agent-modal-body ${panelCollapsed ? 'panel-collapsed' : ''}`}>
          <section className="agent-modal-stage">
            {/* A blocking inbox question this agent raised — surfaced IN the
                modal so the user answers it in-context (the quiet-questions
                feature: a held question flushes to the inbox on idle, and when
                the user opens the agent it also appears right here). Answering
                injects into this live session via the same channel the inbox
                detail pane uses. Only shown on the terminal stage. */}
            {stageView === 'terminal' && <ModalPendingQuestion session={session} />}
            {/* TerminalSurface portals the session's live xterm into this anchor
                while the modal is open (see AGENT_MODAL_TERMINAL_ANCHOR_ID). The
                anchor stays mounted (and keeps its size) in both stage views —
                the diff is an opaque overlay ON TOP of it rather than a swap, so
                the live terminal is never torn down or forced to a zero-size
                refit (one-xterm-per-session invariant). */}
            <div className="agent-modal-terminal" id={AGENT_MODAL_TERMINAL_ANCHOR_ID} />
            {stageView === 'diff' && (
              <div className="agent-modal-diff">
                <AgentDiffPanel cwd={session.cwd} isRemote={projectRemote} exited={exited} scope={writeScope} />
              </div>
            )}
            {stageView === 'report' && (
              <div className="agent-modal-diff agent-modal-report">
                <AgentReportPanel sessionId={session.id} project={project} />
              </div>
            )}
            {stageView === 'terminal' && (
              <CatchUpSummaryCard sessionId={session.id} projectId={projectId} state={state} />
            )}
          </section>

          <AgentDetailPanel
            variant="modal"
            showIdentity={false}
            session={session}
            projectId={projectId}
            projectName={projectName}
            projectColor={projectColor}
            state={state}
            showProject
            background={session.scheduled}
            heartbeat={
              canHeartbeat
                ? { checked: session.heartbeat ?? false, onToggle: toggleHeartbeat }
                : null
            }
            actions={modalActions}
            collapsed={panelCollapsed}
            onToggleCollapse={() => togglePanel('modal')}
            maxFiles={6}
            maxQueue={5}
            stats={stats}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * The blocking inbox question(s) this agent raised, rendered inside the modal so
 * the user answers in-context. This closes the loop with the "quiet questions"
 * feature: a blocking question is HELD while the agent works and flushed to the
 * inbox when it goes idle — and when the user then opens the agent to see what's
 * up, the same question also appears right here on the terminal stage.
 *
 * It reuses the SAME {@link QuestionBlock} form (and its answer-injection path)
 * as the inbox detail pane, so answering here or there is identical. We surface
 * ONLY:
 *  - the entry originating from THIS live session (`entry.sessionId === session.id`),
 *  - that actually carries a structured question,
 *  - that hasn't been answered yet.
 * The newest matching entry wins (agents rarely stack questions on one session;
 * if they do, the latest is the one waiting). Renders nothing otherwise, so a
 * plain working agent's modal is unchanged.
 */
function ModalPendingQuestion({ session }: { session: TerminalSession }) {
  const structuredQuestions = useData((s) => s.structuredQuestionsEnabled);
  // Select the STABLE entries array (a filtering selector returns a fresh array
  // each render → the zustand infinite-loop trap) and filter under useMemo.
  const entries = useInbox((s) => s.entries);
  const answeredIds = useInboxAnswered((s) => s.answeredIds);

  const pending = useMemo<InboxEntry | null>(() => {
    if (!structuredQuestions) return null;
    // entries are newest-first, so the first match is the latest question.
    return (
      entries.find(
        (e) =>
          e.sessionId === session.id &&
          !answeredIds[e.id] &&
          inboxQuestions(e).length > 0
      ) ?? null
    );
  }, [structuredQuestions, entries, answeredIds, session.id]);

  if (!pending) return null;
  const questions = inboxQuestions(pending);
  if (questions.length === 0) return null;

  // The actual question text. In single-question `inbox_ask` mode the question
  // lives in `comments` (the `question` field holds only the lettered options);
  // in multi-question mode `comments` is the shared preamble and each question
  // renders its own prompt inside the card. We pass it as the QuestionBlock's
  // `prompt` so the card is SELF-CONTAINED — the user sees WHAT they're answering
  // right above the options — instead of relying on a separate heading above the
  // card. `inboxPrimaryTitle` (subject / session task title) is only a fallback
  // when the entry carries no question text of its own.
  const questionText = (pending.comments ?? '').trim();

  return (
    <div className="agent-modal-question">
      <QuestionBlock
        key={pending.id}
        entry={pending}
        questions={questions}
        prompt={questionText || inboxPrimaryTitle(pending)}
        sessionId={session.id}
        sessionTitle={session.title}
      />
    </div>
  );
}

/**
 * Catch-up summary affordance — a small icon pinned to the top-right of the
 * terminal stage in the agent modal. It surfaces ONLY when the agent sits idle
 * or blocked long enough for the add-on to generate a summary; clicking the icon
 * opens a popover with the full summary (the same content that used to sit in a
 * full-width card above the terminal). Gated by THREE conditions: config flag ON,
 * agent in a trigger state (idle/blocked), and enough dwell time. Precomputed
 * background work (builtin:catch-up-summary), so the popover just displays the
 * result main already generated and pushed.
 */
function CatchUpSummaryCard({
  sessionId,
  projectId,
  state
}: {
  sessionId: string;
  projectId: string;
  state: AgentState;
}) {
  const enabled = useData((s) => s.catchUpSummaryEnabled);
  const delaySeconds = useData((s) => s.catchUpSummaryDelaySeconds);
  const result = useCatchUpSummary((s) => s.bySession[sessionId]);
  const since = useAgentStatus((s) => s.since[sessionId]);
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Dismiss the popover on an outside click or Escape, so it behaves like a
  // lightweight menu rather than a sticky panel.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Gate: config off, or agent not in a trigger state, or no dwell yet.
  if (!enabled) return null;
  if (state !== 'idle' && state !== 'blocked') return null;

  const dwellMs = since ? Date.now() - since : 0;
  const dwellSec = Math.floor(dwellMs / 1000);
  // If no result yet and dwell is short, don't show anything (the timer hasn't
  // fired). Shimmer threshold is half the configured delay (or 10s min) to avoid
  // showing the icon well before the backend can possibly fire.
  const shimmerThreshold = Math.max(10, Math.floor((delaySeconds ?? 20) / 2));
  const pending = !result && dwellSec >= shimmerThreshold;
  if (!result && !pending) return null;

  const failed = !!result && !result.ok;

  // Dismiss handler: clear the result from the store so the icon vanishes.
  const onDismiss = () => {
    useCatchUpSummary.getState().clear(sessionId);
    setOpen(false);
  };

  // Retry/refresh handler: invoke the on-demand IPC and apply the result.
  const onRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const freshResult = await product.terminals.generateCatchUpSummary(
        projectId,
        sessionId
      );
      useCatchUpSummary.getState().apply(freshResult);
    } finally {
      setRefreshing(false);
    }
  };

  // Success: split the markdown into a headline (first line) + body (the rest).
  const lines = result && result.ok
    ? result.text.trim().split('\n').filter((ln: string) => ln.trim().length > 0)
    : [];
  // The headline sits in a plain-text slot, so flatten the first line's markdown
  // (a leading `## `, `**bold**`, backticks) instead of leaking the raw syntax.
  const headline = mdToPlainText(lines[0] || '') || 'Summary available';
  const body = lines.slice(1).join('\n');
  const hasBody = body.trim().length > 0;

  const iconTitle = pending
    ? 'Generating catch-up summary…'
    : failed
      ? "Couldn't generate a summary — click to retry"
      : 'Catch-up summary available';

  return (
    <div className="agent-modal-catchup" ref={rootRef}>
      <button
        type="button"
        className={`agent-modal-catchup-icon ${open ? 'is-open' : ''} ${pending ? 'is-pending' : ''} ${failed ? 'is-failed' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={iconTitle}
        aria-label={iconTitle}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        {pending ? (
          <Loader2 size={11} className="spin" />
        ) : (
          <Sparkles size={11} />
        )}
      </button>

      {open && (
        <div className="agent-modal-catchup-pop" role="dialog" aria-label="Catch-up summary">
          {failed ? (
            <div className="agent-modal-catchup-error">
              <span>Couldn't generate a summary.</span>
              <button
                type="button"
                className="agent-modal-catchup-refresh"
                onClick={onRefresh}
                disabled={refreshing}
                title="Retry"
                aria-label="Retry"
              >
                <RefreshCw size={12} className={refreshing ? 'spinning' : ''} />
              </button>
              <button
                type="button"
                className="agent-modal-catchup-dismiss"
                onClick={onDismiss}
                aria-label="Dismiss"
              >
                <X size={12} />
              </button>
            </div>
          ) : pending ? (
            <div className="agent-modal-catchup-shimmer" aria-hidden>
              <div className="agent-modal-catchup-skel-line" />
              <div className="agent-modal-catchup-skel-line short" />
            </div>
          ) : (
            <>
              <div className="agent-modal-catchup-head">
                <span className="agent-modal-catchup-headline">{headline}</span>
                <button
                  type="button"
                  className="agent-modal-catchup-refresh"
                  onClick={onRefresh}
                  disabled={refreshing}
                  title="Refresh summary"
                  aria-label="Refresh summary"
                >
                  <RefreshCw size={12} className={refreshing ? 'spinning' : ''} />
                </button>
                <button
                  type="button"
                  className="agent-modal-catchup-dismiss"
                  onClick={onDismiss}
                  aria-label="Dismiss"
                >
                  <X size={12} />
                </button>
              </div>
              {hasBody && (
                <div className="agent-modal-catchup-body">
                  <MarkdownContent text={body} />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
