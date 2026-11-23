// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect } from 'react';
import type { BasicSidebarSectionProps } from '@zana-ai/zcc-plugin-sdk/app';
import type { PluginNavPanelRegistration } from '@zana-ai/zcc-plugin-sdk';
import { Link, MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThreadListItem } from '../../thread-store.js';
import { BasicConversationSidebar, BasicShellHeading, BasicUiModeSwitch, BasicUnsupportedDestination } from './BasicShellChrome.js';
import { getBasicUiMode, setBasicUiMode } from '../../lib/basic-ui.js';
import zanaGlyph from '../../assets/zana-glyph.svg';
import { MobileNavDismiss } from '../mobile-nav-context.js';

const slots = vi.hoisted(() => ({ panels: [] as PluginNavPanelRegistration[] }));
vi.mock('../../plugins/plugin-slots.js', () => ({ listNavPanels: () => slots.panels, subscribePluginSlots: () => () => {} }));
const data = vi.hoisted(() => ({ threads: [] as ThreadListItem[], loading: false, scoped: null as string | null, ensure: vi.fn() }));
vi.mock('../../store.js', () => ({
  useData: (selector: (state: unknown) => unknown) => selector({ projects: [{ id: 'p1', name: 'Personal' }, { id: 'p2', name: 'Website' }] }),
  SIDEBAR_MIN: 256, SIDEBAR_MAX: 480
}));
vi.mock('../../thread-store.js', () => ({ useThreads: (selector: (state: unknown) => unknown) => selector(data) }));
vi.mock('../../hooks/useEnsureThreads.js', () => ({ useEnsureThreads: () => data.ensure() }));
vi.mock('../../hooks/useHosts.js', () => ({ useHosts: () => [{ id: 'local', isPrimary: true }], primaryHost: (hosts: { id: string }[]) => hosts[0] }));
vi.mock('../../lib/windowScope.js', () => ({ getScopedProjectId: () => data.scoped }));

function thread(id: string, patch: Partial<ThreadListItem> = {}): ThreadListItem {
  return { id, projectId: 'p1', hostId: 'local', environmentId: null, providerId: 'fake', status: 'idle', title: `Chat ${id}`, createdAt: 1, cwd: null, branchName: null, isWorktree: false, ...patch };
}
function RouteProbe() { const location = useLocation(); return <output data-testid="route">{location.pathname + location.search + location.hash}</output>; }
function LinkToThread() { return <Link to="/threads/two">Open thread directly</Link>; }
function sidebar(path = '/') {
  const onNavigate = vi.fn();
  render(<MemoryRouter initialEntries={[path]}><BasicConversationSidebar onNavigate={onNavigate} /><RouteProbe /></MemoryRouter>);
  return onNavigate;
}
afterEach(() => { cleanup(); slots.panels = []; data.threads = []; data.loading = false; data.scoped = null; data.ensure.mockClear(); setBasicUiMode('advanced'); });

describe('Basic conversation navigation', () => {
  it('provides the shared desktop resize handle and omits it inside the mobile drawer', () => {
    const view = render(<MemoryRouter><BasicConversationSidebar onNavigate={() => {}} /></MemoryRouter>);
    const handle = screen.getByRole('separator');
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('aria-valuemin')).toBe('256');
    expect(handle.getAttribute('aria-valuemax')).toBe('480');
    expect(handle.getAttribute('title')).toBe('Drag to resize · double-click to reset');
    view.rerender(<MemoryRouter><MobileNavDismiss.Provider value={() => {}}><BasicConversationSidebar onNavigate={() => {}} /></MobileNavDismiss.Provider></MemoryRouter>);
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('shows native conversations and project context, excludes archived/hidden rows and searches', () => {
    data.threads = [thread('one'), thread('two', { projectId: 'p2', title: 'Website outline', status: 'error' }), thread('hidden', { visibility: 'hidden', parentThreadId: 'one' }), thread('archived', { archivedAt: 1 })];
    const onNavigate = sidebar('/threads/one');
    expect(screen.getByRole('link', { name: /Chat one/ }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('Website')).toBeTruthy();
    expect(screen.getByText('Error')).toBeTruthy();
    expect(screen.queryByText('Chat hidden')).toBeNull();
    expect(screen.queryByText('Chat archived')).toBeNull();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search chats' }), { target: { value: 'WEBSITE' } });
    expect(screen.queryByText('Chat one')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: /Website outline/ }));
    expect(screen.getByTestId('route').textContent).toBe('/threads/two');
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(data.ensure).toHaveBeenCalled();
  });

  it('clears filtering with the clear button or Escape and keeps typing focus', () => {
    data.threads = [thread('one'), thread('two', { projectId: 'p2', title: 'Website outline' })];
    sidebar();
    const input = screen.getByRole('searchbox') as HTMLInputElement;
    expect(screen.queryByRole('button', { name: 'Clear chat search' })).toBeNull();
    fireEvent.change(input, { target: { value: 'Website' } });
    expect(screen.queryByText('Chat one')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear chat search' }));
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    expect(screen.getByText('Chat one')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'absent' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('absent');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('');
    expect(screen.getByText('Chat one')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('');
  });

  it('keeps a dedicated project window scoped for rows and new chats', () => {
    data.scoped = 'p2';
    data.threads = [thread('one'), thread('two', { projectId: 'p2' })];
    sidebar('/projects/p2/threads/two');
    expect(screen.queryByText('Chat one')).toBeNull();
    expect(screen.getByRole('link', { name: /Chat two/ }).getAttribute('href')).toBe('/projects/p2/threads/two');
    expect(screen.getByRole('link', { name: 'New chat' }).getAttribute('href')).toBe('/projects/p2/threads/new');
  });

  it('provides loading, empty, search-empty and unknown-project fallbacks', () => {
    data.loading = true;
    const view = render(<MemoryRouter><BasicConversationSidebar onNavigate={() => {}} /></MemoryRouter>);
    expect(screen.getByRole('status').textContent).toBe('Loading conversations…');
    data.loading = false;
    view.rerender(<MemoryRouter><BasicConversationSidebar onNavigate={() => {}} /></MemoryRouter>);
    expect(screen.getByRole('status').textContent).toBe('Your conversations will appear here.');
    data.threads = [thread('unknown', { projectId: 'unknown', title: null, hasPendingInteraction: true })];
    view.rerender(<MemoryRouter><BasicConversationSidebar onNavigate={() => {}} /></MemoryRouter>);
    expect(screen.getByText('New conversation')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Project unavailable' })).toBeTruthy();
    expect(screen.getByText('Needs review')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'absent' } });
    expect(screen.getByRole('status').textContent).toBe('No matching conversations.');
  });

  it('bounds each project, keeps an older active conversation visible, and makes the rest reachable', () => {
    data.threads = Array.from({ length: 51 }, (_, i) => thread(String(i)));
    sidebar('/threads/50');
    expect(screen.getByRole('link', { name: 'Chat 50' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByText('Chat 10')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show more conversations in Personal' }));
    expect(screen.getByText('Chat 10')).toBeTruthy();
    expect(screen.getByText('Chat 50')).toBeTruthy();
  });

  it('groups by project, collapses independently, and exposes search matches inside collapsed projects', () => {
    data.threads = [thread('one'), thread('two', { projectId: 'p2', title: 'Design a homepage' }), thread('three', { projectId: 'p2' })];
    sidebar();
    const personal = screen.getByRole('region', { name: 'Personal' });
    const website = screen.getByRole('region', { name: 'Website' });
    expect(within(personal).getAllByRole('link').map(link => link.textContent)).toEqual(['Chat one']);
    expect(within(website).getAllByRole('link').map(link => link.textContent)).toEqual(['Design a homepage', 'Chat three']);
    fireEvent.click(within(website).getByRole('button', { name: 'Website' }));
    expect(within(website).getByRole('button', { name: 'Website' }).getAttribute('aria-expanded')).toBe('false');
    expect(within(website).queryByRole('link')).toBeNull();
    expect(within(personal).getByRole('link')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'homepage' } });
    expect(screen.queryByRole('region', { name: 'Personal' })).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Website' })).getAllByRole('link')).toHaveLength(1);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Website' }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '  WEBSITE  ' } });
    expect(within(screen.getByRole('region', { name: 'Website' })).getAllByRole('link')).toHaveLength(2);
    expect(screen.queryByRole('region', { name: 'Personal' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Website' }));
    expect(within(screen.getByRole('region', { name: 'Website' })).queryByRole('link')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Website' }));
    expect(within(screen.getByRole('region', { name: 'Website' })).getAllByRole('link')).toHaveLength(2);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'no matches' } });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Website' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('reopens the selected project on direct navigation and allows it to be collapsed again', () => {
    data.threads = [thread('one'), thread('two', { projectId: 'p2' })];
    render(<MemoryRouter><BasicConversationSidebar onNavigate={() => {}} /><LinkToThread /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Website' }));
    expect(screen.getByRole('button', { name: 'Website' }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('link', { name: 'Open thread directly' }));
    expect(screen.getByRole('button', { name: 'Website' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('link', { name: 'Chat two' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: 'Website' }));
    fireEvent.click(screen.getByRole('button', { name: 'Website' }));
    expect(screen.getByRole('link', { name: 'Chat two' })).toBeTruthy();
  });

  it('bounds the project list without hiding the selected project', () => {
    data.threads = Array.from({ length: 52 }, (_, i) => thread(String(i), { projectId: `p${i}` }));
    sidebar('/threads/51');
    expect(screen.queryByText('Chat 50')).toBeNull();
    expect(screen.getByRole('link', { name: 'Chat 51' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show more projects' }));
    expect(screen.getByRole('link', { name: 'Chat 50' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show more projects' })).toBeNull();
  });
});

describe('Basic shell controls', () => {
  it('provides named icon buttons with tooltips and the current view selected', () => {
    render(<MemoryRouter><BasicUiModeSwitch /></MemoryRouter>);
    const basic = screen.getByRole('button', { name: 'Basic view' });
    const advanced = screen.getByRole('button', { name: 'Advanced view' });
    for (const button of [basic, advanced]) {
      expect(button.textContent).toBe('');
      expect(button.title).toBe(button.getAttribute('aria-label'));
      expect(button.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
    }
    expect((basic.querySelector('.zana-brand-icon') as HTMLElement).style.mask).toContain(zanaGlyph);
    expect(basic.querySelector('svg')).toBeNull();
    expect(advanced.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(basic);
    expect(basic.getAttribute('aria-pressed')).toBe('true');
    expect(advanced.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(advanced);
    expect(advanced.getAttribute('aria-pressed')).toBe('true');
    expect(basic.getAttribute('aria-pressed')).toBe('false');
  });

  it('starts the Basic sidebar with New chat and keeps the brand only in the Advanced handoff', () => {
    render(<MemoryRouter><BasicConversationSidebar onNavigate={() => {}} /><BasicUnsupportedDestination /></MemoryRouter>);
    const sidebar = screen.getByRole('complementary', { name: 'Conversations' });
    expect(sidebar.firstElementChild).toBe(screen.getByRole('link', { name: 'New chat' }));
    expect(sidebar.querySelector('.zana-brand-icon')).toBeNull();
    const mark = document.querySelector('.basic-ui-unsupported > .zana-brand-icon') as HTMLElement;
    expect(mark.style.mask).toContain(zanaGlyph);
    expect(mark.getAttribute('aria-hidden')).toBe('true');
  });

  it.each<[string, string | null, string]>([
    ['/scheduler?scope=p#history', null, '/'],
    ['/projects/p2/inbox', 'p2', '/projects/p2/threads/new'],
    ['/threads/one?turn=2#message', null, '/threads/one?turn=2#message'],
    ['/projects/p2/threads/two', 'p2', '/projects/p2/threads/two'],
    ['/projects/p2/threads/new?prompt=hello', 'p2', '/projects/p2/threads/new?prompt=hello'],
    ['/?prompt=hello', null, '/?prompt=hello']
  ])('enters Basic from %s at the conversation or New chat', (from, scope, expected) => {
    data.scoped = scope;
    render(<MemoryRouter initialEntries={[from]}><BasicUiModeSwitch /><RouteProbe /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Basic view' }));
    expect(getBasicUiMode()).toBe('basic');
    expect(screen.getByTestId('route').textContent).toBe(expected);
  });

  it('opens an explicit Advanced-only link at the same destination', () => {
    setBasicUiMode('basic');
    render(<MemoryRouter initialEntries={['/scheduler?scope=p#history']}><BasicUnsupportedDestination /><RouteProbe /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Open in Advanced' }));
    expect(getBasicUiMode()).toBe('advanced');
    expect(screen.getByTestId('route').textContent).toBe('/scheduler?scope=p#history');
  });

  it('keeps the desktop toggle reachable in both states and uses the mobile menu on compact layouts', () => {
    const onToggleNavigation = vi.fn();
    const view = render(<BasicShellHeading compact={false} collapsed={false} onToggleNavigation={onToggleNavigation} />);
    const collapse = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(collapse.title).toBe('Collapse sidebar');
    expect(collapse.getAttribute('aria-expanded')).toBe('true');
    expect(collapse.getAttribute('aria-controls')).toBe('basic-conversation-sidebar');
    expect(collapse.querySelector('.lucide-panel-left-close')).toBeTruthy();
    expect(collapse.closest('.sidebar-trigger-overlay')).toBeTruthy();
    expect(collapse.closest('.basic-ui-shell-heading')?.textContent).toBe('');
    fireEvent.click(collapse);
    view.rerender(<BasicShellHeading compact={false} collapsed onToggleNavigation={onToggleNavigation} />);
    const expand = screen.getByRole('button', { name: 'Expand sidebar' });
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    expect(expand.querySelector('.lucide-panel-left')).toBeTruthy();
    fireEvent.click(expand);
    view.rerender(<BasicShellHeading compact collapsed onToggleNavigation={onToggleNavigation} />);
    const menu = screen.getByRole('button', { name: 'Open conversations' });
    expect(menu.querySelector('.lucide-menu')).toBeTruthy();
    expect(menu.closest('.sidebar-trigger-overlay')).toBeNull();
    fireEvent.click(menu);
    expect(onToggleNavigation).toHaveBeenCalledTimes(3);
  });

  it('retains search and project collapse state while its sidebar is hidden', () => {
    data.threads = [thread('one'), thread('two', { projectId: 'p2' })];
    const view = render(<MemoryRouter><BasicConversationSidebar onNavigate={() => {}} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Personal' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Website' } });
    view.rerender(<MemoryRouter><BasicConversationSidebar hidden onNavigate={() => {}} /></MemoryRouter>);
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(document.getElementById('basic-conversation-sidebar')?.hidden).toBe(true);
    view.rerender(<MemoryRouter><BasicConversationSidebar onNavigate={() => {}} /></MemoryRouter>);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('Website');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Personal' }).getAttribute('aria-expanded')).toBe('false');
  });
});

it('mounts Basic sections above history, deduplicates their threads and closes the drawer on navigation', () => {
  function Section({ registerThreads, openThread, projectIds, searchQuery }: BasicSidebarSectionProps) {
    useEffect(() => registerThreads(['one']), [registerThreads]);
    return <button onClick={() => openThread('one')}>{projectIds.join(',')} {searchQuery} shortcut</button>;
  }
  slots.panels = [{ id: 'panel', pluginId: 'sample', title: 'Sample', icon: 'List', generation: 1,
    component: () => null, experimental_basicSidebarSection: Section }];
  data.threads = [thread('one'), thread('two')];
  const onNavigate = sidebar();
  const shortcut = screen.getByRole('button', { name: /p1,p2 shortcut/ });
  expect(shortcut.compareDocumentPosition(screen.getByRole('heading', { name: 'Conversations' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Chat one' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Chat two' })).toBeTruthy();
  fireEvent.click(shortcut);
  expect(onNavigate).toHaveBeenCalledOnce();
  expect(screen.getByTestId('route').textContent).toBe('/threads/one');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Scout' } });
  expect(screen.getByRole('button', { name: /Scout shortcut/ })).toBeTruthy();
});
