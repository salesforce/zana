import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { AgentGraphEdge, AgentGraphNode, AgentGraphNodeKind } from '../../lib/agent-script-model.js';
import {
  AGENT_GRAPH_NODE_HEIGHT,
  AGENT_GRAPH_NODE_WIDTH,
  isPlaceholderAgentGraph,
  layoutAgentGraph
} from '../../lib/agent-script-graph-layout.js';

const KIND_META: Record<AgentGraphNodeKind, { title: string; subtitle: string }> = {
  start: { title: 'Start Agent', subtitle: 'Routes the conversation' },
  topic: { title: 'Topic', subtitle: 'Destination' },
  action: { title: 'Run', subtitle: 'Action' }
};

function IconBadge({ kind }: { kind: AgentGraphNodeKind }) {
  if (kind === 'action') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M8 5.14v13.72L19.27 12 8 5.14z" />
      </svg>
    );
  }
  if (kind === 'start') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="18" cy="18" r="3" />
        <circle cx="6" cy="6" r="3" />
        <path d="M13 6h3a2 2 0 0 1 2 2v7" />
        <path d="M6 9v7a2 2 0 0 0 2 2h7" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function AgentNode({ data }: NodeProps<{ label: string; kind: AgentGraphNodeKind }>) {
  const meta = KIND_META[data.kind];
  return (
    <div className={`as-node as-node--${data.kind}`}>
      <Handle type="target" position={Position.Top} className="as-node-handle" />
      <span className="as-node-icon">
        <IconBadge kind={data.kind} />
      </span>
      <span className="as-node-copy">
        <strong className="as-node-label">{data.label === 'start_agent' ? meta.title : data.label}</strong>
        <span className="as-node-kind">{data.label === 'start_agent' ? meta.subtitle : meta.title}</span>
      </span>
      <Handle type="source" position={Position.Bottom} className="as-node-handle" />
    </div>
  );
}

const nodeTypes = { agent: AgentNode };

export function AgentGraph(props: { nodes: AgentGraphNode[]; edges: AgentGraphEdge[] }) {
  if (isPlaceholderAgentGraph(props.nodes)) {
    return (
      <div className="graph-empty" role="status">
        No topics defined. Add a <code>start_agent</code> or <code>topic</code> in the Script view.
      </div>
    );
  }
  const nodes: Node[] = layoutAgentGraph(props.nodes).map((node) => ({
    id: node.id,
    type: 'agent',
    position: { x: node.x, y: node.y },
    data: { label: node.label, kind: node.kind },
    style: { width: AGENT_GRAPH_NODE_WIDTH, height: AGENT_GRAPH_NODE_HEIGHT },
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top
  }));
  const edges: Edge[] = props.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    type: 'smoothstep',
    markerEnd: { type: 'arrowclosed', width: 16, height: 16, color: 'var(--graph-edge)' },
    style: { stroke: 'var(--graph-edge)', strokeWidth: 1.75 }
  }));
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.24 }}
      minZoom={0.45}
      maxZoom={1.4}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      proOptions={{ hideAttribution: true }}
      defaultEdgeOptions={{ type: 'smoothstep' }}
    >
      <Background gap={18} size={1} color="var(--graph-dot)" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
