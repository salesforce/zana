// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { create } from 'zustand';

const h = vi.hoisted(() => ({
  compact: false,
  viewportCompact: false,
  closeAgentModal: vi.fn(),
  routeProjectId: null as string | null
}));

vi.mock('../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => h.compact }));
vi.mock('../hooks/useIsCompactViewport.js', () => ({ useIsCompactViewport: () => h.viewportCompact }));
vi.mock('../lib/inspect-session.js', () => ({ inspectRouteProjectId: () => h.routeProjectId }));
vi.mock('./AgentTerminalModal.js', () => ({
  AgentTerminalModal: (props: { session: { id: string }; projectName: string; state: string; onClose: () => void }) => (
    <button data-testid="agent-modal" data-state={props.state} data-project={props.projectName} onClick={props.onClose}>
      {props.session.id}
    </button>
  )
}));
vi.mock('../store.js', () => ({
  useData: create(() => ({
    classicSessionViewEnabled: false,
    threadTabsEnabled: false,
    projects: [{ id: 'p', name: 'Project P', color: '#111' }],
    terminals: { p: [{ id: 's1', projectId: 'p', title: 'one' }] } as Record<string, unknown[]>
  })),
  useUi: create(() => ({
    agentModal: null as null | { sessionId: string; projectId: string },
    closeAgentModal: h.closeAgentModal
  })),
  useAgentStatus: create(() => ({ byId: { s1: 'working' } as Record<string, string> }))
}));

import { useData, useUi } from '../store.js';
import { AgentModalHost } from './AgentModalHost.js';

function Where() {
  return <output data-testid="route">{useLocation().pathname}</output>;
}
const mount = () =>
  render(
    <MemoryRouter initialEntries={['/agents']}>
      <AgentModalHost />
      <Where />
    </MemoryRouter>
  );
const openModal = (sessionId = 's1') =>
  act(() => useUi.setState({ agentModal: { sessionId, projectId: 'p' } } as never));

beforeEach(() => {
  h.compact = false;
  h.viewportCompact = false;
  h.routeProjectId = null;
  h.closeAgentModal.mockReset();
  useData.setState({ classicSessionViewEnabled: false, threadTabsEnabled: false } as never);
  useUi.setState({ agentModal: null } as never);
});
afterEach(cleanup);

it('renders the inspector modal when tabs are off and the layout is wide', () => {
  mount();
  openModal();
  expect(screen.getByTestId('agent-modal').getAttribute('data-state')).toBe('working');
  expect(screen.getByTestId('agent-modal').getAttribute('data-project')).toBe('Project P');
  expect(screen.getByTestId('route').textContent).toBe('/agents');
  act(() => screen.getByTestId('agent-modal').click());
  expect(h.closeAgentModal).toHaveBeenCalled();
});

it('hands off to the session page and closes the modal when thread tabs are on and the viewport is wide', () => {
  useData.setState({ threadTabsEnabled: true } as never);
  mount();
  openModal();
  expect(screen.queryByTestId('agent-modal')).toBeNull();
  expect(screen.getByTestId('route').textContent).toBe('/sessions/s1');
  expect(h.closeAgentModal).toHaveBeenCalled();
});

it('keeps the modal with tabs on when the viewport is compact but the layout is not', () => {
  useData.setState({ threadTabsEnabled: true } as never);
  h.viewportCompact = true;
  mount();
  openModal();
  expect(screen.getByTestId('agent-modal')).toBeTruthy();
  expect(screen.getByTestId('route').textContent).toBe('/agents');
});

it.each([
  ['classic session view', () => useData.setState({ classicSessionViewEnabled: true } as never)],
  ['compact layout', () => { h.compact = true; }]
])('navigates to the session page under %s, using the project route when inspect gives one', (_name, enable) => {
  enable();
  h.routeProjectId = 'p';
  mount();
  openModal();
  expect(screen.queryByTestId('agent-modal')).toBeNull();
  expect(screen.getByTestId('route').textContent).toBe('/projects/p/sessions/s1');
});

it('renders nothing when closed or when the session vanished', () => {
  mount();
  expect(screen.queryByTestId('agent-modal')).toBeNull();
  openModal('gone');
  expect(screen.queryByTestId('agent-modal')).toBeNull();
});
