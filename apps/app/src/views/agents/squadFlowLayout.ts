/**
 * Squad Flow canvas geometry — the hand-rolled layered layout (no graph
 * library) and the orthogonal edge router behind {@link SquadGraph}.
 * Pure functions of the graph, so placement is unit-testable without a DOM.
 */
import type { SquadFlowGraph, SquadFlowNode } from '@zana-ai/zcc-domain/product';
import type { FlowPoint } from '@/lib/squadFlowBounds';

export const NODE_W = 244;
// Card heights mirror the `.squad-flow-node*` rules in global.css, which pin
// every line to a fixed height so the inline card height can be a hard cap:
// border 1+1, padding 11+11, top row 20, body gap 6, status row 20.
export const NODE_H = 70;
// Body gap 6 + one `.squad-flow-node-blocker` / `-coord` line of 16.
export const BLOCKER_H = 22;
// Card gap 5 + `.squad-flow-children` margin-top 8, border-top 1, padding-top 8.
export const CHILDREN_PAD = 22;
// One `.squad-flow-child` / `.squad-flow-child-more` line, and the gap between.
export const CHILD_ROW_H = 16;
export const CHILD_GAP = 4;
export const COL_GAP = 26;
export const ROW_GAP = 96;
export const PAD_X = 24;
export const EDGE_OFFSET = 22;
export const PAD_TOP = EDGE_OFFSET + 16;

/** Max child rows rendered in a node card before collapsing to "+N more". */
export const MAX_VISIBLE_CHILDREN = 4;

export interface Placed {
  node: SquadFlowNode;
  x: number;
  y: number;
  height: number;
}

/** Which job notice line a card renders, if any. The card's render and
 *  {@link nodeHeight} both read this, so the estimate cannot drift. */
export function nodeNotice(node: SquadFlowNode): 'blocker' | 'coordinator' | undefined {
  const job = node.job;
  if (!job?.blockerQuestion) return undefined;
  if (job.blockerAudience === 'coordinator') return 'coordinator';
  return job.needsAttention ? 'blocker' : undefined;
}

/** Named child rows shown, and the "+N more" remainder reconciled against the
 *  authoritative `liveSubagents` count (sub-agents whose hook payload was lost
 *  count but have no record). Shared by the card render and {@link nodeHeight}. */
export function childRowCounts(node: SquadFlowNode): { visible: number; hidden: number } {
  const n = node.subagentChildren?.length ?? 0;
  const visible = Math.min(n, MAX_VISIBLE_CHILDREN);
  return { visible, hidden: n === 0 ? 0 : Math.max(node.liveSubagents, n) - visible };
}

/** Rendered card height (border-box), set inline so layout and DOM agree. */
export function nodeHeight(node: SquadFlowNode): number {
  const { visible, hidden } = childRowCounts(node);
  const rows = visible + (hidden > 0 ? 1 : 0);
  const childSection = rows === 0 ? 0 : CHILDREN_PAD + rows * CHILD_ROW_H + (rows - 1) * CHILD_GAP;
  return NODE_H + childSection + (nodeNotice(node) ? BLOCKER_H : 0);
}

/** Orchestrator centered on row 0; everyone else laid out in wrapping rows
 *  below, each row as tall as its tallest card. Deterministic (input order) so
 *  the graph doesn't jump between ticks. */
export function layout(graph: SquadFlowGraph, width: number): { placed: Placed[]; height: number } {
  // A merged (all-launches) graph can hold one orchestrator per launch; all of
  // them lead the rows so every launch's edges have a placed source.
  const orchestrators = graph.nodes.filter((n) => n.isOrchestrator);
  const workers = graph.nodes.filter((n) => !n.isOrchestrator);
  const perRow = Math.max(1, Math.floor((width - PAD_X * 2 + COL_GAP) / (NODE_W + COL_GAP)));
  const placed: Placed[] = [];
  let bottom = PAD_TOP;
  let rowTop = PAD_TOP;

  for (const tier of [orchestrators, workers]) {
    for (let start = 0; start < tier.length; start += perRow) {
      const row = tier.slice(start, start + perRow);
      const rowWidth = row.length * NODE_W + (row.length - 1) * COL_GAP;
      const startX = (width - rowWidth) / 2;
      let rowHeight = 0;
      row.forEach((node, col) => {
        const height = nodeHeight(node);
        rowHeight = Math.max(rowHeight, height);
        placed.push({ node, x: startX + col * (NODE_W + COL_GAP), y: rowTop, height });
      });
      bottom = rowTop + rowHeight;
      rowTop = bottom + ROW_GAP;
    }
  }

  return { placed, height: Math.max(bottom + PAD_TOP, NODE_H + PAD_TOP * 2) };
}

/** Drop consecutive duplicate + collinear waypoints so the rounded-corner
 *  builder never sees a zero-length segment (which would break the arc math). */
export function simplify(pts: FlowPoint[]): FlowPoint[] {
  const out: FlowPoint[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    out.push(p);
  }
  // Remove collinear middles (a→b→c straight): keep endpoints only.
  const kept: FlowPoint[] = [];
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

/**
 * Orthogonal, rounded-corner route from source (exits bottom) to target
 * (enters top) — the "goes around" look of the Agentforce flow builder.
 *  - Target clearly below → S-route: down, across at mid-Y, down.
 *  - Target above / too close (a reply handoff) → route around a side lane so
 *    the edge never cuts back through the source node.
 */
export function edgeRoute(from: Placed, to: Placed): FlowPoint[] {
  const sx = from.x + NODE_W / 2;
  const sy = from.y + from.height;
  const tx = to.x + NODE_W / 2;
  const ty = to.y;
  const pts: FlowPoint[] = [{ x: sx, y: sy }];

  if (ty >= sy + EDGE_OFFSET * 2) {
    // Standard downward handoff: horizontal channel at the vertical midpoint.
    const midY = (sy + ty) / 2;
    pts.push({ x: sx, y: midY }, { x: tx, y: midY });
  } else {
    // Back-edge (target at/above source): drop out, run along a side lane, and
    // climb up to enter the target from the top.
    const outY = sy + EDGE_OFFSET;
    const inY = Math.max(ty - EDGE_OFFSET, 4);
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
  return simplify(pts);
}
