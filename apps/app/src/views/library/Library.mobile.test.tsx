// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryDoc, Project } from '@zana-ai/zcc-domain/product';
import { LibraryPanel } from './LibraryPanel.js';
import { LibraryView } from './LibraryView.js';
import type { LibraryDeepLink } from './library-deep-link.js';
import { fileManagerName } from '../../lib/file-manager.js';

const state = vi.hoisted(() => ({
  compact: true,
  library: { docs: [] as LibraryDoc[], loading: false },
  ui: { pushToast: vi.fn(), revealLibraryDocId: null },
  data: { projects: [{ id: 'p', name: 'My project' }] },
  search: vi.fn(async () => ({ hits: [] })),
}));
vi.mock('../../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => state.compact }));
vi.mock('../../store', () => ({
  useLibrary: (select: Function) => select(state.library),
  useUi: (select: Function) => select(state.ui),
  useData: (select: Function) => select(state.data),
}));
vi.mock('../../lib/product-client.js', () => ({ product: { library: { search: state.search } } }));
vi.mock('../../components/AgentLauncher', () => ({ AgentLauncher: () => null }));
vi.mock('../../components/PromptModal', () => ({ PromptModal: () => null }));
vi.mock('../../lib/inspect-session', () => ({ inspectAgentSession: vi.fn() }));
vi.mock('./library/DocPreview.js', () => ({ DocPreview: ({ doc, fragment, onOpenDocument }: any) => <>
  <article>{doc.title} content{fragment ? ` ${fragment}` : ''}</article>
  <button onClick={() => onOpenDocument({ path: 'other.md', fragment: 'section-2' })}>Open linked document</button>
  <button onClick={() => onOpenDocument({ path: 'missing.md', fragment: '' })}>Open missing document</button>
</> }));
const project = { id: 'p', name: 'My project', path: '/project' } as Project;
const note = { id: 'a', title: 'Readable note', kind: 'md', relPath: 'notes/reading.md', scope: 'global', createdAt: 1, updatedAt: 1 } as LibraryDoc;
afterEach(cleanup);
beforeEach(() => {
  state.compact = true;
  state.library = { docs: [note, { ...note, id: 'b', title: 'Other', relPath: 'other.md' }], loading: false };
});

for (const kind of ['global', 'project'] as const) {
  describe(`${kind} library mobile navigation`, () => {
    const element = (deepLink?: LibraryDeepLink) => <MemoryRouter>{kind === 'global' ? <LibraryPanel deepLink={deepLink} /> : <LibraryView project={project} deepLink={deepLink} />}</MemoryRouter>;
    it('opens a full document, preserves search, folders and scroll on Back, then reopens the same document', () => {
      const view = render(element());
      const root = view.container.querySelector('.library-view')!;
      const tree = view.container.querySelector<HTMLElement>('.library-tree')!;
      expect(root.getAttribute('data-mobile-pane')).toBe('documents');
      expect(view.queryByRole('button', { name: 'Back to documents' })).toBeNull();
      const input = view.getByRole('textbox') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'Readable' } });
      fireEvent.click(view.getByRole('button', { name: /notes/ }));
      const row = view.getByRole('button', { name: 'reading.md' });
      tree.scrollTop = 123;
      fireEvent.click(row);
      expect(root.getAttribute('data-mobile-pane')).toBe('document');
      expect(view.queryByRole('textbox')).toBeNull();
      expect(view.getByRole('article').textContent).toContain('Readable note content');
      const back = view.getByRole('button', { name: 'Back to documents' });
      expect(document.activeElement).toBe(back);
      expect(view.queryByRole('button', { name: `Reveal in ${fileManagerName()}` })).toBeNull();
      tree.scrollTop = 0; // A browser may reset a hidden scroller.
      fireEvent.click(back);
      expect(root.getAttribute('data-mobile-pane')).toBe('documents');
      expect(input.value).toBe('Readable');
      expect(tree.scrollTop).toBe(123);
      expect(document.activeElement).toBe(row);
      expect(row.getAttribute('aria-current')).toBe('true');
      expect(view.queryByRole('article')).toBeNull();
      fireEvent.click(row);
      expect(root.getAttribute('data-mobile-pane')).toBe('document');
    });

    it('opens incoming deep links directly and keeps both panes on desktop', () => {
      const view = render(element({ scope: 'global', relPath: note.relPath }));
      const root = view.container.querySelector('.library-view')!;
      expect(root.getAttribute('data-mobile-pane')).toBe('document');
      expect(view.getByRole('article').textContent).toContain('Readable note content');
      state.compact = false;
      view.rerender(element());
      expect(root.hasAttribute('data-mobile-pane')).toBe(false);
      expect(view.getByRole('textbox')).toBeTruthy();
      expect(view.getByRole('article')).toBeTruthy();
      expect(view.queryByRole('button', { name: 'Back to documents' })).toBeNull();
      expect(view.getByRole('button', { name: `Reveal in ${fileManagerName()}` })).toBeTruthy();
      state.compact = true;
      view.rerender(element());
      expect(root.getAttribute('data-mobile-pane')).toBe('document');
    });

    it('stays in the list for missing links and empty libraries', () => {
      state.library.docs = [];
      const view = render(element({ scope: 'global', relPath: 'missing.md' }));
      expect(view.getByText('No documents yet')).toBeTruthy();
      expect(view.container.querySelector('.library-view')?.getAttribute('data-mobile-pane')).toBe('documents');
    });

    it('follows a document link and forwards its heading without losing the library surface', () => {
      const view = render(element({ scope: 'global', relPath: note.relPath }));
      fireEvent.click(view.getByRole('button', { name: 'Back to documents' }));
      fireEvent.change(view.getByRole('textbox'), { target: { value: 'Readable' } });
      fireEvent.click(view.getByRole('button', { name: 'reading.md' }));
      fireEvent.click(view.getByRole('button', { name: 'Open linked document' }));
      expect(view.getByRole('article').textContent).toContain('Other content section-2');
      fireEvent.click(view.getByRole('button', { name: 'Open missing document' }));
      expect(state.ui.pushToast).toHaveBeenCalledWith('Linked document was not found in this library', 'error');
      expect(view.getByRole('article').textContent).toContain('Other content section-2');
    });
  });
}

it('does not reopen the reader when filtering out a previous selection', () => {
  const view = render(<MemoryRouter><LibraryView project={project} deepLink={{ scope: 'global', relPath: note.relPath }} /></MemoryRouter>);
  fireEvent.click(view.getByRole('button', { name: 'Back to documents' }));
  fireEvent.change(view.getByRole('textbox'), { target: { value: 'Other' } });
  expect(view.container.querySelector('.library-view')?.getAttribute('data-mobile-pane')).toBe('documents');
  expect(view.queryByRole('button', { name: 'Back to documents' })).toBeNull();
  fireEvent.click(view.getByRole('button', { name: 'other.md' }));
  expect(view.getByRole('article').textContent).toBe('Other content');
});

it('retains desktop project auto-selection', () => {
  state.compact = false;
  const view = render(<MemoryRouter><LibraryView project={project} /></MemoryRouter>);
  expect(view.getByRole('article').textContent).toBe('Readable note content');
  expect(view.getByRole('textbox')).toBeTruthy();
});

it('retains desktop folder toggling and document context actions with native tree buttons', () => {
  state.compact = false;
  const view = render(<MemoryRouter><LibraryPanel /></MemoryRouter>);
  const folder = view.getByRole('button', { name: /notes/ });
  expect(folder.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(folder);
  expect(folder.getAttribute('aria-expanded')).toBe('true');
  fireEvent.contextMenu(view.getByRole('button', { name: 'reading.md' }), { clientX: 100, clientY: 200 });
  expect(view.getByRole('button', { name: 'Rename / move…' })).toBeTruthy();
  expect(view.getByText(`Reveal in ${fileManagerName()}`)).toBeTruthy();
  fireEvent.click(document.body);
  expect(view.queryByRole('button', { name: 'Rename / move…' })).toBeNull();
  fireEvent.click(folder);
  expect(view.queryByRole('button', { name: 'reading.md' })).toBeNull();
});

it('offers Reveal in the project library tree context menu', () => {
  state.compact = false;
  const view = render(<MemoryRouter><LibraryView project={project} /></MemoryRouter>);
  fireEvent.contextMenu(view.getByRole('button', { name: 'reading.md' }), { clientX: 100, clientY: 200 });
  expect(view.getByText(`Reveal in ${fileManagerName()}`)).toBeTruthy();
});
