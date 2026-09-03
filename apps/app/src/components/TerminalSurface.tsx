import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { useData, useUi } from '../store.js';
import type { SplitLayout } from '../store.js';
import { TerminalView } from './TerminalView.js';
import { agentSessionAnchorId, pickAgentSessionPortalTarget } from '../lib/split-layout/agentSessionPortal.js';
import { paneContentForPathname } from '../lib/split-layout/splitThreadNavigation.js';
import { useSplitWorkspace } from '../lib/split-layout/store.js';

// Renders every live terminal session across every project as a single mount.
// Visibility is toggled per active tab so xterm scrollback is preserved when
// switching projects or tabs.
//
// This component is mounted ONCE at app level (TerminalSurfaceHost) and never
// unmounted, so its child xterm instances — and their scrollback — survive
// every nav change. To make the same live terminals appear inside the Workspace
// (which owns column 3 under `projects`) — or inside the agent-inspector modal —
// the rendered grid is RE-PARENTED between anchor nodes.
//
// CRITICAL: we do NOT do this by changing the container passed to createPortal.
// React tears a portal's children down and rebuilds them in the new container
// whenever that container argument changes — which would dispose() every xterm
// (TerminalView's cleanup) and recreate it with an empty buffer, losing all
// scrollback on every modal open/close. Instead we portal into ONE persistent
// node that React always owns, and move THAT node between anchors imperatively
// with appendChild. A DOM move leaves the portal container unchanged, so React
// never remounts — the one-xterm-per-session invariant (and its scrollback)
// holds. When no modal/monitor is open the node parks on the always-mounted
// Workspace terminal-host (CSS-hidden with the workspace-slot).
//
// Pane placement (`area`) is one of:
//   'a' — primary (always present when any pane is shown)
//   'b' — vertical right / horizontal bottom / grid top-right
//   'c' — grid bottom-left (only when layout === 'grid')
//   'd' — grid bottom-right (only when layout === 'grid')
//   undefined — terminal is hidden (display:none, scrollback preserved)
type Area = 'a' | 'b' | 'c' | 'd';

const SLOT_AREA: Array<Area> = ['b', 'c', 'd'];

// DOM id of the Workspace's portal anchor. The surface parks its grid here
// whenever no modal or List-monitor anchor is active. Workspace stays mounted
// (CSS-hidden) so this node is always in the tree.
export const PROJECTS_TERMINAL_ANCHOR_ID = 'cc-terminal-anchor-projects';

// DOM id of the agent-inspector modal's terminal anchor. When the modal is open
// it OUTRANKS the Projects anchor: the surface portals the grid here, forces a
// single-pane layout, and shows ONLY the modal's session — so the same live
// xterm (scrollback and all) appears inside the modal without re-attaching a
// second terminal to the pty. Closing the modal returns the grid to its normal
// nav-driven anchor on the next layout pass.
export const AGENT_MODAL_TERMINAL_ANCHOR_ID = 'cc-terminal-anchor-agent-modal';

// DOM id of the Agents "List" view monitor's center-pane anchor. The inline
// 3-pane monitor (AgentMonitor) selects one agent; the surface portals that
// session's live xterm here so the same terminal (scrollback + interactivity)
// appears in the center pane without re-attaching a second pty. It ranks BELOW
// the agent-inspector modal (a modal is a focused overlay and must win) but
// ABOVE the Projects nav anchor — while the List view is on screen the monitor
// owns the live terminal. Absent from the DOM under any other view, so a stale
// selection never steals the terminal from the Projects workspace.
export const AGENT_MONITOR_TERMINAL_ANCHOR_ID = 'cc-terminal-anchor-agent-monitor';

// DOM id of the thread secondary-panel terminal tab. Ranked below the agent
// modal and the List-view monitor so those focused surfaces keep the live
// xterm, and above the Projects workspace park so a thread-panel tab can show
// the same session without a second PTY.
export const THREAD_PANEL_TERMINAL_ANCHOR_ID = 'cc-terminal-anchor-thread-panel';

export { agentSessionAnchorId };

export function TerminalSurface() {
  const terminals = useData((s) => s.terminals);
  const nav = useUi((s) => s.nav);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const selectedTabId = useUi((s) => s.selectedTabId);
  const splitLayoutMap = useUi((s) => s.splitLayout);
  const splitTabIdsMap = useUi((s) => s.splitTabIds);
  const agentModal = useUi((s) => s.agentModal);
  const agentMonitor = useUi((s) => s.agentMonitor);
  const threadPanelTerminal = useUi((s) => s.threadPanelTerminal);
  const location = useLocation();
  const splitLayout = useSplitWorkspace((s) => s.layout);
  const agentSession = pickAgentSessionPortalTarget(
    splitLayout,
    paneContentForPathname(location.pathname)
  );

  // The single, persistent portal node. React renders the grid into THIS node
  // for the surface's whole lifetime; we only ever move the node between anchors
  // (never swap createPortal's container), so the xterm subtree is never
  // remounted and scrollback is preserved across every nav change and modal
  // open/close. Created lazily so it exists before the first portal render.
  const portalNodeRef = useRef<HTMLDivElement | null>(null);
  if (!portalNodeRef.current) {
    portalNodeRef.current = document.createElement('div');
    portalNodeRef.current.className = 'terminal-surface-portal';
  }

  // Move the persistent node under the right anchor after layout, so the
  // destination anchor (which mounts in the same commit) is present. Re-resolve
  // when nav OR the modal/monitor/session-page selection changes. Precedence:
  // the agent-inspector modal (when open) outranks the routed session page,
  // which outranks the inline monitor, which outranks the always-mounted
  // Workspace park. appendChild is a no-op when the node is already the
  // anchor's child, so a re-render that doesn't change the target won't thrash
  // the DOM.
  const modalSessionId = agentModal?.sessionId ?? null;
  const agentSessionId = !modalSessionId ? agentSession?.sessionId ?? null : null;
  const monitorSessionId = agentMonitor?.sessionId ?? null;
  const threadPanelSessionId = threadPanelTerminal?.sessionId ?? null;
  useLayoutEffect(() => {
    const node = portalNodeRef.current;
    if (!node) return;
    const modalAnchor = modalSessionId
      ? document.getElementById(AGENT_MODAL_TERMINAL_ANCHOR_ID)
      : null;
    const agentSessionAnchor =
      !modalAnchor && agentSessionId
        ? document.getElementById(agentSessionAnchorId(agentSessionId))
        : null;
    const monitorAnchor =
      !modalAnchor && !agentSessionAnchor && monitorSessionId
        ? document.getElementById(AGENT_MONITOR_TERMINAL_ANCHOR_ID)
        : null;
    const threadPanelAnchor =
      !modalAnchor && !agentSessionAnchor && !monitorAnchor && threadPanelSessionId
        ? document.getElementById(THREAD_PANEL_TERMINAL_ANCHOR_ID)
        : null;
    const anchor =
      modalAnchor ??
      agentSessionAnchor ??
      monitorAnchor ??
      threadPanelAnchor ??
      document.getElementById(PROJECTS_TERMINAL_ANCHOR_ID);
    if (anchor && node.parentElement !== anchor) anchor.appendChild(node);
  }, [modalSessionId, agentSessionId, monitorSessionId, threadPanelSessionId, splitLayout]);

  // Build a tab-id → area map for the layout. The agent modal wins: when open,
  // it forces a single pane showing ONLY its session (so the live xterm appears
  // inside the modal). Otherwise only the Projects nav surfaces terminals; under
  // any other nav the map stays empty and every terminal is hidden (scrollback
  // preserved).
  const areaByTabId = new Map<string, Area>();
  let layout: SplitLayout = 'single';

  // Whether the live terminal is being driven by an id-only selector (modal or
  // monitor) rather than the per-project split layout — in that mode a session
  // claims its area regardless of which project is selected.
  const byIdSelection = agentModal
    ?? (agentSessionId && agentSession ? { sessionId: agentSession.sessionId, projectId: agentSession.projectId } : null)
    ?? (monitorSessionId ? agentMonitor : null)
    ?? (threadPanelSessionId ? threadPanelTerminal : null);

  if (agentModal) {
    areaByTabId.set(agentModal.sessionId, 'a');
    layout = 'single';
  } else if (agentSession) {
    areaByTabId.set(agentSession.sessionId, 'a');
    layout = 'single';
  } else if (agentMonitor) {
    // Inline List-view monitor: force a single pane showing only the selected
    // session, so its live xterm fills the center pane. Same shape as the modal
    // branch, one tier down in precedence.
    areaByTabId.set(agentMonitor.sessionId, 'a');
    layout = 'single';
  } else if (threadPanelTerminal) {
    areaByTabId.set(threadPanelTerminal.sessionId, 'a');
    layout = 'single';
  } else if (nav === 'projects') {
    const activeTabId = selectedProjectId ? selectedTabId[selectedProjectId] : undefined;
    layout = (selectedProjectId && splitLayoutMap[selectedProjectId]) || 'single';
    const slotIds: Array<string | undefined> = selectedProjectId
      ? splitTabIdsMap[selectedProjectId] ?? []
      : [];
    if (activeTabId && selectedProjectId) {
      areaByTabId.set(activeTabId, 'a');
      if (layout !== 'single') {
        slotIds.forEach((id, i) => {
          if (!id || id === activeTabId) return;
          const area = SLOT_AREA[i];
          if (!area) return;
          // Don't overwrite if the same id is in multiple slots (shouldn't
          // happen, but be safe).
          if (!areaByTabId.has(id)) areaByTabId.set(id, area);
        });
      }
    }
  }

  const surface = (
    <div className={`terminal-surface layout-${layout}`} aria-hidden={!areaByTabId.size}>
      {Object.entries(terminals).flatMap(([projectId, sessions]) =>
        sessions.map((s) => {
          // Normally a session only claims an area when its project is the
          // selected one (split layout is per-project). The modal and the inline
          // monitor are the exceptions: each shows one specific session by id,
          // which may live in a project other than the selected one, so they
          // resolve by id alone.
          const area = byIdSelection
            ? areaByTabId.get(s.id)
            : projectId === selectedProjectId
              ? areaByTabId.get(s.id)
              : undefined;
          return <TerminalView key={s.id} session={s} area={area} />;
        })
      )}
    </div>
  );

  // Always portal into the SAME persistent node; the node itself is what moves
  // between anchors (see the layout effect above). First paint parks on the
  // Workspace terminal-host; the layout effect relocates it if a modal/monitor
  // outranks that park.
  return createPortal(surface, portalNodeRef.current);
}
