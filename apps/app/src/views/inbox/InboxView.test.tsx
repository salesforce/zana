// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { create } from 'zustand';

const layout = vi.hoisted(() => ({ compact: true, scope: null as string | null }));
const ui = create(() => ({ nav: 'inbox', inboxTab: 'feed' }));
const inbox = create(() => ({ entries: [{ id: 'a', projectId: 'p' }, { id: 'b', projectId: 'other' }] }));
const saved = create(() => ({ records: [{ id: 's', projectId: 'p' }] }));
const selection = create(() => ({ selectedEntryId: null as string | null, select: (id: string | null) => selection.setState({ selectedEntryId: id }) }));
const savedSelection = create(() => ({ selectedSavedId: null as string | null, selectSaved: (id: string | null) => savedSelection.setState({ selectedSavedId: id }) }));

vi.mock('@/store', () => ({
  useUi: (pick: Parameters<typeof ui>[0]) => ui(pick),
  useInbox: (pick: Parameters<typeof inbox>[0]) => inbox(pick),
  useInboxSelection: (pick: Parameters<typeof selection>[0]) => selection(pick),
  useSaved: (pick: Parameters<typeof saved>[0]) => saved(pick),
  useSavedSelection: (pick: Parameters<typeof savedSelection>[0]) => savedSelection(pick),
  useInboxScopeProjectId: () => layout.scope
}));
vi.mock('@/hooks/useCompactLayout', () => ({ useCompactLayout: () => layout.compact }));
vi.mock('@/components/listpane/InboxPane', () => ({
  InboxPane: ({ onShowOverview }: { onShowOverview?: () => void }) => (
    <div className="inbox-list-pane">
      <input aria-label="Filter inbox" />
      <button onClick={() => selection.getState().select('a')}>Report row</button>
      {onShowOverview && <button onClick={onShowOverview}>Overview</button>}
    </div>
  )
}));
vi.mock('@/components/InboxDetail', () => ({
  InboxDetail: ({ visible, onBack }: { visible: boolean; onBack?: () => void }) => (
    <div data-testid="feed-detail" data-visible={visible}>
      <button className="inbox-detail-overview-back" onClick={onBack}>Inbox</button>
    </div>
  )
}));
vi.mock('@/components/SavedDetail', () => ({ SavedDetail: ({ visible }: { visible: boolean }) => <div data-testid="saved-detail" data-visible={visible} /> }));
vi.mock('@/components/InboxOverview', () => ({ InboxOverview: ({ entries }: { entries: unknown[] }) => <div data-testid="overview">{entries.length} entries</div> }));

import { InboxView } from './InboxView';

beforeEach(() => {
  layout.compact = true;
  layout.scope = null;
  ui.setState({ nav: 'inbox', inboxTab: 'feed' });
  selection.setState({ selectedEntryId: null });
  savedSelection.setState({ selectedSavedId: null });
  inbox.setState({ entries: [{ id: 'a', projectId: 'p' }, { id: 'b', projectId: 'other' }] });
});
afterEach(cleanup);

it('opens a report, focuses Back, and returns to the same filtered list and row', () => {
  const { container } = render(<InboxView />);
  const root = container.querySelector('.inbox-view')!;
  expect(root.getAttribute('data-detail-open')).toBe('false');
  fireEvent.change(screen.getByLabelText('Filter inbox'), { target: { value: 'draft' } });
  const row = screen.getByText('Report row');
  row.focus();
  fireEvent.click(row);
  expect(root.getAttribute('data-detail-open')).toBe('true');
  expect(screen.getByTestId('feed-detail').getAttribute('data-visible')).toBe('true');
  expect(document.activeElement).toBe(screen.getByText('Inbox'));
  const detail = container.querySelector('.inbox-view-detail')!;
  detail.scrollTop = 250;
  fireEvent.click(screen.getByText('Inbox'));
  expect(root.getAttribute('data-detail-open')).toBe('false');
  expect((screen.getByLabelText('Filter inbox') as HTMLInputElement).value).toBe('draft');
  expect(document.activeElement).toBe(row);
  fireEvent.click(row);
  expect(detail.scrollTop).toBe(0);
});

it('keeps overview reachable and returns to the list after choosing an overview report', () => {
  const { container } = render(<InboxView />);
  fireEvent.click(screen.getByText('Overview'));
  expect(container.querySelector('.inbox-view')?.getAttribute('data-detail-open')).toBe('true');
  expect(document.activeElement).toBe(screen.getByText('Inbox'));
  fireEvent.click(screen.getByText('Inbox'));
  expect(container.querySelector('.inbox-view')?.getAttribute('data-detail-open')).toBe('false');
  fireEvent.click(screen.getByText('Overview'));
  act(() => selection.getState().select('a'));
  fireEvent.click(screen.getByText('Inbox'));
  expect(container.querySelector('.inbox-view')?.getAttribute('data-detail-open')).toBe('false');
});

it('only enables Saved detail shortcuts while the saved report is open', () => {
  ui.setState({ inboxTab: 'saved' });
  const { container } = render(<InboxView />);
  expect(screen.getByTestId('saved-detail').getAttribute('data-visible')).toBe('false');
  act(() => savedSelection.getState().selectSaved('s'));
  expect(screen.getByTestId('saved-detail').getAttribute('data-visible')).toBe('true');
  fireEvent.click(screen.getByText('Saved reports'));
  expect(savedSelection.getState().selectedSavedId).toBeNull();
  expect(container.querySelector('.inbox-view')?.getAttribute('data-detail-open')).toBe('false');
});

it('honors external selection and disables shortcuts when Inbox is inactive', () => {
  selection.setState({ selectedEntryId: 'a' });
  render(<InboxView />);
  expect(screen.getByTestId('feed-detail').getAttribute('data-visible')).toBe('true');
  act(() => ui.setState({ nav: 'agents' }));
  expect(screen.getByTestId('feed-detail').getAttribute('data-visible')).toBe('false');
});

it('keeps desktop split panes and selection when changing viewport', () => {
  layout.compact = false;
  selection.setState({ selectedEntryId: 'a' });
  const { rerender, container } = render(<InboxView />);
  expect(screen.queryByText('Overview')).toBeNull();
  expect(container.querySelector('.inbox-view')?.getAttribute('data-compact')).toBe('false');
  layout.compact = true;
  rerender(<InboxView />);
  expect(selection.getState().selectedEntryId).toBe('a');
  expect(container.querySelector('.inbox-view')?.getAttribute('data-detail-open')).toBe('true');
});

it('does not open stale or out-of-scope feed or saved selections', () => {
  layout.scope = 'p';
  selection.setState({ selectedEntryId: 'b' });
  const { container } = render(<InboxView />);
  expect(container.querySelector('.inbox-view')?.getAttribute('data-detail-open')).toBe('false');
  act(() => selection.getState().select(null));
  expect(screen.getByTestId('overview').textContent).toBe('1 entries');
  act(() => {
    ui.setState({ inboxTab: 'saved' });
    savedSelection.getState().selectSaved('missing');
  });
  expect(screen.getByTestId('saved-detail').getAttribute('data-visible')).toBe('false');
  layout.scope = 'other';
  act(() => savedSelection.getState().selectSaved('s'));
  expect(screen.getByTestId('saved-detail').getAttribute('data-visible')).toBe('false');
});
