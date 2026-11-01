// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import type { Project } from '@zana-ai/zcc-domain/product';
import type { ThreadListItem } from '../thread-store.js';

const h = vi.hoisted(() => ({ scope: null as string | null, load: vi.fn(), archived: null as null | ((id: string) => void), unsubscribe: vi.fn(), copy: vi.fn(), toast: vi.fn(), archive: vi.fn(), remove: vi.fn() }));
vi.mock('../lib/copy-text.js', () => ({ copyTextOrFail: h.copy }));
vi.mock('../lib/product-client.js', () => ({ product: { threads: { archive: h.archive } } }));
vi.mock('../lib/windowScope.js', () => ({ getScopedProjectId: () => h.scope }));
vi.mock('../store.js', async () => {
  const { create } = await import('zustand');
  return { useData: create(() => ({ projects: [] })), useUi: create(() => ({ pushToast: h.toast })) };
});
vi.mock('../thread-store.js', async () => {
  const { create } = await import('zustand');
  return { useThreads: create(() => ({ threads: [], load: h.load, remove: h.remove })), onThreadArchived: (cb: (id: string) => void) => { h.archived = cb; return h.unsubscribe; } };
});
vi.mock('./thread/pickers/ProviderIcon.js', () => ({ ProviderIcon: ({ providerId }: { providerId: string }) => <i data-provider={providerId} /> }));
import { useData } from '../store.js';
import { useThreads } from '../thread-store.js';
import { TitlebarThreadTabs } from './TitlebarThreadTabs.js';

const row = (id: string, projectId = 'p', extra: Partial<ThreadListItem> = {}): ThreadListItem => ({ id, projectId, title: `Thread ${id}`, providerId: 'fake', status: 'idle', hostId: 'local', environmentId: null, createdAt: 1, cwd: null, branchName: null, isWorktree: false, ...extra });
function Probe() {
  const location = useLocation(); const navigate = useNavigate();
  return <><output data-testid="route">{location.pathname}</output>{['/threads/a', '/threads/b', '/threads/c', '/threads/hidden', '/threads/archived', '/settings', '/projects/p/threads/a'].map(path => <button key={path} onClick={() => navigate(path)}>{path}</button>)}</>;
}
function mount(path = '/threads/a') { return render(<MemoryRouter initialEntries={[path]}><TitlebarThreadTabs /><Probe /></MemoryRouter>); }
const visit = (path: string) => fireEvent.click(screen.getByRole('button', { name: path, exact: true }));
const tabs = () => screen.getAllByRole('tab');

beforeEach(() => {
  h.scope = null; h.load.mockReset().mockResolvedValue(undefined); h.unsubscribe.mockReset(); sessionStorage.clear();
  h.copy.mockReset().mockResolvedValue(undefined); h.toast.mockReset();
  h.archive.mockReset().mockResolvedValue({ ok: true });
  h.remove.mockReset().mockImplementation((id: string) => useThreads.setState({ threads: useThreads.getState().threads.filter(row => row.id !== id) }));
  vi.stubGlobal('confirm', vi.fn(() => true));
  useData.setState({ projects: [{ id: 'p', name: 'Project P', color: '#abc' }, { id: 'q', name: 'Project Q' }] as Project[] });
  useThreads.setState({ threads: [row('a'), row('b', 'q'), row('c', 'p', { title: null }), row('hidden', 'p', { visibility: 'hidden' }), row('archived', 'p', { archivedAt: 1 })] });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('opens visited threads only, keeps stable order and project context, and updates live metadata', () => {
  mount();
  expect(h.load).toHaveBeenCalledOnce();
  expect(tabs()).toHaveLength(1);
  visit('/threads/b'); visit('/threads/a');
  expect(tabs().map(tab => tab.textContent)).toEqual(['Thread aProject P', 'Thread bProject Q']);
  expect(tabs()[0]!.getAttribute('aria-selected')).toBe('true');
  act(() => useThreads.setState({ threads: [row('a'), row('b', 'q', { title: 'Renamed', status: 'active', maxSeq: 4, lastReadSeq: 0 })] }));
  expect(screen.getByRole('tab', { name: 'Renamed — Project Q — Unread' })).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Working' })).toBeTruthy();
  act(() => useThreads.setState({ threads: [row('a', 'p', { hasPendingInteraction: true }), row('b', 'q', { status: 'error' })] }));
  expect(screen.getByRole('img', { name: 'Needs you' })).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Error' })).toBeTruthy();
});

it('uses distinct working, input and error icons while leaving idle tabs and project context quiet', () => {
  mount(); visit('/threads/b');
  expect(screen.queryByRole('img')).toBeNull();
  expect(document.querySelector('.titlebar-thread-context i')).toBeNull();
  expect(document.querySelector('.titlebar-thread-project')?.textContent).toBe('Project P');
  act(() => useThreads.setState({ threads: [row('a', 'p', { status: 'active' }), row('b', 'q', { status: 'active', hasPendingInteraction: true })] }));
  const working = screen.getByRole('img', { name: 'Working' });
  const pending = screen.getByRole('img', { name: 'Needs you' });
  expect(working.querySelector('svg.lucide-loader-circle')?.getAttribute('aria-hidden')).toBe('true');
  expect(pending.querySelector('svg.lucide-message-square-text')).toBeTruthy();
  // A failed thread takes precedence over any leftover pending interaction.
  act(() => useThreads.setState({ threads: [row('a', 'p', { status: 'error', hasPendingInteraction: true }), row('b', 'q')] }));
  expect(screen.getByRole('img', { name: 'Error' }).querySelector('svg.lucide-triangle-alert')).toBeTruthy();
  expect(screen.queryByRole('img', { name: 'Working' })).toBeNull();
  expect(screen.queryByRole('img', { name: 'Needs you' })).toBeNull();
});

it('shows unread with a title emphasis and New label, clearing both when selected or read elsewhere', () => {
  mount(); visit('/threads/b');
  act(() => useThreads.setState({ threads: [row('a', 'p', { maxSeq: 5, lastReadSeq: 2 }), row('b', 'q', { maxSeq: 5, lastReadSeq: 0 })] }));
  const unread = screen.getByRole('tab', { name: 'Thread a — Project P — Unread' });
  expect(unread.closest('.titlebar-thread')?.classList.contains('is-unread')).toBe(true);
  expect(within(unread).getByText('New').getAttribute('aria-hidden')).toBe('true');
  expect(screen.getByRole('tab', { name: 'Thread b — Project Q' }).querySelector('.titlebar-thread-unread-label')).toBeNull();
  expect(document.querySelector('.titlebar-thread-unread')).toBeNull();
  fireEvent.click(unread);
  expect(screen.getByRole('tab', { name: 'Thread a — Project P' }).closest('.titlebar-thread')?.classList.contains('is-unread')).toBe(false);
  expect(screen.getByRole('tab', { name: 'Thread a — Project P' }).querySelector('.titlebar-thread-unread-label')).toBeNull();
  act(() => useThreads.setState({ threads: [row('a', 'p', { maxSeq: 5, lastReadSeq: 5 }), row('b', 'q', { maxSeq: 5, lastReadSeq: 5 })] }));
  visit('/threads/b');
  expect(document.querySelector('.titlebar-thread.is-unread')).toBeNull();
  expect(screen.queryByText('New')).toBeNull();
});

it('closes shortcuts, selects adjacent tabs, reopens closed tabs and falls back after the last close', () => {
  mount(); visit('/threads/b'); visit('/threads/c');
  fireEvent.click(screen.getByRole('button', { name: 'Close tab: Thread b' }));
  expect(screen.getByTestId('route').textContent).toBe('/threads/c');
  fireEvent.click(screen.getByRole('button', { name: 'Close tab: Untitled thread' }));
  expect(screen.getByTestId('route').textContent).toBe('/threads/a');
  fireEvent.click(screen.getByRole('button', { name: 'Reopen closed tab' }));
  expect(screen.getByTestId('route').textContent).toBe('/threads/c');
  fireEvent.click(screen.getByRole('button', { name: 'Close tab: Thread a' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close tab: Untitled thread' }));
  expect(screen.getByTestId('route').textContent).toBe('/agents');
  expect(screen.getByText('Open a thread to keep it here')).toBeTruthy();
  expect(useThreads.getState().threads).toHaveLength(5);
});

it('closes an active tab toward the right, and restores window-local tabs after a remount', () => {
  const view = mount(); visit('/threads/b'); visit('/threads/a');
  fireEvent.click(screen.getByRole('button', { name: 'Close tab: Thread a' }));
  expect(screen.getByTestId('route').textContent).toBe('/threads/b');
  view.unmount(); expect(h.unsubscribe).toHaveBeenCalled();
  mount('/settings');
  expect(tabs()).toHaveLength(1);
  expect(tabs()[0]!.getAttribute('tabindex')).toBe('0');
  fireEvent.click(screen.getByRole('button', { name: 'Reopen closed tab' }));
  expect(screen.getByTestId('route').textContent).toBe('/threads/a');
});

it('keeps project windows scoped, creates threads there, and returns there after closing', () => {
  h.scope = 'p'; mount('/projects/p/threads/a');
  visit('/threads/b');
  expect(tabs()).toHaveLength(1);
  fireEvent.click(tabs()[0]!);
  expect(screen.getByTestId('route').textContent).toBe('/projects/p/threads/a');
  fireEvent.click(screen.getByRole('button', { name: 'New thread' }));
  expect(screen.getByTestId('route').textContent).toBe('/projects/p/threads/new');
  visit('/projects/p/threads/a');
  fireEvent.click(screen.getByRole('button', { name: 'Close tab: Thread a' }));
  expect(screen.getByTestId('route').textContent).toBe('/projects/p');
});

it('keeps a project route when revisiting its tab and makes new global threads from global pages', () => {
  mount('/projects/p/threads/a'); visit('/settings');
  fireEvent.click(tabs()[0]!);
  expect(screen.getByTestId('route').textContent).toBe('/projects/p/threads/a');
  visit('/settings');
  fireEvent.click(screen.getByRole('button', { name: 'New thread' }));
  expect(screen.getByTestId('route').textContent).toBe('/threads/new');
});

it('ignores hidden, archived, missing threads and removes archived tabs without offering reopen', () => {
  mount(); visit('/threads/hidden'); visit('/threads/archived');
  expect(tabs()).toHaveLength(1);
  visit('/threads/a');
  act(() => {
    useThreads.setState({ threads: [] });
    h.archived?.('a');
  });
  expect(screen.queryByRole('tab')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Reopen closed tab' })).toBeNull();
  expect(screen.getByTestId('route').textContent).toBe('/agents');
});

it('provides searchable overflow, keyboard tab navigation and dismissible menus', () => {
  mount(); visit('/threads/b');
  fireEvent.keyDown(tabs()[1]!, { key: 'ArrowLeft' });
  expect(screen.getByTestId('route').textContent).toBe('/threads/a');
  fireEvent.keyDown(tabs()[0]!, { key: 'End' });
  expect(screen.getByTestId('route').textContent).toBe('/threads/b');
  fireEvent.keyDown(tabs()[1]!, { key: 'Home' });
  fireEvent.keyDown(tabs()[0]!, { key: 'ArrowRight' });
  expect(screen.getByTestId('route').textContent).toBe('/threads/b');
  fireEvent.keyDown(tabs()[1]!, { key: 'Enter' });
  const menu = document.querySelector('details')!;
  menu.open = true;
  fireEvent(menu, new Event('toggle'));
  expect(document.querySelector<HTMLElement>('.titlebar-threads-popover')!.style.left).toBe('8px');
  fireEvent.change(screen.getByRole('textbox', { name: 'Find an open thread' }), { target: { value: 'Project P' } });
  const results = within(document.querySelector('.titlebar-threads-results')! as HTMLElement);
  expect(results.getAllByRole('button')).toHaveLength(1);
  fireEvent.click(results.getByRole('button'));
  expect(screen.getByTestId('route').textContent).toBe('/threads/a');
  expect(menu.open).toBe(false);
  menu.open = true; fireEvent.keyDown(document, { key: 'Escape' }); expect(menu.open).toBe(false);
  menu.open = true; fireEvent.pointerDown(document.body); expect(menu.open).toBe(false);
  menu.open = true; fireEvent(window, new Event('resize')); expect(menu.open).toBe(false);
});

const openActions = (name = 'Thread a — Project P') => {
  fireEvent.contextMenu(screen.getByRole('tab', { name, exact: true }), { clientX: 200, clientY: 40 });
  return screen.getByRole('menu', { name: 'Thread tab actions' });
};
const action = (label: string) => fireEvent.click(screen.getByRole('menuitem', { name: label, exact: true }));

it('opens a portalled menu on an inactive tab without selecting it, including its close control', () => {
  mount(); visit('/threads/b');
  const menu = openActions();
  expect(menu.parentElement).toBe(document.body);
  expect(screen.getByTestId('route').textContent).toBe('/threads/b');
  expect(screen.getByRole('tab', { name: 'Thread a — Project P' }).getAttribute('aria-expanded')).toBe('true');
  expect((screen.getByRole('menuitem', { name: 'Reopen closed tab' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(tabs()[0]);
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Close tab: Thread a' }));
  action('Close tab');
  expect(tabs()).toHaveLength(1);
  expect(screen.getByTestId('route').textContent).toBe('/threads/b');
  expect(useThreads.getState().threads).toHaveLength(5);
});

it.each(['ContextMenu', 'F10'])('opens from the keyboard with %s and closes the overflow picker', key => {
  mount();
  const overflow = document.querySelector('details')!;
  overflow.open = true;
  fireEvent.keyDown(tabs()[0]!, { key, shiftKey: key === 'F10' });
  expect(screen.getByRole('menu')).toBeTruthy();
  expect(overflow.open).toBe(false);
  const disabled = ['Close other tabs', 'Close tabs to the right', 'Reopen closed tab'];
  for (const name of disabled) expect((screen.getByRole('menuitem', { name }) as HTMLButtonElement).disabled).toBe(true);
  overflow.open = true; fireEvent(overflow, new Event('toggle'));
  expect(screen.queryByRole('menu')).toBeNull();
});

it('closes tabs to the right, selects a survivor, reopens and closes all without altering threads', () => {
  mount(); visit('/threads/b'); visit('/threads/c');
  openActions(); action('Close tabs to the right');
  expect(tabs()).toHaveLength(1);
  expect(screen.getByTestId('route').textContent).toBe('/threads/a');
  openActions(); action('Reopen closed tab');
  expect(tabs()).toHaveLength(2);
  expect(screen.getByTestId('route').textContent).toBe('/threads/c');
  openActions(); action('Close all tabs');
  expect(screen.queryByRole('tab')).toBeNull();
  expect(screen.getByTestId('route').textContent).toBe('/agents');
  expect(useThreads.getState().threads).toHaveLength(5);
});

it('closes others around an inactive target and leaves a surviving active tab selected', () => {
  mount(); visit('/threads/b'); visit('/threads/c');
  openActions('Thread b — Project Q'); action('Close other tabs');
  expect(tabs()).toHaveLength(1);
  expect(screen.getByTestId('route').textContent).toBe('/threads/b');
  visit('/threads/a'); visit('/threads/c'); visit('/threads/b');
  openActions('Thread a — Project P'); action('Close tabs to the right');
  expect(tabs()).toHaveLength(2);
  expect(screen.getByTestId('route').textContent).toBe('/threads/b');
  openActions('Thread a — Project P'); action('Close tab');
  expect(screen.getByTestId('route').textContent).toBe('/threads/b');
});

it('opens the target project and clears a menu on route changes or archival', () => {
  mount(); visit('/threads/b'); openActions(); action('Open project');
  expect(screen.getByTestId('route').textContent).toBe('/projects/p');
  openActions(); visit('/settings'); expect(screen.queryByRole('menu')).toBeNull();
  openActions(); act(() => h.archived?.('a')); expect(screen.queryByRole('menu')).toBeNull();
});

it('keeps bulk close and copied links within a scoped project window', async () => {
  h.scope = 'p'; mount('/projects/p/threads/a'); visit('/threads/c');
  openActions(); action('Copy thread link');
  await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Thread link copied'));
  expect(h.copy).toHaveBeenCalledWith(`${window.location.origin}/projects/p/threads/a`);
  openActions(); action('Close all tabs');
  expect(screen.getByTestId('route').textContent).toBe('/projects/p');
});

it('copies the clicked thread link and reports clipboard failures without changing tabs', async () => {
  mount(); visit('/threads/b'); openActions(); action('Copy thread link');
  await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Thread link copied'));
  expect(h.copy).toHaveBeenCalledWith(`${window.location.origin}/threads/a`);
  expect(screen.getByTestId('route').textContent).toBe('/threads/b');
  h.copy.mockRejectedValueOnce(new Error('denied'));
  openActions(); action('Copy thread link');
  await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Could not copy thread link', 'error'));
  expect(tabs()).toHaveLength(2);
});

it('archives the active thread and forgets its shortcut without offering reopen', async () => {
  mount(); openActions(); action('Archive');
  expect(window.confirm).toHaveBeenCalledWith('Archive “Thread a”?');
  await waitFor(() => expect(h.remove).toHaveBeenCalledWith('a'));
  expect(h.archive).toHaveBeenCalledWith('a');
  expect(screen.queryByRole('tab')).toBeNull();
  expect(screen.getByTestId('route').textContent).toBe('/agents');
  expect(screen.queryByRole('button', { name: 'Reopen closed tab' })).toBeNull();
  expect(useThreads.getState().threads.some(thread => thread.id === 'a')).toBe(false);
});

it('archives an inactive target while preserving the selected thread and other closed tabs', async () => {
  mount(); visit('/threads/c'); visit('/threads/b');
  fireEvent.click(screen.getByRole('button', { name: 'Close tab: Untitled thread' }));
  openActions(); action('Archive');
  await waitFor(() => expect(h.remove).toHaveBeenCalledWith('a'));
  expect(screen.getByTestId('route').textContent).toBe('/threads/b');
  expect(tabs()).toHaveLength(1);
  openActions('Thread b — Project Q'); action('Reopen closed tab');
  expect(screen.getByTestId('route').textContent).toBe('/threads/c');
});

it('returns to the scoped project after archiving an untitled thread', async () => {
  h.scope = 'p'; mount('/threads/c');
  openActions('Untitled thread — Project P'); action('Archive');
  expect(window.confirm).toHaveBeenCalledWith('Archive “Untitled thread”?');
  await waitFor(() => expect(screen.getByTestId('route').textContent).toBe('/projects/p'));
  expect(screen.queryByRole('tab')).toBeNull();
});

it('warns about background processes and leaves the thread untouched when cancelled', () => {
  mount();
  act(() => useThreads.setState({ threads: [row('a', 'p', { activity: { activeBackgroundCommandCount: 1 } as ThreadListItem['activity'] })] }));
  vi.mocked(window.confirm).mockReturnValue(false);
  openActions(); action('Archive');
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('This agent still has a background process running, like a dev server. Ending its session stops it.'));
  expect(h.archive).not.toHaveBeenCalled();
  expect(h.remove).not.toHaveBeenCalled();
  expect(tabs()).toHaveLength(1);
  expect(screen.getByTestId('route').textContent).toBe('/threads/a');
});

it('does not redirect a different thread selected while archival is pending', async () => {
  let finish!: (result: { ok: boolean }) => void;
  h.archive.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  mount(); openActions(); action('Archive'); visit('/threads/b');
  await act(async () => finish({ ok: true }));
  expect(h.remove).toHaveBeenCalledWith('a');
  expect(screen.getByTestId('route').textContent).toBe('/threads/b');
  expect(tabs()).toHaveLength(1);
});

it.each(['refused', 'offline'])('reports an archive request that is %s and keeps the thread available', async reason => {
  if (reason === 'refused') h.archive.mockResolvedValue({ ok: false });
  else h.archive.mockRejectedValue(new Error('offline'));
  mount(); openActions(); action('Archive');
  await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Could not archive thread', 'error'));
  expect(h.remove).not.toHaveBeenCalled();
  expect(tabs()).toHaveLength(1);
  expect(screen.getByTestId('route').textContent).toBe('/threads/a');
});
