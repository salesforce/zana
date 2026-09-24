/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GraphPreview } from './GraphPreview.js';
import { PLAYGROUND_BRIDGE_SOURCE as source } from '../../src/app/playground-bridge.js';
import { ACTION_AGENT } from '../../src/action-fixtures.js';

vi.mock('./graph', () => ({ AgentGraph: (props: any) => <button onClick={() => props.onOpenAction('lookup')} data-visible={String(props.visible)}>{props.nodes.map((node: any) => node.label).join(',')}</button> }));
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
