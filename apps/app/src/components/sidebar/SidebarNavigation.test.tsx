// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarRail, type SidebarRailItem } from '../SidebarRail.js';
import { useUi } from '../../store.js';
import { GLOBAL_NAV_ORDER_KEY, PROJECT_NAV_ORDER_KEY } from '../sidebarSortable.js';
import { MobileNavDrawer } from '../MobileShellChrome.js';

const h = vi.hoisted(() => ({
  configSet: vi.fn().mockResolvedValue({}),
  onHistory: vi.fn((event: { preventDefault(): void }) => event.preventDefault()),
  footer: []
}));
vi.mock('../../lib/product-client.js', () => ({ product: { config: { set: h.configSet } } }));
vi.mock('../../plugins/plugin-slots.js', () => ({
  subscribePluginSlots: () => () => {}, listSidebarFooterActions: () => h.footer
}));
vi.mock('./useThreadRowSplitDrag.js', () => ({
  usePaneContentSplitDrag: () => ({ onPointerDown: vi.fn(), openInSplit: vi.fn(), consumeClick: () => false })
}));
vi.mock('./paneContentSplitIndicator.js', () => ({ usePaneContentSplitIndicator: () => ({ miniMap: null }) }));

const row = (id: string, label: string): SidebarRailItem => ({
  kind: 'row', id, label, to: `/${id}`, icon: <span aria-hidden="true">{label[0]}</span>, active: false, testId: `nav-${id}`
});
const items: SidebarRailItem[] = [
  row('home', 'New Chat'), row('inbox', 'Inbox'), row('feed', 'Feed'),
  { ...row('history', 'History'), kind: 'row', onClick: h.onHistory },
  { ...row('sample/panel', 'Sample'), kind: 'row', disabled: true, disabledReason: 'Unavailable' },
  { kind: 'section', id: 'projects', node: <ProjectsSection /> }
];
function ProjectsSection() { return <div data-testid="projects-section">Projects</div>; }
function Location() { return <output data-testid="location">{useLocation().pathname}</output>; }
function Rail({ storageKey = GLOBAL_NAV_ORDER_KEY, catalog = items }: { storageKey?: string; catalog?: SidebarRailItem[] }) {
  return <MemoryRouter><SidebarRail className="sidebar sidebar--global" navAriaLabel="Navigation" storageKey={storageKey}
    pinnedIds={['home', 'inbox']} items={catalog} /><Location /></MemoryRouter>;
}
function more() { fireEvent.click(screen.getByRole('button', { name: 'More', exact: true })); }
function customize() {
  more();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Customize navigation' }));
  return screen.getByRole('dialog', { name: 'Customize navigation' });
}
beforeEach(() => {
  h.configSet.mockReset().mockResolvedValue({});
  h.onHistory.mockClear();
  useUi.setState({ sidebarCollapseBehavior: 'two-state', sidebarCollapsed: false, sidebarNavHidden: [], projectSidebarNavHidden: [], sidebarNavOrder: null, projectSidebarNavOrder: null });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('sidebar visibility and customization', () => {
  it('repositions when late plugin destinations grow the popup or the viewport shrinks', () => {
    let height = 200;
    let resized!: () => void;
    const disconnect = vi.fn();
    vi.stubGlobal('innerHeight', 600);
    vi.stubGlobal('innerWidth', 800);
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: () => void) {}
      observe(el: Element) { if (el.classList.contains('sidebar-navigation-popup')) resized = this.callback; }
      unobserve() {}
      disconnect = disconnect;
    });
    const getRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('sidebar-navigation-popup')
        ? DOMRect.fromRect({ width: 280, height }) : getRect.call(this);
    });
    render(<Rail />);
    fireEvent.contextMenu(screen.getByTestId('nav-feed'), { clientX: 900, clientY: 560 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Customize navigation' }));
    const popup = screen.getByRole('dialog', { name: 'Customize navigation' });
    expect(popup.style.top).toBe('392px');
    expect(popup.style.left).toBe('512px');
    height = 400;
    act(() => resized());
    expect(popup.style.top).toBe('192px');
    vi.stubGlobal('innerHeight', 300);
    fireEvent(window, new Event('resize'));
    expect(popup.style.top).toBe('8px');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(disconnect).toHaveBeenCalled();
  });

  it('places More beside Settings and opens its menu upward from the utility bar', () => {
    vi.stubGlobal('innerHeight', 600);
    vi.stubGlobal('innerWidth', 800);
    const getRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('sidebar-navigation-popup')) return DOMRect.fromRect({ width: 280, height: 120 });
      if (this.classList.contains('sidebar-utility-button--more')) return DOMRect.fromRect({ x: 96, y: 560, width: 28, height: 28 });
      return getRect.call(this);
    });
    useUi.setState({ sidebarNavHidden: ['feed'] });
    render(<MemoryRouter initialEntries={['/feed']}><SidebarRail className="sidebar sidebar--global" navAriaLabel="Navigation"
      storageKey={GLOBAL_NAV_ORDER_KEY} pinnedIds={['home', 'inbox']}
      items={items.map((item) => item.id === 'feed' ? { ...item, active: true } as SidebarRailItem : item)} /></MemoryRouter>);
    const button = screen.getByRole('button', { name: 'More', exact: true });
    const bar = screen.getByLabelText('Sidebar utilities');
    expect(bar.contains(button)).toBe(true);
    expect(screen.getByRole('link', { name: 'Settings' }).nextElementSibling).toBe(button);
    expect(button.classList.contains('has-active')).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    more();
    const menu = screen.getByRole('menu');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(menu.style.left).toBe('96px');
    expect(menu.style.top).toBe('436px');
    more();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('hides a destination by right-click and keeps it reachable through More', async () => {
    render(<Rail />);
    fireEvent.contextMenu(screen.getByTestId('nav-feed'), { clientX: 130, clientY: 240 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hide from sidebar' }));
    expect(screen.queryByTestId('nav-feed')).toBeNull();
    expect(screen.getByRole('button', { name: 'More', exact: true })).toBe(document.activeElement);
    expect(h.configSet).toHaveBeenCalledWith({ sidebarNavHidden: ['feed'] });
    more();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Feed' }));
    expect(screen.getByTestId('location').textContent).toBe('/feed');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(useUi.getState().sidebarNavHidden).toEqual(['feed']);
  });

  it('restores checkbox visibility in the saved order, including pinned and disabled items', async () => {
    useUi.setState({ sidebarNavOrder: ['home', 'inbox', 'history', 'feed', 'sample/panel', 'projects'] });
    render(<Rail />);
    const dialog = customize();
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(5);
    expect(within(dialog).queryByRole('button', { name: 'Reorder New Chat' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Reorder Feed' })).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show Feed in sidebar' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show New Chat in sidebar' }));
    expect(screen.queryByTestId('nav-feed')).toBeNull();
    expect(screen.queryByTestId('nav-home')).toBeNull();
    expect(screen.getByTestId('projects-section')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Settings', exact: true })).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show Feed in sidebar' }));
    const nav = screen.getByTestId('sidebar-navigation');
    expect([...nav.querySelectorAll('[data-sidebar-nav-id]')].map((el) => el.getAttribute('data-sidebar-nav-id')))
      .toEqual(['inbox', 'history', 'feed', 'sample/panel']);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show Sample in sidebar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    more();
    const disabled = screen.getByRole('menuitem', { name: 'Sample' });
    fireEvent.click(disabled);
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByTestId('location').textContent).toBe('/');
    expect(disabled.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Customize navigation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore defaults' }));
    await waitFor(() => expect(useUi.getState().sidebarNavHidden).toEqual([]));
    expect(useUi.getState().sidebarNavOrder).toEqual(items.map((item) => item.id));
    expect(screen.getByTestId('nav-home')).toBeTruthy();
  });

  it('keeps global and project visibility independent and preserves hidden plugin preferences when unavailable', () => {
    useUi.setState({ sidebarNavHidden: ['sample/panel'], projectSidebarNavHidden: ['feed'] });
    const { rerender } = render(<Rail />);
    expect(screen.queryByTestId('nav-sample/panel')).toBeNull();
    rerender(<Rail catalog={items.filter((item) => item.id !== 'sample/panel')} />);
    expect(within(customize()).queryByRole('checkbox', { name: 'Show Sample in sidebar' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    rerender(<Rail />);
    expect(screen.queryByTestId('nav-sample/panel')).toBeNull();
    rerender(<Rail storageKey={PROJECT_NAV_ORDER_KEY} />);
    expect(screen.queryByTestId('nav-feed')).toBeNull();
    expect(screen.getByTestId('nav-sample/panel')).toBeTruthy();
    customize();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show Feed in sidebar' }));
    expect(h.configSet).toHaveBeenCalledWith({ projectSidebarNavHidden: [] });
    expect(useUi.getState().sidebarNavHidden).toEqual(['sample/panel']);
  });

  it('runs a hidden action and closes More without changing its visibility', () => {
    useUi.setState({ sidebarNavHidden: ['history'], sidebarCollapsed: true });
    render(<Rail />);
    more();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'History' }), { key: ' ' });
    expect(h.onHistory).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByTestId('location').textContent).toBe('/');
    expect(useUi.getState().sidebarNavHidden).toEqual(['history']);
  });

  it('skips disabled hidden destinations when focusing the More menu', () => {
    useUi.setState({ sidebarNavHidden: ['sample/panel'] });
    render(<Rail />);
    more();
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Customize navigation' }));
  });

  it('supports keyboard context menus, arrow navigation, dismissal, and focus return', () => {
    render(<Rail />);
    const feed = screen.getByTestId('nav-feed');
    feed.focus();
    fireEvent.keyDown(feed, { key: 'F10', shiftKey: true });
    const hide = screen.getByRole('menuitem', { name: 'Hide from sidebar' });
    const customizeAction = screen.getByRole('menuitem', { name: 'Customize navigation' });
    expect(document.activeElement).toBe(hide);
    fireEvent.keyDown(hide, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(customizeAction);
    fireEvent.keyDown(customizeAction, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(hide);
    fireEvent.keyDown(hide, { key: 'End' });
    expect(document.activeElement).toBe(customizeAction);
    fireEvent.keyDown(customizeAction, { key: 'Home' });
    expect(document.activeElement).toBe(hide);
    fireEvent.keyDown(hide, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More', exact: true }));
    fireEvent.keyDown(feed, { key: 'ContextMenu' });
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.keyDown(screen.getByTestId('sidebar-navigation'), { key: 'ContextMenu' });
    expect(screen.queryByRole('menu')).toBeNull();
    more(); more();
    expect(screen.queryByRole('menu')).toBeNull();
    more();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    more();
    fireEvent.blur(window);
    expect(screen.queryByRole('menu')).toBeNull();
    customize();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers customization on blank navigation space and leaves collection context menus alone', () => {
    render(<Rail />);
    fireEvent.contextMenu(screen.getByTestId('projects-section'));
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.contextMenu(screen.getByTestId('sidebar-navigation'));
    expect(screen.queryByRole('menuitem', { name: 'Hide from sidebar' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Customize navigation' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    act(() => screen.getByRole('checkbox', { name: 'Show Feed in sidebar' }).focus());
    expect(screen.getByRole('dialog')).toBeTruthy();
    act(() => screen.getByTestId('nav-inbox').focus());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('rolls back a failed save and reports the error', async () => {
    h.configSet.mockRejectedValueOnce(new Error('offline'));
    render(<Rail />);
    customize();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show Feed in sidebar' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Couldn’t save'));
    expect(screen.getByTestId('nav-feed')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show Feed in sidebar' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.queryByTestId('nav-feed')).toBeNull();
  });

  it('does not roll back a newer preference when an earlier save fails', async () => {
    let rejectFirst!: (error: Error) => void;
    h.configSet.mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }));
    const first = useUi.getState().setSidebarNavHidden(GLOBAL_NAV_ORDER_KEY, ['feed']);
    await useUi.getState().setSidebarNavHidden(GLOBAL_NAV_ORDER_KEY, ['history']);
    rejectFirst(new Error('older request failed'));
    await expect(first).rejects.toThrow('older request failed');
    expect(useUi.getState().sidebarNavHidden).toEqual(['history']);
  });

  it('saves restored defaults together and rolls both fields back on failure', async () => {
    const oldOrder = ['home', 'inbox', 'history', 'feed'];
    useUi.setState({ projectSidebarNavHidden: ['feed'], projectSidebarNavOrder: oldOrder });
    h.configSet.mockRejectedValueOnce(new Error('offline'));
    await expect(useUi.getState().setSidebarNavHidden(PROJECT_NAV_ORDER_KEY, [], ['home', 'inbox', 'feed', 'history']))
      .rejects.toThrow('offline');
    expect(h.configSet).toHaveBeenCalledWith({
      projectSidebarNavHidden: [], projectSidebarNavOrder: ['home', 'inbox', 'feed', 'history']
    });
    expect(useUi.getState().projectSidebarNavHidden).toEqual(['feed']);
    expect(useUi.getState().projectSidebarNavOrder).toBe(oldOrder);
  });

  it('keeps mobile popups inside the navigation modal and dismisses them before the drawer', () => {
    const closeDrawer = vi.fn();
    useUi.setState({ sidebarNavHidden: ['history'] });
    render(<MobileNavDrawer enabled open onClose={closeDrawer}><Rail /></MobileNavDrawer>);
    const popup = customize();
    expect(screen.getByRole('dialog', { name: 'Navigation', exact: true }).contains(popup)).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show History in sidebar' }));
    fireEvent.keyDown(popup, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Customize navigation' })).toBeNull();
    expect(closeDrawer).not.toHaveBeenCalled();
    expect(screen.getByTestId('nav-history')).toBeTruthy();
    more();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Customize navigation' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show History in sidebar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    more();
    fireEvent.click(screen.getByRole('menuitem', { name: 'History' }));
    expect(closeDrawer).toHaveBeenCalledOnce();
    expect(h.onHistory).toHaveBeenCalledOnce();
  });
});

describe('Collapsed behavior setting', () => {
  it('offers two-state by default and switches to three-state, persisting the choice', () => {
    render(<Rail />);
    const popup = customize();
    const two = within(popup).getByRole('radio', { name: /Expanded, Hidden/ }) as HTMLInputElement;
    const three = within(popup).getByRole('radio', { name: /Expanded, Rail, Hidden/ }) as HTMLInputElement;
    expect(two.checked).toBe(true);
    expect(three.checked).toBe(false);
    fireEvent.click(three);
    expect(useUi.getState().sidebarCollapseBehavior).toBe('three-state');
    expect((within(screen.getByRole('dialog', { name: 'Customize navigation' })).getByRole('radio', { name: /Expanded, Rail, Hidden/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(two);
    expect(useUi.getState().sidebarCollapseBehavior).toBe('two-state');
  });

  it('Restore defaults also resets Collapsed behavior to two-state', () => {
    render(<Rail />);
    useUi.getState().setSidebarCollapseBehavior('three-state');
    const popup = customize();
    expect((within(popup).getByRole('radio', { name: /Expanded, Rail, Hidden/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(popup).getByRole('button', { name: 'Restore defaults' }));
    expect(useUi.getState().sidebarCollapseBehavior).toBe('two-state');
    expect((within(screen.getByRole('dialog', { name: 'Customize navigation' })).getByRole('radio', { name: /Expanded, Hidden/ }) as HTMLInputElement).checked).toBe(true);
  });
});
