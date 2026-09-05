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

export function layoutAgentGraph(nodes: readonly AgentGraphNode[]): LaidOutAgentGraphNode[] {
  if (isPlaceholderAgentGraph(nodes)) return [];
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
