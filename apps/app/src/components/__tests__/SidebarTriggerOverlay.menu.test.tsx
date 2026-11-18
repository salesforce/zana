// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => ({
  mode: 'expanded' as 'expanded' | 'rail' | 'hidden',
  behavior: 'three-state' as 'two-state' | 'three-state',
  cycleSidebarMode: vi.fn()
}));
vi.mock('../../store', () => ({
  useUi: (selector: (s: unknown) => unknown) => selector({
    focusedProjectId: null, sidebarMode: h.mode, sidebarCollapseBehavior: h.behavior,
    cycleSidebarMode: h.cycleSidebarMode, setPaletteOpen: vi.fn()
  })
}));
vi.mock('../../lib/windowScope', () => ({ getScopedProjectId: () => null }));
vi.mock('../../hooks/useCompactLayout', () => ({ useCompactLayout: () => false }));
vi.mock('../../hooks/useEnsureThreads', () => ({ useEnsureThreads: () => undefined }));
vi.mock('../SidebarHistoryControls', () => ({ SidebarHistoryControls: () => null }));
vi.mock('../CollapsedUnreadThreads', () => ({ CollapsedUnreadThreads: () => null }));
vi.mock('../MobileAgentsBack', () => ({ MobileAgentsBack: () => null }));

import { SidebarTriggerOverlay } from '../SidebarTriggerOverlay.js';

const mount = () => render(<MemoryRouter><SidebarTriggerOverlay /></MemoryRouter>);
afterEach(() => { cleanup(); h.mode = 'expanded'; h.behavior = 'three-state'; vi.clearAllMocks(); });

describe('SidebarTriggerOverlay two-state (default behavior)', () => {
  it('labels rail as Expand sidebar, since the next click returns to expanded', () => {
    h.behavior = 'two-state';
    h.mode = 'rail';
    mount();
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy();
  });
});

describe('SidebarTriggerOverlay three-state cycle', () => {
  it.each([
    ['expanded', 'Collapse sidebar'],
    ['rail', 'Hide sidebar'],
    ['hidden', 'Expand sidebar']
  ] as const)('in %s the trigger is labelled by the next state and cycles on click', (mode, name) => {
    h.mode = mode;
    mount();
    fireEvent.click(screen.getByRole('button', { name }));
    expect(h.cycleSidebarMode).toHaveBeenCalledTimes(1);
  });

  it('has no context menu', () => {
    mount();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
