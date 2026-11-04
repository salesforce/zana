// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const closeTerminal = vi.fn();
const terminals = [
  { id: 'a1', title: 'Review', status: 'running', profile: 'claude', projectId: 'project' },
  { id: 's1', title: 'zsh', status: 'running', profile: 'shell', projectId: 'project' },
  { id: 'e1', title: 'Done', status: 'exited', profile: 'claude', projectId: 'project' }
];

vi.mock('../../store.js', () => ({
  useData: (select: (state: unknown) => unknown) => select({
    terminals: { project: terminals }, createTerminal: vi.fn(), closeTerminal, renameTerminal: vi.fn()
  }),
  useUi: (select: (state: unknown) => unknown) => select({
    exitProjectFocus: vi.fn(), selectedTabId: {}, selectedProjectId: 'project', collapsedSections: {}, unread: {}
  }),
  useAgentStatus: Object.assign(
    (select: (state: unknown) => unknown) => select({ byId: {} }),
    { getState: () => ({ byId: {} }) }
  ),
  useIdleTriage: { getState: () => ({ byId: {} }) },
  usePersonas: (select: (state: unknown) => unknown) => select({ personas: [] })
}));
vi.mock('../../lib/windowScope.js', () => ({ getScopedProjectId: () => null }));
vi.mock('../ListPaneResizer.js', () => ({ ListPaneResizer: () => null }));
vi.mock('./ProjectDot.js', () => ({ ProjectDot: () => null }));
vi.mock('./ProjectRollupDot.js', () => ({ ProjectRollupDot: () => null }));
vi.mock('../AppPageHeader.js', () => ({ AppPageHeader: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../agentCardActions.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agentCardActions.js')>()),
  useAgentCardActions: () => ({ actions: [], setMenu: vi.fn(), menu: null }),
  AgentCardMenu: () => null,
  clampMenuAnchor: vi.fn()
}));

import { ProjectFocusView } from './ProjectFocusView.js';

const realConfirm = window.confirm;
afterEach(() => { cleanup(); closeTerminal.mockClear(); window.confirm = realConfirm; vi.restoreAllMocks(); });

function renderView() {
  render(<MemoryRouter><ProjectFocusView project={{ id: 'project', name: 'Project', path: '/tmp/project' } as never} /></MemoryRouter>);
}

describe('ProjectFocusView row remove button', () => {
  it('archives a live agent', () => {
    renderView();
    const button = screen.getByLabelText('Archive Review');
    expect(button.getAttribute('title')).toBe('Archive (stops the agent)');
  });

  it('keeps Delete for a live plain shell and Dismiss for an exited session', () => {
    renderView();
    expect(screen.getByLabelText('Delete zsh').getAttribute('title')).toBe('Delete (ends the process)');
    expect(screen.getByLabelText('Dismiss Done').getAttribute('title')).toBe('Dismiss');
    expect(screen.queryByLabelText('Archive zsh')).toBeNull();
  });

  it('confirms with the Archive text before closing, and skips the prompt for exited', () => {
    const confirm = vi.fn(() => false);
    window.confirm = confirm;
    renderView();
    fireEvent.click(screen.getByLabelText('Archive Review'));
    expect(confirm).toHaveBeenCalledWith('Archive “Review”? The agent stops and its conversation stays in History.');
    expect(closeTerminal).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByLabelText('Archive Review'));
    expect(closeTerminal).toHaveBeenCalledWith('a1', 'project');
    confirm.mockClear();
    fireEvent.click(screen.getByLabelText('Dismiss Done'));
    expect(confirm).not.toHaveBeenCalled();
    expect(closeTerminal).toHaveBeenCalledWith('e1', 'project');
  });
});
