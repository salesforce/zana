import { useCallback, useMemo, useRef, useState } from 'react';
import { ChevronRight, GitPullRequest, Hash, Workflow } from 'lucide-react';
import type { SquadFlowGraph, SquadFlowNode } from '@shared/types';
import {
  useData,
  useUi,
  useAgentMesh,
  useAgentStatus,
  useSubagents,
  useSubagentChildren,
  listedTerminals
} from '../store';
import { buildSquadFlow } from '../util/squadFlow';
import {
  ALL_SQUADS,
  reconcileSquadLaunchSelection,
  squadLaunchGroups
} from '../util/squadLaunchGroups';
import { SquadSwitcher, type SquadSwitcherItem } from './SquadSwitcher';

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
 * behind a `useMemo`, mirroring how {@link GlobalAgentsBoard} derives its cards
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
 * The solo bucket gets a fixed "Solo agents" label.
 */
function squadChipLabel(graph: SquadFlowGraph, isSolo: boolean, ordinal: number): string {
  if (isSolo) return 'Solo agents';
  const orch = graph.nodes.find((n) => n.isOrchestrator);
  if (orch) return prettyLabel(orch.label);
  if (graph.squad?.name) return graph.squad.name;
  return `Squad ${ordinal}`;
}

const STATE_VERB: Record<SquadFlowNode['state'], string> = {
  working: 'working',
  blocked: 'needs you',
  done: 'done',
  idle: 'idle',
  unknown: 'idle'
};

/** Max child rows rendered in a node card before collapsing to "+N more". */
const MAX_VISIBLE_CHILDREN = 4;

/**
 * Named sub-agent child rows nested inside a parent node card. Renders nothing
 * when no identity was captured — the parent's count badge is the fallback.
 * A "+N more" chip reconciles the visible rows (and any children whose hook
 * payload was lost) against the authoritative `liveSubagents` count.
 */
function SubagentChildList({ node }: { node: SquadFlowNode }) {
  const children = node.subagentChildren;
  if (!children?.length) return null;
  const visible = children.slice(0, MAX_VISIBLE_CHILDREN);
  // "+N more" reconciles two things against the authoritative count: named rows
  // we collapsed past the visible cap, AND sub-agents whose hook payload was
  // lost (so they count but have no record). max(count, records) − visible.
  const hidden = Math.max(node.liveSubagents, children.length) - visible.length;
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

// ---- layout (hand-rolled layered graph; no graph library) -------------------

const NODE_W = 244;
const NODE_H = 88;
const COL_GAP = 26;
const ROW_GAP = 96;
const PAD_X = 24;
const PAD_TOP = 16;

interface Placed {
  node: SquadFlowNode;
  x: number;
  y: number;
}

/** Orchestrator centered on row 0; everyone else laid out in a wrapping row
 *  below. Deterministic (input order) so the graph doesn't jump between ticks. */
function layout(graph: SquadFlowGraph, width: number): { placed: Placed[]; height: number } {
  const orchestrator = graph.nodes.find((n) => n.isOrchestrator);
  const workers = graph.nodes.filter((n) => !n.isOrchestrator);
  const perRow = Math.max(1, Math.floor((width - PAD_X * 2 + COL_GAP) / (NODE_W + COL_GAP)));
  const placed: Placed[] = [];

  if (orchestrator) {
    placed.push({ node: orchestrator, x: (width - NODE_W) / 2, y: PAD_TOP });
  }

  const workerTop = PAD_TOP + (orchestrator ? NODE_H + ROW_GAP : 0);
  workers.forEach((node, i) => {
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, workers.length - row * perRow);
    const rowWidth = inRow * NODE_W + (inRow - 1) * COL_GAP;
    const startX = (width - rowWidth) / 2;
    const col = i % perRow;
    placed.push({
      node,
      x: startX + col * (NODE_W + COL_GAP),
      y: workerTop + row * (NODE_H + ROW_GAP)
    });
  });

  const rows = Math.ceil(workers.length / perRow);
  // Base height budgets NODE_H=86 per row. Add bottom slack (140px) to ensure
  // maximally-tall cards (4+ sub-agent children) remain reachable — the button's
  // overflow:hidden clips content taller than NODE_H, so it won't auto-extend
  // the scroll container. 140px accommodates the max child section overflow (~116px)
  // plus breathing room. (A3 height-padding fix — frontend-dev-2 2026-06-22)
  const height = workerTop + rows * NODE_H + Math.max(0, rows - 1) * ROW_GAP + PAD_TOP + 140;
  return { placed, height: Math.max(height, NODE_H + PAD_TOP * 2) };
}

interface Pt {
  x: number;
  y: number;
}

/** Drop consecutive duplicate + collinear waypoints so the rounded-corner
 *  builder never sees a zero-length segment (which would break the arc math). */
function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    out.push(p);
  }
  // Remove collinear middles (a→b→c straight): keep endpoints only.
  const kept: Pt[] = [];
  for (let i = 0; i < out.length; i++) {
    if (i === 0 || i === out.length - 1) {
      kept.push(out[i]);
      continue;
    }
    const a = out[i - 1];
    const b = out[i];
    const c = out[i + 1];
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(cross) < 0.5) continue; // collinear → skip b
    kept.push(b);
  }
  return kept;
}

/** Build an orthogonal path through `pts` with rounded (quadratic) corners —
 *  the smooth-step look from the Agentforce flow builder. */
function roundedPath(pts: Pt[], radius: number): string {
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

const EDGE_RADIUS = 14; // corner radius for the rounded orthogonal routing
const EDGE_OFFSET = 22; // how far an edge steps out of a node before turning

/**
 * Orthogonal, rounded-corner route from source (exits bottom) to target
 * (enters top) — the "goes around" look of the Agentforce flow builder.
 *  - Target clearly below → S-route: down, across at mid-Y, down.
 *  - Target above / too close (a reply handoff) → route around a side lane so
 *    the edge never cuts back through the source node.
 */
function edgePath(from: Placed, to: Placed): string {
  const sx = from.x + NODE_W / 2;
  const sy = from.y + NODE_H;
  const tx = to.x + NODE_W / 2;
  const ty = to.y;
  const pts: Pt[] = [{ x: sx, y: sy }];

  if (ty >= sy + EDGE_OFFSET * 2) {
    // Standard downward handoff: horizontal channel at the vertical midpoint.
    const midY = (sy + ty) / 2;
    pts.push({ x: sx, y: midY }, { x: tx, y: midY });
  } else {
    // Back-edge (target at/above source): drop out, run along a side lane, and
    // climb up to enter the target from the top.
    const outY = sy + EDGE_OFFSET;
    const inY = ty - EDGE_OFFSET;
    // Pick a vertical lane between the nodes; if they're near-stacked, push the
    // lane clear of both node bodies so the route doesn't overlap them.
    const gap = Math.abs(tx - sx);
    const laneX =
      gap < NODE_W ? Math.max(sx, tx) + NODE_W / 2 + EDGE_OFFSET : (sx + tx) / 2;
    pts.push(
      { x: sx, y: outY },
      { x: laneX, y: outY },
      { x: laneX, y: inY },
      { x: tx, y: inY }
    );
  }

  pts.push({ x: tx, y: ty });
  return roundedPath(pts, EDGE_RADIUS);
}

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
  strokeWidth,
  animate
}: {
  path: string;
  hot: boolean;
  pending: boolean;
  strokeWidth: number;
  animate: boolean;
}) {
  const dur = hot ? FLOW_DUR_HOT : FLOW_DUR;
  const chevron = hot ? '0,-4.5 8,0 0,4.5' : '0,-3.5 6.5,0 0,3.5';
  return (
    <g>
      <path
        d={path}
        className={`squad-flow-edge ${hot ? 'squad-flow-edge--hot' : ''} ${pending ? 'squad-flow-edge--pending' : ''}`}
        markerEnd={hot ? 'url(#sf-arrow-hot)' : 'url(#sf-arrow)'}
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

const DRAG_THRESHOLD = 4;

function SquadGraph({ graph }: { graph: SquadFlowGraph }) {
  const width = 1100;
  const now = graph.builtAt;
  const { placed, height } = useMemo(() => layout(graph, width), [graph, width]);

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

  const newestTs = graph.edges.reduce((mx, e) => Math.max(mx, e.lastTs), 0);
  const rollup = graph.summary;

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
        useUi.getState().openAgentModal(drag.sessionId, graph.projectId);
      }
    },
    [graph.projectId]
  );

  return (
    <section className="squad-flow-squad">
      <header className="squad-flow-head">
        <span className="squad-flow-icon" aria-hidden="true">
          {graph.squad?.icon ?? '🤖'}
        </span>
        <span className="squad-flow-name">{graph.squad?.name ?? 'Squad'}</span>
        <span className="squad-flow-rollup">
          {rollup.working > 0 && <em className="squad-flow-stat agent-working">{rollup.working} working</em>}
          {rollup.blocked > 0 && <em className="squad-flow-stat agent-blocked">{rollup.blocked} blocked</em>}
          {rollup.idle > 0 && <em className="squad-flow-stat agent-idle">{rollup.idle} idle</em>}
          {rollup.exited > 0 && <em className="squad-flow-stat">{rollup.exited} exited</em>}
          <em className="squad-flow-stat squad-flow-stat--total">{rollup.total} total</em>
        </span>
      </header>

      <div className="squad-flow-canvas">
        <div className="squad-flow-content" style={{ width, height }}>
          <svg
            className="squad-flow-edges"
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            aria-hidden="true"
          >
            <defs>
              <marker id="sf-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
                <path d="M0,0 L9,4.5 L0,9 z" className="squad-flow-arrowhead" />
              </marker>
              <marker id="sf-arrow-hot" markerWidth="10" markerHeight="10" refX="7" refY="5" orient="auto">
                <path d="M0,0 L10,5 L0,10 z" className="squad-flow-arrowhead-hot" />
              </marker>
            </defs>
            {graph.edges.map((e) => {
              const from = byId.get(e.fromSessionId);
              const to = byId.get(e.toSessionId);
              if (!from || !to) return null;
              const hot = e.lastTs === newestTs && newestTs > 0;
              return (
                <FlowEdge
                  key={`${e.fromSessionId}->${e.toSessionId}`}
                  path={edgePath(from, to)}
                  hot={hot}
                  pending={e.pending}
                  strokeWidth={Math.min(4, 1.5 + (e.count - 1) * 0.6)}
                  animate={animateFlow}
                />
              );
            })}
          </svg>

          {resolvedPlaced.map(({ node, x, y }) => {
            const verb = STATE_VERB[node.state];
            const since = node.exited ? '' : sinceLabel(node.stateSince, now);
            const isDragging = draggingId === node.sessionId;
            return (
              <button
                key={node.sessionId}
                type="button"
                className={`squad-flow-node ${node.isOrchestrator ? 'squad-flow-node--orch' : ''} ${node.exited ? 'squad-flow-node--exited' : ''} ${isDragging ? 'squad-flow-node--dragging' : ''}`}
                style={{ left: x, top: y, width: NODE_W }}
                onPointerDown={(e) => handlePointerDown(e, node, x, y)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                title={node.handle ?? node.displayName ?? node.sessionId}
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
                      <span className="squad-flow-node-label">{prettyLabel(node.label)}</span>
                      {node.isOrchestrator && (
                        <span className="squad-flow-orch-tag" title="Team lead — close it to end the whole team">
                          lead
                        </span>
                      )}
                    </span>
                    <span className="squad-flow-node-state">
                      <span
                        className={`squad-flow-state-text agent-${node.exited ? 'done' : node.state}`}
                      >
                        {node.exited ? 'exited' : verb}
                        {since ? ` · ${since}` : ''}
                      </span>
                      {node.role && <span className="squad-flow-node-role">{node.role}</span>}
                      {node.liveSubagents > 0 && !node.subagentChildren?.length && (
                        <span
                          className="squad-flow-subagents"
                          title={`${node.liveSubagents} sub-agent${node.liveSubagents === 1 ? '' : 's'} running`}
                        >
                          {node.liveSubagents} sub-agent{node.liveSubagents === 1 ? '' : 's'}
                        </span>
                      )}
                    </span>
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
  /** Scope to one project (the per-project board passes this). Omitted on the
   *  global board → one graph per project that has live agents. */
  projectId?: string;
}

export function SquadFlowView({ projectId }: SquadFlowViewProps = {}) {
  const terminals = useData((s) => s.terminals);
  const projects = useData((s) => s.projects);
  const agents = useAgentMesh((s) => s.agents);
  const messages = useAgentMesh((s) => s.messages);
  const statusById = useAgentStatus((s) => s.byId);
  const sinceById = useAgentStatus((s) => s.since);
  const subagentsById = useSubagents((s) => s.byId);
  const subagentChildrenById = useSubagentChildren((s) => s.byId);

  // One graph per project that has live agents (or just the scoped project). Raw
  // slices only; derive behind a memo so a status tick doesn't rebuild the world
  // (render-storm guard).
  const graphs = useMemo<SquadFlowGraph[]>(() => {
    const builtAt = Date.now();
    const byProjectId = new Map(projects.map((p) => [p.id, p]));
    const out: SquadFlowGraph[] = [];
    for (const [pid, list] of Object.entries(terminals)) {
      if (projectId && pid !== projectId) continue;
      if (!byProjectId.has(pid)) continue;
      const graph = buildSquadFlow({
        projectId: pid,
        sessions: listedTerminals(list),
        agents: agents.filter((a) => a.projectId === pid),
        messages: messages.filter((m) => m.projectId === pid),
        statusById,
        sinceById,
        subagentsById,
        subagentChildrenById,
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
    projectId
  ]);

  const byProjectId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  // In-memory sticky selection: keep the chosen squad while it exists; new
  // squads don't steal focus; fall back to the first when the selection exits.
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const selected = reconcileSquadSelection(selectedId, graphs);
  // Commit the reconciled id back to state ONLY when it differs, or we'd loop.
  if (selected !== selectedId) setSelectedId(selected);

  // "New" cue: projectIds present when the first selection was committed. Any
  // squad not in this set is "new" until selected. Ref so it survives renders
  // but resets on reload (consistent with in-memory selection).
  const seenRef = useRef<Set<string> | null>(null);
  if (seenRef.current === null && graphs.length > 0) {
    seenRef.current = new Set(graphs.map((g) => g.projectId));
  }
  const seen = seenRef.current ?? new Set<string>();

  // ---- second picker: split the ACTIVE project's mesh into its squads -------
  // A squad = one team launch (shared teamLaunchId); solo/unregistered agents
  // form one "Solo agents" bucket. For each squad we build a launch-FILTERED
  // graph so its orchestrator/edges/rollup are computed within the squad (not
  // inherited from the merged graph). Same raw slices as `graphs`, re-derived
  // behind a memo (render-storm guard). `selected` is the active project id.
  const squadDerived = useMemo(() => {
    const builtAt = Date.now();
    const pid = selected;
    if (!pid) return { groups: [] as ReturnType<typeof squadLaunchGroups>, byLaunch: new Map<string, SquadFlowGraph>() };
    const list = terminals[pid];
    const sessions = listedTerminals(list);
    const projAgents = agents.filter((a) => a.projectId === pid);
    const projMessages = messages.filter((m) => m.projectId === pid);
    const groups = squadLaunchGroups(projAgents, sessions);
    const byLaunch = new Map<string, SquadFlowGraph>();
    for (const grp of groups) {
      const g = buildSquadFlow({
        projectId: pid,
        sessions,
        agents: projAgents,
        messages: projMessages,
        statusById,
        sinceById,
        subagentsById,
        subagentChildrenById,
        launchFilter: grp.launchId,
        builtAt
      });
      if (g) byLaunch.set(grp.launchId, g);
    }
    return { groups, byLaunch };
  }, [selected, terminals, agents, messages, statusById, sinceById, subagentsById, subagentChildrenById]);

  const groupIds = squadDerived.groups.map((g) => g.launchId);

  // Sticky squad selection — defaults to the most-recent squad (not "All").
  const [selectedLaunch, setSelectedLaunch] = useState<string | undefined>(undefined);
  const selectedSquad = reconcileSquadLaunchSelection(selectedLaunch, groupIds);
  if (selectedSquad !== selectedLaunch) setSelectedLaunch(selectedSquad);

  // Per-project "new squad" cue: snapshot the launch ids present when a project
  // is first viewed; any launch id appearing later is "new" until selected.
  const seenLaunchRef = useRef<Map<string, Set<string>>>(new Map());
  let seenLaunch = selected ? seenLaunchRef.current.get(selected) : undefined;
  if (selected && !seenLaunch && groupIds.length > 0) {
    seenLaunch = new Set(groupIds);
    seenLaunchRef.current.set(selected, seenLaunch);
  }

  if (graphs.length === 0) {
    return (
      <div className="squad-flow-empty">
        <Workflow size={28} aria-hidden="true" />
        <h4>No squads running</h4>
        <p>
          When you launch a team, its members appear here as a live flow — who&rsquo;s working,
          who&rsquo;s blocked, and how work hands off between them.
        </p>
      </div>
    );
  }

  const items: SquadSwitcherItem[] = graphs.map((g) => {
    const project = byProjectId.get(g.projectId);
    return {
      id: g.projectId,
      label: g.squad?.name ?? project?.name ?? g.projectId,
      icon: g.squad?.icon ?? '🤖',
      color: project?.color,
      working: g.summary.working,
      isNew: !seen.has(g.projectId) && g.projectId !== selected
    };
  });

  const mergedGraph = graphs.find((g) => g.projectId === selected) ?? graphs[0];

  // Squad-row chips: "All squads" (the merged graph) + one per launch group.
  const { groups, byLaunch } = squadDerived;
  const seenLaunchSet = seenLaunch ?? new Set<string>();
  let realOrdinal = 0;
  const squadItems: SquadSwitcherItem[] = [
    {
      id: ALL_SQUADS,
      label: 'All squads',
      icon: '🗂️',
      working: mergedGraph.summary.working,
      isNew: false
    },
    ...groups.map((grp): SquadSwitcherItem => {
      const g = byLaunch.get(grp.launchId);
      if (!grp.isSolo) realOrdinal += 1;
      return {
        id: grp.launchId,
        label: g ? squadChipLabel(g, grp.isSolo, realOrdinal) : grp.launchId,
        icon: grp.isSolo ? '👤' : '🤖',
        working: g?.summary.working ?? 0,
        isNew: !seenLaunchSet.has(grp.launchId) && grp.launchId !== selectedSquad
      };
    })
  ];

  // The graph to render: the merged view for "All", else the selected squad's
  // filtered graph (falling back to merged if that squad just vanished).
  const activeGraph =
    selectedSquad === ALL_SQUADS ? mergedGraph : byLaunch.get(selectedSquad) ?? mergedGraph;

  return (
    <div className="squad-flow">
      {graphs.length > 1 && (
        <SquadSwitcher items={items} selected={selected} onSelect={setSelectedId} ariaLabel="Projects" />
      )}
      {groups.length > 1 && (
        <SquadSwitcher
          items={squadItems}
          selected={selectedSquad}
          onSelect={setSelectedLaunch}
          ariaLabel="Squads in project"
        />
      )}
      <SquadGraph key={`${activeGraph.projectId}:${selectedSquad}`} graph={activeGraph} />
    </div>
  );
}
