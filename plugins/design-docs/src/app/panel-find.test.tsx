// @vitest-environment happy-dom
// The page frame asks for page-runtime.js, which happy-dom does not load.
// @vitest-environment-options { "settings": { "handleDisabledFileLoadingAsSuccess": true } }
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { UI_USER } from '../server/rpc.js';
import { DocView } from './DocView.js';
import { Workbench } from './Workbench.js';
import { panelFindKey } from './panel-find.js';
import { commentsContentKey } from './CommentsPane.js';
import type { DocLocation } from './content.js';
import { AGENT, createHarness, type Harness } from './test-harness.js';

/** fireEvent returns false when a listener called preventDefault. */
const ctrlF = (target: Element) => !fireEvent.keyDown(target, { key: 'f', ctrlKey: true });

function commentedDoc(harness: Harness) {
  const doc = harness.store.create(
    {
      title: 'Plan',
      projectId: null,
      files: [
        { path: 'README.md', content: 'The overview mentions a timeout once.' },
        { path: 'page.html', content: '<!doctype html><html><body><p>hello</p></body></html>' }
      ]
    },
    UI_USER
  );
  harness.store.addComment(doc.id, { body: 'Raise the timeout to 30s', path: 'README.md', quote: 'overview' }, UI_USER);
  harness.store.addComment(doc.id, { body: 'Is the timeout per request?', path: 'README.md', quote: 'once' }, UI_USER);
  harness.store.addComment(doc.id, { body: 'Unrelated remark' }, UI_USER);
  return doc;
}

function renderDoc(harness: Harness, docId: string, path: string | null = null) {
  harness.render(<DocView docId={docId} path={path} layout="workbench" kind="doc" onDeleted={() => undefined} onOpenPath={() => undefined} />);
}

const header = () => document.querySelector('header.dd-doc-header')!;
const rail = () => screen.getByRole('complementary', { name: 'Comments, history and agents' });

describe('Ctrl+F in a doc outside its content', () => {
  it('opens the doc find bar from the header, the file tree and the history pane', { timeout: 20_000 }, async () => {
    const harness = createHarness();
    const doc = commentedDoc(harness);
    renderDoc(harness, doc.id);
    await screen.findByRole('navigation', { name: 'Files' });

    expect(ctrlF(header())).toBe(true);
    expect(await screen.findByRole('searchbox', { name: 'Find in doc' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Find in doc' }), { key: 'Escape' });
    expect(screen.queryByRole('searchbox', { name: 'Find in doc' })).toBeNull();

    expect(ctrlF(within(screen.getByRole('navigation', { name: 'Files' })).getAllByRole('button')[0]!)).toBe(true);
    expect(await screen.findByRole('searchbox', { name: 'Find in doc' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Find in doc' }), { key: 'Escape' });

    fireEvent.click(within(rail()).getByRole('tab', { name: /History/ }));
    expect(ctrlF(within(rail()).getByRole('tab', { name: /History/ }))).toBe(true);
    expect(await screen.findByRole('searchbox', { name: 'Find in doc' })).toBeTruthy();
  });

  it('opens the page find bar from the header when the open file is an html page', async () => {
    const harness = createHarness();
    const doc = commentedDoc(harness);
    renderDoc(harness, doc.id, 'page.html');
    await waitFor(() => expect(document.querySelector('iframe[title="page.html"]')).not.toBeNull());
    expect(ctrlF(header())).toBe(true);
    expect(await screen.findByRole('searchbox', { name: 'Find in doc' })).toBeTruthy();
  });

  it('keeps Ctrl+F away from thread search even when there is nothing to open', async () => {
    const harness = createHarness();
    const doc = commentedDoc(harness);
    renderDoc(harness, doc.id);
    await screen.findByRole('navigation', { name: 'Files' });
    expect(document.querySelector('.dd-doc')!.hasAttribute('data-own-find')).toBe(true);
  });
});

describe('Ctrl+F in the comments pane', () => {
  it('searches the comment threads, from the pane and from the comment box', async () => {
    const harness = createHarness();
    const doc = commentedDoc(harness);
    renderDoc(harness, doc.id);
    await within(await screen.findByRole('complementary', { name: 'Comments, history and agents' })).findByText('Unrelated remark');

    const box = within(rail()).getByPlaceholderText('Comment on README.md… agents see open comments') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'half a draft' } });
    expect(ctrlF(box)).toBe(true);
    const input = await screen.findByRole('searchbox', { name: 'Find in comments' });
    expect(screen.queryByRole('searchbox', { name: 'Find in doc' })).toBeNull();
    expect(box.value).toBe('half a draft');

    fireEvent.change(input, { target: { value: 'timeout' } });
    await waitFor(() => expect(screen.getByTestId('dom-find-bar-count').textContent).toBe('1/2'));
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('dom-find-bar-count').textContent).toBe('2/2'));

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('dom-find-bar')).toBeNull();
    expect(ctrlF(within(rail()).getByRole('group', { name: 'Comment scope' }))).toBe(true);
    expect(await screen.findByRole('searchbox', { name: 'Find in comments' })).toBeTruthy();
  });
});

describe('Ctrl+F in the doc list', () => {
  function renderWorkbench(harness: Harness) {
    function Host() {
      const [location, setLocation] = useState<DocLocation>({ docId: null, path: null });
      return <Workbench variant="global" projectId={null} location={location} onLocationChange={setLocation} />;
    }
    harness.render(<Host />);
  }

  it('focuses and selects the search box from a row, and Esc clears it back to the list', async () => {
    const harness = createHarness();
    commentedDoc(harness);
    renderWorkbench(harness);
    const row = await screen.findByText('Plan', { selector: '.dd-doc-row-title' });
    const search = screen.getByRole('textbox', { name: 'Search design docs' }) as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'nothing here' } });
    row.focus();
    expect(ctrlF(row)).toBe(true);
    expect(document.activeElement).toBe(search);
    expect(search.selectionStart).toBe(0);
    expect(search.selectionEnd).toBe('nothing here'.length);

    fireEvent.keyDown(search, { key: 'a' });
    expect(search.value).toBe('nothing here');
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(search.value).toBe('');
    expect(document.activeElement).toBe(document.querySelector('.dd-list-scroll'));
  });

  it('also takes Ctrl+F from the landing page beside the list', async () => {
    const harness = createHarness();
    commentedDoc(harness);
    renderWorkbench(harness);
    await screen.findByText('Plan', { selector: '.dd-doc-row-title' });
    expect(ctrlF(document.querySelector('main.dd-main')!)).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search design docs' }));
  });
});

describe('Ctrl+F with the doc list hidden', () => {
  it('is still claimed, so it never reaches thread search', async () => {
    const harness = createHarness();
    commentedDoc(harness);
    function Host() {
      const [location, setLocation] = useState<DocLocation>({ docId: null, path: null });
      return <Workbench variant="global" projectId={null} location={location} onLocationChange={setLocation} />;
    }
    harness.render(<Host />);
    await screen.findByText('Plan', { selector: '.dd-doc-row-title' });
    fireEvent.click(screen.getByRole('button', { name: 'Hide doc list' }));
    expect(ctrlF(document.querySelector('main.dd-main')!)).toBe(true);
    expect(screen.queryByRole('textbox', { name: 'Search design docs' })).toBeNull();
  });
});

describe('panelFindKey', () => {
  const key = (target: Element, init: { defaultPrevented?: boolean; ctrlKey?: boolean } = {}) =>
    panelFindKey({ defaultPrevented: init.defaultPrevented ?? false, target, nativeEvent: new KeyboardEvent('keydown', { key: 'f', ctrlKey: init.ctrlKey ?? true }) } as never);

  it('claims Ctrl+F once, and not inside the code editor or for other keys', () => {
    const plain = document.createElement('div');
    const monaco = document.createElement('div');
    monaco.className = 'monaco-editor';
    const inner = document.createElement('span');
    monaco.append(inner);
    expect(key(plain)).toBe(true);
    expect(key(plain, { defaultPrevented: true })).toBe(false);
    expect(key(plain, { ctrlKey: false })).toBe(false);
    expect(key(inner)).toBe(false);
  });
});

describe('Ctrl+F with a past revision open', () => {
  it('finds in the diff and in the full snapshot from the history pane', { timeout: 20_000 }, async () => {
    const harness = createHarness();
    const doc = commentedDoc(harness);
    await harness.asAgent((store) => store.writeFile(doc.id, { path: 'README.md', content: 'The overview now mentions a deadline.' }, AGENT));
    renderDoc(harness, doc.id, 'README.md');
    await screen.findByRole('navigation', { name: 'Files' });
    fireEvent.click(within(rail()).getByRole('tab', { name: /History/ }));
    await waitFor(() => expect(rail().querySelector('.dd-history-row')).toBeTruthy());
    const row = rail().querySelector('.dd-history-row') as HTMLElement;
    fireEvent.click(row);
    await screen.findByRole('table', { name: /Changes in revision/ });

    // Diff view: there is no preview, so the revision view owns the find bar.
    expect(ctrlF(row)).toBe(true);
    const bar = await screen.findByRole('searchbox', { name: 'Find in doc' });
    fireEvent.change(bar, { target: { value: 'deadline' } });
    await waitFor(() => expect(screen.getByTestId('dom-find-bar-count').textContent).toBe('1/1'));
    fireEvent.keyDown(bar, { key: 'Escape' });

    // Full snapshot: the preview inside it answers.
    fireEvent.click(screen.getByRole('button', { name: 'Full file' }));
    expect(ctrlF(row)).toBe(true);
    expect(await screen.findByRole('searchbox', { name: 'Find in doc' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Find in doc' }), { key: 'Escape' });

    // The banner and its controls are not part of the snapshot, but the key still reaches the preview's bar.
    expect(ctrlF(screen.getByRole('button', { name: 'Close revision' }))).toBe(true);
    expect(await screen.findByRole('searchbox', { name: 'Find in doc' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Find in doc' }), { key: 'Escape' });

    // A click on a spot that cannot take focus (banner text, a disabled Restore) lands on the doc root, which must be focusable.
    const root = document.querySelector('.dd-doc') as HTMLElement;
    root.focus();
    expect(document.activeElement).toBe(root);
    expect(ctrlF(root)).toBe(true);
    expect(await screen.findByRole('searchbox', { name: 'Find in doc' })).toBeTruthy();
  });
});

describe('Ctrl+F with nothing to search', () => {
  it('leaves the key alone in the editor, and does not pull focus to the doc list', { timeout: 20_000 }, async () => {
    const harness = createHarness();
    const doc = commentedDoc(harness);
    function Host() {
      const [location, setLocation] = useState<DocLocation>({ docId: doc.id, path: 'README.md' });
      return <Workbench variant="global" projectId={null} location={location} onLocationChange={setLocation} />;
    }
    harness.render(<Host />);
    await screen.findByRole('navigation', { name: 'Files' });
    fireEvent.click(within(screen.getByRole('group', { name: 'View mode' })).getByRole('button', { name: 'Edit' }));
    await screen.findByRole('textbox', { name: 'Edit README.md' });

    expect(ctrlF(header())).toBe(false);
    expect(screen.queryByRole('searchbox', { name: 'Find in doc' })).toBeNull();
    expect(document.activeElement).not.toBe(screen.getByRole('textbox', { name: 'Search design docs' }));
  });
});

describe('commentsContentKey', () => {
  const comment = (body: string, replyBody: string) =>
    ({ id: 'c1', status: 'open', body, replies: [{ id: 'r1', body: replyBody }] }) as never;

  it('changes for same-length edits of a comment or a reply', () => {
    const base = commentsContentKey('all', false, [comment('timeout', 'ok')]);
    expect(commentsContentKey('all', false, [comment('deadline', 'ok')])).not.toBe(base);
    expect(commentsContentKey('all', false, [comment('timeout', 'no')])).not.toBe(base);
    expect(commentsContentKey('all', false, [comment('timeout', 'ok')])).toBe(base);
  });
});
