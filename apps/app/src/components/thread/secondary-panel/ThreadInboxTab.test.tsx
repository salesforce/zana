/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InboxEntry } from '@zana-ai/zcc-domain/product';

const { focusInboxEntry } = vi.hoisted(() => ({
  focusInboxEntry: vi.fn()
}));

const projects = vi.hoisted(() => ({
  current: [] as Array<{ id: string; name?: string; path?: string }>
}));

const inbox = vi.hoisted(() => ({
  entries: [] as InboxEntry[],
  readIds: {} as Record<string, boolean>
}));

vi.mock('../../../store.js', () => ({
  useData: (selector: (s: { projects: Array<{ id: string }> }) => unknown) =>
    selector({ projects: projects.current }),
  useInbox: (selector: (s: { entries: InboxEntry[] }) => unknown) =>
    selector({ entries: inbox.entries }),
  useInboxRead: (selector: (s: { readIds: Record<string, boolean> }) => unknown) =>
    selector({ readIds: inbox.readIds })
}));

vi.mock('../../../lib/inboxNavigation.js', () => ({
  focusInboxEntry
}));

vi.mock('../../InboxEntryBody.js', () => ({
  InboxEntryBody: ({ entry }: { entry: InboxEntry }) => (
    <div data-testid="inbox-entry-body">{entry.subject ?? entry.id}</div>
  )
}));

vi.mock('../../InboxSidebar.js', () => ({
  InboxSidebar: ({
    onSelect,
    reportsOnly
  }: {
    onSelect?: (id: string | null) => void;
    reportsOnly?: boolean;
  }) => (
    <button
      type="button"
      data-testid="inbox-sidebar-stub"
      data-reports-only={reportsOnly ? 'true' : 'false'}
      onClick={() => onSelect?.('e1')}
    >
      list
    </button>
  )
}));

import { ThreadInboxTab } from './ThreadInboxTab.js';

function entry(overrides: Partial<InboxEntry> = {}): InboxEntry {
  return {
    id: 'e1',
    ts: 1,
    projectId: 'p1',
    subject: 'Weekly report',
    comments: 'all green',
    report: true,
    ...overrides
  } as InboxEntry;
}

describe('ThreadInboxTab', () => {
  afterEach(() => {
    cleanup();
    focusInboxEntry.mockClear();
  });
  it('shows a placeholder when the project is missing', () => {
    projects.current = [];
    inbox.entries = [entry()];
    const html = renderToStaticMarkup(<ThreadInboxTab projectId="missing" />);
    expect(html).toContain('Project is unavailable for Inbox');
    expect(html).not.toContain('data-testid="thread-inbox-tab"');
  });

  it('shows an empty state when the project has no entries', () => {
    projects.current = [{ id: 'p1', name: 'Alpha', path: '/tmp/alpha' }];
    inbox.entries = [entry({ projectId: 'other' })];
    const html = renderToStaticMarkup(<ThreadInboxTab projectId="p1" />);
    expect(html).toContain('data-testid="thread-inbox-tab"');
    expect(html).toContain('No inbox messages for this project yet');
    expect(html).not.toContain('data-testid="inbox-sidebar-stub"');
  });

  it('lists scoped entries with Unread and Reports chips', () => {
    projects.current = [{ id: 'p1', name: 'Alpha', path: '/tmp/alpha' }];
    inbox.entries = [entry(), entry({ id: 'e2', report: false, subject: 'Note' })];
    inbox.readIds = {};
    const html = renderToStaticMarkup(<ThreadInboxTab projectId="p1" />);
    expect(html).toContain('data-testid="thread-inbox-tab"');
    expect(html).toContain('data-testid="thread-inbox-unread-chip"');
    expect(html).toContain('data-testid="thread-inbox-reports-chip"');
    expect(html).toContain('>Unread 2<');
    expect(html).toContain('>Reports 1<');
    expect(html).toContain('data-testid="inbox-sidebar-stub"');
  });

  it('opens local detail, goes back, and Open in Inbox focuses the full inbox', () => {
    projects.current = [{ id: 'p1', name: 'Alpha', path: '/tmp/alpha' }];
    inbox.entries = [entry()];
    inbox.readIds = {};
    render(<ThreadInboxTab projectId="p1" />);
    fireEvent.click(screen.getByTestId('inbox-sidebar-stub'));
    expect(screen.getByTestId('inbox-entry-body').textContent).toBe('Weekly report');
    expect(screen.getByTestId('thread-inbox-tab').className).toContain('thread-inbox-tab');
    expect(document.querySelector('.thread-inbox-detail')).toBeTruthy();
    fireEvent.click(screen.getByTestId('thread-inbox-open-in-inbox'));
    expect(focusInboxEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }));
    fireEvent.click(screen.getByTestId('thread-inbox-back'));
    expect(screen.getByTestId('inbox-sidebar-stub')).toBeTruthy();
  });

  it('toggles the Reports chip into the sidebar', () => {
    projects.current = [{ id: 'p1', name: 'Alpha', path: '/tmp/alpha' }];
    inbox.entries = [entry()];
    render(<ThreadInboxTab projectId="p1" />);
    expect(screen.getByTestId('inbox-sidebar-stub').getAttribute('data-reports-only')).toBe('false');
    fireEvent.click(screen.getByTestId('thread-inbox-reports-chip'));
    expect(screen.getByTestId('inbox-sidebar-stub').getAttribute('data-reports-only')).toBe('true');
  });
});

describe('ThreadInboxTab chrome', () => {
  it('gives the side-panel inbox reading padding', () => {
    const css = readFileSync(join(process.cwd(), 'apps/app/src/styles/global.css'), 'utf8');
    const start = css.indexOf('.thread-inbox-filters {');
    const end = css.indexOf('@container thread-explorer');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = css.slice(start, end);
    expect(block).toContain('padding: 12px 14px 10px;');
    expect(block).toContain('padding: 6px 8px 16px;');
    expect(block).toContain('padding: 12px 14px;');
    expect(block).toContain('padding: 16px 16px 32px;');
    expect(block).toContain('overflow-wrap: anywhere;');
  });
});
