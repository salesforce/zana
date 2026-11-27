// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect } from 'react';
import type { BasicSidebarSectionProps } from '@zana-ai/zcc-plugin-sdk/app';
import type { PluginNavPanelRegistration } from '@zana-ai/zcc-plugin-sdk';
import { Link, MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThreadListItem } from '../../thread-store.js';
import { BasicConversationSidebar, BasicShellHeading, BasicUiModeSwitch, BasicUnsupportedDestination, MobileInterfaceView } from './BasicShellChrome.js';
import { getBasicUiMode, setBasicUiMode } from '../../lib/basic-ui.js';
import zanaGlyph from '../../assets/zana-glyph.svg';
import { MobileNavDismiss } from '../mobile-nav-context.js';
import { DEFAULT_BASIC_CONVERSATION_VIEW, useBasicConversationView } from './basic-conversation-view.js';
import { act, waitFor } from '@testing-library/react';

const slots = vi.hoisted(() => ({ panels: [] as PluginNavPanelRegistration[] }));
vi.mock('../../plugins/plugin-slots.js', () => ({ listNavPanels: () => slots.panels, subscribePluginSlots: () => () => {} }));
const data = vi.hoisted(() => ({ threads: [] as ThreadListItem[], loading: false, scoped: null as string | null, ensure: vi.fn(), remove: vi.fn(), upsert: vi.fn() }));
const actions = vi.hoisted(() => ({
  archive: vi.fn(), unarchive: vi.fn(), pin: vi.fn(), unpin: vi.fn(), read: vi.fn(), unread: vi.fn(), rename: vi.fn(),
  copy: vi.fn(), move: vi.fn(), toast: vi.fn()
}));
vi.mock('../../store.js', () => ({
  useData: (selector: (state: unknown) => unknown) => selector({ projects: [{ id: 'p1', name: 'Personal' }, { id: 'p2', name: 'Website', color: '#2f81f7' }] }),
  useUi: { getState: () => ({ pushToast: actions.toast }) },
  errorMessage: (error: Error) => error.message,
  SIDEBAR_MIN: 256, SIDEBAR_MAX: 480
}));
const archive = vi.hoisted(() => ({ listeners: new Set<() => void>(), history: vi.fn() }));
vi.mock('../../thread-store.js', () => ({
  useThreads: Object.assign((selector: (state: unknown) => unknown) => selector(data), { getState: () => data }),
  onThreadArchived: (listener: () => void) => { archive.listeners.add(listener); return () => archive.listeners.delete(listener); }
}));
vi.mock('../../lib/product-client.js', () => ({ product: { threads: { ...actions, history: archive.history } } }));
vi.mock('../../lib/copy-text.js', () => ({ copyTextOrFail: actions.copy }));
vi.mock('../../lib/session-move.js', () => ({ useSessionMove: { getState: () => ({ open: actions.move }) } }));
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
afterEach(() => { cleanup(); useBasicConversationView.setState({ view: { ...DEFAULT_BASIC_CONVERSATION_VIEW } }); archive.history.mockReset(); archive.listeners.clear(); slots.panels = []; data.threads = []; data.loading = false; data.scoped = null; data.ensure.mockClear(); setBasicUiMode('advanced'); });

it('shows the current interface view in mobile navigation and dismisses it after a change', () => {
  const onChange = vi.fn();
  render(<MemoryRouter initialEntries={['/agents']}><MobileInterfaceView onChange={onChange} /><RouteProbe /></MemoryRouter>);
  const advanced = screen.getByRole('button', { name: 'Interface view Advanced' });
  fireEvent.click(advanced);
  let sheet = within(screen.getByRole('dialog', { name: 'Interface view' }));
  expect(sheet.getByRole('button', { name: 'Advanced' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(sheet.getByRole('button', { name: 'Advanced' }));
  expect(onChange).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(advanced);
  fireEvent.click(advanced);
  sheet = within(screen.getByRole('dialog', { name: 'Interface view' }));
  fireEvent.click(sheet.getByRole('button', { name: 'Basic' }));
  expect(getBasicUiMode()).toBe('basic');
  expect(screen.getByTestId('route').textContent).toBe('/');
  expect(screen.getByRole('button', { name: 'Interface view Basic' })).toBeTruthy();
  expect(onChange).toHaveBeenCalledOnce();
});

describe('Basic conversation navigation', () => {
  it('omits New Window from the Basic desktop sidebar', () => {
    vi.stubGlobal('cc', {});
    try {
      setBasicUiMode('basic');
      sidebar();
      expect(screen.queryByRole('button', { name: 'New Window' })).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

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
    expect(screen.getByText('Project unavailable')).toBeTruthy();
    expect(screen.getByText('Needs review')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'absent' } });
    expect(screen.getByRole('status').textContent).toBe('No matching conversations.');
  });

  it('marks finished conversations with unseen replies as Unread, except the open, live or archived ones', () => {
    data.threads = [
      thread('new', { lastReadSeq: 3, maxSeq: 5 }),
      thread('read', { lastReadSeq: 5, maxSeq: 5 }),
      thread('never', { lastReadSeq: null, maxSeq: 2 }),
      thread('open', { lastReadSeq: 1, maxSeq: 5 }),
      thread('live', { status: 'active', lastReadSeq: 1, maxSeq: 5 })
    ];
    sidebar('/threads/open');
    const row = screen.getByTestId('basic-chat-row-new');
    expect(row.className).toContain('is-unread');
    expect(row.getAttribute('aria-label')).toBe('Chat new, Personal, unread');
    expect(within(row).getByText('Unread')).toBeTruthy();
    for (const id of ['read', 'never', 'open']) {
      expect(screen.queryByTestId(`basic-chat-unread-${id}`)).toBeNull();
      expect(screen.getByTestId(`basic-chat-row-${id}`).className).not.toContain('is-unread');
    }
    expect(screen.queryByTestId('basic-chat-unread-live')).toBeNull();
    expect(within(screen.getByTestId('basic-chat-row-live')).getByText('Working')).toBeTruthy();
  });

  it('shows Unread even inside a project window where no project label is rendered', () => {
    data.scoped = 'p1';
    data.threads = [thread('new', { lastReadSeq: 0, maxSeq: 1 }), thread('archived', { archivedAt: 1, lastReadSeq: 0, maxSeq: 1 })];
    useBasicConversationView.setState({ view: { ...DEFAULT_BASIC_CONVERSATION_VIEW, status: 'all' } });
    archive.history.mockResolvedValue([]);
    sidebar('/projects/p1/threads/new2');
    expect(screen.getByTestId('basic-chat-row-new').getAttribute('aria-label')).toBe('Chat new, unread');
    expect(screen.getByTestId('basic-chat-unread-new')).toBeTruthy();
    expect(screen.queryByTestId('basic-chat-unread-archived')).toBeNull();
  });

  it('pages one flat list and keeps an older active conversation visible', () => {
    data.threads = Array.from({ length: 41 }, (_, i) => thread(String(i), { updatedAt: 100 - i, projectId: i % 2 ? 'p2' : 'p1' }));
    sidebar('/threads/40');
    expect(screen.getByRole('link', { name: 'Chat 40, Personal' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByText('Chat 30')).toBeNull();
    expect(screen.getAllByRole('link').filter(link => link.dataset.testid?.startsWith('basic-chat-row-'))).toHaveLength(31);
    fireEvent.click(screen.getByRole('button', { name: 'Show more conversations' }));
    expect(screen.getByText('Chat 30')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show more conversations' })).toBeNull();
  });

  it('shows no project headers, names the project under each title, and searches project names', () => {
    data.threads = [thread('one', { updatedAt: 3 }), thread('two', { projectId: 'p2', title: 'Design a homepage', updatedAt: 2, status: 'active' }), thread('three', { projectId: 'p2', updatedAt: 1 })];
    sidebar();
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Website' })).toBeNull();
    const rows = screen.getAllByRole('link').filter(link => link.dataset.testid?.startsWith('basic-chat-row-'));
    expect(rows.map(link => link.getAttribute('aria-label'))).toEqual(['Chat one, Personal', 'Design a homepage, Website', 'Chat three, Website']);
    const personal = within(rows[0]!).getByText('Personal');
    const website = within(rows[1]!).getByText('Website');
    expect(personal.style.getPropertyValue('--basic-chat-project-color')).toBe('');
    expect(website.className).toBe('basic-ui-chat-project');
    expect(website.style.getPropertyValue('--basic-chat-project-color')).toBe('#2f81f7');
    expect(within(rows[1]!).getByText('Working')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '  WEBSITE  ' } });
    expect(screen.getAllByRole('link').filter(link => link.dataset.testid?.startsWith('basic-chat-row-'))).toHaveLength(2);
  });

  it('omits the project label inside a dedicated project window', () => {
    data.scoped = 'p1';
    data.threads = [thread('one'), thread('two', { projectId: 'p2' })];
    sidebar();
    const row = screen.getByRole('link', { name: 'Chat one' });
    expect(row.querySelector('.basic-ui-chat-meta')).toBeNull();
    expect(screen.queryByText('Chat two')).toBeNull();
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

  it('retains search state while its sidebar is hidden', () => {
    data.threads = [thread('one'), thread('two', { projectId: 'p2' })];
    const view = render(<MemoryRouter><BasicConversationSidebar onNavigate={() => {}} /></MemoryRouter>);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Website' } });
    view.rerender(<MemoryRouter><BasicConversationSidebar hidden onNavigate={() => {}} /></MemoryRouter>);
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(document.getElementById('basic-conversation-sidebar')?.hidden).toBe(true);
    view.rerender(<MemoryRouter><BasicConversationSidebar onNavigate={() => {}} /></MemoryRouter>);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('Website');
    expect(screen.queryByText('Chat one')).toBeNull();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    expect(screen.getByText('Chat one')).toBeTruthy();
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
  expect(screen.queryByText('Chat one')).toBeNull();
  expect(screen.getByRole('link', { name: 'Chat two, Personal' })).toBeTruthy();
  fireEvent.click(shortcut);
  expect(onNavigate).toHaveBeenCalledOnce();
  expect(screen.getByTestId('route').textContent).toBe('/threads/one');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Scout' } });
  expect(screen.getByRole('button', { name: /Scout shortcut/ })).toBeTruthy();
});

describe('Basic conversation view menu', () => {
  const open = () => fireEvent.click(screen.getByRole('button', { name: 'Conversation view options' }));
  const pick = (choice: string, option: string) => {
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(`^${choice}`) }));
    fireEvent.click(within(screen.getByRole('group', { name: choice })).getByRole('menuitemradio', { name: option }));
  };

  it('switches layouts without leaving the current chat and reveals collapsed groups during search', () => {
    data.threads = [thread('old', { updatedAt: 1 }), thread('web', { projectId: 'p2', updatedAt: 2 }),
      thread('recent', { updatedAt: 3 })];
    sidebar('/threads/web');
    const trigger = screen.getByRole('button', { name: 'Conversation view options' });
    const search = screen.getByRole('searchbox', { name: 'Search chats' });
    const web = () => screen.getByRole('link', { name: 'Chat web, Website' });
    const chatOrder = () => within(screen.getByRole('navigation')).getAllByRole('link').map(link => link.textContent);
    expect(chatOrder()).toEqual(['Chat recentPersonal', 'Chat webWebsite', 'Chat oldPersonal']);

    open();
    pick('Layout', 'By project');
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger.className).not.toContain('is-filtered');
    expect(chatOrder()).toEqual(['Chat recent', 'Chat old', 'Chat web']);
    expect(web().getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('route').textContent).toBe('/threads/web');
    const website = screen.getByRole('button', { name: 'Website' });
    fireEvent.click(website);
    expect(website.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: 'Chat web, Website' })).toBeNull();
    fireEvent.change(search, { target: { value: 'Website' } });
    expect(website.getAttribute('aria-expanded')).toBe('true');
    expect(web()).toBeTruthy();
    fireEvent.change(search, { target: { value: '' } });
    expect(website.getAttribute('aria-expanded')).toBe('false');

    open();
    pick('Layout', 'Quiet list');
    expect(screen.queryByRole('button', { name: 'Website' })).toBeNull();
    expect(web().getAttribute('aria-current')).toBe('page');
  });

  it('sorts by title, hides automations and shows a filter summary', () => {
    data.threads = [thread('b', { title: 'Beta', updatedAt: 9 }), thread('a', { title: 'Alpha', updatedAt: 1 }),
      thread('bot', { title: 'Bot chat', originPluginId: 'bots', updatedAt: 5 })];
    sidebar();
    const names = () => screen.getAllByRole('link').map(link => link.querySelector('.basic-ui-chat-name')?.textContent ?? link.textContent);
    expect(names()).toEqual(['New chat', 'Beta', 'Bot chat', 'Alpha']);
    open();
    expect(screen.getByRole('menu', { name: 'Conversation view options' })).toBeTruthy();
    pick('Sort by', 'Title');
    expect(names()).toEqual(['New chat', 'Alpha', 'Beta', 'Bot chat']);
    expect(screen.queryByTestId('basic-conversation-filter')).toBeNull();
    const toggle = screen.getByRole('menuitemcheckbox', { name: 'Automations' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(names()).toEqual(['New chat', 'Alpha', 'Beta']);
    expect(screen.getByTestId('basic-conversation-filter').textContent).toBe('No automations');
    expect(screen.getByRole('button', { name: 'Conversation view options' }).className).toContain('is-filtered');
    pick('Last activity', 'Today');
    expect(screen.getByText('No matching conversations.')).toBeTruthy();
    expect(screen.getByTestId('basic-conversation-filter').textContent).toBe('Today · No automations');
  });

  it('closes on Escape (returning focus) and on an outside click, and toggles submenus', () => {
    sidebar();
    open();
    const sortItem = screen.getByRole('menuitem', { name: /^Sort by/ });
    fireEvent.click(sortItem);
    expect(sortItem.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(sortItem);
    expect(screen.queryByRole('group', { name: 'Sort by' })).toBeNull();
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Conversation view options' }));
    open();
    fireEvent.pointerDown(screen.getByRole('menu'));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    open(); open();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('loads archived conversations from history for Archived and All, and reloads after an archive', async () => {
    archive.history
      .mockResolvedValueOnce({ rows: [{ id: 'old', projectId: 'p2', providerId: 'fake', title: 'Archived plan', updatedAt: 5, archivedAt: 6, hostId: 'local', createdAt: 2, originPluginId: null }], nextOffset: 40 })
      .mockResolvedValueOnce({ rows: [{ id: 'one', projectId: 'p1', providerId: 'fake', title: 'Stale copy', updatedAt: 1, archivedAt: 1 }] })
      .mockResolvedValue({ rows: [] });
    data.threads = [thread('one')];
    sidebar();
    expect(archive.history).not.toHaveBeenCalled();
    open();
    pick('Status', 'All');
    await waitFor(() => expect(screen.getByRole('link', { name: 'Archived plan, Website' })).toBeTruthy());
    expect(within(screen.getByRole('link', { name: 'Archived plan, Website' })).getByText('Archived')).toBeTruthy();
    expect(archive.history).toHaveBeenNthCalledWith(1, { archived: 'archived', offset: 0 });
    expect(archive.history).toHaveBeenNthCalledWith(2, { archived: 'archived', offset: 40 });
    expect(screen.getByRole('link', { name: 'Chat one, Personal' })).toBeTruthy();
    expect(screen.queryByText('Stale copy')).toBeNull();
    expect(screen.getByTestId('basic-conversation-filter').textContent).toBe('All');
    pick('Status', 'Archived');
    expect(screen.getByRole('link', { name: 'Archived plan, Website' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Chat one, Personal' })).toBeNull();
    const calls = archive.history.mock.calls.length;
    act(() => { for (const listener of archive.listeners) listener(); });
    await waitFor(() => expect(archive.history.mock.calls.length).toBeGreaterThan(calls));
  });

  it('reports a failed archived load', async () => {
    archive.history.mockRejectedValue(new Error('offline'));
    data.scoped = 'p1';
    useBasicConversationView.setState({ view: { ...DEFAULT_BASIC_CONVERSATION_VIEW, status: 'archived' } });
    sidebar();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Archived conversations could not be loaded'));
    expect(archive.history).toHaveBeenCalledWith({ archived: 'archived', offset: 0, projectId: 'p1' });
  });
});

describe('Basic conversation row actions', () => {
  const trigger = () => screen.getByRole('button', { name: 'Actions for Chat one' });
  const item = (name: string) => screen.getByRole('menuitem', { name, exact: true });
  const choose = (name: string) => { fireEvent.click(trigger()); fireEvent.click(item(name)); };

  afterEach(() => {
    Object.values(actions).forEach(mock => mock.mockReset());
    data.remove.mockClear();
    data.upsert.mockClear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('opens by right-click or keyboard, returns focus on Escape and copies the row ID without opening it', async () => {
    data.threads = [thread('one')];
    const onNavigate = sidebar();
    fireEvent.contextMenu(screen.getByTestId('basic-chat-row-one'));
    expect(document.activeElement).toBe(item('Pin'));
    fireEvent.keyDown(item('Pin'), { key: 'Escape' });
    expect(document.activeElement).toBe(trigger());
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    fireEvent.click(item('Copy conversation ID'));
    await waitFor(() => expect(actions.toast).toHaveBeenCalledWith('Conversation ID copied'));
    expect(actions.copy).toHaveBeenCalledWith('one');
    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.getByTestId('route').textContent).toBe('/');
  });

  it.each([
    ['Pin', 'pin', {}], ['Unpin', 'unpin', { pinnedAt: 1 }],
    ['Mark as unread', 'unread', {}], ['Mark as read', 'read', { maxSeq: 5, lastReadSeq: 0 }]
  ] as const)('wires %s to the existing thread action and refreshes the roster', async (label, method, patch) => {
    data.threads = [thread('one', patch)];
    const changed = thread('one', { updatedAt: 10 });
    actions[method].mockResolvedValue({ thread: changed });
    sidebar();
    choose(label);
    expect(actions[method]).toHaveBeenCalledWith('one');
    await waitFor(() => expect(data.upsert).toHaveBeenCalledWith(changed));
  });

  it('uses the existing move dialog and lets users cancel or submit a rename', async () => {
    data.threads = [thread('one')];
    sidebar();
    choose('Move to project…');
    expect(actions.move).toHaveBeenCalledWith('one');
    choose('Rename');
    let dialog = within(screen.getByRole('dialog', { name: 'Rename conversation' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(actions.rename).not.toHaveBeenCalled();
    choose('Rename');
    dialog = within(screen.getByRole('dialog', { name: 'Rename conversation' }));
    fireEvent.change(dialog.getByRole('textbox', { name: 'Title' }), { target: { value: 'Updated title' } });
    actions.rename.mockResolvedValue({ thread: thread('one', { title: 'Updated title' }) });
    fireEvent.click(dialog.getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(data.upsert).toHaveBeenCalledWith(expect.objectContaining({ title: 'Updated title' })));
    expect(actions.rename).toHaveBeenCalledWith('one', 'Updated title');
  });

  it('confirms archive and returns the selected conversation to Basic new chat', async () => {
    data.threads = [thread('one')];
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.stubGlobal('confirm', confirm);
    actions.archive.mockResolvedValue({ ok: true });
    sidebar('/threads/one');
    choose('Archive');
    expect(actions.archive).not.toHaveBeenCalled();
    choose('Archive');
    expect(confirm).toHaveBeenCalledWith('Archive “Chat one”?');
    expect(actions.archive).toHaveBeenCalledWith('one');
    await waitFor(() => expect(screen.getByTestId('route').textContent).toBe('/'));
    expect(data.remove).toHaveBeenCalledWith('one');
  });

  it('reloads visible archive history when the archive response arrives before the roster event', async () => {
    data.threads = [thread('one')];
    useBasicConversationView.setState({ view: { ...DEFAULT_BASIC_CONVERSATION_VIEW, status: 'all' } });
    archive.history.mockResolvedValue({ rows: [] });
    actions.archive.mockResolvedValue({ ok: true });
    vi.stubGlobal('confirm', vi.fn(() => true));
    sidebar('/threads/two');
    await waitFor(() => expect(archive.history).toHaveBeenCalledTimes(1));
    choose('Archive');
    await waitFor(() => expect(archive.history).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('route').textContent).toBe('/threads/two');
  });

  it('offers only copy and restore for archived conversations and handles a retry after failure', async () => {
    archive.history.mockResolvedValue({ rows: [{ id: 'one', projectId: 'p1', providerId: 'fake', title: 'Chat one', updatedAt: 5, archivedAt: 6 }] });
    useBasicConversationView.setState({ view: { ...DEFAULT_BASIC_CONVERSATION_VIEW, status: 'archived' } });
    actions.unarchive.mockRejectedValueOnce(new Error('Environment unavailable')).mockResolvedValueOnce({ thread: thread('one') });
    sidebar();
    await screen.findByRole('button', { name: 'Actions for Chat one' });
    fireEvent.click(trigger());
    expect(screen.getAllByRole('menuitem').map(entry => entry.textContent)).toEqual(['Copy conversation ID', 'Restore']);
    fireEvent.click(item('Restore'));
    await waitFor(() => expect(actions.toast).toHaveBeenCalledWith('Environment unavailable', 'error'));
    expect(data.upsert).not.toHaveBeenCalled();
    choose('Restore');
    await waitFor(() => expect(data.upsert).toHaveBeenCalledWith(thread('one')));
  });
});
