import type { AgentGraphEdge, AgentGraphNode, AgentGraphNodeKind } from './agent-script-model.js';

/** Widest column; kept for callers that size a node without knowing its kind. */
export const AGENT_GRAPH_NODE_WIDTH = 340;
export const AGENT_GRAPH_NODE_HEIGHT = 68;
/** Left-to-right columns: Start, Topics, Actions. Actions are widest because their API names are longest. */
export const AGENT_GRAPH_COLUMN_WIDTH: Record<AgentGraphNodeKind, number> = { start: 220, topic: 290, action: 340 };
const COLUMN_GAP = 96;
const ROW_GAP = 18;
const TOPIC_GAP = 30;
const COMPACT_GAP_Y = 48;
const ORIGIN_X = 0;
const ORIGIN_Y = 0;

const RANK: Record<AgentGraphNodeKind, number> = {
  start: 0,
  topic: 1,
  action: 2
};

export interface LaidOutAgentGraphNode extends AgentGraphNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function isPlaceholderAgentGraph(nodes: readonly AgentGraphNode[]): boolean {
  return nodes.length === 0 || (nodes.length === 1 && nodes[0]?.id === 'empty');
}

export interface AgentGraphLayoutOptions {
  /** Narrow containers: stack every node in one column (start, topics, actions) instead of rank columns. */
  compact?: boolean;
}

/** Finds the node a `graph.focus {node}` command refers to: exact id, then label, then case-insensitive label. */
export function resolveFocusNode(nodes: readonly AgentGraphNode[], query: string | null | undefined): AgentGraphNode | null {
  const text = (query ?? '').trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  return nodes.find(node => node.id === text) ?? nodes.find(node => node.label === text) ?? nodes.find(node => node.label.toLowerCase() === lower) ?? null;
}

const columnX = (kind: AgentGraphNodeKind) => {
  let x = ORIGIN_X;
  for (const k of ['start', 'topic', 'action'] as const) {
    if (k === kind) return x;
    x += AGENT_GRAPH_COLUMN_WIDTH[k] + COLUMN_GAP;
  }
  return x;
};

/**
 * Left-to-right layered layout. Actions are grouped under the first topic that reaches them, in topic order,
 * so each topic's edges fan out to a contiguous block. A topic then sits level with the middle of its
 * actions, pushed down only as far as needed to keep topics from overlapping. Start is centred on the topics.
 */
export function layoutAgentGraph(nodes: readonly AgentGraphNode[], options: AgentGraphLayoutOptions = {}, edges: readonly AgentGraphEdge[] = []): LaidOutAgentGraphNode[] {
  if (isPlaceholderAgentGraph(nodes)) return [];
  const size = (node: AgentGraphNode) => ({ width: AGENT_GRAPH_COLUMN_WIDTH[node.kind], height: AGENT_GRAPH_NODE_HEIGHT });
  if (options.compact) {
    const ordered = [...nodes].sort((a, b) => RANK[a.kind] - RANK[b.kind]);
    const width = AGENT_GRAPH_COLUMN_WIDTH.action;
    return ordered.map((node, index) => ({
      ...node, width, height: AGENT_GRAPH_NODE_HEIGHT,
      x: ORIGIN_X,
      y: ORIGIN_Y + index * (AGENT_GRAPH_NODE_HEIGHT + COMPACT_GAP_Y)
    }));
  }
  const byId = new Map(nodes.map(node => [node.id, node]));
  const topics = nodes.filter(node => node.kind === 'topic');
  const starts = nodes.filter(node => node.kind === 'start');
  const owners = [...starts, ...topics];
  const placedActions = new Set<string>();
  const actionOrder: AgentGraphNode[] = [];
  for (const owner of owners) {
    for (const edge of edges) {
      const target = byId.get(edge.target);
      if (edge.source !== owner.id || target?.kind !== 'action' || placedActions.has(target.id)) continue;
      placedActions.add(target.id);
      actionOrder.push(target);
    }
  }
  for (const node of nodes) if (node.kind === 'action' && !placedActions.has(node.id)) actionOrder.push(node);

  const laid = new Map<string, LaidOutAgentGraphNode>();
  actionOrder.forEach((node, index) => {
    laid.set(node.id, { ...node, ...size(node), x: columnX('action'), y: ORIGIN_Y + index * (AGENT_GRAPH_NODE_HEIGHT + ROW_GAP) });
  });
  let floor = -Infinity;
  for (const topic of topics) {
    const targets = edges.filter(edge => edge.source === topic.id).map(edge => laid.get(edge.target)).filter((node): node is LaidOutAgentGraphNode => node?.kind === 'action');
    const wanted = targets.length ? targets.reduce((sum, node) => sum + node.y, 0) / targets.length : floor + AGENT_GRAPH_NODE_HEIGHT + TOPIC_GAP;
    const y = Math.max(Number.isFinite(wanted) ? wanted : ORIGIN_Y, floor + AGENT_GRAPH_NODE_HEIGHT + TOPIC_GAP, ORIGIN_Y);
    laid.set(topic.id, { ...topic, ...size(topic), x: columnX('topic'), y });
    floor = y;
  }
  const topicYs = topics.map(topic => laid.get(topic.id)!.y);
  const middle = topicYs.length ? (Math.min(...topicYs) + Math.max(...topicYs)) / 2 : ORIGIN_Y;
  starts.forEach((node, index) => {
    laid.set(node.id, { ...node, ...size(node), x: columnX('start'), y: middle + index * (AGENT_GRAPH_NODE_HEIGHT + TOPIC_GAP) });
  });
  return nodes.map(node => laid.get(node.id)!).filter(Boolean);
}
