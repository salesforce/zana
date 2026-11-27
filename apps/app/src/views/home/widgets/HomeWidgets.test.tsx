// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { PluginHomepageSectionRegistration } from '@zana-ai/zcc-plugin-sdk/app';
import { afterEach, expect, it, vi } from 'vitest';
import { HomeWidgets, loadHomeWidgets } from './HomeWidgets.js';
import { builtInWidgets, HOME_WIDGETS_KEY, newWidget } from './model.js';

const data = vi.hoisted(() => ({
  read: {} as Record<string, true>,
  inbox: [] as { id: string; subject?: string }[],
  threads: [] as { id: string; title: string; createdAt: number; archivedAt?: number; visibility?: string }[],
  open: vi.fn()
}));
vi.mock('@/store', () => ({
  useInbox: (pick: (state: { entries: typeof data.inbox }) => unknown) => pick({ entries: data.inbox }),
  useInboxRead: (pick: (state: { readIds: typeof data.read }) => unknown) => pick({ readIds: data.read })
}));
vi.mock('@/thread-store', () => ({
  useThreads: (pick: (state: { threads: typeof data.threads }) => unknown) => pick({ threads: data.threads })
}));
vi.mock('@/lib/inboxNavigation', () => ({ focusInboxEntry: data.open }));
vi.mock('@/plugins/PluginSlotBoundary', () => ({ PluginSlotBoundary: ({ children }: { children: React.ReactNode }) => children }));

const plugin: PluginHomepageSectionRegistration = {
  id: 'time-off', pluginId: 'people', generation: 1, title: 'Workday time off',
  component: ({ pluginId }) => <p>Live {pluginId} content</p>
};
function Dashboard({ plugins = [] }: { plugins?: PluginHomepageSectionRegistration[] }) {
  const [widgets, setWidgets] = useState(loadHomeWidgets);
  return <MemoryRouter><HomeWidgets plugins={plugins} widgets={widgets} onChange={setWidgets} /></MemoryRouter>;
}
const button = (name: string) => screen.getByRole('button', { name, exact: true });
const change = (name: string, value: string) => fireEvent.change(screen.getByLabelText(name), { target: { value } });
const store = (...templates: typeof builtInWidgets) => {
  localStorage.setItem(HOME_WIDGETS_KEY, JSON.stringify(templates.map((template, index) => newWidget(String(index), template))));
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  vi.restoreAllMocks();
  data.open.mockReset();
  data.inbox = [];
  data.read = {};
  data.threads = [];
});

it('builds, pins, checks, edits and deletes a personal widget', () => {
  render(<Dashboard />);
  fireEvent.click(button('Add widget'));
  fireEvent.click(button('Build'));
  expect((button('Generate preview') as HTMLButtonElement).disabled).toBe(true);
  change('What should this widget show?', 'Make a checklist called Launch: Review, Publish');
  fireEvent.click(button('Generate preview'));
  expect(screen.getByRole('region', { name: 'Widget preview' }).textContent).toContain('Launch');
  fireEvent.click(button('Pin to Home'));
  const review = screen.getByRole('checkbox', { name: 'Review' }) as HTMLInputElement;
  fireEvent.click(review);
  expect(review.checked).toBe(true);
  expect(loadHomeWidgets()[0].content).toMatch(/^\[x\] Review/);
  fireEvent.click(button('Edit layout'));
  fireEvent.click(button('Edit Launch'));
  change('Widget name', 'Release checklist');
  fireEvent.click(button('Save changes'));
  fireEvent.click(button('Edit Release checklist'));
  fireEvent.click(button('Remove widget'));
  expect(loadHomeWidgets()).toEqual([]);
  expect(screen.queryByRole('article')).toBeNull();
});

it('adds an installed integration and shows a useful fallback after uninstall', () => {
  const view = render(<Dashboard plugins={[plugin]} />);
  fireEvent.click(button('Add widget'));
  change('Find a widget', 'missing');
  expect(screen.getByText('No widgets match your search.')).toBeTruthy();
  change('Find a widget', 'workday');
  fireEvent.click(button('Workday time off'));
  expect(screen.getByText('Pin this widget to see live content from Workday time off.')).toBeTruthy();
  fireEvent.click(button('Pin to Home'));
  expect(screen.getByText('Live people content')).toBeTruthy();
  view.rerender(<Dashboard />);
  expect(screen.getByText('This widget’s plugin is unavailable.')).toBeTruthy();
  fireEvent.click(button('Edit layout'));
  fireEvent.click(button('Edit Workday time off'));
  expect(screen.getByText('Unavailable plugin')).toBeTruthy();
});

it('renders live Inbox and thread content without hidden or read items', () => {
  data.inbox = [{ id: 'unread', subject: 'Review this' }, { id: 'read', subject: 'Earlier item' }];
  data.read = { read: true };
  data.threads = [
    { id: 'old', title: 'Older thread', createdAt: 1 },
    { id: 'new', title: 'Newer thread', createdAt: 2 },
    { id: 'hidden', title: 'Hidden', createdAt: 3, visibility: 'hidden' },
    { id: 'archived', title: 'Archived', createdAt: 3, archivedAt: 4 }
  ];
  store(builtInWidgets[0], builtInWidgets[1]);
  render(<Dashboard />);
  fireEvent.click(button('Review this'));
  expect(data.open).toHaveBeenCalledWith(data.inbox[0]);
  expect(screen.queryByText('Earlier item')).toBeNull();
  const links = within(screen.getByRole('article', { name: 'Resume work' })).getAllByRole('link');
  expect(links.map(link => link.textContent)).toEqual(['Newer thread', 'Older thread']);
  expect(links[0].getAttribute('href')).toBe('/threads/new');
});

it('moves and resizes from the keyboard and applies updates from other windows', () => {
  store(builtInWidgets[2], builtInWidgets[3]);
  render(<Dashboard />);
  fireEvent.click(button('Edit layout'));
  const note = screen.getByRole('article', { name: 'Quick note' });
  const move = button('Move Quick note on grid');
  fireEvent.keyDown(move, { key: 'ArrowDown' });
  expect(note.style.gridRow).toBe('2 / span 3');
  fireEvent.keyDown(button('Resize Quick note'), { key: 'ArrowRight' });
  expect(note.style.gridColumn).toBe('1 / span 4');
  expect(loadHomeWidgets().find(widget => widget.title === 'Quick note')?.cells[6]).toEqual({ row: 1, column: 0 });
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: HOME_WIDGETS_KEY, newValue: '[]' })));
  expect(screen.queryByRole('article')).toBeNull();
});

it('previews chart values and reports storage failures', () => {
  render(<Dashboard />);
  fireEvent.click(button('Add widget'));
  fireEvent.click(button('Browse'));
  fireEvent.click(button('Chart'));
  change('Content', 'New: 12\nWon: 4');
  expect(screen.getByText('New')).toBeTruthy();
  expect(screen.getByText('12')).toBeTruthy();
  const fail = vi.fn(() => { throw new Error('quota'); });
  vi.stubGlobal('localStorage', { setItem: fail });
  fireEvent.click(button('Pin to Home'));
  expect(fail).toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('couldn’t save');
  expect(screen.getByRole('article', { name: 'Chart' })).toBeTruthy();
});

it('shows a drop preview, ignores off-grid drops, and commits a pointer move or resize', () => {
  store(builtInWidgets[2], builtInWidgets[3]);
  render(<Dashboard />);
  fireEvent.click(button('Edit layout'));
  const card = screen.getByRole('article', { name: 'Quick note' });
  const grid = card.parentElement!;
  vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 590, 512));
  const title = button('Move Quick note on grid');
  const resize = button('Resize Quick note');
  for (const handle of [title, resize]) {
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    handle.hasPointerCapture = vi.fn(() => true);
  }
  const start = { pointerId: 3, button: 0, clientX: 30, clientY: 24 };
  fireEvent.pointerDown(title, start);
  fireEvent.pointerMove(title, { ...start, clientY: 26 });
  expect(screen.queryByText('Drop here')).toBeNull();
  fireEvent.pointerMove(title, { ...start, clientY: 88 });
  expect(screen.getByText('Drop here')).toBeTruthy();
  fireEvent.pointerMove(title, { ...start, clientX: 840 });
  fireEvent.pointerUp(title, start);
  expect(card.style.gridRow).toBe('1 / span 3');
  fireEvent.pointerDown(title, start);
  fireEvent.pointerMove(title, { ...start, clientY: 88 });
  fireEvent.keyDown(title, { key: 'Escape' });
  expect(screen.queryByText('Drop here')).toBeNull();
  fireEvent.pointerDown(title, start);
  fireEvent.pointerMove(title, { ...start, clientY: 88 });
  fireEvent.pointerUp(title, start);
  expect(card.style.gridRow).toBe('2 / span 3');
  fireEvent.pointerDown(resize, start);
  fireEvent.pointerMove(resize, { ...start, clientX: 130, clientY: 88 });
  fireEvent.pointerCancel(resize, start);
  expect(card.style.gridRow).toBe('2 / span 3');
  fireEvent.pointerDown(resize, start);
  fireEvent.pointerMove(resize, { ...start, clientX: 130, clientY: 88 });
  fireEvent.pointerUp(resize, start);
  expect(card.style.gridRow).toBe('2 / span 4');
});

it('configures a personal count directly and previews it with the current data', () => {
  render(<Dashboard />);
  fireEvent.click(button('Add widget'));
  fireEvent.click(button('Build'));
  fireEvent.click(button('Start from scratch'));
  expect((button('Pin to Home') as HTMLButtonElement).disabled).toBe(true);
  change('Widget name', 'Reading list');
  change('Display', 'count');
  change('Content', 'Book one\n\nBook two');
  expect(within(screen.getByRole('region', { name: 'Widget preview' })).getByText('2')).toBeTruthy();
  fireEvent.click(button('Pin to Home'));
  expect(within(screen.getByRole('article', { name: 'Reading list' })).getByText('2')).toBeTruthy();
});
