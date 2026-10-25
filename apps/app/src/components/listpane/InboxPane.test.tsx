// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MOBILE_THREAD_TITLE_ID, MOBILE_THREAD_CONTROLS_ID } from '../useMobileThreadTitleTarget.js';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';

const layout = vi.hoisted(() => ({ compact: false }));
vi.mock('../../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => layout.compact }));
afterEach(() => { cleanup(); layout.compact = false; vi.clearAllMocks(); });

const setInboxTab = vi.fn();
const setInboxGrouping = vi.fn();
const markAllRead = vi.fn();
const setManyCollapsed = vi.fn();
const reloadInbox = vi.fn(async (_opts?: { notify?: boolean }) => true);

vi.mock('../../store.js', () => ({
  INBOX_LIST_MIN: 345,
  useInbox: (selector: (state: { entries: unknown[] }) => unknown) =>
    selector({
      entries: [
        { id: 'e1', ts: 1, projectId: 'p1', report: true },
        { id: 'e2', ts: 2, projectId: 'p1' }
      ]
    }),
  useInboxRead: (selector: (state: { readIds: Record<string, boolean>; markAllRead: typeof markAllRead }) => unknown) =>
    selector({ readIds: { e1: true }, markAllRead }),
  useInboxKeep: (selector: (state: { keptIds: Record<string, boolean> }) => unknown) =>
    selector({ keptIds: {} }),
  useInboxCollapsed: (selector: (state: { byKey: Record<string, boolean>; setMany: typeof setManyCollapsed }) => unknown) =>
    selector({ byKey: {}, setMany: setManyCollapsed }),
  useInboxScopeProjectId: () => null,
  clearInbox: vi.fn(),
  reloadInbox: (opts?: { notify?: boolean }) => reloadInbox(opts),
  useSaved: (selector: (state: { records: { id: string; projectId: string }[] }) => unknown) =>
    selector({ records: [{ id: 's1', projectId: 'p1' }] }),
  useUi: (selector: (state: {
    inboxTab: 'feed' | 'saved';
    setInboxTab: typeof setInboxTab;
    inboxGrouping: 'project' | 'time';
    setInboxGrouping: typeof setInboxGrouping;
  }) => unknown) =>
    selector({
      inboxTab: 'feed',
      setInboxTab,
      inboxGrouping: 'project',
      setInboxGrouping
    })
}));

vi.mock('../ListPaneResizer.js', () => ({ ListPaneResizer: () => null }));
vi.mock('../InboxSidebar.js', () => ({ InboxSidebar: () => null }));
vi.mock('../SavedSidebar.js', () => ({ SavedSidebar: () => null }));

import { InboxPane } from './InboxPane.js';

describe('InboxPane tabs', () => {
  it('exposes Feed and Saved tabs, not a Reports tab', () => {
    const html = renderToStaticMarkup(<InboxPane />);

    expect(html).toContain('aria-label="Feed, 1 unread"');
    expect(html).toContain('aria-label="Saved, 1"');
    expect(html).toContain('class="inbox-tab-label">Feed<');
    expect(html).toContain('class="inbox-tab-label">Saved<');
    expect(html).not.toContain('class="inbox-tab-label">Reports<');
    expect(html).not.toContain('Saved reports');
  });

  it('puts Unread and Reports on the filter row as chips', () => {
    const html = renderToStaticMarkup(<InboxPane />);

    expect(html).toContain('class="inbox-filter-chip ');
    expect(html).toContain('>Unread 1<');
    expect(html).toContain('>Reports 1<');
    expect(html).toContain('aria-pressed="false"');
  });

  it('keeps an overflow trigger labeled Inbox actions beside the tablist', () => {
    const html = renderToStaticMarkup(<InboxPane />);

    expect(html).toContain('aria-label="Inbox actions"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('class="inbox-actions-more"');
    expect(html).not.toContain('class="inbox-actions-menu"');
    expect(html).not.toContain('class="tab-context-menu"');
  });
});

describe('InboxPane compact chrome contract', () => {
  it('keeps grouping / clear in the ⋯ menu instead of a second icon row', () => {
    const source = readFileSync(resolve('apps/app/src/components/listpane/InboxPane.tsx'), 'utf8');
    const html = renderToStaticMarkup(<InboxPane />);

    expect(source).toContain('<span className="inbox-tab-label">Saved</span>');
    expect(source).toContain('aria-label="Inbox actions"');
    expect(source).toContain('Group by project');
    expect(source).toContain('Group by time');
    expect(source).toContain('className="tab-context-menu"');
    expect(source).toContain('tab-context-sep');
    expect(source).toContain('MailCheck');
    expect(source).toContain('createPortal');
    expect(source).toContain('role="menu"');
    expect(source).not.toContain('inbox-actions-menu-item');
    expect(source).not.toContain('AppPageHeader');
    expect(source).not.toContain('list-header-actions');
    expect(html).not.toContain('inbox-unread-toggle');
    expect(html).not.toContain('inbox-clear-all');
    expect(html).not.toContain('inbox-grouping-toggle');
  });

  it('always shows the ⋯ menu and floors the list column at 345px', () => {
    const css = readFileSync(
      resolve('apps/app/src/styles/global.css'),
      'utf8'
    );
    const store = readFileSync(resolve('apps/app/src/store.ts'), 'utf8');

    expect(store).toContain('export const INBOX_LIST_MIN = 345;');
    expect(css).toContain('--inbox-list-min: 345px;');
    expect(css).toContain('min-width: var(--inbox-list-min, 345px);');
    expect(css).toContain(
      '.inbox-view {\n  --inbox-list-min: 345px;\n  grid-column: 2 / -1;\n  background: var(--bg-panel);\n  min-width: 0;\n  min-height: 0;\n  overflow: hidden;\n  display: grid;\n  grid-template-columns: max(var(--inbox-list-min), var(--col-list)) minmax(0, 1fr);\n'
    );
    expect(css).toContain(
      'grid-template-columns: max(var(--inbox-list-min), var(--col-list)) minmax(0, 1fr);\n  /* Trap the inner list pane z-index so the Feed list cannot paint over the\n     left rail. The sidebar is a sibling stacking context at z-index 1; without\n     this, the list is later in the tree and wins. */\n  isolation: isolate;\n}'
    );
    expect(css).toContain('.inbox-actions-more {\n  display: flex;');
    expect(css).not.toContain('.inbox-actions-more {\n  display: none;');
    expect(css).not.toContain('@container (max-width: 260px)');
    expect(css).toContain('.inbox-tab {\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  padding: 5px 10px;\n  border: none;\n  background: transparent;\n  color: var(--text-muted);\n  font-family: inherit;\n  font-size: 12px;\n  font-weight: 600;\n  flex: 0 1 auto;');
  });

  it('does not steal the titlebar reserve when the sidebar is collapsed', () => {
    const source = readFileSync(resolve('apps/app/src/components/listpane/InboxPane.tsx'), 'utf8');
    const css = readFileSync(
      resolve('apps/app/src/styles/global.css'),
      'utf8'
    );
    expect(source).not.toContain('ownsWindowTopLeft');
    expect(css).not.toContain('.app-shell.sidebar-is-collapsed .inbox-list-pane .list-header {\n  display: flex;\n}');
    expect(css).not.toContain('.app-shell.sidebar-is-collapsed .inbox-list-pane .inbox-actions-more {\n  display: none;\n}');
    expect(css).not.toContain('--inbox-tabs-leading');
  });
});


describe('Inbox refresh', () => {
  it('reloads the feed from the icon beside Inbox actions and ignores clicks while loading', async () => {
    let finish!: (ok: boolean) => void;
    reloadInbox.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    render(<InboxPane />);
    const refresh = screen.getByRole('button', { name: 'Refresh inbox' });
    expect(refresh.nextElementSibling?.getAttribute('aria-label')).toBe('Inbox actions');
    fireEvent.click(refresh);
    expect(reloadInbox).toHaveBeenCalledExactlyOnceWith({ notify: true });
    expect(refresh.getAttribute('aria-busy')).toBe('true');
    expect(refresh.querySelector('svg')?.getAttribute('class')).toContain('spin');
    fireEvent.click(refresh);
    expect(reloadInbox).toHaveBeenCalledOnce();
    finish(true);
    await vi.waitFor(() => expect(refresh.getAttribute('aria-busy')).toBe('false'));
    expect(refresh.querySelector('svg')?.getAttribute('class')).not.toContain('spin');
  });
  it('does not duplicate Refresh inside the desktop ⋯ menu', () => {
    render(<InboxPane />);
    fireEvent.click(screen.getByRole('button', { name: 'Inbox actions' }));
    expect(within(screen.getByRole('menu')).queryByRole('button', { name: /Refresh inbox/ })).toBeNull();
  });
});

describe('mobile Inbox header', () => {
  function mount(onShowOverview = vi.fn()) {
    layout.compact = true;
    return render(<><div id={MOBILE_THREAD_TITLE_ID} /><div id={MOBILE_THREAD_CONTROLS_ID} /><InboxPane onShowOverview={onShowOverview} /></>);
  }
  it('shows the title, tabs and unread filter with search revealed on demand', () => {
    mount();
    expect(screen.getByRole('heading').textContent).toBe('Inbox');
    expect(screen.getByRole('tab', { name: 'Feed, 1 unread' })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Unread 1' }));
    expect(screen.getByRole('button', { name: 'Show all messages' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Search inbox' }));
    const input = screen.getByRole('textbox', { name: 'Search inbox' });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close inbox search' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Search inbox' }));
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
  });
  it('keeps grouping and reports in a single sheet, retaining their callbacks', () => {
    mount();
    const more = () => fireEvent.click(screen.getByRole('button', { name: 'Inbox actions' }));
    more();
    let sheet = screen.getByRole('dialog', { name: 'Inbox actions' });
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Group by time' }));
    expect(setInboxGrouping).toHaveBeenCalledWith('time');
    expect(screen.queryByRole('dialog')).toBeNull();
    more(); sheet = screen.getByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Reports 1' }));
    more();
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Show all messages' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Mark 1 as read' }));
    expect(markAllRead).toHaveBeenCalledWith(['e1', 'e2']);
  });
  it('offers Refresh inbox in the actions sheet', () => {
    mount();
    expect(screen.queryByRole('button', { name: 'Refresh inbox' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Inbox actions' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Refresh inbox' }));
    expect(reloadInbox).toHaveBeenCalledExactlyOnceWith({ notify: true });
  });
  it('opens the overview from More and releases its header while details are active', () => {
    const overview = vi.fn();
    const view = mount(overview);
    fireEvent.click(screen.getByRole('button', { name: 'Inbox actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Inbox overview' }));
    expect(overview).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
    view.rerender(<><div id={MOBILE_THREAD_TITLE_ID} /><div id={MOBILE_THREAD_CONTROLS_ID} /><InboxPane mobileHeaderEnabled={false} /></>);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Inbox actions' })).toBeNull();
  });
});
