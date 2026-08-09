import { useEffect, useRef, useState } from 'react';
import { Plus, X, Pin } from 'lucide-react';
import type { LaunchProfileId, TerminalSession } from '@shared/types';
import { useUi, useAgentStatus, usePersonas } from '../store';
import { getTerminal } from '../util/findRegistry';
import { profileIcon, personaIcon } from '../util/profileIcon';
import type { AgentState } from '@shared/types';

/** Human label for the status dot's tooltip + aria. */
const AGENT_STATE_LABEL: Record<AgentState, string> = {
  blocked: 'Blocked — needs you',
  working: 'Working',
  done: 'Done — unseen',
  idle: 'Idle',
  unknown: ''
};

/**
 * Live agent-state dot for a tab. Subscribes by id to a PRIMITIVE (the state
 * string), so one session's transition repaints only its own dot — never the
 * tab strip (BC 8). Renders nothing for `unknown` (plain shells, no signal yet)
 * so non-agent tabs stay clean.
 */
function AgentStatusDot({ sessionId }: { sessionId: string }) {
  const state = useAgentStatus((s) => s.byId[sessionId] ?? 'unknown');
  if (state === 'unknown') return null;
  return (
    <span
      className={`tab-agent-dot agent-${state}`}
      title={AGENT_STATE_LABEL[state]}
      aria-label={AGENT_STATE_LABEL[state]}
    />
  );
}

interface Props {
  tabs: TerminalSession[];
  activeTabId: string | undefined;
  onSelect: (id: string) => void;
  /**
   * Terminate a session: kills the pty and removes the tab. A restorable
   * snapshot is kept so ⌘⇧T can reopen. Only the context-menu "Delete" item
   * routes here for live sessions (with a confirm); exited tombstones also
   * route here from the X button / middle-click to dismiss without friction.
   */
  onClose: (id: string) => void;
  /**
   * Close a session out of the tab strip without killing it. The pty keeps
   * running headless; the session stays listed in the project's vertical list
   * under its real status, and clicking that row re-opens it (re-attaching the
   * same live pty). This is what the X button, middle-click, ⌘W, and the
   * context-menu "Hide" items do for live sessions — closing is non-destructive;
   * only "Delete" terminates.
   */
  onDetach?: (id: string) => void;
  /** Spawn a new terminal (a plain shell). The "+" button routes here. Agent
   *  profiles (claude / personas) live in the Agents view, not the tab strip. */
  onNewTerminal: () => void;
  onReorder?: (fromId: string, toId: string) => void;
  onRename?: (id: string, title: string) => void;
  onDuplicate?: (id: string) => void;
  onRestart?: (id: string) => void;
  /** Re-attach an EXITED remote tab to its live tmux session on the box (sleep
   *  recovery). Passed only for remote projects; absent ⇒ the menu item hides. */
  onReconnect?: (id: string) => void;
  onPin?: (id: string, pinned: boolean) => void;
  /** Tab ids currently mounted in non-primary split panes. */
  splitTabIds?: ReadonlyArray<string | undefined>;
  /** Whether a split layout is active (any layout != single). */
  splitActive?: boolean;
  onOpenInSplit?: (id: string) => void;
  onRemoveFromSplit?: (id: string) => void;
  onCloseSplit?: () => void;
}

interface TabContextMenu {
  tabId: string;
  x: number;
  y: number;
}

export function TabBar({ tabs, activeTabId, onSelect, onClose, onDetach, onNewTerminal, onReorder, onRename, onDuplicate, onRestart, onReconnect, onPin, splitTabIds, splitActive, onOpenInSplit, onRemoveFromSplit, onCloseSplit }: Props) {
  const splitSet = new Set((splitTabIds ?? []).filter((x): x is string => !!x));
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [tabMenu, setTabMenu] = useState<TabContextMenu | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const unread = useUi((s) => s.unread);
  // Raw personas slice (stable ref; only changes on an actual update) so a tab
  // launched as a persona can show that persona's icon/label on its chip.
  const personas = usePersonas((s) => s.personas);

  const startRename = (t: TerminalSession) => {
    if (!onRename) return;
    setRenamingId(t.id);
    setRenameValue(t.title);
  };

  const commitRename = () => {
    if (renamingId && onRename) {
      const v = renameValue.trim();
      if (v) onRename(renamingId, v);
    }
    setRenamingId(null);
  };

  useEffect(() => {
    if (!tabMenu) return;
    const close = () => setTabMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', close);
    };
  }, [tabMenu]);

  // Close one tab = remove it from the strip, not destroy it. A live session
  // keeps its pty running and stays in the project's vertical list under its
  // real status (click that row to re-open it); an exited tab has no process
  // left, so it's just dismissed. The process is only ever terminated via the
  // context-menu "Delete" or the project-list row's X — see `deleteOne`. No
  // confirm here: closing is non-destructive.
  const closeOne = (t: TerminalSession) => {
    if (t.status === 'exited' || !onDetach) {
      onClose(t.id); // dead tombstone (or no detach wired) — just remove it
      return;
    }
    onDetach(t.id); // live — remove from the strip, keep the process alive
  };

  // Destroy one tab: terminate the process and remove the tab. Live sessions
  // get a confirm so a stray Delete can't silently kill a running agent;
  // exited tabs are already dead, so they drop without friction. ⌘⇧T reopens.
  const deleteOne = (t: TerminalSession) => {
    if (
      t.status === 'exited' ||
      window.confirm(`Delete “${t.title}”? The process will be terminated.`)
    ) {
      onClose(t.id);
    }
  };

  // Bulk close: remove every live, non-pinned target from the strip (its pty
  // keeps running, still listed in the vertical list) and dismiss any exited
  // tombstones. Non-destructive, so no confirm — matches the single-tab close.
  const bulkClose = (targets: TerminalSession[]) => {
    for (const t of targets) {
      if (t.pinned) continue;
      if (t.status === 'exited' || !onDetach) onClose(t.id);
      else onDetach(t.id);
    }
  };

  const closeOthers = (id: string) => bulkClose(tabs.filter((t) => t.id !== id));
  const closeToRight = (id: string) => {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    bulkClose(tabs.slice(idx + 1));
  };
  // Exited tabs have no live process — drop them all with no prompt.
  const dismissExited = () => {
    for (const t of tabs) if (t.status === 'exited' && !t.pinned) onClose(t.id);
  };

  // A standard mouse wheel only emits vertical deltas, but the tab strip
  // overflows horizontally — so without translating the wheel, there's no way
  // to reach off-screen tabs on a non-trackpad device. Map the dominant delta
  // onto scrollLeft. A real horizontal gesture (trackpad / shift+wheel) already
  // carries deltaX, so prefer it and fall back to deltaY. Bound natively (not
  // via React's onWheel, which is passive at the root) so preventDefault can
  // stop the gesture from bubbling into a vertical scroll of the page.
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return; // nothing to scroll
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (delta === 0) return;
      el.scrollLeft += delta;
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Keep the active tab visible: when it changes (e.g. via keyboard or a click
  // on a clipped tab), scroll the strip just enough to reveal it.
  useEffect(() => {
    const el = stripRef.current;
    if (!el || !activeTabId) return;
    const tab = el.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeTabId)}"]`);
    tab?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [activeTabId]);

  return (
    <div className="tabbar" role="tablist" ref={stripRef}>
      {tabs.map((t) => (
        <div
          key={t.id}
          data-tab-id={t.id}
          className={`tab ${activeTabId === t.id ? 'active' : ''} ${
            draggingId === t.id ? 'dragging' : ''
          } ${dragOverId === t.id && draggingId && draggingId !== t.id ? 'drag-over' : ''} ${
            t.pinned ? 'pinned' : ''
          } ${splitSet.has(t.id) ? 'split' : ''} ${t.status === 'exited' ? 'exited' : ''} ${
            t.status === 'exited' && (t.exitCode ?? 0) !== 0 ? 'exited-bad' : ''
          }`}
          role="tab"
          aria-selected={activeTabId === t.id}
          title={
            t.status === 'exited'
              ? `${t.title} · exited${t.exitCode != null ? ` (code ${t.exitCode})` : ''}`
              : undefined
          }
          onClick={() => onSelect(t.id)}
          onAuxClick={(e) => {
            // Middle-click closes the tab (skipping pinned ones).
            if (e.button !== 1) return;
            e.preventDefault();
            e.stopPropagation();
            if (!t.pinned) closeOne(t);
          }}
          onMouseDown={(e) => {
            // Suppress browser-default autoscroll on middle-click.
            if (e.button === 1) e.preventDefault();
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setTabMenu({ tabId: t.id, x: e.clientX, y: e.clientY });
          }}
          draggable={!!onReorder}
          onDragStart={(e) => {
            setDraggingId(t.id);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', t.id);
          }}
          onDragEnter={(e) => {
            if (!draggingId || draggingId === t.id) return;
            e.preventDefault();
            setDragOverId(t.id);
          }}
          onDragOver={(e) => {
            if (!draggingId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
          }}
          onDrop={(e) => {
            e.preventDefault();
            const from = draggingId;
            setDraggingId(null);
            setDragOverId(null);
            if (from && from !== t.id) onReorder?.(from, t.id);
          }}
          onDragEnd={() => {
            setDraggingId(null);
            setDragOverId(null);
          }}
        >
          {unread[t.id] && activeTabId !== t.id && <span className="tab-unread" />}
          {(() => {
            // A persona-launched tab shows the persona's icon (falling back to
            // the base-profile icon inside personaIcon); otherwise the plain
            // profile icon. If the persona was deleted since launch, fall back.
            const persona = t.personaId
              ? personas.find((p) => p.id === t.personaId)
              : undefined;
            return (
              <span
                className={`tab-profile-icon profile-${t.profile}`}
                aria-hidden="true"
                title={persona?.name}
              >
                {persona ? personaIcon(persona) : profileIcon(t.profile)}
              </span>
            );
          })()}
          <AgentStatusDot sessionId={t.id} />
          {renamingId === t.id ? (
            <input
              className="tab-rename"
              value={renameValue}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitRename();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setRenamingId(null);
                }
              }}
            />
          ) : (
            <span className="tab-title" onDoubleClick={() => startRename(t)}>
              {t.title}
              {t.status === 'exited' && (
                <span className="tab-exit-marker">
                  {(t.exitCode ?? 0) !== 0 ? ` ✗${t.exitCode}` : ' ·exited'}
                </span>
              )}
            </span>
          )}
          {t.pinned ? (
            <span className="tab-pin-marker" title="Pinned" aria-label="Pinned">
              <Pin size={11} />
            </span>
          ) : (
            <button
              type="button"
              className="tab-close"
              aria-label={t.status === 'exited' ? `Dismiss ${t.title}` : `Close ${t.title}`}
              title={
                t.status === 'exited'
                  ? 'Dismiss tab'
                  : 'Close tab — keeps the process running, still listed in the sidebar. Right-click → Delete to end it.'
              }
              onClick={(e) => {
                e.stopPropagation();
                // Drop focus before triggering close so the button doesn't
                // stay :focus-visible when the next tab takes its place
                // under the cursor.
                e.currentTarget.blur();
                closeOne(t);
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>
      ))}
      <button
        ref={anchor}
        className="tab-add"
        aria-label="New terminal"
        title="New terminal"
        onClick={(e) => {
          e.stopPropagation();
          // Terminals only ever spawn a plain shell. Agent profiles live in the
          // Agents view's launcher, not the tab strip.
          onNewTerminal();
        }}
      >
        <Plus size={14} />
      </button>
      {tabMenu && (() => {
        const t = tabs.find((tt) => tt.id === tabMenu.tabId);
        if (!t) return null;
        const idx = tabs.findIndex((tt) => tt.id === t.id);
        const hasRight = idx >= 0 && idx < tabs.length - 1;
        const hasOthers = tabs.length > 1;
        const hasExited = tabs.some((tt) => tt.status === 'exited');
        return (
          <div
            className="tab-context-menu"
            style={{ top: tabMenu.y, left: tabMenu.x }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                setTabMenu(null);
                onSelect(t.id);
                startRename(t);
              }}
              disabled={!onRename}
            >
              Rename…
            </button>
            {onDuplicate && (
              <button
                onClick={() => {
                  setTabMenu(null);
                  onDuplicate(t.id);
                }}
              >
                Duplicate
              </button>
            )}
            {onRestart && (
              <button
                onClick={() => {
                  setTabMenu(null);
                  onRestart(t.id);
                }}
                title={
                  t.status === 'exited'
                    ? 'Restart this session'
                    : 'Kill and restart this session with the same profile and args'
                }
              >
                {t.status === 'exited' ? 'Restart' : 'Restart…'}
              </button>
            )}
            {onReconnect && t.status === 'exited' && (
              <button
                onClick={() => {
                  setTabMenu(null);
                  onReconnect(t.id);
                }}
                title="Re-attach the live session on the remote host (or resume it) — recovers a remote agent whose connection dropped while your machine slept"
              >
                Reconnect
              </button>
            )}
            {onPin && (
              <button
                onClick={() => {
                  setTabMenu(null);
                  onPin(t.id, !t.pinned);
                }}
              >
                {t.pinned ? 'Unpin' : 'Pin'}
              </button>
            )}
            <button
              onClick={() => {
                setTabMenu(null);
                getTerminal(t.id)?.clear();
              }}
            >
              Clear scrollback
            </button>
            {onOpenInSplit && !splitSet.has(t.id) && t.id !== activeTabId && (
              <button
                onClick={() => {
                  setTabMenu(null);
                  onOpenInSplit(t.id);
                }}
                title="Open this tab in the next free split pane"
              >
                Open in split
              </button>
            )}
            {onRemoveFromSplit && splitSet.has(t.id) && (
              <button
                onClick={() => {
                  setTabMenu(null);
                  onRemoveFromSplit(t.id);
                }}
              >
                Remove from split
              </button>
            )}
            {onCloseSplit && splitActive && (
              <button
                onClick={() => {
                  setTabMenu(null);
                  onCloseSplit();
                }}
              >
                Close split (single pane)
              </button>
            )}
            <div className="tab-context-sep" />
            <button
              onClick={() => { setTabMenu(null); closeOne(t); }}
              disabled={!!t.pinned}
              title="Close this tab. The process keeps running and stays in the sidebar; click its row or press ⌘⇧T to re-open it."
            >
              {t.status === 'exited' ? 'Dismiss' : 'Close'}
            </button>
            <button
              onClick={() => { setTabMenu(null); closeOthers(t.id); }}
              disabled={!hasOthers}
              title="Close all other tabs (their processes keep running, still listed in the sidebar)."
            >
              Close others
            </button>
            <button
              onClick={() => { setTabMenu(null); closeToRight(t.id); }}
              disabled={!hasRight}
              title="Close tabs to the right (their processes keep running, still listed in the sidebar)."
            >
              Close to the right
            </button>
            <div className="tab-context-sep" />
            <button
              className="tab-context-danger"
              onClick={() => { setTabMenu(null); deleteOne(t); }}
              disabled={!!t.pinned}
              title="Terminate this session and remove the tab. Reopen with ⌘⇧T."
            >
              {t.status === 'exited' ? 'Dismiss' : 'Delete'}
            </button>
            <button
              onClick={() => { setTabMenu(null); dismissExited(); }}
              disabled={!hasExited}
              title="Dismiss every exited tab (their processes are already gone)."
            >
              Dismiss exited
            </button>
          </div>
        );
      })()}
    </div>
  );
}
