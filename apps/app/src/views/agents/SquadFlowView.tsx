import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { hasDesktopBridge } from '@/lib/app-surface';
import { ArrowRight, ChevronRight, GitPullRequest, Hash, LayoutList, Search, Workflow } from 'lucide-react';
import type { ExecutionBoardProjection, SquadFlowNode } from '@zana-ai/zcc-domain/product';
import {
  useData,
  useAgentMesh,
  useAgentStatus,
  useSubagents,
  useSubagentChildren,
  agentViewTerminals,
  usePersonas
} from '@/store';
import { inspectAgentSession, inspectThread } from '@/lib/inspect-session';
import { useThreads } from '@/thread-store';
import { useCanvasPan } from '@/hooks/useCanvasPan';
import { useCompactLayout } from '@/hooks/useCompactLayout';
import './mobile-canvas.css';
import './squad-overview.css';
import { buildSquadFlow, isQuiescentSquad, SOLO_GROUP_ICON, SOLO_GROUP_LABEL, type FlowGraph } from '@/lib/squadFlow';
import { modernFlowParticipants } from '@/lib/modern-squad-members';
import { squadFlowBounds, type FlowPoint } from '@/lib/squadFlowBounds';
import {
  ALL_SQUADS,
  squadLaunchGroups
} from '@/lib/squadLaunchGroups';
import { shortRunId, teamRunLabel } from '@/lib/executionIdentity';
import { childRowCounts, edgeRoute, layout, NODE_W, nodeNotice, simplify } from './squadFlowLayout';
import { SquadMemberDetails, SquadRoster } from './SquadRoster';
import {
  mainSquadFilters, matchesSquadMemberSearch, matchesSquadSearch,
  nodeActivity, runStates, sliceSquadGraph, squadMemberStatus, squadQuestion, squadRunStatus, squadStatusCounts,
  squadStatuses, type SquadStatusFilter
} from './squadFlowPresentation';

export { nodeActivity, STREAMING_FRESH_MS } from './squadFlowPresentation';

/**
 * Sticky squad-selection reducer for the Flow view's switcher. Given the
 * previously-selected projectId and the current graph list (in display order),
 * returns the projectId that should be selected now:
 *   - keep `prev` if it still exists  → new squads never steal focus
 *   - else fall back to the first graph → exit fallback
 *   - else undefined → no squads
 * Pure (in-memory selection, no persistence) so it's unit-testable.
 */
export function reconcileSquadSelection(
  prev: string | undefined,
  graphs: { projectId: string }[]
): string | undefined {
  if (prev && graphs.some((g) => g.projectId === prev)) return prev;
  return graphs[0]?.projectId;
}

/**
 * The Agents board's "Flow" view: for each project with a live squad, render the
 * roster as a directed handoff graph — orchestrator pinned on top, workers in a
 * row below, edges = agent→agent messages (most-recent highlighted), each node
 * carrying a live status dot and a sub-agent count badge.
 *
 * Presentational + reactive only. The graph is folded from the raw store slices
 * (mesh / status / sub-agents / terminals) through the pure {@link buildSquadFlow}
 * behind a `useMemo`, mirroring how {@link AgentsBoard} derives its cards
 * — so a status tick re-derives the graph without rebuilding any store
 * (render-storm guard). Reuses the shared `tab-agent-dot agent-*` status-dot
 * vocabulary; all other styling is a fresh `squad-flow-*` prefix (NOT `gus-*` /
 * `agent-mesh-*`, per the CLAUDE.md coupling note).
 */

/** Shorten a node label for display (path-shaped auto-handles → last segment). */
function prettyLabel(label: string): string {
  let out = label;
  if (out.includes('/')) {
    const segments = out.split('/').filter(Boolean);
    out = segments[segments.length - 1] ?? out;
  }
  return out.length > 24 ? `${out.slice(0, 23)}…` : out;
}

/** Plain length-cap for free text (sub-agent descriptions) — unlike
 *  {@link prettyLabel} it does NOT path-collapse, so "fix auth/login" stays whole. */
function truncate(text: string, max = 40): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Compact "for Xs/Xm/Xh" since a state began; empty when unknown. */
function sinceLabel(stateSince: number | undefined, now: number): string {
  if (!stateSince) return '';
  const sec = Math.max(0, Math.round((now - stateSince) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  return `${Math.round(min / 60)}h`;
}

/**
 * Chip label for one squad in the second picker. Prefers the squad's
 * orchestrator card label (so the chip matches the top card on the canvas),
 * then the matched squad-template name, then a positional "Squad N" fallback.
 * The solo bucket gets the same fixed label as its header.
 */
export function squadChipLabel(graph: FlowGraph, ordinal: number): string {
  if (graph.isSolo) return SOLO_GROUP_LABEL;
  if (graph.teamName) return graph.teamName;
  const orch = graph.nodes.find((n) => n.isOrchestrator);
  if (orch) return prettyLabel(orch.label);
  if (graph.squad?.name) return graph.squad.name;
  return `Squad ${ordinal}`;
}

/** Header label for one rendered graph; the solo bucket matches its chip. */
export function squadHeaderLabel(graph: FlowGraph): string {
  if (graph.isSolo) return SOLO_GROUP_LABEL;
  if (graph.executionId && graph.teamName) {
    return teamRunLabel({ cohortId: graph.executionId, executionId: graph.executionId, executionJobTitle: graph.executionJobTitle, teamName: graph.teamName });
  }
  return graph.teamName ?? graph.squad?.name ?? 'Squad';
}

const STATE_VERB: Record<SquadFlowNode['state'], string> = {
  working: 'working',
  blocked: 'needs you',
  done: 'done',
  idle: 'idle',
  unknown: 'idle',
  waiting: 'waiting'
};

/**
 * Named sub-agent child rows nested inside a parent node card. Renders nothing
 * when no identity was captured — the parent's count badge is the fallback.
 * A "+N more" chip reconciles the visible rows (and any children whose hook
 * payload was lost) against the authoritative `liveSubagents` count.
 */
function SubagentChildList({ node }: { node: SquadFlowNode }) {
  const children = node.subagentChildren;
  if (!children?.length) return null;
  const counts = childRowCounts(node);
  const visible = children.slice(0, counts.visible);
  const hidden = counts.hidden;
  const collapsedNamed = children.length - visible.length; // records we hid
  const unnamed = hidden - collapsedNamed; // count beyond any record
  const moreTitle =
    unnamed > 0
      ? `${hidden} more sub-agent${hidden === 1 ? '' : 's'} (${unnamed} without a captured name)`
      : `${hidden} more sub-agent${hidden === 1 ? '' : 's'}`;
  return (
    <span className="squad-flow-children">
      {visible.map((child) => {
        const running = child.status === 'running';
        return (
          <span key={child.id} className="squad-flow-child">
            <span
              className={`tab-agent-dot agent-${running ? 'working' : 'done'}`}
              aria-hidden="true"
            />
            {child.subagentType && (
              <span className="squad-flow-child-type">{child.subagentType}</span>
            )}
            <span className="squad-flow-child-desc">
              {child.description ? truncate(child.description) : 'sub-agent'}
            </span>
          </span>
        );
      })}
      {hidden > 0 && (
        <span className="squad-flow-child-more" title={moreTitle}>
          +{hidden} more
        </span>
      )}
    </span>
  );
}

/** Build an orthogonal path through `pts` with rounded (quadratic) corners —
 *  the smooth-step look from the Agentforce flow builder. */
function roundedPath(pts: FlowPoint[], radius: number): string {
  const p = simplify(pts);
  if (p.length < 2) return '';
  let d = `M${p[0].x},${p[0].y}`;
  for (let i = 1; i < p.length - 1; i++) {
    const prev = p[i - 1];
    const cur = p[i];
    const next = p[i + 1];
    const l1 = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const l2 = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    const b1 = { x: cur.x - ((cur.x - prev.x) / l1) * r, y: cur.y - ((cur.y - prev.y) / l1) * r };
    const b2 = { x: cur.x + ((next.x - cur.x) / l2) * r, y: cur.y + ((next.y - cur.y) / l2) * r };
    d += ` L${b1.x},${b1.y} Q${cur.x},${cur.y} ${b2.x},${b2.y}`;
  }
  const last = p[p.length - 1];
  d += ` L${last.x},${last.y}`;
  return d;
}

const EDGE_RADIUS = 14;

const EDGE_BOUNDS_PAD = 16;

// Animated chevrons ride source→target along each edge, so the direction of a
// handoff reads at a glance (borrowed from the Agentforce flow builder's
// AnimatedEdge). Two chevrons, phase-offset by half the loop; hot (most-recent)
// edges flow faster + brighter.
const CHEVRON_COUNT = 2;
const FLOW_DUR = 2.6; // seconds per loop for a normal edge
const FLOW_DUR_HOT = 1.4; // faster for the most-recent handoff

/** One directed handoff edge: static spine + chevrons animating along it.
 *  Chevrons are skipped under prefers-reduced-motion — the arrowhead still
 *  conveys direction. */
function FlowEdge({
  path,
  hot,
  pending,
  dependency,
  markerId,
  strokeWidth,
  animate
}: {
  path: string;
  hot: boolean;
  pending: boolean;
  dependency: boolean;
  markerId: string;
  strokeWidth: number;
  animate: boolean;
}) {
  const dur = hot ? FLOW_DUR_HOT : FLOW_DUR;
  const chevron = hot ? '0,-4.5 8,0 0,4.5' : '0,-3.5 6.5,0 0,3.5';
  return (
    <g>
      <path
        d={path}
        className={`squad-flow-edge ${hot ? 'squad-flow-edge--hot' : ''} ${pending ? 'squad-flow-edge--pending' : ''} ${dependency ? 'squad-flow-edge--dependency' : ''}`}
        markerEnd={`url(#${markerId})`}
        strokeWidth={strokeWidth}
      />
      {animate &&
        Array.from({ length: CHEVRON_COUNT }, (_, i) => (
          <polygon
            key={i}
            points={chevron}
            className={hot ? 'squad-flow-chevron--hot' : 'squad-flow-chevron'}
          >
            <animateMotion
              dur={`${dur}s`}
              begin={`${(i * dur) / CHEVRON_COUNT}s`}
              repeatCount="indefinite"
              path={path}
              rotate="auto"
            />
          </polygon>
        ))}
    </g>
  );
}

/**
 * A self-loop arc drawn above a WORKING node. It gives a lone worker — one that
 * hands off to nobody, so draws no outgoing edge — a visible directed arrow onto
 * itself, reading as "actively working on its own unit". Chevron rides the arc under
 * `animate` (reduced-motion / quiescent off); the arrowhead alone still conveys
 * direction. `variant` mirrors the node tier: `streaming` (fresh output) is the bright,
 * faster arc; `working` (live agent dot, no fresh output yet) is dimmer and slower —
 * both convey motion, so a working lone worker is never invisible. */
function SelfLoopArc({ cx, topY, animate, markerId, variant = 'streaming' }: { cx: number; topY: number; animate: boolean; markerId: string; variant?: 'streaming' | 'working' }) {
  // Small arc bowing up out of the node's top edge, entering back down into it.
  const path = `M${cx - 16},${topY} C${cx - 34},${topY - 46} ${cx + 34},${topY - 46} ${cx + 16},${topY}`;
  return (
    <g>
      <path d={path} className={`squad-flow-self-loop ${variant === 'working' ? 'squad-flow-self-loop--working' : ''}`} markerEnd={`url(#${markerId})`} fill="none" />
      {animate && (
        <polygon points="0,-3.5 6.5,0 0,3.5" className={`squad-flow-chevron--self ${variant === 'working' ? 'squad-flow-chevron--self-working' : ''}`}>
          <animateMotion dur={variant === 'working' ? '2.8s' : '1.8s'} repeatCount="indefinite" path={path} rotate="auto" />
        </polygon>
      )}
    </g>
  );
}

const DRAG_THRESHOLD = 4;
const DOUBLE_CLICK_MS = 350;

function flowNodeTitle(node: SquadFlowNode, compact: boolean): string {
  const label = node.inspectionTarget.type === 'thread'
    ? node.label
    : node.handle ?? node.displayName ?? node.sessionId;
  const action = node.inspectionTarget.type === 'thread'
    ? compact ? 'Tap to open thread' : 'Click to open thread'
    : compact ? 'Tap to open agent' : node.job?.executionId
      ? 'Click to inspect job details, double-click to open terminal'
      : 'Click to open terminal';
  return `${label} (${action})`;
}

export function SquadGraph({ graph, onInspectExecution, pannable = true, questionsPinned = false }: {
  graph: FlowGraph;
  onInspectExecution?: (projectId: string, executionId: string) => void;
  pannable?: boolean;
  questionsPinned?: boolean;
}) {
  const navigate = useNavigate();
  const arrowId = useId();
  const inspectFlowNode = useCallback((node: SquadFlowNode) => {
    if (node.inspectionTarget.type === 'thread') {
      inspectThread(node.inspectionTarget.id, graph.projectId, navigate);
      return;
    }
    inspectAgentSession(node.inspectionTarget.id, graph.projectId, navigate);
  }, [graph.projectId, navigate]);
  const width = 1100;
  const now = graph.builtAt;
  const { placed, height: layoutHeight } = useMemo(() => {
    if (!questionsPinned) return layout(graph, width);
    // The map shares the full-width question banner with Overview.
    const nodes = graph.nodes.map((node) => nodeNotice(node) === 'blocker' && node.job
      ? { ...node, job: { ...node.job, blockerQuestion: undefined } }
      : node);
    return layout({ ...graph, nodes }, width);
  }, [graph, questionsPinned, width]);

  // Skip the flowing chevrons for reduced-motion users (arrowheads still show
  // direction). Read once — the preference doesn't change mid-session in practice.
  const animateFlow = useMemo(
    () =>
      typeof window !== 'undefined' &&
      !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    []
  );

  // Drag state: position overrides keyed by sessionId.
  const [offsets, setOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragRef = useRef<{
    sessionId: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    moved: boolean;
  } | null>(null);
  const lastThreadOpenRef = useRef<{ sessionId: string; at: number } | null>(null);
  useEffect(() => {
    lastThreadOpenRef.current = null;
  }, [graph]);

  // Resolve final position: layout + any drag offset.
  const resolvedPlaced = useMemo(() => {
    return placed.map((p) => {
      const off = offsets[p.node.sessionId];
      if (!off) return p;
      return { ...p, x: off.x, y: off.y };
    });
  }, [placed, offsets]);

  const byId = useMemo(
    () => new Map(resolvedPlaced.map((p) => [p.node.sessionId, p])),
    [resolvedPlaced]
  );

  const routedEdges = useMemo(() => graph.edges.flatMap((edge) => {
    const from = byId.get(edge.fromSessionId);
    const to = byId.get(edge.toSessionId);
    return from && to ? [{ edge, points: edgeRoute(from, to) }] : [];
  }), [graph.edges, byId]);
  const bounds = useMemo(() => squadFlowBounds(
    resolvedPlaced.map(({ x, y, height }) => ({ x, y, width: NODE_W, height })),
    routedEdges.flatMap(({ points }) => points),
    width,
    layoutHeight,
    EDGE_BOUNDS_PAD
  ), [resolvedPlaced, routedEdges, width, layoutHeight]);
  const contentWidth = bounds.width;
  const contentHeight = bounds.height;

  const newestTs = graph.edges.reduce((mx, edge) => edge.kind === 'work-dependency' ? mx : Math.max(mx, edge.lastTs), 0);
  const rollup = graph.summary;
  // A done (all-exited) squad must render as a static, muted graph — no gold
  // hot edge, no flowing chevrons — so it doesn't keep looking like live work.
  const quiescent = isQuiescentSquad(rollup);
  const { isPanning, canvasPanProps } = useCanvasPan();
  const compact = useCompactLayout();
  const canvasRef = useRef<HTMLDivElement>(null);
  const positioned = useRef(false);
  useLayoutEffect(() => {
    if (!compact) { positioned.current = false; return; }
    const canvas = canvasRef.current;
    const first = resolvedPlaced.find(({ node }) => node.isOrchestrator) ?? resolvedPlaced[0];
    if (!canvas || !first || positioned.current) return;
    // Start at an agent rather than the empty left edge of the desktop graph.
    canvas.scrollLeft = Math.max(0, first.x + bounds.offsetX + NODE_W / 2 - canvas.clientWidth / 2);
    positioned.current = true;
  }, [compact, resolvedPlaced, bounds.offsetX]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>, node: SquadFlowNode, baseX: number, baseY: number) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        sessionId: node.sessionId,
        startX: e.clientX,
        startY: e.clientY,
        origX: baseX,
        origY: baseY,
        moved: false
      };
    },
    []
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
      if (!drag.moved) {
        drag.moved = true;
        setDraggingId(drag.sessionId);
      }
      setOffsets((prev) => ({
        ...prev,
        [drag.sessionId]: { x: drag.origX + dx, y: drag.origY + dy }
      }));
    },
    []
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;
      e.currentTarget.releasePointerCapture(e.pointerId);
      setDraggingId(null);
      if (!drag.moved) {
        const node = graph.nodes.find((candidate) => candidate.sessionId === drag.sessionId);
        // A nested Modern member opens its thread; Job nodes open details.
        if (node?.job?.executionId && onInspectExecution && (node.inspectionTarget.type !== 'thread' || node.isOrchestrator)) {
          onInspectExecution(graph.projectId, node.job.executionId);
          return;
        }
        if (node?.inspectionTarget.type === 'thread') {
          const previous = lastThreadOpenRef.current;
          lastThreadOpenRef.current = { sessionId: node.sessionId, at: e.timeStamp };
          if (previous?.sessionId === node.sessionId && e.timeStamp - previous.at <= DOUBLE_CLICK_MS) return;
        }
        if (node) inspectFlowNode(node);
      }
    },
    [graph, onInspectExecution, inspectFlowNode]
  );

  return (
    <section className="squad-flow-squad">
      <header className="squad-flow-head">
        <span className="squad-flow-icon" aria-hidden="true">
          {graph.isSolo ? SOLO_GROUP_ICON : graph.squad?.icon ?? '🤖'}
        </span>
        <span className="squad-flow-name">{squadHeaderLabel(graph)}</span>
        <span className="squad-flow-rollup">
          {rollup.working > 0 && <em className="squad-flow-stat agent-working">{rollup.working} working</em>}
          {rollup.blocked > 0 && <em className="squad-flow-stat agent-blocked">{rollup.blocked} blocked</em>}
          {rollup.idle > 0 && <em className="squad-flow-stat agent-idle">{rollup.idle} idle</em>}
          {rollup.exited > 0 && <em className="squad-flow-stat">{rollup.exited} exited</em>}
          <em className="squad-flow-stat squad-flow-stat--total">{rollup.total} total</em>
        </span>
      </header>

      <div
        ref={canvasRef}
        className={`squad-flow-canvas${pannable ? ' is-pannable' : ''}${isPanning ? ' is-panning' : ''}`}
        aria-label={compact ? 'Agent canvas. Swipe to explore.' : pannable ? 'Squad canvas. Drag empty space to pan.' : 'Squad canvas'}
        {...(pannable && !compact ? canvasPanProps : {})}
      >
        <div className="squad-flow-content" style={{ width: contentWidth, height: contentHeight }}>
          <svg
            className="squad-flow-edges"
            width={contentWidth}
            height={contentHeight}
            viewBox={`0 0 ${contentWidth} ${contentHeight}`}
            aria-hidden="true"
          >
            <defs>
              <marker id={arrowId} markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
                <path d="M0,0 L9,4.5 L0,9 z" className="squad-flow-arrowhead" />
              </marker>
              <marker id={`${arrowId}-hot`} markerWidth="10" markerHeight="10" refX="7" refY="5" orient="auto">
                <path d="M0,0 L10,5 L0,10 z" className="squad-flow-arrowhead-hot" />
              </marker>
              <marker id={`${arrowId}-self`} markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
                <path d="M0,0 L9,4.5 L0,9 z" className="squad-flow-arrowhead-self" />
              </marker>
            </defs>
            {routedEdges.map(({ edge: e, points }) => {
              const dependency = e.kind === 'work-dependency';
              const hot = !dependency && !quiescent && e.lastTs === newestTs && newestTs > 0;
              return (
                <FlowEdge
                  key={`${e.fromSessionId}->${e.toSessionId}`}
                  path={roundedPath(points.map((point) => ({
                    x: point.x + bounds.offsetX,
                    y: point.y + bounds.offsetY
                  })), EDGE_RADIUS)}
                  hot={hot}
                  pending={e.pending}
                  dependency={dependency}
                  markerId={hot ? `${arrowId}-hot` : arrowId}
                  strokeWidth={Math.min(4, 1.5 + (e.count - 1) * 0.6)}
                  animate={animateFlow && !quiescent && !dependency}
                />
              );
            })}
            {!quiescent && !graph.isSolo &&
              resolvedPlaced.map(({ node, x, y }) => {
                const { working, streaming } = nodeActivity(node, now);
                // Self-arc renders for ANY genuinely-working node (Plan 1), so a lone
                // worker with no handoffs still shows motion. Bare/stranded claims are
                // NOT working, so they draw no arc (no phantom motion).
                return working ? (
                  <SelfLoopArc
                    key={`self:${node.sessionId}`}
                    cx={x + bounds.offsetX + NODE_W / 2}
                    topY={y + bounds.offsetY}
                    animate={animateFlow}
                    markerId={`${arrowId}-self`}
                    variant={streaming ? 'streaming' : 'working'}
                  />
                ) : null;
              })}
          </svg>

          {resolvedPlaced.map(({ node, x, y, height }) => {
            const { working, streaming, claimed } = nodeActivity(node, now);
            const notice = nodeNotice(node);
            const question = node.job?.blockerQuestion ?? '';
            // "working" = real liveness (fresh output OR the mesh reports working);
            // "claimed" = a durable claim exists but no live signal — neither is
            // fabricated into motion, so a stranded claim shows a static chip only.
            const verb = node.exited
              ? 'exited'
              : working
                ? 'working'
                : claimed
                  ? 'claimed'
                  : STATE_VERB[node.state];
            const since = node.exited ? '' : sinceLabel(node.claim?.claimedAt ?? node.stateSince, now);
            const isDragging = draggingId === node.sessionId;
            return (
              <button
                key={node.sessionId}
                type="button"
                className={`squad-flow-node ${node.isOrchestrator ? 'squad-flow-node--orch' : ''} ${node.inspectionTarget.type === 'thread' && node.job ? 'squad-flow-node--modern' : ''} ${node.exited ? 'squad-flow-node--exited' : ''} ${working && !quiescent ? 'squad-flow-node--working' : ''} ${streaming && !quiescent ? 'squad-flow-node--streaming' : ''} ${claimed && !quiescent ? 'squad-flow-node--claimed' : ''} ${isDragging ? 'squad-flow-node--dragging' : ''}`}
                style={{ left: x + bounds.offsetX, top: y + bounds.offsetY, width: NODE_W, height }}
                onPointerDown={compact ? undefined : (e) => handlePointerDown(e, node, x, y)}
                onPointerMove={compact ? undefined : handlePointerMove}
                onPointerUp={compact ? undefined : handlePointerUp}
                onClick={(event) => {
                  if (compact) inspectFlowNode(node);
                  else if (event.detail === 0) {
                    if (node.job?.executionId && onInspectExecution && (node.inspectionTarget.type !== 'thread' || node.isOrchestrator)) {
                      onInspectExecution(graph.projectId, node.job.executionId);
                    } else {
                      inspectFlowNode(node);
                    }
                  }
                }}
                onDoubleClick={compact || node.inspectionTarget.type === 'thread' ? undefined : () => inspectFlowNode(node)}
                title={flowNodeTitle(node, compact)}
              >
                <span className="squad-flow-node-main">
                  <span className="squad-flow-node-icon" aria-hidden="true">
                    {node.isOrchestrator ? <GitPullRequest size={17} /> : <Hash size={17} />}
                    <span
                      className={`squad-flow-node-dot tab-agent-dot agent-${node.exited ? 'done' : node.state}`}
                      aria-hidden="true"
                    />
                  </span>
                  <span className="squad-flow-node-body">
                    <span className="squad-flow-node-top">
                      <span className="squad-flow-node-label">{questionsPinned ? node.label : prettyLabel(node.label)}</span>
                      {node.isOrchestrator && !questionsPinned && (
                        <span className="squad-flow-orch-tag" title="Orchestrator — close it to end the whole squad">
                          orchestrator
                        </span>
                      )}
                    </span>
                    <span className="squad-flow-node-state">
                      <span
                        className={`squad-flow-state-text agent-${node.exited ? 'done' : node.state}`}
                      >
                        {verb}
                        {since ? ` · ${since}` : ''}
                      </span>
                      {streaming && (
                        <span className="squad-flow-live" title="Emitting output — claim lease is live">
                          live
                        </span>
                      )}
                      {claimed && (
                        <span
                          className="squad-flow-claimed"
                          title="Backend holds a work claim for this worker, but there is no live session and no recent output — resuming, remote, or stalled. No activity is being shown because none is confirmed."
                        >
                          no output
                        </span>
                      )}
                      {(node.role || (questionsPinned && node.isOrchestrator)) && (
                        <span className="squad-flow-node-role" title={node.role}>
                          {questionsPinned && node.isOrchestrator ? 'Coordinator' : node.role}
                        </span>
                      )}
                      {node.liveSubagents > 0 && !node.subagentChildren?.length && (
                        <span
                          className="squad-flow-subagents"
                          title={`${node.liveSubagents} sub-agent${node.liveSubagents === 1 ? '' : 's'} running`}
                        >
                          {node.liveSubagents} sub-agent{node.liveSubagents === 1 ? '' : 's'}
                        </span>
                      )}
                    </span>
                    {notice === 'blocker' && (
                      <span className="squad-flow-node-blocker" title={question}>
                        Needs you · {truncate(question, 56)}
                      </span>
                    )}
                    {notice === 'coordinator' && (
                      <span className="squad-flow-node-coord" title={question}>
                        Coordinator deciding · {truncate(question, 56)}
                      </span>
                    )}
                  </span>
                  <ChevronRight size={14} className="squad-flow-node-chevron" aria-hidden="true" />
                </span>
                <SubagentChildList node={node} />
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

interface SquadFlowViewProps {
  /** Scope to one project (the project-scoped AgentsBoard passes this). Omitted
   *  on the global board → one graph per project that has live agents. */
  projectId?: string;
  onInspectExecution?: (projectId: string, executionId: string) => void;
}

export function SquadFlowView({ projectId, onInspectExecution }: SquadFlowViewProps = {}) {
  const compact = useCompactLayout();
  const navigate = useNavigate();
  const terminals = useData((s) => s.terminals);
  const projects = useData((s) => s.projects);
  const threads = useThreads((s) => s.threads);
  const personas = usePersonas((s) => s.personas);
  const agents = useAgentMesh((s) => s.agents);
  const messages = useAgentMesh((s) => s.messages);
  const statusById = useAgentStatus((s) => s.byId);
  const sinceById = useAgentStatus((s) => s.since);
  const subagentsById = useSubagents((s) => s.byId);
  const subagentChildrenById = useSubagentChildren((s) => s.byId);
  const includeScheduled = useData((s) => s.includeScheduledAgentsInAgentView);
  const flowAllOrganization = useData((s) => s.flowAllOrganization);
  const [executions, setExecutions] = useState<ExecutionBoardProjection[]>([]);
  const [view, setView] = useState<'overview' | 'map'>('overview');

  const threadParticipantsByProject = useMemo(
    () => modernFlowParticipants(threads, executions, personas),
    [threads, executions, personas]
  );

  useEffect(() => {
    let cancelled = false;
    if (!hasDesktopBridge()) return;
    const refresh = () => {
      const targets = projectId ? [projectId] : projects.map((project) => project.id);
      // allSettled: one project's rejection must not blank out every other
      // project's fresh data for this tick, nor its own previously-fetched
      // executions (a persistent per-project failure would otherwise silently
      // freeze `executions` forever). On rejection, fall back to whatever this
      // project last had in state.
      void Promise.allSettled(targets.map((id) => window.cc.executionBoard.listProject(id))).then(
        (results) => {
          if (cancelled) return;
          setExecutions((prev) =>
            results.flatMap((result, i) => {
              const pid = targets[i];
              if (result.status === 'fulfilled') return result.value.executions;
              console.error(
                `[SquadFlowView] executionBoard.listProject failed for project ${pid}`,
                result.reason
              );
              return prev.filter((execution) => execution.projectId === pid);
            })
          );
        }
      );
    };
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [projectId, projects]);

  // One graph per project that has live agents (or just the scoped project). Raw
  // slices only; derive behind a memo so a status tick doesn't rebuild the world
  // (render-storm guard).
  const graphs = useMemo<FlowGraph[]>(() => {
    const builtAt = Date.now();
    const byProjectId = new Map(projects.map((p) => [p.id, p]));
    const out: FlowGraph[] = [];
    const projectIds = new Set([...Object.keys(terminals), ...threadParticipantsByProject.keys()]);
    for (const pid of projectIds) {
      if (projectId && pid !== projectId) continue;
      if (!byProjectId.has(pid)) continue;
      const list = terminals[pid];
      const graph = buildSquadFlow({
        projectId: pid,
        sessions: agentViewTerminals(list, includeScheduled),
        agents: agents.filter((a) => a.projectId === pid),
        threadParticipants: threadParticipantsByProject.get(pid),
        messages: messages.filter((m) => m.projectId === pid),
        statusById,
        sinceById,
        subagentsById,
        subagentChildrenById,
        executions: executions.filter((execution) => execution.projectId === pid),
        builtAt
      });
      if (graph) out.push(graph);
    }
    return out;
  }, [
    terminals,
    projects,
    agents,
    messages,
    statusById,
    sinceById,
    subagentsById,
    subagentChildrenById,
    executions,
    projectId,
    includeScheduled,
    threadParticipantsByProject
  ]);

  const [selectedId, setSelectedId] = useState<string>();
  const selected = projectId ?? (projects.some((project) => project.id === selectedId)
    ? selectedId
    : reconcileSquadSelection(undefined, graphs) ?? projects[0]?.id);
  if (selected !== selectedId) setSelectedId(selected);

  // Project launch groups share the same live data as the combined graph.
  // A squad = one team launch (shared teamLaunchId); solo/unregistered agents
  // form one "Solo agents" bucket. For each squad we build a launch-FILTERED
  // graph so its orchestrator/edges/rollup are computed within the squad (not
  // inherited from the merged graph). Same raw slices as `graphs`, re-derived
  // behind a memo (render-storm guard). `selected` is the active project id.
  const squadDerived = useMemo(() => {
    const builtAt = Date.now();
    const pid = selected;
    if (!pid) return { groups: [] as ReturnType<typeof squadLaunchGroups>, byLaunch: new Map<string, FlowGraph>() };
    const list = terminals[pid];
    const sessions = agentViewTerminals(list, includeScheduled);
    const projAgents = agents.filter((a) => a.projectId === pid);
    const threadParticipants = threadParticipantsByProject.get(pid) ?? [];
    const projMessages = messages.filter((m) => m.projectId === pid);
    const groups = squadLaunchGroups(projAgents, sessions, threadParticipants);
    const byLaunch = new Map<string, FlowGraph>();
    for (const grp of groups) {
      const g = buildSquadFlow({
        projectId: pid,
        sessions,
        agents: projAgents,
        threadParticipants,
        messages: projMessages,
        statusById,
        sinceById,
        subagentsById,
        subagentChildrenById,
        executions: executions.filter((execution) => execution.projectId === pid),
        launchFilter: grp.launchId,
        builtAt
      });
      if (g) byLaunch.set(grp.launchId, g);
    }
    return { groups, byLaunch };
  }, [selected, terminals, agents, messages, statusById, sinceById, subagentsById, subagentChildrenById, executions, includeScheduled, threadParticipantsByProject]);

  const mergedGraph = graphs.find((graph) => graph.projectId === selected);
  const selectedProject = projects.find((project) => project.id === selected);
  const projectExecutions = executions.filter((execution) => execution.projectId === selected);
  const executionsById = new Map(projectExecutions.map((execution) => [execution.executionId, execution]));
  const runs: SquadRun[] = [];
  let solo: FlowGraph | undefined;
  for (const group of squadDerived.groups) {
    const graph = squadDerived.byLaunch.get(group.launchId);
    if (!graph) continue;
    if (group.isSolo) {
      solo = graph;
    } else {
      const execution = executionsById.get(graph.executionId ?? group.launchId);
      runs.push({
        id: group.launchId,
        graph,
        execution,
        title: execution?.jobTitle || graph.executionJobTitle || squadChipLabel(graph, runs.length + 1),
        teamName: execution?.teamName ?? graph.teamName,
        startedAt: execution?.createdAt ?? group.launchedAt
      });
      if (execution) executionsById.delete(execution.executionId);
    }
  }
  for (const execution of executionsById.values()) {
    runs.push({ id: execution.executionId, execution, title: execution.jobTitle, teamName: execution.teamName, startedAt: execution.createdAt });
  }
  runs.sort((a, b) => b.startedAt - a.startedAt);

  return (
    <SquadSurface
      key={selected}
      compact={compact}
      view={view}
      setView={setView}
      projectName={selectedProject?.name}
      projectPicker={projectId ? undefined : { selected, projects, onSelect: setSelectedId }}
      mergedGraph={mergedGraph}
      runs={runs}
      solo={solo}
      splitMap={flowAllOrganization === 'team-runs'}
      onInspectExecution={selected && onInspectExecution ? (executionId) => onInspectExecution(selected, executionId) : undefined}
      onOpenMember={(node) => {
        if (!selected) return;
        if (node.inspectionTarget.type === 'thread') inspectThread(node.inspectionTarget.id, selected, navigate);
        else inspectAgentSession(node.inspectionTarget.id, selected, navigate);
      }}
    />
  );
}

interface SquadRun {
  id: string;
  title: string;
  teamName?: string;
  startedAt: number;
  graph?: FlowGraph;
  execution?: ExecutionBoardProjection;
}

interface SquadSurfaceProps {
  compact: boolean;
  view: 'overview' | 'map';
  setView: (view: 'overview' | 'map') => void;
  projectName?: string;
  projectPicker?: {
    selected?: string;
    projects: readonly { id: string; name: string }[];
    onSelect: (id: string) => void;
  };
  mergedGraph?: FlowGraph;
  solo?: FlowGraph;
  runs: SquadRun[];
  splitMap: boolean;
  onInspectExecution?: (executionId: string) => void;
  onOpenMember: (node: SquadFlowNode) => void;
}

function SquadSurface({ compact, view, setView, projectName, projectPicker, mergedGraph, solo, runs, splitMap, onInspectExecution, onOpenMember }: SquadSurfaceProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<SquadStatusFilter>('all');
  const [selectedRun, setSelectedRun] = useState(ALL_SQUADS);
  const [selectedMember, setSelectedMember] = useState<string>();
  const trigger = useRef<HTMLButtonElement>(null);
  const now = mergedGraph?.builtAt ?? Date.now();
  const query = search.trim().toLowerCase();
  const memberQuery = matchesSquadSearch(query, projectName) ? '' : query;
  const mapOnly = view === 'map';
  const matchingRuns = runs.flatMap((run) => {
    const question = squadQuestion(run.execution);
    const state = run.execution?.state;
    const runMatches = matchesSquadSearch(memberQuery, run.title, run.teamName, question, run.execution?.executionId, state && runStates[state]);
    const nodes = (run.graph?.nodes ?? []).filter((node) => runMatches || matchesSquadMemberSearch(node, now, memberQuery));
    if (!runMatches && nodes.length === 0) return [];
    const status = squadRunStatus(run.execution, question, nodes, now);
    return [{ ...run, nodes, question, status }];
  });
  const matchingSolo = (solo?.nodes ?? []).filter((node) => matchesSquadMemberSearch(node, now, memberQuery));
  const counts = squadStatusCounts(matchingSolo, now);
  counts.all += matchingRuns.length;
  for (const run of matchingRuns) counts[run.status] += 1;
  // Overview filters top-level rows. Keep a matching run's roster together.
  const visibleRuns = matchingRuns.filter((run) => filter === 'all' || run.status === filter);
  visibleRuns.sort((a, b) => Number(!!b.question) - Number(!!a.question));
  const soloNodes = matchingSolo.filter((node) => filter === 'all' || squadMemberStatus(node, now) === filter);
  const detail = [...soloNodes, ...visibleRuns.flatMap((run) => run.nodes)].find((node) => node.sessionId === selectedMember);
  const statusOptions = Object.keys(squadStatuses) as SquadStatusFilter[];
  const mapRuns = mapOnly ? visibleRuns
    .map((run) => ({ ...run, nodes: run.nodes.filter((node) => filter === 'all' || squadMemberStatus(node, now) === filter) }))
    .filter((run) => run.graph && run.nodes.length > 0) : [];
  const chosenRun = mapRuns.find((run) => run.id === selectedRun);
  const graphs = (chosenRun ? [chosenRun] : mapRuns).flatMap((run) => run.graph ? [sliceSquadGraph(run.graph, run.nodes)] : []);
  const soloGraph = mapOnly && !chosenRun && solo ? sliceSquadGraph(solo, soloNodes) : undefined;
  if (soloGraph?.edges.length) graphs.push(soloGraph);

  let mapGraphs = graphs;
  if (mergedGraph && !chosenRun && !splitMap && graphs.length > 1) {
    const mapIds = new Set(graphs.flatMap((graph) => graph.nodes.map((node) => node.sessionId)));
    mapGraphs = [sliceSquadGraph(mergedGraph, mergedGraph.nodes.filter((node) => mapIds.has(node.sessionId)))];
  }

  const clearMember = () => setSelectedMember(undefined);
  const closeMember = () => {
    clearMember();
    trigger.current?.focus();
  };
  const chooseMember = (node: SquadFlowNode, button: HTMLButtonElement) => {
    trigger.current = button;
    setSelectedMember(node.sessionId);
  };
  const changeFilter = (next: SquadStatusFilter) => {
    setFilter(next);
    if (next === 'done') setView('overview');
    clearMember();
  };
  const questionButton = (run: SquadRun & { question?: string }, includeRunTitle: boolean) => run.question && (
    <button type="button" className="squad-attention" key={run.id} disabled={!onInspectExecution || !run.execution} onClick={() => {
      if (run.execution) onInspectExecution?.(run.execution.executionId);
    }}>
      <strong>Needs you</strong><span>{run.question}{includeRunTitle && <small>{run.title}</small>}</span>
      <ChevronRight size={16} aria-hidden="true" />
    </button>
  );
  const hasContent = runs.length > 0 || (solo?.nodes.length ?? 0) > 0;
  const hasMatches = visibleRuns.length > 0 || soloNodes.length > 0;
  const showSolo = soloNodes.length > 0 && !(mapOnly && soloGraph?.edges.length);

  return (
    <section className="squad-flow squad-overview" aria-label="Squads" onKeyDown={(event) => {
      if (event.key === 'Escape' && detail) {
        event.stopPropagation();
        closeMember();
      }
    }}>
      <header className="squad-overview-header">
        <h1>Squads</h1>
        {projectPicker && projectPicker.projects.length > 0 && (
          <label className="squad-select">Project
            <select value={projectPicker.selected ?? ''} onChange={(event) => projectPicker.onSelect(event.target.value)}>
              {projectPicker.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
        )}
      </header>
      <div className="squad-overview-tools">
        <div className="squad-view-switch" role="group" aria-label="Squad display">
          <button type="button" aria-pressed={!mapOnly} onClick={() => setView('overview')}><LayoutList size={15} aria-hidden="true" />Overview</button>
          <button type="button" aria-pressed={mapOnly} onClick={() => {
            if (filter === 'done') changeFilter('all');
            clearMember();
            setView('map');
          }}><Workflow size={15} aria-hidden="true" />Map</button>
        </div>
        <label className="squad-search">
          <Search size={15} aria-hidden="true" />
          <input type="search" aria-label="Search agents and runs" placeholder="Search agents and runs…" value={search} onChange={(event) => {
            setSearch(event.target.value);
            clearMember();
          }} />
        </label>
      </div>
      {hasContent && (
        <div className="squad-status-filters" role="group" aria-label="Filter Squad runs and solo agents">
          {mainSquadFilters.map((status) => (
            <button type="button" key={status} className="squad-filter-tile" aria-pressed={filter === status} data-status={status} onClick={() => changeFilter(status)}>
              <strong>{counts[status]}</strong><span>{squadStatuses[status]}</span>
            </button>
          ))}
          {statusOptions.some((status) => !mainSquadFilters.some((primary) => status === primary) && counts[status] > 0) && (
            <label className="squad-select squad-other-statuses">Status
              <select value={filter} onChange={(event) => changeFilter(event.target.value as SquadStatusFilter)}>
                {statusOptions.filter((status) => status === 'all' || counts[status] > 0 || status === filter)
                  .map((status) => <option key={status} value={status}>{squadStatuses[status]} ({counts[status]})</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      <div className={detail ? 'squad-content squad-content--inspecting' : 'squad-content'}>
        <div className="squad-content-main">
          {mapOnly && visibleRuns.map((run) => questionButton(run, true))}
          {!mapOnly && visibleRuns.length > 0 && (
            <section aria-label="Squad runs">
              <h2 className="squad-section-title">Squad runs <small>{visibleRuns.length}</small></h2>
              {visibleRuns.map((run) => (
                <section className="squad-surface squad-run" aria-label={run.title} key={run.id}>
                  <div className="squad-run-header">
                    <span className="squad-roster-icon"><Workflow size={15} aria-hidden="true" /></span>
                    <div className="squad-roster-body">
                      <h3>{run.title}</h3>
                      <small>{[run.teamName && run.teamName !== run.title ? run.teamName : undefined,
                        run.execution && `Run ${shortRunId(run.execution.executionId)}`,
                        run.graph && `${run.graph.nodes.length} ${run.graph.nodes.length === 1 ? 'agent' : 'agents'}`].filter(Boolean).join(' · ')}</small>
                    </div>
                    {run.execution && !run.question && (
                      <span className="squad-status" data-status={run.execution.state === 'COMPLETED' ? 'done' : undefined}>{runStates[run.execution.state]}</span>
                    )}
                    {run.execution && onInspectExecution && (
                      <button className="btn squad-run-open" type="button" aria-label={`Open Squad details for ${run.title}`} onClick={() => onInspectExecution(run.execution!.executionId)}>
                        Details <ChevronRight size={14} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  {questionButton(run, false)}
                  <SquadRoster nodes={run.nodes} now={now} selectedId={selectedMember} onSelect={chooseMember} questionPinned={!!run.question} />
                </section>
              ))}
            </section>
          )}
          {mapOnly && hasMatches && (
            <SquadMap compact={compact} graphs={mapGraphs} runs={mapRuns} selectedRun={chosenRun?.id ?? ALL_SQUADS}
              onSelect={setSelectedRun} onInspectExecution={onInspectExecution} />
          )}
          {showSolo && (
            <section aria-label={SOLO_GROUP_LABEL}>
              <h2 className="squad-section-title">{SOLO_GROUP_LABEL} <small>{soloNodes.length}</small></h2>
              <div className="squad-surface">
                <SquadRoster nodes={soloNodes} now={now} selectedId={selectedMember} onSelect={chooseMember} key={filter} solo />
              </div>
            </section>
          )}
          {!mapOnly && hasMatches && !runs.length && <p className="squad-surface squad-empty">No Squad runs in this project.</p>}
          {!hasMatches && (
            <div className="squad-surface squad-empty" role="status">
              <strong>{hasContent ? 'No matching agents or Squad runs' : 'No agents or Squad runs in this project'}</strong>
              {hasContent && <button type="button" className="btn" onClick={() => { setSearch(''); changeFilter('all'); }}>Clear filters</button>}
            </div>
          )}
        </div>
        {detail && (
          <SquadMemberDetails node={detail} now={now} onClose={closeMember} onOpen={onOpenMember} onInspectExecution={onInspectExecution} />
        )}
      </div>
    </section>
  );
}

function SquadMap({ compact, graphs, runs, selectedRun, onSelect, onInspectExecution }: {
  compact: boolean;
  graphs: FlowGraph[];
  runs: SquadRun[];
  selectedRun: string;
  onSelect: (id: string) => void;
  onInspectExecution?: (executionId: string) => void;
}) {
  const { isPanning, canvasPanProps } = useCanvasPan();
  if (!graphs.length) return <p className="squad-surface squad-empty">No Squad members to map in this selection.</p>;
  const edges = graphs.flatMap((graph) => graph.edges);
  const hasMessages = edges.some((edge) => edge.kind !== 'work-dependency');
  const hasDependencies = edges.some((edge) => edge.kind === 'work-dependency');
  const stacked = graphs.length > 1;
  return (
    <section aria-label="Squad map">
      <div className="squad-map-heading">
        <div className="squad-map-legend">
          {hasMessages && <span><ArrowRight size={15} aria-hidden="true" /> Agent message</span>}
          {hasDependencies && <span><span className="squad-dependency-dash" aria-hidden="true" /> Work dependency</span>}
          {!edges.length && <span>No handoffs in this selection yet</span>}
          {compact && <span>Swipe to explore</span>}
        </div>
        {runs.length > 1 && <label className="squad-select">Run
          <select value={selectedRun} onChange={(event) => onSelect(event.target.value)}>
            <option value={ALL_SQUADS}>All Squad runs</option>
            {runs.map((run) => <option key={run.id} value={run.id}>{run.title}{run.execution ? ` · ${shortRunId(run.execution.executionId)}` : ''}</option>)}
          </select>
        </label>}
      </div>
      {stacked ? (
        <div
          className={`squad-flow-run-groups${isPanning ? ' is-panning' : ''}`}
          aria-label={compact ? 'Agent canvases. Swipe to explore.' : 'Squad run canvases. Drag empty space to pan.'}
          {...(!compact ? canvasPanProps : {})}
        >
          {graphs.map((graph) => (
            <SquadGraph key={graph.executionId ?? graph.nodes[0]?.sessionId} graph={graph} pannable={false} questionsPinned
              onInspectExecution={onInspectExecution ? (_, executionId) => onInspectExecution(executionId) : undefined} />
          ))}
        </div>
      ) : (
        <SquadGraph key={selectedRun} graph={graphs[0]} questionsPinned
          onInspectExecution={onInspectExecution ? (_, executionId) => onInspectExecution(executionId) : undefined} />
      )}
    </section>
  );
}
