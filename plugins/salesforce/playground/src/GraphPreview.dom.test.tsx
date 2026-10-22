/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GraphPreview } from './GraphPreview.js';
import { PLAYGROUND_BRIDGE_SOURCE as source } from '../../src/app/playground-bridge.js';
import { ACTION_AGENT } from '../../src/action-fixtures.js';

const seen: any = {};
vi.mock('./graph', () => ({ AgentGraph: (props: any) => { seen.props = props; return <button onClick={() => props.onOpenAction('lookup')} data-visible={String(props.visible)}>{props.nodes.map((node: any) => node.label).join(',')}</button>; } }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('renders Salesforce topics from bounded host snapshots and sends action selections back', () => {
  const post = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
  render(<GraphPreview />);
  expect(post).toHaveBeenCalledWith({ source, type: 'ready' }, location.origin);
  const send = (data: object, origin = location.origin, sender: Window | null = window.parent) => fireEvent(window, new MessageEvent('message', { origin, source: sender, data: { source, ...data } }));
  const graph = { type: 'graph', content: ACTION_AGENT, visible: true, theme: 'light' };
  send(graph, 'https://foreign.example'); send(graph, location.origin, null); send({ type: 'ready' }); send({ ...graph, content: null });
  expect(screen.getByRole('button').textContent).not.toContain('returns');
  send(graph);
  expect(screen.getByRole('button').textContent).toContain('returns');
  expect(screen.getByTestId('agent-script-graph').className).toContain('light');
  expect(screen.getByRole('button').getAttribute('data-visible')).toBe('true');
  expect(screen.getByText(/topics · .*actions/).textContent).toContain('3 actions');
  fireEvent.click(screen.getByRole('button'));
  expect(post).toHaveBeenLastCalledWith({ source, type: 'openAction', id: 'lookup' }, location.origin);
  send({ ...graph, content: '', theme: 'dark', visible: false });
  expect(screen.getByRole('button').getAttribute('data-visible')).toBe('false');
  expect(screen.getByTestId('agent-script-graph').className).toContain('dark');
});

it('passes compact layout and graph.focus through to the graph', () => {
  vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
  render(<GraphPreview />);
  const graph = { source, type: 'graph', content: ACTION_AGENT, visible: true, theme: 'dark', compact: true, focus: 'lookup', focusSeq: 4 };
  fireEvent(window, new MessageEvent('message', { origin: location.origin, source: window.parent, data: graph }));
  expect(screen.getByTestId('agent-script-graph').className).toContain('compact');
  fireEvent(window, new MessageEvent('message', { origin: location.origin, source: window.parent, data: { ...graph, compact: false } }));
  expect(screen.getByTestId('agent-script-graph').className).not.toContain('compact');
});

it('shows test coverage, traces a case, lists gaps and asks the host to draft cases for them', () => {
  const post = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
  render(<GraphPreview />);
  const coverage = { cases: [
    { id: 'ok', name: 'Lookup works', outcome: 'pass', path: ['start_agent', 'lookup'], missing: [] },
    { id: 'bad', name: 'Refund', outcome: 'fail', reason: 'Action "refund" not called.', path: ['start_agent', 'refund'], missing: ['refund'] }
  ] };
  const send = (data: object) => fireEvent(window, new MessageEvent('message', { origin: location.origin, source: window.parent, data: { source, type: 'graph', content: ACTION_AGENT, visible: true, theme: 'dark', ...data } }));
  send({ coverage: { cases: 'nope' } });
  expect(screen.queryByLabelText('Test cases')).toBeNull();
  expect(seen.props.status).toBeNull();
  send({ coverage });
  expect(seen.props.status).toMatchObject({ start_agent: 'pass', lookup: 'pass', refund: 'fail', returns: 'none' });
  expect(screen.getByText('✗ Action "refund" not called.')).toBeTruthy();
  expect(screen.getByText('returns').tagName).toBe('CODE');
  fireEvent.click(screen.getByText('Refund').closest('button')!);
  expect(seen.props.highlight).toEqual({ nodes: ['start_agent', 'refund'], missing: ['refund'] });
  fireEvent.click(screen.getByText('Refund').closest('button')!);
  expect(seen.props.highlight).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '+ Draft cases for gaps' }));
  expect(post).toHaveBeenLastCalledWith({ source, type: 'draftCases', labels: ['returns'] }, location.origin);
  fireEvent.click(screen.getByRole('button', { name: 'Test coverage' }));
  expect(seen.props.status).toBeNull();
  expect(screen.queryByLabelText('Test cases')).toBeNull();
  // "Show path on graph" from the Tests pane turns coverage back on and pins the case.
  send({ coverage, focusCase: 'bad', focusSeq: 2 });
  expect(seen.props.highlight).toEqual({ nodes: ['start_agent', 'refund'], missing: ['refund'] });
  send({ coverage: { cases: [{ ...coverage.cases[0], path: ['start_agent', 'lookup', 'refund', 'returns'] }] } });
  expect(screen.getByText('Every topic and action is reached.')).toBeTruthy();
});
