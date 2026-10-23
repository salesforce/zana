// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const createTerminal = vi.fn();
const personas = [
  { id: 'z', name: 'Zulu', source: null },
  { id: 'hidden', name: 'Hidden', source: { projectId: 'other' } },
  { id: 'a', name: 'Alpha', source: { projectId: 'project' } }
];

vi.mock('../../store.js', () => ({
  useData: (select: (state: unknown) => unknown) => select({
    terminals: { project: [] }, createTerminal, closeTerminal: vi.fn(), renameTerminal: vi.fn()
  }),
  useUi: (select: (state: unknown) => unknown) => select({
    exitProjectFocus: vi.fn(), selectedTabId: {}, selectedProjectId: 'project', collapsedSections: {}, unread: {}
  }),
  useAgentStatus: Object.assign(
    (select: (state: unknown) => unknown) => select({ byId: {} }),
    { getState: () => ({ byId: {} }) }
  ),
  useIdleTriage: { getState: () => ({ byId: {} }) },
  usePersonas: (select: (state: unknown) => unknown) => select({ personas })
}));
vi.mock('../../lib/windowScope.js', () => ({ getScopedProjectId: () => null }));
vi.mock('../ListPaneResizer.js', () => ({ ListPaneResizer: () => null }));
vi.mock('./ProjectDot.js', () => ({ ProjectDot: () => null }));
vi.mock('./ProjectRollupDot.js', () => ({ ProjectRollupDot: () => null }));
vi.mock('../AppPageHeader.js', () => ({ AppPageHeader: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../agentCardActions.js', () => ({ useAgentCardActions: () => ({ actions: [], setMenu: vi.fn(), menu: null }), AgentCardMenu: () => null, clampMenuAnchor: vi.fn() }));

import { ProjectFocusView } from './ProjectFocusView.js';

describe('ProjectFocusView quick launch ordering', () => {
  it('sorts scoped personas and opens without launching a terminal', () => {
    render(<MemoryRouter><ProjectFocusView project={{ id: 'project', name: 'Project', path: '/tmp/project' } as never} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'New session' }));
    expect(createTerminal).not.toHaveBeenCalled();
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Claude', 'Claude YOLO', 'Shell', 'Alpha', 'Zulu'
    ]);
    expect(screen.queryByRole('menuitem', { name: 'Hidden' })).toBeNull();
  });
});
