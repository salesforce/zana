import type { AgentGraphNode, AgentGraphNodeKind } from './agent-script-model.js';

export const AGENT_GRAPH_NODE_WIDTH = 248;
export const AGENT_GRAPH_NODE_HEIGHT = 78;
const GAP_X = 40;
const GAP_Y = 96;
const ORIGIN_X = 320;
const ORIGIN_Y = 36;

const RANK: Record<AgentGraphNodeKind, number> = {
  start: 0,
  topic: 1,
  action: 2
};

export interface LaidOutAgentGraphNode extends AgentGraphNode {
  x: number;
  y: number;
}

export function isPlaceholderAgentGraph(nodes: readonly AgentGraphNode[]): boolean {
  return nodes.length === 0 || (nodes.length === 1 && nodes[0]?.id === 'empty');
}

export interface AgentGraphLayoutOptions {
  /** Narrow containers: stack every node in one column (start, topics, actions) instead of rank rows. */
  compact?: boolean;
}

/** Finds the node a `graph.focus {node}` command refers to: exact id, then label, then case-insensitive label. */
export function resolveFocusNode(nodes: readonly AgentGraphNode[], query: string | null | undefined): AgentGraphNode | null {
  const text = (query ?? '').trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  return nodes.find(node => node.id === text) ?? nodes.find(node => node.label === text) ?? nodes.find(node => node.label.toLowerCase() === lower) ?? null;
}

export function layoutAgentGraph(nodes: readonly AgentGraphNode[], options: AgentGraphLayoutOptions = {}): LaidOutAgentGraphNode[] {
  if (isPlaceholderAgentGraph(nodes)) return [];
  if (options.compact) {
    const ordered = [...nodes].sort((a, b) => RANK[a.kind] - RANK[b.kind]);
    return ordered.map((node, index) => ({
      ...node,
      x: ORIGIN_X - AGENT_GRAPH_NODE_WIDTH / 2,
      y: ORIGIN_Y + index * (AGENT_GRAPH_NODE_HEIGHT + GAP_Y / 2)
    }));
  }
  const buckets: AgentGraphNode[][] = [[], [], []];
  for (const node of nodes) {
    buckets[RANK[node.kind]]!.push(node);
  }
  const laid: LaidOutAgentGraphNode[] = [];
  for (let rank = 0; rank < buckets.length; rank += 1) {
    const row = buckets[rank]!;
    const width = row.length * AGENT_GRAPH_NODE_WIDTH + Math.max(0, row.length - 1) * GAP_X;
    const startX = ORIGIN_X - width / 2;
    row.forEach((node, index) => {
      laid.push({
        ...node,
        x: startX + index * (AGENT_GRAPH_NODE_WIDTH + GAP_X),
        y: ORIGIN_Y + rank * (AGENT_GRAPH_NODE_HEIGHT + GAP_Y)
      });
    });
  }
  return laid;
}
