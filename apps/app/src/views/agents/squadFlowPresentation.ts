import type { ExecutionBoardProjection, SquadFlowNode } from '@zana-ai/zcc-domain/product';
import type { FlowGraph } from '@/lib/squadFlow';

/**
 * Activity treatment for one node, split into tiers so the graph shows motion for
 * ANY genuinely-working node even when it draws no edges (a single-worker linear DAG
 * has zero handoffs — the "no arrows, looks dead" gap) WITHOUT ever fabricating motion
 * for a node that is not actually working.
 *
 *  - `working` (→ static border accent + self-arc): the node is ACTUALLY doing work.
 *    "Actually" means real liveness evidence — it is `streaming` (fresh output, below),
 *    OR its live agent-mesh dot reads 'working'. A bare durable CLAIM is deliberately
 *    NOT working: a claim is only an assignment, so a just-claimed / stranded slot whose
 *    worker sits idle must not render a phantom self-arc (that is the exact wedge the
 *    self-heal path — redispatchStalled / flushStale — exists to recover). Such a claim
 *    surfaces as `claimed`.
 *  - `streaming` (→ bright self-arc + live badge): the stronger, backend-grounded tier.
 *    The node's CLAIMED unit produced real worker OUTPUT within {@link STREAMING_FRESH_MS}
 *    (`progressAt`), advanced by the host ONLY from PTY output — never by the agent-state
 *    lease renewal that keeps a stuck worker's `leaseExpiresAt` future, so a live lease
 *    alone must NOT read as streaming. `streaming ⊆ working`.
 *  - `claimed` (→ static neutral chip, NO arc): holds a durable claim but shows no
 *    liveness (stale/absent `progressAt`, mesh dot not 'working'). Surfaced honestly as
 *    "assigned, not confirmed emitting" — never as motion.
 *
 * A quiescent (all-exited) squad and any exited node get no treatment.
 */
export const STREAMING_FRESH_MS = 15_000;
export function nodeActivity(node: SquadFlowNode, now: number): { working: boolean; streaming: boolean; claimed: boolean } {
  if (node.exited) return { working: false, streaming: false, claimed: false };
  // STREAMING requires FRESH output progress — not a bare live lease. `progressAt`
  // advances only on real worker OUTPUT (byte-output renewal + worker turn), never on
  // the agent-state lease renewal that keeps a stuck worker's `leaseExpiresAt` future.
  const streaming = node.claim?.progressAt !== undefined && now - node.claim.progressAt < STREAMING_FRESH_MS;
  // WORKING = real liveness ONLY: fresh output, OR a live agent dot reading 'working'.
  // A bare claim (incl. a detached board-synth node with no fresh output) is NOT working
  // — it reads as `claimed` so a stranded assignment can never render phantom motion.
  const working = streaming || node.state === 'working';
  const claimed = !working && node.claim !== undefined;
  return { working, streaming, claimed };
}

export const squadStatuses = {
  all: 'All agents',
  working: 'Working',
  blocked: 'Needs you',
  idle: 'Idle',
  waiting: 'Waiting',
  claimed: 'Assigned',
  done: 'Done',
  exited: 'Exited'
} as const;
export type SquadStatusFilter = keyof typeof squadStatuses;
type SquadStatus = Exclude<SquadStatusFilter, 'all'>;

export const mainSquadFilters = ['all', 'working', 'blocked', 'idle'] as const;

export function squadMemberStatus(node: SquadFlowNode, now: number): SquadStatus {
  if (node.exited) return 'exited';
  if (node.state === 'blocked') return 'blocked';
  const { working, claimed } = nodeActivity(node, now);
  if (working) return 'working';
  if (claimed) return 'claimed';
  return node.state === 'unknown' ? 'idle' : node.state;
}

export function memberRole(node: SquadFlowNode): string {
  if (node.isOrchestrator) return 'Coordinator';
  if (node.role && node.role !== 'worker') return node.role;
  if (node.job || node.role === 'worker') return 'Worker';
  return node.inspectionTarget.type === 'thread' ? 'Thread' : 'CLI Agent';
}

export function matchesSquadSearch(query: string, ...values: Array<string | undefined>): boolean {
  return !query || values.some((value) => value?.toLowerCase().includes(query));
}

export function matchesSquadMember(node: SquadFlowNode, now: number, filter: SquadStatusFilter, query: string): boolean {
  const status = squadMemberStatus(node, now);
  return (filter === 'all' || status === filter)
    && matchesSquadSearch(query, node.label, node.displayName, node.handle, memberRole(node), squadStatuses[status]);
}

export function squadStatusCounts(nodes: readonly SquadFlowNode[], now: number) {
  const counts = { all: nodes.length, working: 0, blocked: 0, idle: 0, waiting: 0, claimed: 0, done: 0, exited: 0 };
  for (const node of nodes) counts[squadMemberStatus(node, now)] += 1;
  return counts;
}

/** Edges stay attached only when both endpoints are visible. */
export function sliceSquadGraph(graph: FlowGraph, nodes: SquadFlowNode[]): FlowGraph {
  if (nodes.length === graph.nodes.length) return graph;
  const ids = new Set(nodes.map((node) => node.sessionId));
  const { all: total, working, blocked, idle, exited } = squadStatusCounts(nodes, graph.builtAt);
  return {
    ...graph,
    nodes,
    edges: graph.edges.filter((edge) => ids.has(edge.fromSessionId) && ids.has(edge.toSessionId)),
    summary: { total, working, blocked, idle, exited }
  };
}

export const runStates: Record<ExecutionBoardProjection['state'], string> = {
  READY: 'Ready',
  STARTING: 'Starting',
  RUNNING: 'Running',
  COMPLETED: 'Complete',
  BLOCKED: 'Blocked',
  STOPPED: 'Stopped',
  FAILED: 'Failed'
};

export function isClosedSquadRun(execution: ExecutionBoardProjection) {
  return execution.state === 'COMPLETED' || execution.state === 'STOPPED' || execution.state === 'FAILED';
}

export function squadQuestion(execution: ExecutionBoardProjection | undefined): string | undefined {
  const blocker = execution?.currentBlocker;
  if (!execution || !blocker || isClosedSquadRun(execution) || blocker.audience === 'coordinator') return;
  if (blocker.delivery?.state === 'PENDING' || blocker.delivery?.state === 'LEASED') return;
  return blocker.question;
}
