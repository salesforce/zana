/** @vitest-environment happy-dom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AgentScriptTools, useAgentScriptTools } from './AgentScriptTools.js';

function Workspace({ scope = 'one' }: { scope?: string }) {
  const tools = useAgentScriptTools(scope);
  return <><button onClick={tools.toggle}>Toggle panel</button><AgentScriptTools tools={tools} render={id => <input aria-label={`${id} draft`} />} /></>;
}
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function add(name: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Add side panel tab' }));
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
}

it('keeps tools mounted on switch/hide, deduplicates tabs, and restores a project layout', () => {
  const view = render(<Workspace />);
  fireEvent.change(screen.getByLabelText('files draft'), { target: { value: 'filter' } });
  add('Graph view');
  add('Preview');
  fireEvent.change(screen.getByLabelText('preview draft'), { target: { value: 'my conversation' } });
  add('Graph view');
  expect(screen.getAllByRole('tab', { name: 'Graph view' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));
  expect((screen.getByLabelText('preview draft') as HTMLInputElement).value).toBe('my conversation');
  fireEvent.click(screen.getByRole('button', { name: 'Hide side panel' }));
  expect(screen.queryByRole('tablist')).toBeNull();
  fireEvent.click(screen.getByText('Toggle panel'));
  expect((screen.getByLabelText('preview draft') as HTMLInputElement).value).toBe('my conversation');
  fireEvent.click(screen.getByRole('button', { name: 'Close Preview' }));
  expect(screen.getByRole('tab', { name: 'Graph view' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Close File explorer' }));
  expect(screen.getByRole('tab', { name: 'Graph view' }).getAttribute('aria-selected')).toBe('true');
  view.unmount();
  const restored = render(<Workspace />);
  expect(screen.getByRole('tab', { name: 'Graph view' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Close Graph view' }));
  expect(screen.getByRole('heading', { name: 'Add a tool' })).toBeTruthy();
  restored.unmount();
  render(<Workspace scope="two" />);
  expect(screen.getByRole('tab', { name: 'File explorer' })).toBeTruthy();
});

it('supports roving keyboard tabs, wrapping, Home/End, and Delete with focus recovery', () => {
  render(<Workspace />); add('Graph view'); add('Actions');
  const graph = screen.getByRole('tab', { name: 'Graph view' });
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Actions' }), { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(graph);
  fireEvent.keyDown(graph, { key: 'Home' });
  const files = screen.getByRole('tab', { name: 'File explorer' });
  expect(document.activeElement).toBe(files);
  fireEvent.keyDown(files, { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Actions' }));
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(files);
  fireEvent.keyDown(files, { key: 'End' });
  fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
  fireEvent.keyDown(document.activeElement!, { key: 'Delete' });
  expect(screen.queryByRole('tab', { name: 'Actions' })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add side panel tab' }));
});

it('sanitizes stored state and tolerates unavailable browser storage', () => {
  localStorage.setItem('salesforce:agent-tools:one', JSON.stringify({ tabs: ['graph', 'graph', 'unknown'], active: 'unknown', open: false }));
  const view = render(<Workspace />);
  expect(screen.queryByRole('tablist')).toBeNull();
  fireEvent.click(screen.getByText('Toggle panel'));
  expect(screen.getByRole('heading', { name: 'Add a tool' })).toBeTruthy();
  expect(screen.getAllByRole('tab')).toHaveLength(1);
  view.unmount();
  localStorage.setItem('salesforce:agent-tools:one', 'invalid json');
  const fallback = render(<Workspace />);
  expect(screen.getByRole('tab', { name: 'File explorer' })).toBeTruthy();
  fallback.unmount();
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error('denied'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('denied'); });
  render(<Workspace />); add('Tests');
  expect(screen.getByRole('tab', { name: 'Tests' }).getAttribute('aria-selected')).toBe('true');
});
