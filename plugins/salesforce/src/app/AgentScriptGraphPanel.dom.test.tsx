/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AgentScriptGraphPanel } from './AgentScriptGraphPanel.js';
import { PLAYGROUND_BRIDGE_SOURCE as source } from './playground-bridge.js';
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('syncs the draft, visibility and theme, accepting action clicks only from its own frame', async () => {
  const open = vi.fn();
  const view = render(<AgentScriptGraphPanel source="draft" visible onOpenAction={open} />);
  const frame = screen.getByTitle('AgentScript graph') as HTMLIFrameElement;
  const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined);
  const send = (data: object, origin = location.origin, sender: Window | null = frame.contentWindow) => act(() => { window.dispatchEvent(new MessageEvent('message', { origin, source: sender, data: { source, ...data } })); });
  send({ type: 'ready' }, 'https://foreign.example');
  send({ type: 'ready' }, location.origin, window);
  send({ type: 'unknown' });
  expect(post).not.toHaveBeenCalled();
  send({ type: 'ready' });
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'graph', content: 'draft', visible: true }), location.origin);
  view.rerender(<AgentScriptGraphPanel source="updated" visible={false} onOpenAction={open} />);
  expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ content: 'updated', visible: false }), location.origin);
  await act(async () => { document.documentElement.dataset.theme = 'light'; });
  expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'light' }), location.origin);
  send({ type: 'openAction', id: 'one' }); expect(open).toHaveBeenCalledWith('one');
  view.unmount();
  send({ type: 'openAction', id: 'two' }); expect(open).toHaveBeenCalledTimes(1);
});

it('surfaces an asset failure or timeout and recovers on a late ready message', () => {
  vi.useFakeTimers();
  render(<AgentScriptGraphPanel source="" visible onOpenAction={() => {}} />);
  const frame = screen.getByTitle('AgentScript graph') as HTMLIFrameElement;
  vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined);
  act(() => vi.advanceTimersByTime(12_000));
  expect(screen.getByRole('alert').textContent).toContain('Could not load the graph');
  fireEvent(window, new MessageEvent('message', { origin: location.origin, source: frame.contentWindow, data: { source, type: 'ready' } }));
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.error(frame);
  expect(screen.getByRole('alert')).toBeTruthy();
});
