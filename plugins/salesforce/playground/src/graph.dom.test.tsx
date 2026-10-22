/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';

const fitView = vi.fn();
const captured: any = {};
vi.mock('@xyflow/react', () => ({
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
  useReactFlow: () => ({ fitView }),
  ReactFlow: (props: any) => {
    captured.props = props;
    const Node = props.nodeTypes.agent;
    return <div data-testid="flow">{props.nodes.map((n: any) => <Node key={n.id} data={n.data} />)}{props.children}</div>;
  }
}));
vi.mock('@xyflow/react/dist/style.css', () => ({}));

import { AgentGraph, actionSubtitle, isAvailableEdge, neighbourhood, nodeSubtitle } from './graph.js';
import { parseAgentScriptSource } from '../../lib/agent-script-parse.js';
import { ACTION_AGENT } from '../../src/action-fixtures.js';

afterEach(() => { cleanup(); vi.useRealTimers(); fitView.mockClear(); });
const graph = () => parseAgentScriptSource(ACTION_AGENT, 'agentforce').graph;

it('shows the placeholder for an empty graph', () => {
  const { getByRole } = render(<AgentGraph nodes={[]} edges={[]} />);
  const status = getByRole('status');
  expect(status.textContent).toContain('No topics defined');
  // The status is a grid; a single paragraph keeps the sentence and its code chips on one line.
  expect([...status.childNodes].map(node => node.nodeName)).toEqual(['P']);
});

it('renders nodes, marks the focused one, opens actions and fits the view to the focus after a delay', () => {
  vi.useFakeTimers();
  const g = graph();
  const topic = g.nodes.find(n => n.kind === 'topic')!;
  const onOpenAction = vi.fn();
  const { container, rerender, unmount } = render(<AgentGraph nodes={g.nodes} edges={g.edges} focus={topic.label} focusSeq={1} compact onOpenAction={onOpenAction} />);
  expect(container.querySelectorAll('.is-focused')).toHaveLength(1);
  expect(container.textContent).toContain('Start Agent');
  expect(captured.props.nodes.some((n: any) => n.data.openAction)).toBe(true);
  // Pressing an action node must not start a canvas pan, or the pane swallows the click.
  expect(captured.props.nodes.filter((n: any) => n.data.openAction).every((n: any) => n.className === 'nopan')).toBe(true);
  expect(captured.props.nodes.filter((n: any) => !n.data.openAction).every((n: any) => n.className === undefined)).toBe(true);
  const button = container.querySelector('[role="button"]') as HTMLElement;
  fireEvent.click(button);
  fireEvent.keyDown(button, { key: 'Enter' });
  fireEvent.keyDown(button, { key: ' ' });
  fireEvent.keyDown(button, { key: 'a' });
  expect(onOpenAction).toHaveBeenCalledTimes(3);
  expect(fitView).not.toHaveBeenCalled();
  vi.advanceTimersByTime(60);
  expect(fitView).toHaveBeenCalledWith(expect.objectContaining({ nodes: [{ id: expect.any(String) }] }));
  // new seq re-centres; unmounting cancels a pending centre
  rerender(<AgentGraph nodes={g.nodes} edges={g.edges} focus={topic.label} focusSeq={2} visible={false} />);
  unmount();
  vi.advanceTimersByTime(60);
  expect(fitView).toHaveBeenCalledTimes(1);
});

it('does not centre and has no action handlers when nothing is focusable', () => {
  vi.useFakeTimers();
  const g = graph();
  const { container } = render(<AgentGraph nodes={g.nodes} edges={g.edges} focus="no-such-topic" />);
  vi.advanceTimersByTime(100);
  expect(fitView).not.toHaveBeenCalled();
  expect(container.querySelector('.is-focused')).toBeNull();
  expect(container.querySelector('[role="button"]')).toBeNull();
});

it('describes nodes with a subtitle and dashes edges to actions that are only available', () => {
  const g = graph();
  const { container } = render(<AgentGraph nodes={g.nodes} edges={g.edges} />);
  expect(container.textContent).toContain('Apex · OrderLookup');
  expect(container.textContent).toContain('Flow · CheckReturn');
  const edge = (label: string) => captured.props.edges.find((e: any) => e.ariaLabel === label);
  expect(edge('explicit run').style.strokeDasharray).toBeUndefined();
  expect(edge('available').style.strokeDasharray).toBe('5 4');
  expect(edge('declared')).toMatchObject({ sourceHandle: 'out', targetHandle: 'in', type: 'default' });
  cleanup();
  // Breaks long API names at underscores.
  const long = render(<AgentGraph nodes={[{ id: 's', label: 'start_agent', kind: 'start' }, { id: 'a', label: 'BT_Modsol_Check', kind: 'action' }] as any} edges={[]} />);
  expect(long.container.querySelectorAll('.as-node-label wbr')).toHaveLength(2);
});

it('routes compact and same-column edges top to bottom', () => {
  const nodes = [{ id: 'start', label: 'start_agent', kind: 'start' }, { id: 'a', label: 'A', kind: 'topic' }, { id: 'b', label: 'B', kind: 'topic' }] as any;
  const edges = [{ id: 'ab', source: 'a', target: 'b', label: 'transition' }, { id: 'sa', source: 'start', target: 'a', label: 'transition' }];
  render(<AgentGraph nodes={nodes} edges={edges} />);
  expect(captured.props.edges[0]).toMatchObject({ sourceHandle: 'bottom', targetHandle: 'top', type: 'smoothstep' });
  expect(captured.props.edges[1]).toMatchObject({ sourceHandle: 'out', type: 'default' });
  cleanup();
  render(<AgentGraph nodes={nodes} edges={edges} compact />);
  expect(captured.props.edges[1]).toMatchObject({ sourceHandle: 'bottom', type: 'smoothstep' });
});

it('lights a hovered node and its neighbours and dims the rest', () => {
  const g = graph();
  const { container } = render(<AgentGraph nodes={g.nodes} edges={g.edges} />);
  expect(container.querySelector('.is-dim')).toBeNull();
  const dimensions = () => captured.props.nodes.map((node: any) => [node.width, node.height]);
  const originalDimensions = dimensions();
  expect(originalDimensions.every(([width, height]: number[]) => width > 0 && height > 0)).toBe(true);
  act(() => captured.props.onNodeMouseEnter({}, { id: 'start' }));
  expect(dimensions()).toEqual(originalDimensions);
  expect(container.querySelectorAll('.is-hot')).toHaveLength(3);
  expect(container.querySelectorAll('.is-dim')).toHaveLength(2);
  expect(captured.props.edges.filter((e: any) => e.style.opacity === 0.15)).toHaveLength(1);
  act(() => captured.props.onNodeMouseLeave());
  expect(dimensions()).toEqual(originalDimensions);
  expect(container.querySelector('.is-dim, .is-hot')).toBeNull();
});

it('shows coverage badges and a pinned case path with its missing node', () => {
  const nodes = [{ id: 'start', label: 'start_agent', kind: 'start' }, { id: 't', label: 'Quotes', kind: 'topic' }, { id: 'a', label: 'Submit', kind: 'action' }, { id: 'x', label: 'Other', kind: 'action' }] as any;
  const edges = [{ id: 'st', source: 'start', target: 't' }, { id: 'ta', source: 't', target: 'a', label: 'available' }, { id: 'tx', source: 't', target: 'x' }];
  const { container } = render(<AgentGraph nodes={nodes} edges={edges} status={{ start_agent: 'pass', Quotes: 'fail' }} highlight={{ nodes: ['start_agent', 'Quotes'], missing: ['Submit'] }} />);
  expect([...container.querySelectorAll('.as-node-status')].map(n => n.textContent)).toEqual(['✓', '!', '·', '·']);
  expect(container.querySelectorAll('.is-hot')).toHaveLength(2);
  expect(container.querySelector('.is-missing')?.textContent).toContain('Submit');
  expect(container.querySelectorAll('.is-dim')).toHaveLength(1);
  const ta = captured.props.edges.find((e: any) => e.id === 'ta');
  expect(ta.style.stroke).toBe('var(--graph-missing)');
  expect(captured.props.edges.find((e: any) => e.id === 'st').style.stroke).toBe('var(--graph-hot)');
});

it('formats subtitles and neighbourhoods', () => {
  expect(actionSubtitle(undefined)).toBe('Action');
  expect(actionSubtitle('prompt://Summarise')).toBe('Prompt · Summarise');
  expect(isAvailableEdge('run')).toBe(false);
  const nodes = [{ id: 's', label: 'start_agent', kind: 'start' }, { id: 't', label: 'T', kind: 'topic' }, { id: 'u', label: 'U', kind: 'topic' }, { id: 'a', label: 'A', kind: 'action' }] as any;
  const edges = [{ id: '1', source: 's', target: 't' }, { id: '2', source: 't', target: 'a' }, { id: '3', source: 't', target: 'u' }];
  expect(nodeSubtitle(nodes[0], nodes, edges)).toBe('Routes the conversation · 1 topic');
  expect(nodeSubtitle(nodes[0], nodes, [])).toBe('Routes the conversation');
  expect(nodeSubtitle(nodes[1], nodes, edges)).toBe('1 action · 1 transition');
  expect(nodeSubtitle(nodes[2], nodes, edges)).toBe('Topic');
  expect([...neighbourhood('t', edges).nodes].sort()).toEqual(['a', 's', 't', 'u']);
});
