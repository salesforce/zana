/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

const fitView = vi.fn();
const captured: any = {};
vi.mock('@xyflow/react', () => ({
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom' },
  useReactFlow: () => ({ fitView }),
  ReactFlow: (props: any) => {
    captured.props = props;
    const Node = props.nodeTypes.agent;
    return <div data-testid="flow">{props.nodes.map((n: any) => <Node key={n.id} data={n.data} />)}{props.children}</div>;
  }
}));
vi.mock('@xyflow/react/dist/style.css', () => ({}));

import { AgentGraph } from './graph.js';
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
