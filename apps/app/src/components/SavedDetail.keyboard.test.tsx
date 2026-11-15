// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  selected: 'one' as string | null,
  select: vi.fn(), remove: vi.fn(),
  records: [
    { id: 'one', title: 'First report', projectId: 'p', savedAt: 2, comments: 'First' },
    { id: 'two', title: 'Second report', projectId: 'p', savedAt: 1, comments: 'Second' }
  ]
}));
vi.mock('../store.js', () => ({
  useSaved: (pick: (s: unknown) => unknown) => pick({ records: state.records, loading: false }),
  useSavedSelection: (pick: (s: unknown) => unknown) => pick({ selectedSavedId: state.selected, selectSaved: state.select }),
  useUi: (pick: (s: unknown) => unknown) => pick({ pushToast: vi.fn() }),
  deleteSavedRecord: (id: string) => state.remove(id)
}));
vi.mock('./MarkdownContent.js', () => ({ MarkdownContent: ({ text }: { text: string }) => <p>{text}</p>, DocContent: () => null }));
import { SavedDetail } from './SavedDetail.js';

beforeEach(() => {
  vi.clearAllMocks();
  state.selected = 'one';
  vi.stubGlobal('confirm', vi.fn().mockReturnValue(false));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const view = (visible = true) => <section className="inbox-view"><SavedDetail visible={visible} /></section>;

it('confirms before deleting a saved snapshot or changing selection', () => {
  render(view());
  const button = screen.getByRole('button', { name: 'Delete this saved report' });
  button.focus();
  fireEvent.keyDown(button, { key: 'Delete' });
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('saved report permanently'));
  expect(state.remove).not.toHaveBeenCalled();
  expect(state.select).not.toHaveBeenCalled();
  vi.mocked(window.confirm).mockReturnValue(true);
  fireEvent.click(button);
  expect(state.remove).toHaveBeenCalledExactlyOnceWith('one');
  expect(state.select).toHaveBeenCalledWith('two');
});

it('deletes once on a deliberate scoped Delete key after confirmation', () => {
  vi.mocked(window.confirm).mockReturnValue(true);
  render(view());
  const button = screen.getByRole('button', { name: 'Delete this saved report' });
  button.focus();
  fireEvent.keyDown(button, { key: 'Delete' });
  expect(state.remove).toHaveBeenCalledExactlyOnceWith('one');
});

it('ignores Backspace, repeat, editor input and popup interaction', () => {
  const { container } = render(view());
  const button = screen.getByRole('button', { name: 'Delete this saved report' });
  button.focus();
  fireEvent.keyDown(button, { key: 'Backspace' });
  fireEvent.keyDown(button, { key: 'Delete', repeat: true });
  const scope = container.querySelector('.inbox-view')!;
  for (const html of ['<div contenteditable="true"><span>Draft</span></div>', '<div role="dialog" aria-modal="true"><button>Options</button></div>']) {
    scope.insertAdjacentHTML('beforeend', html);
    const popup = scope.lastElementChild!;
    fireEvent.keyDown(popup.firstElementChild!, { key: 'Delete' });
    popup.remove();
  }
  expect(window.confirm).not.toHaveBeenCalled();
  expect(state.remove).not.toHaveBeenCalled();
});

it('ignores Delete when hidden or unselected and releases its listener on unmount', () => {
  const { rerender, unmount } = render(view(false));
  fireEvent.keyDown(screen.getByRole('button', { name: 'Delete this saved report' }), { key: 'Delete' });
  state.selected = null;
  rerender(view());
  fireEvent.keyDown(document.querySelector('.inbox-view')!, { key: 'Delete' });
  unmount();
  fireEvent.keyDown(window, { key: 'Delete' });
  expect(window.confirm).not.toHaveBeenCalled();
  expect(state.remove).not.toHaveBeenCalled();
});

it('shows the saved-reports fairy scene when nothing is saved', () => {
  const records = state.records;
  state.records = [];
  try {
    const { container } = render(view());
    expect(screen.getByTestId('saved-detail-empty').getAttribute('data-art')).toBe('saved');
    expect(container.querySelector('[data-scene="saved"] .fairy-saved-ribbon')).toBeTruthy();
  } finally {
    state.records = records;
  }
});
