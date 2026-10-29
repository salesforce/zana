/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AgentTabs } from './AgentTabs.js';

vi.mock('../salesforce-tools-link.js', () => ({ SalesforceToolsLink: ({ projectId }: { projectId: string }) => <a data-testid="tools-link">{projectId}</a> }));
afterEach(cleanup);
const agents = [{ path: 'a/A.agent', label: 'A.agent' }, { path: 'b/B.agent', label: 'B.agent' }, { path: 'c/C.agent', label: 'C.agent' }];

it('shows one tab per agent with unsaved and running marks, the org pill and the Salesforce link', () => {
  render(<AgentTabs agents={agents} active="b/B.agent" dirtyPaths={new Set(['a/A.agent'])} runningPaths={new Set(['c/C.agent'])} projectId="p1"
    orgPill={<span data-testid="org">dev</span>} onSelect={vi.fn()} onClose={vi.fn()} onOpenAgent={vi.fn()} />);
  expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['A.agent●', 'B.agent', 'C.agent']);
  expect(screen.getByRole('tab', { name: /B\.agent/ }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByLabelText('Unsaved changes')).toBeTruthy();
  expect(screen.getByLabelText('Preview running')).toBeTruthy();
  expect(screen.getByTestId('org').textContent).toBe('dev');
  expect(screen.getByTestId('tools-link').textContent).toBe('p1');
});

it('selects, closes and opens agents, and moves between tabs with the arrow keys', () => {
  const onSelect = vi.fn(); const onClose = vi.fn(); const onOpenAgent = vi.fn();
  render(<AgentTabs agents={agents} active="a/A.agent" projectId="p1" onSelect={onSelect} onClose={onClose} onOpenAgent={onOpenAgent} />);
  fireEvent.click(screen.getByRole('tab', { name: /C\.agent/ }));
  expect(onSelect).toHaveBeenLastCalledWith('c/C.agent');
  fireEvent.click(screen.getByRole('button', { name: 'Close agent B.agent' }));
  expect(onClose).toHaveBeenCalledWith('b/B.agent');
  fireEvent.click(screen.getByRole('button', { name: /Open agent/ }));
  expect(onOpenAgent).toHaveBeenCalledOnce();
  fireEvent.keyDown(screen.getByRole('tab', { name: /A\.agent/ }), { key: 'ArrowLeft' });
  expect(onSelect).toHaveBeenLastCalledWith('c/C.agent');
  fireEvent.keyDown(screen.getByRole('tab', { name: /C\.agent/ }), { key: 'ArrowRight' });
  expect(onSelect).toHaveBeenLastCalledWith('a/A.agent');
  onSelect.mockClear();
  fireEvent.keyDown(screen.getByRole('tab', { name: /A\.agent/ }), { key: 'q' });
  expect(onSelect).not.toHaveBeenCalled();
});

it('has no tabs but still offers Open agent when nothing is open', () => {
  render(<AgentTabs agents={[]} active={null} projectId="p1" onSelect={vi.fn()} onClose={vi.fn()} onOpenAgent={vi.fn()} />);
  expect(screen.queryAllByRole('tab')).toHaveLength(0);
  expect(screen.getByRole('button', { name: /Open agent/ })).toBeTruthy();
});

it('offers per-agent windows in main and keeps a detached primary tab open', () => {
  const onDetach = vi.fn(); const onOpenAgent = vi.fn();
  const view = render(<AgentTabs agents={agents} active="a/A.agent" projectId="p1" onSelect={vi.fn()} onClose={vi.fn()} onOpenAgent={onOpenAgent} onDetach={onDetach} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open B.agent in its own window' }));
  expect(onDetach).toHaveBeenCalledWith('b/B.agent');
  view.rerender(<AgentTabs agents={[agents[0]]} active="a/A.agent" lockedPath="a/A.agent" projectId="p1" onSelect={vi.fn()} onClose={vi.fn()} onOpenAgent={onOpenAgent} />);
  expect(screen.queryByRole('button', { name: 'Close agent A.agent' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open another agent' }));
  expect(onOpenAgent).toHaveBeenCalledOnce();
});
