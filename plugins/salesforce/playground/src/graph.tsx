import { Background, Controls, ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { AgentGraphEdge, AgentGraphNode } from '../../lib/agent-script-model.js';

const KIND_COLOR: Record<AgentGraphNode['kind'], string> = {
  start: '#3b82f6',
  topic: '#a855f7',
  action: '#f59e0b'
};

export function AgentGraph(props: { nodes: AgentGraphNode[]; edges: AgentGraphEdge[] }) {
  const nodes = props.nodes.map((node, index) => ({
    id: node.id,
    position: {
      x: node.kind === 'start' ? 24 : node.kind === 'action' ? 420 : 220,
      y: 24 + index * 72
    },
    data: { label: node.label },
    style: {
      border: `1px solid ${KIND_COLOR[node.kind]}`,
      borderRadius: 8,
      padding: 8,
      fontSize: 12,
      background: 'var(--bg, #111)',
      color: 'var(--fg, #eee)'
    }
  }));
  const edges = props.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label
  }));
  return (
    <ReactFlow nodes={nodes} edges={edges} fitView proOptions={{ hideAttribution: true }}>
      <Background />
      <Controls />
    </ReactFlow>
  );
}
