// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixtures = vi.hoisted(() => ({ slots: [] as any[], view: 'plugin:test/world', last: null as any, executions: [] as any[], inspect: vi.fn() }));
vi.mock('@/components/AgentViewToggle', () => ({
  AgentViewToggle: () => null, ScheduledColumnToggle: () => null,
  useAgentsBoardView: () => ({ view: fixtures.view, compact: false, pluginViews: fixtures.slots })
}));
vi.mock('@/hooks/useEnsureThreads', () => ({ useEnsureThreads: () => {} }));
vi.mock('@/lib/inspect-session', () => ({ inspectAgentSession: fixtures.inspect, inspectThread: vi.fn() }));
vi.mock('@/components/ExecutionJobDetails', () => ({ ExecutionJobDetails: ({ projectId, executionId }: any) => <output data-testid="execution">{projectId}:{executionId}</output> }));
vi.mock('@/views/agents/SquadFlowView', () => ({ SquadFlowView: () => null }));
vi.mock('@/components/AgentMonitor', () => ({ AgentMonitor: () => null }));
vi.mock('@/components/MobilePageHeader', () => ({ MobilePageHeader: () => null }));
import { useData, useAgentStatus, useScheduler, useUi } from '@/store';
import { useThreads } from '@/thread-store';
import { usePluginRuntimeContext } from '@/plugins/PluginSlotBoundary';
import { AgentsBoard } from './AgentsBoard.js';
import { setPendingSquadDetailsTarget } from '@/lib/squad-details-target';
function View(props: any) {
  const context = usePluginRuntimeContext(); fixtures.last = { ...props, context };
  return <div data-testid="plugin-view">
    {[...props.members, ...props.executions].map((row: any) => <button key={row.key} onClick={() => props.onInspect(row.key)}>{row.title}</button>)}
    <button onClick={() => props.onInspect('missing:key')}>Stale item</button>
  </div>;
}
const projects = [{ id: 'p1', name: 'One', path: '/one', color: 'blue' }, { id: 'p2', name: 'Two', path: '/two' }] as any[];
beforeEach(() => {
  fixtures.slots = [{ pluginId: 'test', id: 'world', generation: 2, title: 'World', component: View }];
  fixtures.view = 'plugin:test/world'; fixtures.inspect.mockClear();
  fixtures.executions = [{ projectId: 'p1', executionId: 'j1', jobTitle: 'Review', state: 'RUNNING' }, { projectId: 'unknown', executionId: 'j2', jobTitle: 'Missing project', state: 'COMPLETED' }];
  window.cc = { executionBoard: { listProject: async (id: string) => ({ executions: id === 'p1' ? fixtures.executions : [], hasMore: false }) } } as any;
  useData.setState({ projects, terminals: { p1: [{ id: 'a1', profile: 'codex', title: 'Coder', status: 'running', projectId: 'p1' }] as any[] }, includeScheduledAgentsInAgentView: true, idleAttentionSensitivity: 'medium' });
  useAgentStatus.setState({ byId: { a1: 'working' }, since: {} });
  useScheduler.setState({ tasks: [] }); useThreads.setState({ threads: [] }); useUi.setState({ selectedTabId: {} });
});
afterEach(() => { cleanup(); delete (window as any).cc; });
it('projects the scoped fleet, preserves runtime provenance and routes inspect callbacks', async () => {
  render(<MemoryRouter><AgentsBoard scope={{ kind: 'project', project: projects[0] }} /></MemoryRouter>);
  await screen.findByRole('button', { name: 'Review' });
  expect(fixtures.last.projectId).toBe('p1');
  expect(fixtures.last.projects).toEqual([{ id: 'p1', name: 'One', color: 'blue' }]);
  expect(fixtures.last.context).toEqual({ pluginId: 'test', generation: 2 });
  fireEvent.click(screen.getByRole('button', { name: 'Coder' }));
  expect(fixtures.inspect).toHaveBeenCalledWith('a1', 'p1', expect.any(Function));
  fireEvent.click(screen.getByRole('button', { name: 'Stale item' }));
  expect(screen.queryByTestId('execution')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  expect(screen.getByTestId('execution').textContent).toBe('p1:j1');
});
it('filters global executions by title and project, and ignores missing projects', async () => {
  render(<MemoryRouter><AgentsBoard scope={{ kind: 'global' }} /></MemoryRouter>);
  await screen.findByRole('button', { name: 'Review' });
  expect(fixtures.last.projectId).toBeNull(); expect(fixtures.last.projects).toHaveLength(2);
  const filter = screen.getByLabelText('Filter agents');
  fireEvent.change(filter, { target: { value: 'review' } });
  expect(fixtures.last.executions.map((e: any) => e.title)).toEqual(['Review']);
  fireEvent.change(filter, { target: { value: 'one' } });
  expect(fixtures.last.members.map((e: any) => e.title)).toEqual(['Coder']);
  expect(fixtures.last.executions.map((e: any) => e.title)).toEqual(['Review']);
  fireEvent.change(filter, { target: { value: 'absent' } });
  expect(fixtures.last.executions).toEqual([]); expect(fixtures.last.members).toEqual([]);
  expect(fixtures.last.population.members.map((m: any) => m.title)).toEqual(['Coder']);
  expect(fixtures.last.population.executions.map((e: any) => e.title)).toEqual(['Review']);
  fixtures.last.onInspect('agent:a1'); expect(fixtures.inspect).toHaveBeenCalledWith('a1', 'p1', expect.any(Function));
  fixtures.last.onInspect('execution:unknown:j2'); expect(screen.queryByTestId('execution')).toBeNull();
});
it('keeps the full population project-scoped and rejects inspect keys from another project', async () => {
  useData.setState({ terminals: { ...useData.getState().terminals, p2: [{ id: 'a2', profile: 'codex', title: 'Other', status: 'running', projectId: 'p2' }] as any[] } });
  render(<MemoryRouter><AgentsBoard scope={{ kind: 'project', project: projects[0] }} /></MemoryRouter>);
  await screen.findByRole('button', { name: 'Review' });
  expect(fixtures.last.population.members.map((m: any) => m.key)).toEqual(['agent:a1']);
  fixtures.last.onInspect('agent:a2'); expect(fixtures.inspect).not.toHaveBeenCalled();
});
it('keeps the view toolbar available for an empty fleet and falls back when the slot disappears', async () => {
  fixtures.executions = []; useData.setState({ terminals: {} });
  const { rerender } = render(<MemoryRouter><AgentsBoard scope={{ kind: 'global' }} /></MemoryRouter>);
  await waitFor(() => expect(fixtures.last.members).toEqual([]));
  expect(screen.getByLabelText('Filter agents')).toBeTruthy();
  fixtures.slots = []; fixtures.view = 'board';
  rerender(<MemoryRouter><AgentsBoard scope={{ kind: 'global' }} /></MemoryRouter>);
  expect(screen.queryByTestId('plugin-view')).toBeNull();
  expect(screen.getByText('No agents')).toBeTruthy();
});

it('opens a pending Inbox deep-link target on mount', async () => {
  setPendingSquadDetailsTarget({ projectId: 'p1', executionId: 'j1' });
  render(<MemoryRouter><AgentsBoard scope={{ kind: 'project', project: projects[0] }} /></MemoryRouter>);
  expect((await screen.findByTestId('execution')).textContent).toBe('p1:j1');
});
it('opens squad details from the open event and ignores incomplete event details', async () => {
  render(<MemoryRouter><AgentsBoard scope={{ kind: 'project', project: projects[0] }} /></MemoryRouter>);
  await screen.findByRole('button', { name: 'Review' });
  window.dispatchEvent(new CustomEvent('zana:open-squad-details', { detail: { projectId: 'p1' } }));
  window.dispatchEvent(new CustomEvent('zana:open-squad-details'));
  await waitFor(() => expect(screen.queryByTestId('execution')).toBeNull());
  window.dispatchEvent(new CustomEvent('zana:open-squad-details', { detail: { projectId: 'p1', executionId: 'j1' } }));
  expect((await screen.findByTestId('execution')).textContent).toBe('p1:j1');
});
