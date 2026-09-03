import { useEffect, useState, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Puzzle, Trash2 } from 'lucide-react';
import { product } from '../lib/product-client.js';
import { useData, useIdleTriage } from '../store.js';
import { cardNeedsAttention, type AgentCard } from './AgentBoard.js';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';
import { isClaudeProfile } from '../lib/launchProfile.js';
import { resolveIcon } from '../lib/resolveIcon.js';
import { getScopedProjectId } from '../lib/windowScope.js';
import { openAgentSessionInSplit } from '../lib/split-layout/openThreadInSplit.js';
import { isCompactViewport } from '../hooks/useIsCompactViewport.js';
import { useRouteState } from '../hooks/useRouteState.js';
import {
  availableAgentCardActions,
  invokeAgentCardAction
} from '../plugins/plugin-agent-actions.js';
import { listAgentCardActions, subscribePluginSlots } from '../plugins/plugin-slots.js';

/**
 * Shared agent-card lifecycle actions + right-click menu, used by the kanban
 * {@link AgentBoardLanes}. Extracted so actions drive the SAME real pty (no
 * parallel kill path) and expose a consistent menu — a card behaves identically
 * whether you right-click it in a lane or view its details.
 */

/** Open right-click menu: which card + where to anchor it (viewport coords). */
export interface CardMenu {
  card: AgentCard;
  x: number;
  y: number;
}

export interface AgentCardActions {
  /** Interrupt a running agent (Ctrl-C). Non-destructive — session stays alive. */
  stop: (c: AgentCard) => void;
  /** Stop the process and relaunch with the same profile/args (confirms while live). */
  restart: (c: AgentCard) => void;
  /**
   * Re-attach a REMOTE tombstone whose `ssh` proxy died during sleep — spawns a
   * fresh local pty that re-attaches the live `cc-<id>` tmux session on the box
   * (or resumes the transcript when it's gone). The manual fallback for the
   * auto-reconnect-on-wake path. No confirm (non-destructive: the tombstone is a
   * dead pty already). Meaningful only for exited remote sessions.
   */
  reconnect: (c: AgentCard) => void;
  /** Detach a foreground agent to background, or pull a headless one forward. */
  toggleBackground: (c: AgentCard) => void;
  /**
   * Drop a card out of the "Needs you" lane WITHOUT touching the process. Clears
   * BOTH ways a card gets there: the sticky `blocked` overlay (the same clear the
   * Stop hook does, via main) AND a triage-promoted idle verdict (dropped from the
   * renderer triage slice, since main only re-triages on the next idle edge). Lets
   * you dismiss the nag for an agent you've decided to leave.
   */
  clearBlocked: (c: AgentCard) => void;
  rename: (c: AgentCard) => void;
  /**
   * Close a live Claude-family agent after summarizing to the inbox and filing
   * a follow-up if work is left. Same path as the agent-modal footer.
   */
  closeWithFollowup: (c: AgentCard) => void;
  /** Terminate + remove the card (confirms while live). */
  remove: (c: AgentCard) => void;
}

/** Live Claude-family sessions can leave a transcript; shells cannot. */
export function canCloseWithFollowup(
  session: Pick<TerminalSession, 'status' | 'profile'>
): boolean {
  return session.status !== 'exited' && isClaudeProfile(session.profile);
}

/** Live: terminate and remove. Exited: drop the card. */
export function cliAgentRemoveLabel(exited: boolean): 'Dismiss' | 'Delete' {
  return exited ? 'Dismiss' : 'Delete';
}

export function cliAgentDeleteConfirm(title: string): string {
  return `Delete “${title}”? The process will be terminated.`;
}

export function cliAgentRestartLiveTitle(): string {
  return 'Stop the process and relaunch this session with the same profile and args';
}

export function cliAgentRestartConfirm(title: string): string {
  return `Stop the process and relaunch "${title}"?`;
}

/**
 * Confirm, then fold a work summary (+ follow-up if unfinished) and close.
 * Returns false if the user cancelled. Callers that hide the control behind
 * {@link canCloseWithFollowup} still go through this so confirm copy and the
 * store call stay in one place.
 */
export async function closeAgentWithFollowup(
  session: Pick<TerminalSession, 'id' | 'title'>,
  projectId: string
): Promise<boolean> {
  if (!globalThis.confirm(`Close “${session.title}” and file a follow-up if work is left?`)) {
    return false;
  }
  await useData.getState().closeIdleAgents(projectId, [session.id], true);
  return true;
}

/**
 * Wires the card actions to the shared store (same methods the TabBar/sidebar
 * use) and owns the single open-menu state + its dismiss-on-outside-interaction
 * effect. Returns the menu state and the action set; the caller renders
 * {@link AgentCardMenu} with these.
 */
/** A rename the user initiated; drives the in-app {@link PromptModal}. */
export interface PendingRename {
  card: AgentCard;
}

export function useAgentCardActions(): {
  menu: CardMenu | null;
  setMenu: (m: CardMenu | null) => void;
  actions: AgentCardActions;
  /** Set when the user picks "Rename…"; render a PromptModal while non-null. */
  rename: PendingRename | null;
  /** Clear the rename modal (cancel). */
  closeRename: () => void;
  /** Commit a rename to the given trimmed value. */
  submitRename: (card: AgentCard, value: string) => void;
} {
  const closeTerminal = useData((s) => s.closeTerminal);
  const hideTerminal = useData((s) => s.hideTerminal);
  const restoreTerminal = useData((s) => s.restoreTerminal);
  const restartTerminal = useData((s) => s.restartTerminal);
  const reconnectRemote = useData((s) => s.reconnectRemote);
  const renameTerminal = useData((s) => s.renameTerminal);

  const [menu, setMenu] = useState<CardMenu | null>(null);
  const [rename, setRename] = useState<PendingRename | null>(null);

  // Dismiss the menu on any outside interaction — mirrors the TabBar menu:
  // mousedown anywhere, window blur, or any keypress closes it. The menu itself
  // stops mousedown propagation so a click inside doesn't self-close before the
  // action fires.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', close);
    };
  }, [menu]);

  const actions: AgentCardActions = {
    stop: (c) => {
      void product.terminals.write(c.session.id, '\x03').catch(() => {});
    },
    restart: (c) => {
      const live = c.session.status !== 'exited';
      if (
        live &&
        !window.confirm(`Restart “${c.session.title}”? The current process is terminated and relaunched.`)
      ) {
        return;
      }
      void restartTerminal(c.session.id, c.projectId);
    },
    reconnect: (c) => {
      void reconnectRemote(c.session.id, c.projectId);
    },
    toggleBackground: (c) => {
      if (c.session.headless) void restoreTerminal(c.session.id, c.projectId);
      else void hideTerminal(c.session.id, c.projectId);
    },
    clearBlocked: (c) => {
      // Blocked overlay lives in main (authorize there); the triage promotion is
      // a renderer-side advisory slice — clear both so the card leaves the lane
      // regardless of which path put it there.
      void product.terminals.clearAgentBlocked(c.projectId, c.session.id).catch(() => {});
      useIdleTriage.getState().clear(c.session.id);
    },
    // Open the in-app PromptModal — Electron's renderer disables window.prompt
    // (it throws "prompt() is not supported"). The caller renders the modal
    // from the returned `rename` state and calls submitRename on confirm.
    rename: (c) => {
      setRename({ card: c });
    },
    closeWithFollowup: (c) => {
      void closeAgentWithFollowup(c.session, c.projectId);
    },
    remove: (c) => {
      const live = c.session.status !== 'exited';
      // Closing the team LEAD (orchestrator) cascades: main tears down every
      // other live member of its cohort (the team dies with its lead). Warn
      // about that consequence so it's never a surprise — a plain worker/solo
      // close keeps the default single-session prompt.
      const isLead = c.session.cohort?.role === 'orchestrator';
      const message = isLead
        ? `Close “${c.session.title}”? It's the team lead — closing it will also stop every other agent in “${c.session.cohort?.teamName}”.`
        : cliAgentDeleteConfirm(c.session.title);
      if (live && !window.confirm(message)) {
        return;
      }
      void closeTerminal(c.session.id, c.projectId);
    }
  };

  const closeRename = () => setRename(null);
  const submitRename = (card: AgentCard, value: string) => {
    const v = value.trim();
    if (v && v !== card.session.title) renameTerminal(card.projectId, card.session.id, v);
    setRename(null);
  };

  return { menu, setMenu, actions, rename, closeRename, submitRename };
}

interface AgentCardMenuProps {
  menu: CardMenu;
  setMenu: (m: CardMenu | null) => void;
  actions: AgentCardActions;
  /** Navigate to the agent's workspace tab (the menu's "Open"/"View" item). */
  onPick: (c: AgentCard) => void;
}

/**
 * The card right-click menu. Reuses the TabBar context-menu styling so it
 * matches the rest of the app; stopPropagation on mousedown keeps the global
 * close-on-mousedown from firing before a button's onClick.
 */
export function AgentCardMenu({ menu, setMenu, actions, onPick }: AgentCardMenuProps) {
  const { card } = menu;
  const navigate = useNavigate();
  const location = useLocation();
  const route = useRouteState();
  const exited = card.session.status === 'exited';
  // A remote tombstone can be re-attached to its still-live tmux session on the
  // box (the sleep-recovery path), unlike a local exited session which is truly
  // dead — so show Reconnect only for exited sessions in a remote project.
  const isRemote = useData((s) => !!s.projects.find((p) => p.id === card.projectId)?.remote);
  const canReconnect = exited && isRemote;
  // "Mark as Idle" clears the "Needs you" lane. A card reaches that lane two ways
  // (see AgentBoard LANES): a real `blocked` overlay, OR a triage-promoted idle
  // agent (its state is `idle`, not `blocked`). Offer the action for BOTH so a
  // triaged card isn't stuck nagging — gate on the same predicate the lane uses.
  const sensitivity = useData((s) => s.idleAttentionSensitivity);
  const needsYou = !exited && (card.state === 'blocked' || cardNeedsAttention(card, sensitivity));
  const pluginSlots = useSyncExternalStore(subscribePluginSlots, listAgentCardActions, listAgentCardActions);
  const pluginCtx = { sessionId: card.session.id, projectId: card.projectId };
  const pluginActions = availableAgentCardActions(pluginSlots, pluginCtx);
  return (
    <div
      className="tab-context-menu"
      style={{ top: menu.y, left: menu.x }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button onClick={() => { setMenu(null); onPick(card); }}>{exited ? 'View' : 'Open'}</button>
      <button
        type="button"
        onClick={() => {
          setMenu(null);
          openAgentSessionInSplit({
            navigate,
            projectId: route.isProjectFocused
              ? route.focusedProjectId
              : (getScopedProjectId() ?? null),
            sessionId: card.session.id,
            isCompact: isCompactViewport(),
            currentPathname: location.pathname
          });
        }}
      >
        Open in split
      </button>
      {canReconnect && (
        <button
          onClick={() => { setMenu(null); actions.reconnect(card); }}
          title="Re-attach the live session on the remote host (or resume it) — recovers a remote agent whose connection dropped while your machine slept"
        >
          Reconnect
        </button>
      )}
      {!exited && (
        <button
          onClick={() => { setMenu(null); actions.stop(card); }}
          title="Send Ctrl-C to interrupt the agent. The session stays alive."
        >
          Stop
        </button>
      )}
      {needsYou && (
        <button
          onClick={() => { setMenu(null); actions.clearBlocked(card); }}
          title="Clear the “Needs you” flag and mark this agent as Idle. The process keeps running."
        >
          Mark as Idle
        </button>
      )}
      <button
        onClick={() => { setMenu(null); actions.restart(card); }}
        title={
          exited
            ? 'Relaunch this session with the same profile and args'
            : cliAgentRestartLiveTitle()
        }
      >
        {exited ? 'Restart' : 'Restart…'}
      </button>
      {!exited && (
        <button
          onClick={() => { setMenu(null); actions.toggleBackground(card); }}
          title={
            card.session.headless
              ? 'Bring this agent back into the tab strip'
              : 'Detach this agent to the background — keeps running headless'
          }
        >
          {card.session.headless ? 'Bring to foreground' : 'Send to background'}
        </button>
      )}
      <button onClick={() => { setMenu(null); actions.rename(card); }}>Rename…</button>
      {canCloseWithFollowup(card.session) && (
        <button
          onClick={() => { setMenu(null); actions.closeWithFollowup(card); }}
          title="Close the agent, summarising its work to your inbox and filing a follow-up if it left something unfinished"
        >
          Close with follow-up
        </button>
      )}
      {pluginActions.length > 0 ? <div className="tab-context-sep" /> : null}
      {pluginActions.map((slot) => {
        const Icon = slot.icon ? resolveIcon(slot.icon) : Puzzle;
        return (
          <button
            key={`${slot.pluginId}/${slot.id}`}
            type="button"
            data-testid={`agent-card-plugin-${slot.pluginId}-${slot.id}`}
            onClick={() => {
              setMenu(null);
              invokeAgentCardAction(slot, pluginCtx);
            }}
          >
            <Icon size={14} aria-hidden="true" />
            {slot.title}
          </button>
        );
      })}
      <div className="tab-context-sep" />
      <button
        className="tab-context-danger"
        onClick={() => { setMenu(null); actions.remove(card); }}
        title={
          exited
            ? 'Dismiss this finished agent from the board'
            : 'Terminate this agent and remove it from the board'
        }
      >
        {cliAgentRemoveLabel(exited)}
      </button>
    </div>
  );
}

/** Hover-revealed one-click delete. Closes the PTY with no confirm, matching thread archive. */
export function AgentDeleteQuickAction({
  session,
  projectId
}: {
  session: Pick<TerminalSession, 'id' | 'title' | 'status'>;
  projectId: string;
}) {
  const closeTerminal = useData((s) => s.closeTerminal);
  const exited = session.status === 'exited';
  return (
    <button
      type="button"
      className="project-terminal-close agent-delete-quick"
      data-testid="agent-delete-quick"
      aria-label={`${cliAgentRemoveLabel(exited)} ${session.title}`}
      title={cliAgentRemoveLabel(exited)}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void closeTerminal(session.id, projectId);
      }}
    >
      <Trash2 size={12} />
    </button>
  );
}

/** Clamp a right-click anchor so the menu (≈180×260) never clips the viewport
 *  edge — board/list rows live in the rightmost column, so a raw clientX would
 *  push it off-screen. */
export function clampMenuAnchor(e: { clientX: number; clientY: number }): { x: number; y: number } {
  return {
    x: Math.min(e.clientX, window.innerWidth - 196),
    y: Math.min(e.clientY, window.innerHeight - 272)
  };
}
