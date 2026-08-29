import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';

const setInboxTab = vi.fn();
const setInboxGrouping = vi.fn();
const markAllRead = vi.fn();
const setManyCollapsed = vi.fn();

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
  useSaved: (selector: (state: { records: { id: string; projectId: string }[] }) => unknown) =>
    selector({ records: [{ id: 's1', projectId: 'p1' }] }),
  useUi: (selector: (state: {
    inboxTab: 'feed' | 'reports' | 'saved';
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
  it('exposes full tab names via aria-label, including counts', () => {
    const html = renderToStaticMarkup(<InboxPane />);

    expect(html).toContain('aria-label="Feed, 1 unread"');
    expect(html).toContain('aria-label="Reports, 1"');
    expect(html).toContain('aria-label="Saved, 1"');
    expect(html).toContain('class="inbox-tab-label">Feed<');
    expect(html).toContain('class="inbox-tab-label">Reports<');
    expect(html).toContain('class="inbox-tab-label">Saved<');
    expect(html).not.toContain('Saved reports');
  });

  it('keeps an overflow trigger labeled Inbox actions beside the tablist', () => {
    const html = renderToStaticMarkup(<InboxPane />);

    expect(html).toContain('aria-label="Inbox actions"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('class="inbox-actions-more"');
    expect(html).not.toContain('class="inbox-actions-menu"');
  });
});

describe('InboxPane compact chrome contract', () => {
  it('keeps feed actions in the ⋯ menu instead of a second icon row', () => {
    const source = readFileSync(new URL('./InboxPane.tsx', import.meta.url), 'utf8');
    const html = renderToStaticMarkup(<InboxPane />);

    expect(source).toContain('<span className="inbox-tab-label">Saved</span>');
    expect(source).toContain('aria-label="Inbox actions"');
    expect(source).toContain('Group by project');
    expect(source).toContain('Sort by time');
    expect(source).toContain('role="menu"');
    expect(source).not.toContain('AppPageHeader');
    expect(source).not.toContain('list-header-actions');
    expect(html).not.toContain('inbox-unread-toggle');
    expect(html).not.toContain('inbox-clear-all');
    expect(html).not.toContain('inbox-grouping-toggle');
  });

  it('always shows the ⋯ menu and floors the list column at 345px', () => {
    const css = readFileSync(
      new URL('../../styles/global.css', import.meta.url),
      'utf8'
    );
    const store = readFileSync(new URL('../../store.ts', import.meta.url), 'utf8');

    expect(store).toContain('export const INBOX_LIST_MIN = 345;');
    expect(css).toContain('--inbox-list-min: 345px;');
    expect(css).toContain('min-width: var(--inbox-list-min, 345px);');
    expect(css).toContain('grid-template-columns: max(var(--inbox-list-min), var(--col-list)) minmax(0, 1fr);');
    expect(css).toContain('.inbox-actions-more {\n  display: flex;');
    expect(css).not.toContain('.inbox-actions-more {\n  display: none;');
    expect(css).not.toContain('@container (max-width: 260px)');
    expect(css).toContain('.inbox-tab {\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  padding: 5px 10px;\n  border: none;\n  background: transparent;\n  color: var(--text-muted);\n  font-family: inherit;\n  font-size: 12px;\n  font-weight: 600;\n  flex: 0 1 auto;');
  });

  it('does not steal the titlebar reserve when the sidebar is collapsed', () => {
    const source = readFileSync(new URL('./InboxPane.tsx', import.meta.url), 'utf8');
    const css = readFileSync(
      new URL('../../styles/global.css', import.meta.url),
      'utf8'
    );
    expect(source).not.toContain('ownsWindowTopLeft');
    expect(css).not.toContain('.app-shell.sidebar-is-collapsed .inbox-list-pane .list-header {\n  display: flex;\n}');
    expect(css).not.toContain('.app-shell.sidebar-is-collapsed .inbox-list-pane .inbox-actions-more {\n  display: none;\n}');
    expect(css).not.toContain('--inbox-tabs-leading');
  });
});
