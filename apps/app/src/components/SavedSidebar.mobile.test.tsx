// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import type { SavedRecord } from '@zana-ai/zcc-domain/product';

const layout = vi.hoisted(() => ({ compact: true }));
const records = create(() => ({ records: [] as SavedRecord[], loading: false }));
const selection = create(() => ({ selectedSavedId: null as string | null, selectSaved: (id: string | null) => selection.setState({ selectedSavedId: id }) }));
vi.mock('../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => layout.compact }));
vi.mock('../store.js', () => ({
  useSaved: (pick: Parameters<typeof records>[0]) => records(pick),
  useSavedSelection: (pick: Parameters<typeof selection>[0]) => selection(pick),
  useData: (pick: (s: { projects: unknown[] }) => unknown) => pick({ projects: [] })
}));
import { SavedSidebar } from './SavedSidebar';

beforeEach(() => {
  layout.compact = true;
  records.setState({ records: [{ id: 'a', projectId: 'p', title: 'First saved report', comments: 'body', savedAt: Date.now() }], loading: false });
  selection.setState({ selectedSavedId: null });
});
afterEach(cleanup);

it('leaves the mobile list open until the user selects a report', () => {
  render(<SavedSidebar />);
  expect(selection.getState().selectedSavedId).toBeNull();
  fireEvent.click(screen.getByRole('button'));
  expect(selection.getState().selectedSavedId).toBe('a');
  act(() => selection.getState().selectSaved(null));
  act(() => records.setState({ records: [...records.getState().records] }));
  expect(selection.getState().selectedSavedId).toBeNull();
  fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
  expect(selection.getState().selectedSavedId).toBe('a');
});

it('clears an invalid mobile selection when filtering without opening another report', () => {
  selection.setState({ selectedSavedId: 'a' });
  const { rerender } = render(<SavedSidebar />);
  expect(selection.getState().selectedSavedId).toBe('a');
  rerender(<SavedSidebar query="no matching report" />);
  expect(selection.getState().selectedSavedId).toBeNull();
  expect(screen.getByText('No matches.')).toBeTruthy();
  rerender(<SavedSidebar />);
  expect(selection.getState().selectedSavedId).toBeNull();
});

it('preserves desktop default selection and reselects when returning to desktop', () => {
  layout.compact = false;
  const { rerender } = render(<SavedSidebar />);
  expect(selection.getState().selectedSavedId).toBe('a');
  layout.compact = true;
  rerender(<SavedSidebar />);
  expect(selection.getState().selectedSavedId).toBe('a');
  act(() => selection.getState().selectSaved(null));
  layout.compact = false;
  rerender(<SavedSidebar />);
  expect(selection.getState().selectedSavedId).toBe('a');
});

it('clears the selection when changing project scope or deleting the report', () => {
  selection.setState({ selectedSavedId: 'a' });
  const { rerender } = render(<SavedSidebar scopeProjectId="p" />);
  rerender(<SavedSidebar scopeProjectId="other" />);
  expect(selection.getState().selectedSavedId).toBeNull();
  act(() => records.setState({ records: [] }));
  expect(screen.getByText('No saved reports.')).toBeTruthy();
});

it('filters saved document paths and project labels and keeps an explicit pick', () => {
  records.setState({ records: [
    { id: 'a', projectId: 'p', projectLabel: 'Retired project', title: '', comments: '\nSaved findings', savedAt: Date.now() - 120_000 },
    { id: 'b', projectId: 'p', title: '', comments: '', docs: [{ path: 'docs/review.md', content: 'Review' }], savedAt: Date.now() - 7_200_000 },
    { id: 'c', projectId: 'other', title: '', comments: '', savedAt: Date.now() - 172_800_000 }
  ] });
  const { rerender } = render(<SavedSidebar />);
  expect(screen.getByText('Saved findings')).toBeTruthy();
  expect(screen.getByText('(untitled)')).toBeTruthy();
  expect(screen.getByText('2m')).toBeTruthy();
  expect(screen.getByText('2h')).toBeTruthy();
  expect(screen.getByText('2d')).toBeTruthy();
  fireEvent.keyDown(screen.getByText('docs/review.md').closest('[role="button"]')!, { key: ' ' });
  expect(selection.getState().selectedSavedId).toBe('b');
  rerender(<SavedSidebar query="docs/review" />);
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(selection.getState().selectedSavedId).toBe('b');
  rerender(<SavedSidebar query="Retired project" />);
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(screen.getByText('Saved findings')).toBeTruthy();
});
