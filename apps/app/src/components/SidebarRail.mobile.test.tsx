// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => ({
  state: { sidebarCollapsed: false },
  footer: [],
  split: vi.fn(),
  consume: vi.fn(() => false)
}));
vi.mock('../store.js', () => ({
  useUi: Object.assign((selector: (state: typeof h.state) => unknown) => selector(h.state), { getState: () => h.state })
}));
vi.mock('../plugins/plugin-slots.js', () => ({
  subscribePluginSlots: () => () => {},
  listSidebarFooterActions: () => h.footer
}));
vi.mock('./sidebar/useThreadRowSplitDrag.js', () => ({ usePaneContentSplitDrag: h.split }));
vi.mock('./sidebarSortable.js', () => ({
  SortableNavItem: () => { throw new Error('Mobile navigation must not mount sortable rows'); },
  SortableSidebarSection: () => { throw new Error('Mobile navigation must not mount sortable sections'); },
  useSortableSidebarNav: (_key: string, ids: string[]) => ({ pinnedNavIds: ids, sortableNavIds: [], trailingNavIds: [], consumeNavClick: h.consume })
}));
import { MobileNavDrawer } from './MobileShellChrome.js';
import { SidebarRail, type SidebarRailItem } from './SidebarRail.js';

afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('runs action-only destinations and closes the mobile drawer without invoking split drag', () => {
  const close = vi.fn();
  const action = vi.fn((event: { preventDefault(): void }) => event.preventDefault());
  const items: SidebarRailItem[] = [
    { kind: 'row', id: 'inbox', label: 'Inbox', icon: null, to: '/inbox', testId: 'inbox', active: true, splitContent: { kind: 'inbox' } },
    { kind: 'row', id: 'history', label: 'History', icon: null, to: '#', testId: 'history', active: false, onClick: action },
    { kind: 'section', id: 'projects', node: <div>Projects</div> }
  ];
  render(<MemoryRouter><MobileNavDrawer enabled open onClose={close}>
    <SidebarRail className="sidebar" navAriaLabel="Nav" storageKey="test" pinnedIds={[]} items={items} />
  </MobileNavDrawer></MemoryRouter>);
  fireEvent.click(screen.getByRole('link', { name: 'History' }));
  expect(action).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('link', { name: 'Inbox' }));
  expect(close).toHaveBeenCalledTimes(2);
  expect(h.split).not.toHaveBeenCalled();
  h.consume.mockReturnValueOnce(true);
  fireEvent.click(screen.getByRole('link', { name: 'History' }));
  expect(action).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
  expect(close).toHaveBeenCalledTimes(3);
});
