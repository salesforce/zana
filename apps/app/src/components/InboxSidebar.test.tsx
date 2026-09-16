/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { InboxEntry } from '@zana-ai/zcc-domain/product';

const { select, markRead, onSelect } = vi.hoisted(() => ({
  select: vi.fn(),
  markRead: vi.fn(),
  onSelect: vi.fn()
}));

const entries: InboxEntry[] = [
  {
    id: 'e1',
    ts: Date.now(),
    projectId: 'p1',
    subject: 'Ship the report',
    comments: 'done',
    report: true
  } as InboxEntry,
  {
    id: 'e2',
    ts: Date.now() - 1_000,
    projectId: 'p2',
    subject: 'Other project',
    comments: 'nope'
  } as InboxEntry
];

vi.mock('../store.js', () => ({
  useInbox: (selector: (s: { entries: InboxEntry[]; loading: boolean }) => unknown) =>
    selector({ entries, loading: false }),
  useInboxSelection: (selector: (s: { selectedEntryId: string | null; select: typeof select }) => unknown) =>
    selector({ selectedEntryId: null, select }),
  useInboxRead: (selector: (s: {
    readIds: Record<string, boolean>;
    markRead: typeof markRead;
    markUnread: () => void;
  }) => unknown) => selector({ readIds: {}, markRead, markUnread: vi.fn() }),
  useInboxKeep: (selector: (s: { keptIds: Record<string, boolean> }) => unknown) =>
    selector({ keptIds: {} }),
  useInboxAnswered: (selector: (s: { answeredIds: Record<string, true> }) => unknown) =>
    selector({ answeredIds: {} }),
  useInboxCollapsed: (selector: (s: { byKey: Record<string, boolean>; toggle: () => void }) => unknown) =>
    selector({ byKey: {}, toggle: vi.fn() }),
  useFeedNoise: (selector: (s: { byScope: Record<string, { routineIds?: ReadonlySet<string> }> }) => unknown) =>
    selector({ byScope: {} }),
  useData: (selector: (s: {
    projects: Array<{ id: string; name: string }>;
    feedNoiseClassifierEnabled: boolean;
  }) => unknown) =>
    selector({
      projects: [{ id: 'p1', name: 'Alpha' }, { id: 'p2', name: 'Beta' }],
      feedNoiseClassifierEnabled: false
    }),
  maybeRefreshFeedNoise: vi.fn(),
  scopeKeyFor: (id: string | null) => id ?? 'all',
  deleteInboxEntry: vi.fn(),
  toggleInboxKeep: vi.fn()
}));

import { InboxSidebar } from './InboxSidebar.js';

describe('InboxSidebar embedded selection', () => {
  afterEach(() => {
    cleanup();
    select.mockClear();
    onSelect.mockClear();
    markRead.mockClear();
  });
  it('does not write global selection when onSelect is provided', () => {
    render(
      <InboxSidebar
        scopeProjectId="p1"
        grouping="time"
        selectedId={null}
        onSelect={onSelect}
        autoSelect={false}
      />
    );
    fireEvent.click(screen.getByText('Ship the report'));
    expect(onSelect).toHaveBeenCalledWith('e1');
    expect(select).not.toHaveBeenCalled();
    expect(markRead).toHaveBeenCalledWith('e1');
  });

  it('does not auto-select on mount when autoSelect is false', () => {
    select.mockClear();
    onSelect.mockClear();
    renderToStaticMarkup(<InboxSidebar grouping="time" autoSelect={false} />);
    expect(select).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('auto-selects the newest visible row without writing global selection', async () => {
    render(
      <InboxSidebar
        scopeProjectId="p1"
        grouping="time"
        selectedId={null}
        onSelect={onSelect}
        autoSelect
      />
    );
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('e1'));
    expect(select).not.toHaveBeenCalled();
  });
});
