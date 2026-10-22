import { useEffect, useMemo, useState } from 'react';
import { Background, Controls, Handle, Position, ReactFlow, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { AgentGraphEdge, AgentGraphNode, AgentGraphNodeKind } from '../../lib/agent-script-model.js';
import {
  isPlaceholderAgentGraph,
  layoutAgentGraph,
  resolveFocusNode
} from '../../lib/agent-script-graph-layout.js';

/** Test status of a node, from the scenario cases that reach it. */
export type GraphNodeStatus = 'pass' | 'fail' | 'none';
/** Node labels to light up (a case's expected path) and the ones that case never reached. */
export interface GraphHighlight { nodes: readonly string[]; missing: readonly string[] }

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

/** `available` and `declared` actions may be called; transitions and explicit runs always happen. */
export function isAvailableEdge(label: string | undefined): boolean {
  return label === 'available' || label === 'declared';
}

/** `flow://Check_Status` → `Flow · Check_Status`. */
export function actionSubtitle(target: string | undefined): string {
  const match = /^([a-z][\w-]*):\/\/(.+)$/i.exec(target ?? '');
  if (!match) return 'Action';
  const scheme = match[1]!.toLowerCase();
  const kind = scheme === 'apex' ? 'Apex' : scheme === 'flow' ? 'Flow' : scheme.charAt(0).toUpperCase() + scheme.slice(1);
  return `${kind} · ${match[2]}`;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** One line under the label: what an action runs, how far a topic or the start agent routes. */
export function nodeSubtitle(node: AgentGraphNode, nodes: readonly AgentGraphNode[], edges: readonly AgentGraphEdge[]): string {
  if (node.kind === 'action') return actionSubtitle(node.target);
  const kindOf = (id: string) => nodes.find(row => row.id === id)?.kind;
  const out = edges.filter(edge => edge.source === node.id);
  const actions = new Set(out.filter(edge => kindOf(edge.target) === 'action').map(edge => edge.target)).size;
  const topics = new Set(out.filter(edge => kindOf(edge.target) === 'topic').map(edge => edge.target)).size;
  if (node.kind === 'start') return topics ? `Routes the conversation · ${plural(topics, 'topic')}` : 'Routes the conversation';
  const parts = [...(actions ? [plural(actions, 'action')] : []), ...(topics ? [plural(topics, 'transition')] : [])];
  return parts.join(' · ') || 'Topic';
}

/** Breaks long API names at underscores instead of mid-word. */
function Breakable({ text }: { text: string }) {
  const parts = text.split('_');
  return <>{parts.map((part, index) => <span key={index}>{part}{index < parts.length - 1 ? <>_<wbr /></> : null}</span>)}</>;
}

type GraphNodeData = {
  label: string; kind: AgentGraphNodeKind; subtitle: string; focused?: boolean; openAction?: () => void;
  emphasis?: 'hot' | 'dim' | 'missing'; status?: GraphNodeStatus; vertical?: boolean;
};
type GraphNode = Node<GraphNodeData, 'agent'>;

const STATUS_MARK: Record<GraphNodeStatus, string> = { pass: '✓', fail: '!', none: '·' };
const STATUS_TITLE: Record<GraphNodeStatus, string> = { pass: 'Covered by passing cases', fail: 'On a failing case’s path', none: 'Not reached by any case' };

function AgentNode({ data }: NodeProps<GraphNode>) {
  const title = data.label === 'start_agent' ? 'Start Agent' : data.label;
  const classes = ['as-node', `as-node--${data.kind}`, data.focused ? 'is-focused' : '', data.emphasis ? `is-${data.emphasis}` : '', data.status ? `has-status is-${data.status}` : ''].filter(Boolean).join(' ');
  return (
    <div className={classes} title={title} role={data.openAction ? 'button' : undefined} tabIndex={data.openAction ? 0 : undefined} aria-label={data.openAction ? `Inspect ${data.label}` : undefined} onClick={data.openAction} onKeyDown={event => { if (data.openAction && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); data.openAction(); } }} style={data.openAction ? { cursor: 'pointer' } : undefined}>
      <Handle id="in" type="target" position={Position.Left} className="as-node-handle" />
      <Handle id="top" type="target" position={Position.Top} className="as-node-handle" />
      <span className="as-node-icon">
        <IconBadge kind={data.kind} />
      </span>
      <span className="as-node-copy">
        <strong className="as-node-label"><Breakable text={title} /></strong>
        <span className="as-node-kind">{data.subtitle}</span>
      </span>
      {data.status && <span className={`as-node-status is-${data.status}`} title={STATUS_TITLE[data.status]} aria-label={STATUS_TITLE[data.status]}>{STATUS_MARK[data.status]}</span>}
      <Handle id="out" type="source" position={Position.Right} className="as-node-handle" />
      <Handle id="bottom" type="source" position={Position.Bottom} className="as-node-handle" />
    </div>
  );
}

const nodeTypes = { agent: AgentNode };

/** Child of <ReactFlow>: centres the viewport on the node named by `graph.focus`. */
function FocusNode({ id, seq }: { id: string | null; seq?: number }) {
  const flow = useReactFlow();
  useEffect(() => {
    if (!id) return;
    const timer = window.setTimeout(() => { void flow.fitView({ nodes: [{ id }], duration: 250, padding: 1.2, maxZoom: 1.2 }); }, 50);
    return () => window.clearTimeout(timer);
  }, [flow, id, seq]);
  return null;
}

/** Node ids and edge ids next to `id`: what a hover lights up. */
export function neighbourhood(id: string, edges: readonly AgentGraphEdge[]): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set([id]); const lit = new Set<string>();
  for (const edge of edges) if (edge.source === id || edge.target === id) { nodes.add(edge.source); nodes.add(edge.target); lit.add(edge.id); }
  return { nodes, edges: lit };
}

export function AgentGraph(props: {
  nodes: AgentGraphNode[]; edges: AgentGraphEdge[]; visible?: boolean; compact?: boolean; focus?: string | null; focusSeq?: number; onOpenAction?: (id: string) => void;
  /** Node label → test status. Shown as a badge when set. */
  status?: Readonly<Record<string, GraphNodeStatus>> | null;
  /** A pinned path (a selected test case). Wins over hover. */
  highlight?: GraphHighlight | null;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const placeholder = isPlaceholderAgentGraph(props.nodes);
  const active = useMemo(() => {
    if (props.highlight) {
      const ids = new Set(props.nodes.filter(node => props.highlight!.nodes.includes(node.label) || props.highlight!.missing.includes(node.label)).map(node => node.id));
      const missing = new Set(props.nodes.filter(node => props.highlight!.missing.includes(node.label)).map(node => node.id));
      const edges = new Set(props.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)).map(edge => edge.id));
      return { nodes: ids, edges, missing };
    }
    if (hovered) return { ...neighbourhood(hovered, props.edges), missing: new Set<string>() };
    return null;
  }, [hovered, props.edges, props.highlight, props.nodes]);
  if (placeholder) {
    return (
      <div className="graph-empty" role="status">
        {/* One grid item: bare text and <code> children would each become a separate row. */}
        <p>No topics defined. Add a <code>start_agent</code> or <code>topic</code> in the Script view.</p>
      </div>
    );
  }
  const focusId = resolveFocusNode(props.nodes, props.focus)?.id ?? null;
  const vertical = Boolean(props.compact);
  const nodes: GraphNode[] = layoutAgentGraph(props.nodes, { compact: props.compact }, props.edges).map((node) => ({
    id: node.id,
    type: 'agent',
    selectable: Boolean(node.actionId),
    // Pressing a node pans the canvas, which steals the click; action nodes open their action instead.
    ...(node.actionId ? { className: 'nopan' } : {}),
    focusable: false,
    position: { x: node.x, y: node.y },
    // Hover replaces node data. Declare the fixed layout size so React Flow never
    // hides the node while its ResizeObserver measures the replacement again.
    width: node.width,
    height: node.height,
    data: {
      label: node.label, kind: node.kind, subtitle: nodeSubtitle(node, props.nodes, props.edges), focused: node.id === focusId, vertical,
      openAction: node.actionId && props.onOpenAction ? () => props.onOpenAction!(node.actionId!) : undefined,
      ...(active ? { emphasis: active.missing.has(node.id) ? 'missing' as const : active.nodes.has(node.id) ? 'hot' as const : 'dim' as const } : {}),
      ...(props.status ? { status: props.status[node.label] ?? 'none' } : {})
    },
    style: { width: node.width, height: node.height }
  }));
  const kindOf = new Map(props.nodes.map(node => [node.id, node.kind]));
  const edges: Edge[] = props.edges.map((edge) => {
    const sameColumn = kindOf.get(edge.source) === kindOf.get(edge.target);
    const down = vertical || sameColumn;
    const lit = active?.edges.has(edge.id) ?? false;
    const missing = lit && (active?.missing.has(edge.target) ?? false);
    const color = missing ? 'var(--graph-missing)' : lit ? 'var(--graph-hot)' : 'var(--graph-edge)';
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: down ? 'bottom' : 'out',
      targetHandle: down ? 'top' : 'in',
      type: down ? 'smoothstep' : 'default',
      ariaLabel: edge.label,
      markerEnd: { type: 'arrowclosed', width: 14, height: 14, color },
      style: {
        stroke: color, strokeWidth: lit ? 2.2 : 1.5,
        ...(isAvailableEdge(edge.label) ? { strokeDasharray: '5 4' } : {}),
        ...(active && !lit ? { opacity: 0.15 } : {})
      }
    } satisfies Edge;
  });
  return (
    <ReactFlow
      key={props.visible === false ? 'hidden' : 'visible'}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.12 }}
      minZoom={0.3}
      maxZoom={1.4}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      proOptions={{ hideAttribution: true }}
      onNodeMouseEnter={(_, node) => setHovered(node.id)}
      onNodeMouseLeave={() => setHovered(null)}
    >
      <Background gap={18} size={1} color="var(--graph-dot)" />
      <Controls showInteractive={false} />
      <FocusNode id={focusId} seq={props.focusSeq} />
    </ReactFlow>
  );
}
