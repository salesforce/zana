/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
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
let currentEntries = entries;
let readIds: Record<string, boolean> = {};
let answeredIds: Record<string, true> = {};

vi.mock('./AgentLauncher.js', () => ({
  AgentLauncher: ({ initialPrompt, onClose, onLaunched }: {
    initialPrompt: string;
    onClose: () => void;
    onLaunched: (session: { id: string }, project: string) => void;
  }) => (
    <div role="dialog">
      <textarea aria-label="Prompt" defaultValue={initialPrompt} />
      <button onClick={onClose}>Cancel</button>
      <button onClick={() => onLaunched({ id: 'session' }, 'p1')}>Launch</button>
    </div>
  )
}));
vi.mock('../lib/inspect-session.js', () => ({ inspectAgentSession: vi.fn() }));

vi.mock('../store.js', () => ({
  useInbox: (selector: (s: { entries: InboxEntry[]; loading: boolean }) => unknown) =>
    selector({ entries: currentEntries, loading: false }),
  useInboxSelection: (selector: (s: { selectedEntryId: string | null; select: typeof select }) => unknown) =>
    selector({ selectedEntryId: null, select }),
  useInboxRead: (selector: (s: {
    readIds: Record<string, boolean>;
    markRead: typeof markRead;
    markUnread: () => void;
  }) => unknown) => selector({ readIds, markRead, markUnread: vi.fn() }),
  useInboxKeep: (selector: (s: { keptIds: Record<string, boolean> }) => unknown) =>
    selector({ keptIds: {} }),
  useInboxAnswered: (selector: (s: { answeredIds: Record<string, true> }) => unknown) =>
    selector({ answeredIds }),
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
import { deleteInboxEntry } from '../store.js';
import { inspectAgentSession } from '../lib/inspect-session.js';

afterEach(() => {
  cleanup();
  select.mockClear();
  markRead.mockClear();
  currentEntries = entries;
  readIds = {};
  answeredIds = {};
});

it('shows full-width rows chronologically with report context and shared read/selection actions', () => {
  currentEntries = [...entries].reverse();
  const { container } = render(<section className="inbox-view"><InboxSidebar fullWidth /></section>);
  const rows = Array.from(container.querySelectorAll('.inbox-feed-card-open'));
  expect(rows).toHaveLength(2);
  expect(rows[0].textContent).toContain('Ship the report');
  expect(rows[0].textContent).toContain('Alpha · done');
  expect(screen.getByText('Report', { exact: true })).toBeTruthy();
  fireEvent.keyDown(rows[0], { key: 'j' });
  expect(select).toHaveBeenLastCalledWith('e1');
  fireEvent.click(rows[1]);
  expect(select).toHaveBeenLastCalledWith('e2');
  expect(markRead).toHaveBeenLastCalledWith('e2');
  fireEvent.contextMenu(rows[0]);
  expect(screen.getByRole('menuitem', { name: 'Keep' })).toBeTruthy();
});

it('opens an editable, project-scoped fix draft only for an authenticated offer', () => {
  currentEntries = [
    { ...entries[0], subject: 'Checks failed', comments: 'Failed check details', report: false, offerAgentFix: true, extensionSource: { extensionId: 'checks' } },
    { ...entries[1], offerAgentFix: true }
  ];
  render(<MemoryRouter><InboxSidebar fullWidth /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Fix with agent' }));
  expect((screen.getByRole('textbox', { name: 'Prompt' }) as HTMLTextAreaElement).value).toContain('Failed check details');
  expect(inspectAgentSession).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Launch' }));
  expect(inspectAgentSession).toHaveBeenCalledWith('session', 'p1', expect.any(Function));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('applies the same actionable filter in both layouts and shows an empty state when handled', () => {
  currentEntries = [
    ...entries,
    { id: 'q', ts: 24, projectId: 'p1', subject: 'Choose a target', question: { options: [{ id: 'A', label: 'Alpha' }, { id: 'B', label: 'Beta' }] } }
  ];
  const result = render(<InboxSidebar needsActionOnly />);
  expect(screen.getByText('Choose a target')).toBeTruthy();
  expect(screen.queryByText('Other project')).toBeNull();
  result.rerender(<InboxSidebar needsActionOnly fullWidth />);
  fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
  expect(select).toHaveBeenLastCalledWith('q');
  answeredIds = { q: true };
  result.rerender(<InboxSidebar needsActionOnly fullWidth />);
  expect(screen.getByText('Nothing needs your action.')).toBeTruthy();
  result.rerender(<InboxSidebar needsActionOnly fullWidth hideEmpty />);
  expect(screen.queryByText('Nothing needs your action.')).toBeNull();
});

it('keeps a blocking question pinned once when switching from project to time grouping', () => {
  currentEntries = [
    ...entries,
    { id: 'q', ts: Date.now(), projectId: 'p1', subject: 'Choose a target', question: {
      blocking: true,
      options: [{ id: 'A', label: 'Alpha' }, { id: 'B', label: 'Beta' }]
    } }
  ];
  const { container, rerender } = render(<InboxSidebar />);
  expect(container.querySelector('.inbox-questions-pinned')?.textContent).toContain('Choose a target');
  rerender(<InboxSidebar grouping="time" />);
  expect(container.querySelector('.inbox-questions-pinned')?.textContent).toContain('Choose a target');
  expect(screen.getAllByText('Choose a target')).toHaveLength(1);
  expect(screen.getByText('Ship the report')).toBeTruthy();
});

describe('InboxSidebar embedded selection', () => {
  afterEach(() => {
    cleanup();
    select.mockClear();
    onSelect.mockClear();
    markRead.mockClear();
    vi.restoreAllMocks(); vi.unstubAllGlobals();
    vi.mocked(deleteInboxEntry).mockClear();
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

  it('scopes j/k navigation to the Inbox and ignores editor and dialog events', () => {
    const { container } = render(<section className="inbox-view"><InboxSidebar grouping="time" /></section>);
    const row = screen.getByText('Ship the report').closest('[role="button"]') as HTMLElement;
    row.focus();
    fireEvent.keyDown(row, { key: 'j' });
    expect(select).toHaveBeenCalledWith('e1');
    select.mockClear();
    fireEvent.keyDown(document.body, { key: 'j' });
    const scope = container.querySelector('.inbox-view')!;
    scope.insertAdjacentHTML('beforeend', '<div contenteditable="true"><span>Draft</span></div>');
    fireEvent.keyDown(scope.lastElementChild!.firstElementChild!, { key: 'j' });
    fireEvent.keyDown(scope.lastElementChild!.firstElementChild!, { key: 'k' });
    scope.insertAdjacentHTML('beforeend', '<div role="dialog" aria-modal="true"><button>Options</button></div>');
    fireEvent.keyDown(row, { key: 'j' });
    expect(select).not.toHaveBeenCalled();
  });

  it('confirms context-menu deletion and preserves the message on cancel', () => {
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', confirm);
    render(<InboxSidebar grouping="time" />);
    const row = screen.getByText('Ship the report').closest('[role="button"]')!;
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByText('Delete', { exact: true }));
    expect(confirm).toHaveBeenCalled();
    expect(deleteInboxEntry).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByText('Delete', { exact: true }));
    expect(deleteInboxEntry).toHaveBeenCalledExactlyOnceWith('e1');
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
