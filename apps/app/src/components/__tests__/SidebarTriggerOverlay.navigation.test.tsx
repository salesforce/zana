// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const state = vi.hoisted(() => ({ focusedProjectId: null as string | null, scopedProjectId: null as string | null }));
vi.mock('../../store', () => ({
  useUi: (selector: (s: unknown) => unknown) => selector({
    focusedProjectId: state.focusedProjectId, sidebarCollapsed: true,
    toggleSidebar: vi.fn(), setPaletteOpen: vi.fn()
  })
}));
vi.mock('../../lib/windowScope', () => ({ getScopedProjectId: () => state.scopedProjectId }));
vi.mock('../../hooks/useCompactLayout', () => ({ useCompactLayout: () => false }));
vi.mock('../../hooks/useEnsureThreads', () => ({ useEnsureThreads: () => undefined }));
vi.mock('../SidebarHistoryControls', () => ({ SidebarHistoryControls: () => null }));
vi.mock('../CollapsedUnreadThreads', () => ({ CollapsedUnreadThreads: () => null }));
vi.mock('../MobileAgentsBack', () => ({ MobileAgentsBack: () => null }));

import { SidebarTriggerOverlay } from '../SidebarTriggerOverlay.js';

function Location() { return <output data-testid="location">{useLocation().pathname}</output>; }
afterEach(() => { cleanup(); state.focusedProjectId = null; state.scopedProjectId = null; });

describe('collapsed New Chat navigation', () => {
  it.each([
    { focus: null, scope: null, expected: '/' },
    { focus: 'focused/project', scope: null, expected: '/projects/focused%2Fproject/threads/new' },
    { focus: 'other', scope: 'locked', expected: '/projects/locked/threads/new' }
  ])('opens $expected with focus=$focus and scope=$scope', ({ focus, scope, expected }) => {
    state.focusedProjectId = focus;
    state.scopedProjectId = scope;
    render(<MemoryRouter initialEntries={['/inbox']}><SidebarTriggerOverlay /><Location /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'New Chat', exact: true }));
    expect(screen.getByTestId('location').textContent).toBe(expected);
  });
});
