// @vitest-environment happy-dom
// The page frame asks for page-runtime.js, which happy-dom does not load.
// @vitest-environment-options { "settings": { "handleDisabledFileLoadingAsSuccess": true } }
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UI_USER } from '../server/rpc.js';
import { MAX_BINARY_FILE_BYTES } from '../shared/limits.js';
import { DocView, type DocLayout } from './DocView.js';
import { draftDocAgent } from './Agents.js';
import { AGENT, createHarness, type Harness } from './test-harness.js';
import { DocHeader } from './DocHeader.js';
import { createApi } from './api.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function richDoc(harness: Harness, projectId: string | null = 'p1') {
  return harness.store.create(
    {
      title: 'Search',
      projectId,
      files: [
        { path: 'README.md', content: 'Overview\n\nSee [API](api.md), [Diagrams](diagrams), [Gone](missing.md) and [Top](#top).\n\n![logo](logo.png)' },
        { path: 'api.md', content: 'Endpoints' },
        { path: 'diagrams/flow.mmd', content: 'flowchart LR\n  A --> B' },
        { path: 'src/main.ts', content: 'const answer = 42;' },
        { path: 'mock.html', content: '<!doctype html><html><head><title>m</title></head><body><img src="logo.png"><script>go()</script></body></html>' },
        { path: 'logo.png', content: PNG, encoding: 'base64' },
        { path: 'icon.svg', content: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' },
        { path: 'notes.txt', content: 'plain notes' },
        { path: 'empty.md', content: '' }
      ]
    },
    UI_USER
  );
}

function simpleDoc(harness: Harness, content = 'Line one\nLine two', projectId: string | null = 'p1') {
  return harness.store.create(
    {
      title: 'Simple',
      projectId,
      files: [
        { path: 'README.md', content },
        { path: 'api.md', content: 'Endpoints' }
      ]
    },
    UI_USER
  );
}

function renderDoc(harness: Harness, docId: string, options: { path?: string | null; layout?: DocLayout; contextProjectId?: string | null; kind?: 'doc' | 'template' } = {}) {
  const opened: Array<[string | null, boolean | undefined]> = [];
  const onDeleted = vi.fn();
  function Host() {
    const [path, setPath] = useState<string | null>(options.path ?? null);
    return (
      <DocView
        docId={docId}
        path={path}
        layout={options.layout ?? 'workbench'}
        contextProjectId={options.contextProjectId ?? null}
        kind={options.kind}
        onDeleted={onDeleted}
        onOpenPath={(next, replace) => {
          opened.push([next, replace]);
          setPath(next);
        }}
      />
    );
  }
  harness.render(<Host />);
  return { opened, onDeleted };
}

const tree = () => screen.getByRole('navigation', { name: 'Files' });
const treeFile = (name: string) => within(tree()).getByRole('button', { name: new RegExp(`^${name.replace(/\./g, '\\.')}`) });
const pane = (path: string) => document.querySelector<HTMLElement>(`section[aria-label="${path}"]`);
async function findPane(path: string) {
  await waitFor(() => expect(pane(path)).not.toBeNull());
  return pane(path)!;
}
const modeButton = (name: 'Preview' | 'Edit' | 'Split') => within(screen.getByRole('group', { name: 'View mode' })).getByRole('button', { name });
const editor = (path: string) => screen.getByRole('textbox', { name: `Edit ${path}` }) as HTMLTextAreaElement;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DocHeader overlays', () => {
  it('uses editor-only chrome for templates', async () => {
    const harness = createHarness();
    const template = harness.store.templateNew({ label: 'Personal template' }, UI_USER);
    renderDoc(harness, template.id, { kind: 'template' });
    await findPane('README.md');
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Ask agent/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Peer conflicts' })).toBeNull();
    expect(screen.queryByRole('tab', { name: /Comments/ })).toBeNull();
    expect(screen.queryByRole('tab', { name: /Agents/ })).toBeNull();
    expect(screen.getByRole('tab', { name: /History/ })).toBeTruthy();
  });

  it('shows History for a template even when the shared rail tab was left on Agents', async () => {
    localStorage.setItem('zcc.design-docs.rail-tab', JSON.stringify('agents'));
    const harness = createHarness();
    const template = harness.store.templateNew({ label: 'Personal template' }, UI_USER);
    renderDoc(harness, template.id, { kind: 'template' });
    await findPane('README.md');
    expect(document.querySelector('.dd-rail')).toBeTruthy();
    expect(screen.queryByText(/No agents/i)).toBeNull();
    expect(document.querySelector('.dd-rail-tab.on')?.textContent).toContain('History');
    localStorage.removeItem('zcc.design-docs.rail-tab');
  });

  it('opens and dismisses the peer conflicts dialog and the more-actions menu', async () => {
    const harness = createHarness();
    const doc = simpleDoc(harness);
    harness.render(<DocHeader doc={doc} projects={[]} compact={false} onDeleted={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Peer conflicts' }));
    const dialog = await screen.findByRole('dialog', { name: 'Peer conflicts' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Peer conflicts' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryAllByRole('menuitem')).toHaveLength(0));
  });
});

describe('metadata consent', () => {
  it.each(['title', 'summary', 'tags', 'status'])('pins %s consent across realtime head refresh', async (field) => {
    const harness = createHarness();
    const doc = { ...simpleDoc(harness), head: 'reviewed-head' };
    const view = harness.render(<DocHeader doc={doc} projects={[]} compact={false} onDeleted={() => undefined} />);
    if (field === 'tags') fireEvent.click(screen.getByRole('button', { name: 'Tag' }));
    else if (field === 'status') fireEvent.click(screen.getByTitle('Change status'));
    else fireEvent.click(screen.getByTitle(`Edit ${field}`));
    view.rerender(<DocHeader doc={{ ...doc, head: 'replacement-head' }} projects={[]} compact={false} onDeleted={() => undefined} />);
    if (field === 'status') fireEvent.click(screen.getByRole('menuitem', { name: 'Approved' }));
    else {
      const input = screen.getByRole('textbox', { name: field === 'tags' ? 'Add tags' : field === 'title' ? 'Title' : 'Summary' });
      fireEvent.change(input, { target: { value: 'Reviewed value' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    }
    await waitFor(() => expect(harness.toasts).toHaveLength(1));
    expect(harness.rpcCalls.find((call) => call.method === 'update')!.input).toMatchObject({ expectedHead: 'reviewed-head' });
  });

  it('serializes file identity CAS without reading a replacement before sending', async () => {
    const call = vi.fn(async () => ({}));
    const api = createApi(call);
    await api.writeFile('doc', { path: 'file.md', content: 'new', baseRevision: 3, baseFileId: 'read-id' });
    await api.editFile('doc', { path: 'file.md', edits: [], baseRevision: 3, baseFileId: 'read-id' });
    await api.deleteFile('doc', 'file.md', 3, 'read-id');
    await api.renameFile('doc', 'file.md', 'moved.md', 3, 'read-id');
    await api.restore('doc', 7, 0, null);
    expect(call.mock.calls).toEqual([
      ['writeFile', { doc: 'doc', path: 'file.md', content: 'new', baseRevision: 3, baseFileId: 'read-id' }],
      ['editFile', { doc: 'doc', path: 'file.md', edits: [], baseRevision: 3, baseFileId: 'read-id' }],
      ['deleteFile', { doc: 'doc', path: 'file.md', baseRevision: 3, baseFileId: 'read-id' }],
      ['renameFile', { doc: 'doc', from: 'file.md', to: 'moved.md', baseRevision: 3, baseFileId: 'read-id' }],
      ['restore', { doc: 'doc', id: 7, baseRevision: 0, baseFileId: null }]
    ]);
  });

  it('sends displayed head for title, summary, status and tags; never retries stale approval', async () => {
    const harness = createHarness();
    const doc = { ...simpleDoc(harness), head: 'reviewed-head' };
    harness.render(<DocHeader doc={doc} projects={[]} compact={false} onDeleted={() => undefined} />);
    fireEvent.click(screen.getByTitle('Edit title'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'New title' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Title' }), { key: 'Enter' });
    await waitFor(() => expect(harness.rpcCalls.some((call) => call.method === 'update')).toBe(true));
    fireEvent.click(screen.getByTitle('Edit summary'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Summary' }), { target: { value: 'New summary' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Summary' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Tag' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Add tags' }), { target: { value: 'reviewed' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Add tags' }), { key: 'Enter' });
    fireEvent.click(screen.getByTitle('Change status'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Approved' }));
    await waitFor(() => expect(harness.toasts).toHaveLength(4));
    expect(harness.rpcCalls.filter((call) => call.method === 'update').map((call) => call.input)).toEqual([
      { doc: doc.id, title: 'New title', expectedHead: doc.head },
      { doc: doc.id, summary: 'New summary', expectedHead: doc.head },
      { doc: doc.id, tags: ['reviewed'], expectedHead: doc.head },
      { doc: doc.id, status: 'approved', expectedHead: doc.head }
    ]);
    expect(harness.toasts.every((toast) => toast.kind === 'error' && /head changed/.test(toast.message))).toBe(true);
    expect(harness.store.summary(doc.id).status).toBe('draft');
  });
});

describe('previewing files', () => {
  it('keeps Ask agent available when a doc has no files to select', async () => {
    const harness = createHarness({ panelAgent: true });
    const doc = simpleDoc(harness);
    vi.spyOn(harness.store, 'get').mockReturnValue({ ...doc, files: [] });
    renderDoc(harness, doc.id);
    expect(await screen.findByText('This doc has no files')).toBeTruthy();
    expect(document.querySelector('.dd-selection-chip')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Ask agent/ }));
    expect(screen.queryByRole('checkbox', { name: /Focus on/ })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: /^Fill the gaps/ }));
    await waitFor(() => expect(harness.navigateCalls).toHaveLength(1));
    expect(harness.navigateCalls[0]).toMatchObject({ method: 'openPanelAgent', options: { draft: {
      view: doc.id, prompt: expect.stringContaining(doc.id)
    } } });
    expect(harness.spawn).not.toHaveBeenCalled();
  });

  it('renders each kind of file and follows links inside the doc', async () => {
    const harness = createHarness();
    const doc = richDoc(harness);
    const { opened } = renderDoc(harness, doc.id);

    const readme = await findPane('README.md');
    expect(await within(readme).findByText(/Overview/)).toBeTruthy();
    // Referenced images are inlined as data URLs once loaded.
    await waitFor(() => expect(within(readme).getByTestId('plugin-markdown').innerHTML).toContain('data:image/png;base64,'));

    fireEvent.click(within(readme).getByText('Top'));
    fireEvent.click(within(readme).getByText('Gone'));
    expect(harness.toasts).toContainEqual({ message: 'missing.md is not a file in this design doc', kind: 'error' });
    expect(opened).toEqual([]);

    fireEvent.click(within(readme).getByText('Diagrams'));
    const flow = await findPane('diagrams/flow.mmd');
    expect(within(flow).getByTestId('plugin-markdown').textContent).toContain('```mermaid');

    fireEvent.click(treeFile('README.md'));
    fireEvent.click(within(await findPane('README.md')).getByText('API'));
    expect(within(await findPane('api.md')).getByText('Endpoints')).toBeTruthy();
    expect(opened.map(([path]) => path)).toEqual(['diagrams/flow.mmd', 'README.md', 'api.md']);

    fireEvent.click(treeFile('main.ts'));
    expect(within(await findPane('src/main.ts')).getByTestId('plugin-markdown').textContent).toContain('const answer = 42;');

    fireEvent.click(treeFile('mock.html'));
    const htmlPane = await findPane('mock.html');
    await waitFor(() => expect(htmlPane.querySelector('iframe')).not.toBeNull());
    const frame = htmlPane.querySelector('iframe')!;
    expect(frame.title).toBe('mock.html');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-forms');
    const srcDoc = frame.getAttribute('srcdoc')!;
    // A page without CSS of its own gets the Zana theme.
    expect(srcDoc).toContain('data-zcc-theme');
    // The page runtime boots before the page's own markup; its scripts wait for it.
    expect(srcDoc).toMatch(/<script type="application\/json" id="dd-page">\{"mode":"frame",[^<]*<\/script><script src="[^"]*\/page-runtime\.js"><\/script>/);
    expect(srcDoc).toMatch(/<script type="text\/x-dd-script"[^>]*>go\(\)<\/script>/);
    // The server bundled the page's image.
    expect(srcDoc).toContain('data:image/png;base64,');
    fireEvent.click(screen.getByRole('button', { name: 'Tablet (768px)' }));
    expect(frame.style.width).toBe('768px');
    expect(screen.getByRole('button', { name: 'Tablet (768px)' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Full width' }));
    expect(frame.style.width).toBe('');

    fireEvent.click(treeFile('logo.png'));
    const image = await within(await findPane('logo.png')).findByRole('img', { name: 'logo.png' });
    expect(image.getAttribute('src')).toBe(`data:image/png;base64,${PNG}`);
    expect((modeButton('Edit') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(treeFile('icon.svg'));
    expect((await within(await findPane('icon.svg')).findByRole('img', { name: 'icon.svg' })).getAttribute('src')).toMatch(/^data:image\/svg\+xml;base64,/);

    fireEvent.click(treeFile('notes.txt'));
    expect((await findPane('notes.txt')).querySelector('pre.dd-plain')!.textContent).toBe('plain notes');

    fireEvent.click(treeFile('empty.md'));
    expect(await within(await findPane('empty.md')).findByText(/This file is empty/)).toBeTruthy();
  });

  it('collapses folders in the file tree', async () => {
    const harness = createHarness();
    const doc = richDoc(harness);
    renderDoc(harness, doc.id);
    await findPane('README.md');
    const folder = within(tree()).getByRole('button', { name: 'diagrams' });
    expect(folder.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(folder);
    expect(folder.getAttribute('aria-expanded')).toBe('false');
    expect(within(tree()).queryByRole('button', { name: /^flow\.mmd/ })).toBeNull();
    fireEvent.click(folder);
    expect(treeFile('flow.mmd')).toBeTruthy();
  });

  it('hides the file tree behind the file switcher and remembers it', async () => {
    const harness = createHarness();
    const doc = richDoc(harness);
    renderDoc(harness, doc.id);
    await findPane('README.md');
    fireEvent.click(within(tree()).getByRole('button', { name: 'Hide files' }));
    expect(screen.queryByRole('navigation', { name: 'Files' })).toBeNull();
    expect(localStorage.getItem('zcc.design-docs.tree')).toBe('false');

    // The switcher's tree is a popover, so it offers no Hide.
    fireEvent.click(screen.getByTitle('Files in this doc'));
    expect(within(tree()).queryByRole('button', { name: 'Hide files' })).toBeNull();
    fireEvent.click(treeFile('flow.mmd'));
    await findPane('diagrams/flow.mmd');

    fireEvent.click(screen.getByRole('button', { name: 'Show files' }));
    expect(within(tree()).getByRole('button', { name: 'Hide files' })).toBeTruthy();
    expect(localStorage.getItem('zcc.design-docs.tree')).toBe('true');
  });

  it('flashes who updated the file when an agent edit lands', async () => {
    const harness = createHarness();
    const doc = simpleDoc(harness);
    renderDoc(harness, doc.id);
    const readme = await findPane('README.md');
    await harness.asAgent((store) => store.writeFile(doc.id, { path: 'README.md', content: 'Agent rewrite' }, AGENT));
    expect(await within(readme).findByText('Agent rewrite')).toBeTruthy();
    expect(within(readme).getByText(/Updated by Architect/)).toBeTruthy();
  });

  it('shows an error when the doc cannot be opened', async () => {
    const harness = createHarness();
    renderDoc(harness, 'dd_missing');
    expect(await screen.findByText('This design doc could not be opened')).toBeTruthy();
  });

  it('closes a doc that is deleted while it is open', async () => {
    const harness = createHarness();
    const doc = simpleDoc(harness);
    const { onDeleted } = renderDoc(harness, doc.id);
    await findPane('README.md');
    await harness.asAgent((store) => store.remove(doc.id));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(harness.toasts).toContainEqual({ message: '“Simple” was deleted', kind: 'info' });
  });

  it('turns a text selection into a comment or a question for an agent', async () => {
    const harness = createHarness();
    const doc = simpleDoc(harness, 'The cache expires hourly.');
    renderDoc(harness, doc.id);
    const readme = await findPane('README.md');
    const text = await within(readme).findByText('The cache expires hourly.');
    const removeAllRanges = vi.fn();
    const selection = {
      isCollapsed: false,
      anchorNode: text.firstChild,
      toString: () => ' expires hourly ',
      getRangeAt: () => ({ getBoundingClientRect: () => ({ top: 100, left: 50, width: 40, height: 10 }) }),
      removeAllRanges
    };
    vi.stubGlobal('getSelection', () => selection);
    const preview = readme.querySelector('.dd-preview')!;

    fireEvent.mouseUp(preview);
    const chip = () => readme.querySelector<HTMLElement>('.dd-selection-chip');
    fireEvent.click(within(chip()!).getByRole('button', { name: 'Comment' }));
    expect(removeAllRanges).toHaveBeenCalled();
    expect(chip()).toBeNull();
    const composer = screen.getByPlaceholderText('Comment on README.md… agents see open comments');
    expect(document.querySelector('.dd-composer-quote')!.textContent).toContain('expires hourly');
    fireEvent.change(composer, { target: { value: 'Why hourly?' } });
    fireEvent.keyDown(composer, { key: 'Enter', metaKey: true });
    await waitFor(() => expect(harness.store.get(doc.id).comments[0]).toMatchObject({ body: 'Why hourly?', path: 'README.md', quote: 'expires hourly' }));
    await waitFor(() => expect(document.querySelector('.dd-composer-quote')).toBeNull());

    fireEvent.mouseUp(preview);
    const askSelection = within(chip()!).getByRole('button', { name: 'Ask agent' });
    fireEvent.mouseDown(askSelection);
    selection.isCollapsed = true;
    fireEvent.mouseUp(askSelection);
    expect(chip()).not.toBeNull();
    fireEvent.click(askSelection);
    const prompt = (await screen.findByPlaceholderText(/^Or describe what you want/)) as HTMLTextAreaElement;
    expect(prompt.value).toBe('');
    expect(screen.getByText('README.md (1)')).toBeTruthy();
    expect(document.querySelector('.dd-ask-context pre')?.textContent).toBe('expires hourly');
    fireEvent.click(screen.getByRole('button', { name: 'Remove selected passage' }));
    expect(document.querySelector('.dd-ask-context')).toBeNull();

    // A collapsed selection clears the chip, and pressing elsewhere hides it.
    selection.isCollapsed = false;
    fireEvent.mouseUp(preview);
    expect(chip()).not.toBeNull();
    fireEvent.mouseDown(preview);
    expect(chip()).toBeNull();
    selection.isCollapsed = true;
    fireEvent.mouseUp(preview);
    expect(chip()).toBeNull();
  });

  it.each([true, false])('hands the captured passage to the agent without quoting it into the request (panel=%s)', async (panelAgent) => {
    const harness = createHarness({ panelAgent });
    const doc = simpleDoc(harness, 'Tokens expire hourly.');
    renderDoc(harness, doc.id);
    const readme = await findPane('README.md');
    const text = await within(readme).findByText('Tokens expire hourly.');
    vi.stubGlobal('getSelection', () => ({
      isCollapsed: false, anchorNode: text.firstChild, toString: () => 'Tokens expire hourly.',
      getRangeAt: () => ({ getBoundingClientRect: () => ({ top: 100, left: 50, width: 40, height: 10 }) }),
      removeAllRanges: vi.fn()
    }));
    fireEvent.mouseUp(readme.querySelector('.dd-preview')!);
    fireEvent.click(within(readme.querySelector('.dd-selection-chip')!).getByRole('button', { name: 'Ask agent' }));
    fireEvent.change(await screen.findByPlaceholderText(/^Or describe what you want/), { target: { value: 'Explain this policy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start', exact: true }));
    if (panelAgent) {
      await waitFor(() => expect(harness.navigateCalls).toHaveLength(1));
      expect(harness.navigateCalls[0]).toMatchObject({ method: 'openPanelAgent', options: { draft: {
        selection: { path: 'README.md', text: 'Tokens expire hourly.', startLine: 1, endLine: 1 },
        prompt: expect.stringContaining('Explain this policy')
      } } });
      const draft = (harness.navigateCalls[0] as { options: { draft: { prompt: string } } }).options.draft;
      expect(draft.prompt).not.toContain('Tokens expire hourly.');
      expect(harness.spawn).not.toHaveBeenCalled();
    } else {
      await waitFor(() => expect(harness.spawn).toHaveBeenCalledTimes(1));
      expect(harness.spawn.mock.calls[0]![0]).toMatchObject({ prompt: expect.stringContaining('Tokens expire hourly.') });
      expect(harness.spawn.mock.calls[0]![0]).toMatchObject({ prompt: expect.stringContaining('Explain this policy') });
    }
  });
});

describe('editing files', () => {
  it('edits, reverts and saves with the keyboard', async () => {
    const harness = createHarness();
    const doc = simpleDoc(harness);
    renderDoc(harness, doc.id);
    await findPane('README.md');
    fireEvent.click(modeButton('Edit'));
    const input = editor('README.md');
    expect(screen.getByText('Saved · rev 1')).toBeTruthy();

    fireEvent.change(input, { target: { value: 'Draft' } });
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Revert' }));
    expect(input.value).toBe('Line one\nLine two');

    input.setSelectionRange(0, 0);
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(editor('README.md').value).toBe('  Line one\nLine two');
    fireEvent.keyDown(input, { key: 's', metaKey: true });
    await waitFor(() => expect(harness.store.readFile(doc.id, 'README.md').content).toBe('  Line one\nLine two'));
    expect(await screen.findByText('Saved · rev 2')).toBeTruthy();

    fireEvent.change(editor('README.md'), { target: { value: 'Clicked save' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(harness.store.readFile(doc.id, 'README.md')).toMatchObject({ content: 'Clicked save', revision: 3 }));

    harness.fail('writeFile', 'quota exceeded');
    fireEvent.change(editor('README.md'), { target: { value: 'Will fail' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(harness.toasts).toContainEqual({ message: 'Could not save README.md: quota exceeded', kind: 'error' }));
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });

  it('resolves conflicts with an agent edit either way', async () => {
    const harness = createHarness();
    const doc = simpleDoc(harness);
    renderDoc(harness, doc.id);
    await findPane('README.md');
    fireEvent.click(modeButton('Edit'));

    fireEvent.change(editor('README.md'), { target: { value: 'Mine' } });
    await harness.asAgent((store) => store.writeFile(doc.id, { path: 'README.md', content: 'Agent v2' }, AGENT));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Architect saved revision 2 while you were editing.');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(editor('README.md'), { key: 's', ctrlKey: true });
    fireEvent.click(within(alert).getByRole('button', { name: 'Overwrite with mine' }));
    await waitFor(() => expect(harness.store.readFile(doc.id, 'README.md')).toMatchObject({ content: 'Mine', revision: 3 }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());

    fireEvent.change(editor('README.md'), { target: { value: 'Mine again' } });
    await harness.asAgent((store) => store.writeFile(doc.id, { path: 'README.md', content: 'Agent v4' }, AGENT));
    fireEvent.click(within(await screen.findByRole('alert')).getByRole('button', { name: /Discard mine/ }));
    await waitFor(() => expect(editor('README.md').value).toBe('Agent v4'));
    expect(screen.getByText('Saved · rev 4')).toBeTruthy();

    // A save that races an unannounced write is reported as a conflict too.
    fireEvent.change(editor('README.md'), { target: { value: 'Stale base' } });
    harness.store.writeFile(doc.id, { path: 'README.md', content: 'Silent v5' }, AGENT);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toContain('saved revision 5');
    harness.fail('readFile', 'offline');
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: /Discard mine/ }));
    await waitFor(() => expect(harness.toasts).toContainEqual({ message: 'Could not reload README.md: offline', kind: 'error' }));
  });

  it('asks before discarding unsaved edits, and previews side by side', async () => {
    const harness = createHarness();
    const doc = simpleDoc(harness);
    const { opened } = renderDoc(harness, doc.id);
    await findPane('README.md');
    fireEvent.click(modeButton('Split'));
    fireEvent.change(editor('README.md'), { target: { value: 'Split draft' } });
    await waitFor(() => expect(document.querySelector('.dd-editor-preview')!.textContent).toContain('Split draft'));

    fireEvent.click(treeFile('api.md'));
    const confirm = screen.getByRole('dialog', { name: 'Discard unsaved changes?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(opened).toEqual([]);

    fireEvent.click(modeButton('Preview'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Discard unsaved changes?' })).getByRole('button', { name: 'Discard' }));
    expect(await within(await findPane('README.md')).findByText(/Line one/)).toBeTruthy();
    expect(modeButton('Preview').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(modeButton('Edit'));
    fireEvent.change(editor('README.md'), { target: { value: 'Dirty' } });
    fireEvent.click(treeFile('api.md'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Discard unsaved changes?' })).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(opened).toEqual([['api.md', undefined]]));
    expect(editor('api.md').value).toBe('Endpoints');
    expect(harness.store.readFile(doc.id, 'README.md').content).toBe('Line one\nLine two');
  });

  it('keeps a draft whose file is deleted elsewhere, and saving puts it back', async () => {
    const harness = createHarness();
    const doc = simpleDoc(harness);
    renderDoc(harness, doc.id, { path: 'api.md' });
    await findPane('api.md');
    fireEvent.click(modeButton('Edit'));
    fireEvent.change(editor('api.md'), { target: { value: 'Endpoints v2' } });

    await harness.asAgent((store) => store.deleteFile(doc.id, 'api.md', AGENT));
    expect(await screen.findByText(/^api\.md was deleted or renamed while you were editing/)).toBeTruthy();
    expect(editor('api.md').value).toBe('Endpoints v2');
    expect(screen.queryByText('api.md is not in this doc anymore.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(harness.store.readFile(doc.id, 'api.md').content).toBe('Endpoints v2'));
    // The editor stays on the file while the doc reloads with it.
    expect(editor('api.md').value).toBe('Endpoints v2');
    expect(screen.queryByText(/was deleted or renamed while you were editing/)).toBeNull();
    await waitFor(() => expect(within(tree()).queryByRole('button', { name: /^api\.md/ })).not.toBeNull());
    expect(editor('api.md').value).toBe('Endpoints v2');
    expect(screen.getByText(/^Saved · rev/)).toBeTruthy();
  });

  it('asks before a comment jump drops unsaved edits', async () => {
    const harness = createHarness();
    const doc = simpleDoc(harness);
    harness.store.addComment(doc.id, { body: 'On the API', path: 'api.md', quote: 'Endpoints' }, UI_USER);
    const { opened } = renderDoc(harness, doc.id);
    await findPane('README.md');
    fireEvent.click(modeButton('Edit'));
    fireEvent.change(editor('README.md'), { target: { value: 'Draft' } });

    const rail = screen.getByRole('complementary', { name: 'Comments, history and agents' });
    fireEvent.click(await within(rail).findByTitle('Show in the document'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Discard unsaved changes?' })).getByRole('button', { name: 'Cancel' }));
    expect(opened).toEqual([]);
    expect(editor('README.md').value).toBe('Draft');

    fireEvent.click(within(rail).getByTitle('Show in the document'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Discard unsaved changes?' })).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(opened).toEqual([['api.md', undefined]]));
    expect(within(await findPane('api.md')).getByText('Endpoints')).toBeTruthy();
    expect(modeButton('Preview').getAttribute('aria-pressed')).toBe('true');
    expect(harness.store.readFile(doc.id, 'README.md').content).toBe('Line one\nLine two');
  });

  it('scrolls to the passage a comment quotes', async () => {
    const harness = createHarness();
    const doc = simpleDoc(harness);
    harness.store.addComment(doc.id, { body: 'Which line?', path: 'README.md', quote: 'Line two' }, UI_USER);
    const scrolled = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
      scrolled(this.textContent);
    };
    try {
      renderDoc(harness, doc.id);
      await findPane('README.md');
      const rail = screen.getByRole('complementary', { name: 'Comments, history and agents' });
      fireEvent.click(await within(rail).findByTitle('Show in the document'));
      await waitFor(() => expect(scrolled).toHaveBeenCalledWith(expect.stringContaining('Line two')));
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});

describe('file tree', () => {
  it('creates files, reuses existing ones and refuses images', async () => {
    const harness = createHarness();
    const doc = simpleDoc(harness);
    const { opened } = renderDoc(harness, doc.id);
    await findPane('README.md');
    const newPath = (value: string) => {
      fireEvent.click(screen.getByRole('button', { name: 'New file' }));
      const input = screen.getByRole('textbox', { name: 'path/name.md, .mmd, .html…' });
      fireEvent.change(input, { target: { value } });
      fireEvent.submit(input.closest('form')!);
    };

    newPath('notes/open_questions');
    await waitFor(() => expect(harness.store.readFile(doc.id, 'notes/open_questions.md').content).toBe('# Open questions\n\n'));
    await waitFor(() => expect(opened.at(-1)).toEqual(['notes/open_questions.md', undefined]));

    newPath('api.md');
    await waitFor(() => expect(opened.at(-1)).toEqual(['api.md', undefined]));

    newPath('photo.png');
    expect(harness.toasts).toContainEqual({ message: 'Use “Add files” to upload images and fonts.', kind: 'error' });

    harness.fail('writeFile', 'too many files');
    newPath('extra.md');
    await waitFor(() => expect(harness.toasts).toContainEqual({ message: 'Could not create extra.md: too many files', kind: 'error' }));

    fireEvent.click(screen.getByRole('button', { name: 'New file' }));
    const input = screen.getByRole('textbox', { name: 'path/name.md, .mmd, .html…' });
    fireEvent.change(input, { target: { value: 'ignored.md' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'path/name.md, .mmd, .html…' })).toBeNull();
    expect(harness.store.get(doc.id).files.map((file) => file.path)).not.toContain('ignored.md');
  });

  it('renames, promotes and deletes files from the row menu', async () => {
    const harness = createHarness();
    const doc = simpleDoc(harness);
    const { opened } = renderDoc(harness, doc.id, { path: 'api.md' });
    await findPane('api.md');
    const rowMenu = (path: string) => fireEvent.click(screen.getByRole('button', { name: `Actions for ${path}` }));

    rowMenu('api.md');
    fireEvent.click(screen.getByRole('menuitem', { name: /^Open first/ }));
    await waitFor(() => expect(harness.store.get(doc.id).entryPath).toBe('api.md'));
    await waitFor(() => expect(within(treeFile('api.md')).queryByLabelText('Entry file')).not.toBeNull());
    harness.fail('update', 'read-only');
    rowMenu('README.md');
    fireEvent.click(screen.getByRole('menuitem', { name: /^Open first/ }));
    await waitFor(() => expect(harness.toasts).toContainEqual({ message: 'read-only', kind: 'error' }));

    rowMenu('api.md');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename or move' }));
    const rename = screen.getByRole('textbox', { name: 'New path' }) as HTMLInputElement;
    expect(rename.value).toBe('api.md');
    fireEvent.change(rename, { target: { value: 'spec/api.md' } });
    fireEvent.submit(rename.closest('form')!);
    await waitFor(() => expect(opened.at(-1)).toEqual(['spec/api.md', true]));
    expect(harness.store.get(doc.id).files.map((file) => file.path)).toEqual(['README.md', 'spec/api.md']);
    await waitFor(() => expect(within(tree()).queryByRole('button', { name: 'spec' })).not.toBeNull());

    harness.fail('renameFile', 'taken');
    fireEvent.doubleClick(treeFile('api.md'));
    fireEvent.change(screen.getByRole('textbox', { name: 'New path' }), { target: { value: 'README.md' } });
    fireEvent.blur(screen.getByRole('textbox', { name: 'New path' }));
    await waitFor(() => expect(harness.toasts).toContainEqual({ message: 'Could not rename spec/api.md: taken', kind: 'error' }));

    // Submitting the unchanged path just closes the input.
    fireEvent.doubleClick(treeFile('api.md'));
    fireEvent.submit(screen.getByRole('textbox', { name: 'New path' }).closest('form')!);
    expect(screen.queryByRole('textbox', { name: 'New path' })).toBeNull();

    harness.fail('deleteFile', 'locked');
    rowMenu('spec/api.md');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete file' })).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(harness.toasts).toContainEqual({ message: 'Could not delete spec/api.md: locked', kind: 'error' }));

    harness.restore('deleteFile');
    rowMenu('spec/api.md');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const confirm = screen.getByRole('dialog', { name: 'Delete file' });
    expect(confirm.textContent).toContain('Its history is kept');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(opened.at(-1)).toEqual([null, true]));
    expect(harness.store.get(doc.id).files.map((file) => file.path)).toEqual(['README.md']);
    expect(await findPane('README.md')).toBeTruthy();

    // The only file left cannot be deleted: the item is disabled and says why, and no RPC is sent.
    const deletes = harness.rpcCalls.filter((call) => call.method === 'deleteFile').length;
    await waitFor(() => expect(within(tree()).queryByRole('button', { name: /spec/ })).toBeNull());
    rowMenu('README.md');
    const last = screen.getByRole('menuitem', { name: 'Delete' }) as HTMLButtonElement;
    expect(last.disabled).toBe(true);
    expect(last.title).toBe('A design doc needs at least one file. Delete the doc instead.');
    fireEvent.click(last);
    expect(screen.queryByRole('dialog', { name: 'Delete file' })).toBeNull();
    expect(harness.rpcCalls.filter((call) => call.method === 'deleteFile')).toHaveLength(deletes);
    expect(harness.store.get(doc.id).files.map((file) => file.path)).toEqual(['README.md']);
  });

  it('warns before renaming or deleting the file with unsaved edits', async () => {
    const harness = createHarness();
    const doc = simpleDoc(harness);
    const { opened } = renderDoc(harness, doc.id, { path: 'api.md' });
    await findPane('api.md');
    fireEvent.click(modeButton('Edit'));
    fireEvent.change(editor('api.md'), { target: { value: 'Draft' } });
    const renameTo = (from: string, to: string) => {
      fireEvent.doubleClick(treeFile(from));
      fireEvent.change(screen.getByRole('textbox', { name: 'New path' }), { target: { value: to } });
      fireEvent.submit(screen.getByRole('textbox', { name: 'New path' }).closest('form')!);
    };

    // Another file has no draft, so it renames straight away.
    renameTo('README.md', 'overview.md');
    await waitFor(() => expect(harness.store.get(doc.id).files.map((file) => file.path)).toContain('overview.md'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(editor('api.md').value).toBe('Draft');

    renameTo('api.md', 'spec.md');
    let confirm = screen.getByRole('dialog', { name: 'Discard unsaved changes?' });
    expect(confirm.textContent).toContain('Renaming api.md drops your unsaved edits');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(harness.store.get(doc.id).files.map((file) => file.path)).toContain('api.md');
    expect(editor('api.md').value).toBe('Draft');

    renameTo('api.md', 'spec.md');
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Discard unsaved changes?' })).getByRole('button', { name: 'Discard and rename' }));
    await waitFor(() => expect(opened.at(-1)).toEqual(['spec.md', true]));
    await waitFor(() => expect(editor('spec.md').value).toBe('Endpoints'));

    fireEvent.change(editor('spec.md'), { target: { value: 'Draft again' } });
    fireEvent.click(screen.getByRole('button', { name: 'Actions for spec.md' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    confirm = screen.getByRole('dialog', { name: 'Delete file' });
    expect(confirm.textContent).toContain('Your unsaved edits to it will be lost.');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(opened.at(-1)).toEqual([null, true]));
    // The draft is dropped with the file, not kept as a pending recreation.
    expect(await findPane('overview.md')).toBeTruthy();
    expect(screen.queryByText(/was deleted or renamed while you were editing/)).toBeNull();
    expect(harness.store.get(doc.id).files.map((file) => file.path)).toEqual(['overview.md']);
  });

  it('uploads images, fonts and text files and rejects oversized ones', async () => {
    const harness = createHarness();
    const doc = simpleDoc(harness);
    renderDoc(harness, doc.id);
    await findPane('README.md');
    const input = tree().querySelector<HTMLInputElement>('input[type="file"]')!;
    const clicked = vi.spyOn(input, 'click').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Add files' }));
    expect(clicked).toHaveBeenCalled();

    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'My Logo.svg', { type: 'image/svg+xml' });
    const png = new File([Uint8Array.from(atob(PNG), (char) => char.charCodeAt(0))], 'dot.png', { type: 'image/png' });
    const font = new File([Uint8Array.from([0, 1, 0, 0])], 'Inter.woff2', { type: 'font/woff2' });
    const data = new File(['{"runs":[]}'], 'data.json', { type: 'application/json' });
    const huge = { name: 'huge.png', size: MAX_BINARY_FILE_BYTES + 1 } as File;
    Object.defineProperty(input, 'files', { configurable: true, value: [svg, png, font, data, huge] });
    fireEvent.change(input);

    await waitFor(() => expect(harness.toasts.map((entry) => entry.message)).toContain('Added assets/dot.png. Reference it with ![dot.png](assets/dot.png)'));
    expect(harness.toasts).toContainEqual({ message: 'Added assets/My-Logo.svg. Reference it with ![My Logo.svg](assets/My-Logo.svg)', kind: 'info' });
    await waitFor(() => expect(harness.toasts.find((entry) => entry.message.startsWith('huge.png is larger than'))?.kind).toBe('error'));
    expect(harness.store.readFile(doc.id, 'assets/My-Logo.svg').content).toBe('<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(harness.store.readFile(doc.id, 'assets/dot.png')).toMatchObject({ encoding: 'base64', content: PNG });
    await waitFor(() => expect(harness.toasts.map((entry) => entry.message)).toContain('Added data.json'));
    expect(harness.toasts.map((entry) => entry.message)).toContain('Added assets/Inter.woff2');
    expect(harness.store.readFile(doc.id, 'assets/Inter.woff2')).toMatchObject({ encoding: 'base64', content: 'AAEAAA==' });
    expect(harness.store.readFile(doc.id, 'data.json')).toMatchObject({ encoding: 'utf8', content: '{"runs":[]}' });

    harness.fail('writeFile', 'full');
    Object.defineProperty(input, 'files', { configurable: true, value: [png] });
    fireEvent.change(input);
    await waitFor(() => expect(harness.toasts).toContainEqual({ message: 'Could not add dot.png: full', kind: 'error' }));
  });
});

describe('comments', () => {
  it('adds, resolves, reopens and deletes comments', async () => {
    const harness = createHarness();
    const doc = simpleDoc(harness);
    harness.store.addComment(doc.id, { body: 'On the API', path: 'api.md', quote: 'Endpoints' }, UI_USER);
    const { opened } = renderDoc(harness, doc.id);
    await findPane('README.md');
    const rail = screen.getByRole('complementary', { name: 'Comments, history and agents' });
    expect(await within(rail).findByText('On the API')).toBeTruthy();
    expect(within(rail).getByRole('tab', { name: /Comments/ }).textContent).toContain('1');

    fireEvent.click(within(rail).getByRole('button', { name: 'This file' }));
    expect(within(rail).getByText('No open comments')).toBeTruthy();
    fireEvent.click(within(rail).getByRole('button', { name: 'All files' }));

    const composer = within(rail).getByPlaceholderText('Comment on README.md… agents see open comments');
    fireEvent.change(composer, { target: { value: 'Needs a summary' } });
    fireEvent.click(within(rail).getByRole('button', { name: 'Comment' }));
    // The composer mirrors its value as text, so look for the posted card.
    expect(await within(rail).findByText('Needs a summary', { selector: 'article p' })).toBeTruthy();
    expect(harness.store.get(doc.id).comments.find((comment) => comment.body === 'Needs a summary')).toMatchObject({ path: 'README.md', quote: null });

    const card = within(rail).getByText('Needs a summary', { selector: 'article p' }).closest('article')!;
    fireEvent.click(within(card).getByRole('button', { name: 'Resolve' }));
    const disclosure = await within(rail).findByRole('button', { name: /Resolved \(1\)/ });
    fireEvent.click(disclosure);
    const resolved = within(rail).getByText('Needs a summary', { selector: 'article p' }).closest('article')!;
    fireEvent.click(within(resolved).getByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(within(rail).queryByRole('button', { name: /Resolved/ })).toBeNull());
    // Deleting asks first, since a comment has no history to restore it from.
    const deleteButton = () =>
      within(within(rail).getByText('Needs a summary', { selector: 'article p' }).closest('article')!).getByRole('button', { name: 'Delete comment' });
    fireEvent.click(deleteButton());
    const confirm = screen.getByRole('dialog', { name: 'Delete comment' });
    expect(confirm.textContent).toContain('Delete this comment? This cannot be undone.');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(harness.store.get(doc.id).comments.some((comment) => comment.body === 'Needs a summary')).toBe(true);
    fireEvent.click(deleteButton());
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete comment' })).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(within(rail).queryByText('Needs a summary', { selector: 'article p' })).toBeNull());
    expect(screen.queryByRole('dialog')).toBeNull();

    // The anchor jumps to the commented passage in its file.
    fireEvent.click(within(rail).getByTitle('Show in the document'));
    await waitFor(() => expect(opened.at(-1)).toEqual(['api.md', undefined]));
    expect(await within(await findPane('api.md')).findByText('Endpoints')).toBeTruthy();
  });

  it('reports comment failures', async () => {
    const harness = createHarness();
    const doc = simpleDoc(harness);
    harness.store.addComment(doc.id, { body: 'Existing' }, UI_USER);
    renderDoc(harness, doc.id);
    const rail = await screen.findByRole('complementary', { name: 'Comments, history and agents' });
    await within(rail).findByText('Existing');

    harness.fail('addComment', 'too long');
    fireEvent.change(within(rail).getByRole('textbox'), { target: { value: 'Nope' } });
    fireEvent.click(within(rail).getByRole('button', { name: 'Comment' }));
    await waitFor(() => expect(harness.toasts).toContainEqual({ message: 'Could not add the comment: too long', kind: 'error' }));
    expect((within(rail).getByRole('textbox') as HTMLTextAreaElement).value).toBe('Nope');

    harness.fail('setCommentStatus', 'gone');
    fireEvent.click(within(rail).getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(harness.toasts).toContainEqual({ message: 'Could not update the comment: gone', kind: 'error' }));
    harness.fail('deleteComment', 'gone');
    fireEvent.click(within(rail).getByRole('button', { name: 'Delete comment' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete comment' })).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(harness.toasts).toContainEqual({ message: 'Could not delete the comment: gone', kind: 'error' }));
    expect(within(rail).getByText('Existing')).toBeTruthy();
  });

  it('threads replies under a comment', async () => {
    const harness = createHarness();
    const doc = simpleDoc(harness);
    const question = harness.store.addComment(doc.id, { body: 'Why polling?', path: 'README.md' }, UI_USER);
    harness.store.addReply(doc.id, question.id, 'Websockets are blocked on mobile.', AGENT);
    renderDoc(harness, doc.id);
    await findPane('README.md');
    const rail = screen.getByRole('complementary', { name: 'Comments, history and agents' });
    const card = (await within(rail).findByText('Why polling?', { selector: 'article p' })).closest('article')!;
    const replies = within(card).getByRole('list', { name: 'Replies' });
    expect(within(replies).getByText('Architect')).toBeTruthy();
    expect(within(replies).getByText('Websockets are blocked on mobile.')).toBeTruthy();

    // Esc closes the composer without sending.
    fireEvent.click(within(card).getByRole('button', { name: 'Reply' }));
    fireEvent.change(within(card).getByRole('textbox', { name: 'Reply' }), { target: { value: 'Never mind' } });
    fireEvent.keyDown(within(card).getByRole('textbox', { name: 'Reply' }), { key: 'Escape' });
    expect(within(card).queryByRole('textbox', { name: 'Reply' })).toBeNull();

    fireEvent.click(within(card).getByRole('button', { name: 'Reply' }));
    const composer = card.querySelector<HTMLElement>('.dd-reply-composer')!;
    const send = within(composer).getByRole('button', { name: 'Reply' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    harness.fail('replyToComment', 'too many replies');
    fireEvent.change(within(card).getByRole('textbox', { name: 'Reply' }), { target: { value: 'Then use SSE' } });
    fireEvent.click(send);
    await waitFor(() => expect(harness.toasts).toContainEqual({ message: 'Could not reply: too many replies', kind: 'error' }));
    expect((within(card).getByRole('textbox', { name: 'Reply' }) as HTMLTextAreaElement).value).toBe('Then use SSE');

    harness.restore('replyToComment');
    fireEvent.keyDown(within(card).getByRole('textbox', { name: 'Reply' }), { key: 'Enter', metaKey: true });
    await waitFor(() => expect(within(replies).getByText('Then use SSE')).toBeTruthy());
    expect(within(card).queryByRole('textbox', { name: 'Reply' })).toBeNull();
    expect(harness.store.get(doc.id).comments[0]!.replies.map((reply) => reply.body)).toEqual(['Websockets are blocked on mobile.', 'Then use SSE']);

    // The confirmation counts the replies that go with the comment.
    fireEvent.click(within(card).getByRole('button', { name: 'Delete comment' }));
    const confirm = screen.getByRole('dialog', { name: 'Delete comment' });
    expect(confirm.textContent).toContain('Delete this comment and its 2 replies? This cannot be undone.');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));

    // A reply goes without asking.
    harness.fail('deleteComment', 'gone');
    fireEvent.click(within(replies).getAllByRole('button', { name: 'Delete reply' })[1]!);
    await waitFor(() => expect(harness.toasts).toContainEqual({ message: 'Could not delete the reply: gone', kind: 'error' }));
    harness.restore('deleteComment');
    fireEvent.click(within(replies).getAllByRole('button', { name: 'Delete reply' })[1]!);
    await waitFor(() => expect(within(replies).queryByText('Then use SSE')).toBeNull());
    expect(harness.store.get(doc.id).comments[0]!.replies).toHaveLength(1);

    fireEvent.click(within(card).getByRole('button', { name: 'Delete comment' }));
    const last = screen.getByRole('dialog', { name: 'Delete comment' });
    expect(last.textContent).toContain('Delete this comment and its reply? This cannot be undone.');
    fireEvent.click(within(last).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(harness.store.get(doc.id).comments).toHaveLength(0));
  });

  it('marks comments on deleted files and keeps a draft across rail tabs', async () => {
    const harness = createHarness();
    const doc = simpleDoc(harness);
    harness.store.addComment(doc.id, { body: 'On the API', path: 'api.md', quote: 'Endpoints' }, UI_USER);
    const { opened } = renderDoc(harness, doc.id);
    await findPane('README.md');
    const rail = screen.getByRole('complementary', { name: 'Comments, history and agents' });
    await within(rail).findByText('On the API');

    fireEvent.change(within(rail).getByPlaceholderText(/^Comment on README\.md/), { target: { value: 'Half a thought' } });
    fireEvent.click(within(rail).getByRole('tab', { name: /History/ }));
    fireEvent.click(within(rail).getByRole('tab', { name: /Comments/ }));
    expect((within(rail).getByPlaceholderText(/^Comment on README\.md/) as HTMLTextAreaElement).value).toBe('Half a thought');

    await harness.asAgent((store) => store.deleteFile(doc.id, 'api.md', AGENT));
    const anchor = await within(rail).findByTitle('This file was deleted');
    expect(anchor.textContent).toContain('api.md (deleted)');
    expect((anchor as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(anchor);
    expect(opened).toEqual([]);
  });
});

describe('history', () => {
  it('lists revisions, shows their changes and restores one', async () => {
    const harness = createHarness();
    const doc = simpleDoc(harness);
    harness.store.writeFile(doc.id, { path: 'README.md', content: 'Line one\nLine 2', note: 'Tighten' }, AGENT);
    harness.store.writeFile(doc.id, { path: 'README.md', content: 'Line one\nLine 2\nLine three' }, UI_USER);
    renderDoc(harness, doc.id);
    await findPane('README.md');
    fireEvent.click(screen.getByRole('tab', { name: /History/ }));
    const rail = screen.getByRole('complementary', { name: 'Comments, history and agents' });
    await within(rail).findByText('Tighten');
    const rows = within(rail).getAllByRole('button', { name: /^(Created|Edited)/ });
    expect(rows.map((row) => row.textContent)).toEqual([expect.stringMatching(/^Edited\s*rev 3/), expect.stringMatching(/^Edited\s*rev 2\s*Tighten/), expect.stringMatching(/^Created\s*rev 1/)]);

    fireEvent.click(rows[0]!);
    expect((await screen.findByRole('button', { name: /Current/ })).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close revision' }));

    fireEvent.click(within(rail).getAllByRole('button', { name: /^Edited/ })[1]!);
    const diff = await screen.findByRole('table', { name: 'Changes in revision 2' });
    expect(diff.textContent).toContain('+1');
    expect(diff.textContent).toContain('−1');
    expect(within(diff).getByText('Line 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Full file' }));
    expect(await within(await findPane('README.md')).findByText(/Line 2/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Changes' }));
    expect(screen.getByRole('table', { name: 'Changes in revision 2' })).toBeTruthy();

    harness.fail('restore', 'busy');
    fireEvent.click(screen.getByRole('button', { name: /^Restore/ }));
    await waitFor(() => expect(harness.toasts).toContainEqual({ message: 'Could not restore: busy', kind: 'error' }));
    harness.restore('restore');
    // An edit that lands while the revision is open is not overwritten.
    harness.store.writeFile(doc.id, { path: 'README.md', content: 'Line one\nLine 2\nLine three\nLine four' }, AGENT);
    fireEvent.click(screen.getByRole('button', { name: /^Restore/ }));
    await waitFor(() => expect(harness.toasts.at(-1)?.message).toMatch(/^Could not restore: README.md changed since revision 3 \(now 4/));
    await harness.emit({ docId: doc.id });
    await waitFor(() => expect(within(rail).getAllByRole('button', { name: /^Edited/ })).toHaveLength(3));
    // A live refresh cannot grant new restore consent; reopen the revision to review the new base.
    fireEvent.click(screen.getByRole('button', { name: 'Close revision' }));
    fireEvent.click(within(rail).getAllByRole('button', { name: /^Edited/ })[2]!);
    await screen.findByRole('table', { name: 'Changes in revision 2' });
    fireEvent.click(screen.getByRole('button', { name: /^Restore/ }));
    await waitFor(() => expect(harness.toasts).toContainEqual({ message: 'Restored README.md to revision 2 (now rev 5)', kind: 'info' }));
    expect(harness.store.readFile(doc.id, 'README.md').content).toBe('Line one\nLine 2');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Close revision' })).toBeNull());

    fireEvent.click(within(rail).getAllByRole('button', { name: /^Created/ })[0]!);
    // A creation has nothing to compare with, so only the snapshot shows.
    expect(await screen.findByRole('button', { name: /^Restore/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Changes' })).toBeNull();
  });

  it('recreates a deleted file and shows renames across all files', async () => {
    const harness = createHarness();
    const doc = simpleDoc(harness);
    harness.store.renameFile(doc.id, 'api.md', 'spec.md', UI_USER);
    harness.store.deleteFile(doc.id, 'spec.md', UI_USER);
    localStorage.setItem('zcc.design-docs.rail-tab', JSON.stringify('history'));
    const { opened } = renderDoc(harness, doc.id);
    await findPane('README.md');
    const rail = screen.getByRole('complementary', { name: 'Comments, history and agents' });
    fireEvent.click(await within(rail).findByRole('button', { name: 'All files' }));
    const deleted = await within(rail).findByRole('button', { name: /^Deleted\s*spec\.md/ });
    expect(within(rail).getByRole('button', { name: /^Renamed\s*spec\.md/ })).toBeTruthy();

    fireEvent.click(deleted);
    expect(await screen.findByRole('table', { name: /Changes in revision/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Recreate file/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Recreate spec.md?' });
    expect(dialog.textContent).toContain('is no longer in this doc. Recreate it');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Recreate' }));
    await waitFor(() => expect(harness.store.readFile(doc.id, 'spec.md').content).toBe('Endpoints'));
    await waitFor(() => expect(opened.at(-1)).toEqual(['spec.md', undefined]));

    fireEvent.click(within(rail).getByRole('button', { name: /^Renamed\s*spec\.md/ }));
    await waitFor(() => expect(document.querySelector('.dd-revision-banner')?.textContent).toContain('from api.md'));
  });
});

describe('agents', () => {
  it('opens linked threads in the shared host panel and keeps the agent list usable', async () => {
    const harness = createHarness({ panelAgent: true });
    const doc = simpleDoc(harness);
    harness.store.linkThread(doc.id, 'thread-9', 'Reviewer run', 'reviewer');
    harness.store.linkThread(doc.id, 'thread-8', 'Drafting', 'author');
    renderDoc(harness, doc.id);
    await findPane('README.md');
    fireEvent.click(screen.getByRole('tab', { name: /Agents/ }));
    const rail = screen.getByRole('complementary', { name: 'Comments, history and agents' });
    expect(within(rail).getAllByTitle('Open chat beside the doc')).toHaveLength(2);
    fireEvent.click(within(rail).getByText('Reviewer run').closest('button')!);
    expect(harness.navigateCalls.at(-1)).toEqual({ method: 'openPanelAgent', options: { threadId: 'thread-9', title: doc.title } });
    expect(within(rail).queryByTestId('plugin-thread-chat')).toBeNull();
    expect(pane('README.md')).not.toBeNull();
    expect(within(rail).getByText('Drafting')).toBeTruthy();

    fireEvent.click(within(rail).getByText('Drafting').closest('button')!);
    expect(harness.navigateCalls.at(-1)).toEqual({ method: 'openPanelAgent', options: { threadId: 'thread-8', title: doc.title } });
    harness.fail('unlinkThread', 'nope');
    fireEvent.click(within(rail).getAllByRole('button', { name: 'Unlink thread' })[0]!);
    await waitFor(() => expect(harness.toasts).toContainEqual({ message: 'Could not unlink: nope', kind: 'error' }));
    harness.restore('unlinkThread');
    for (const button of within(rail).getAllByRole('button', { name: 'Unlink thread' })) fireEvent.click(button);
    expect(await within(rail).findByText('No agents yet')).toBeTruthy();
    expect(harness.store.get(doc.id).threads).toEqual([]);
  });

  it('navigates to the thread when the doc already sits beside one', async () => {
    const harness = createHarness();
    const doc = simpleDoc(harness);
    harness.store.linkThread(doc.id, 'thread-9', 'Reviewer run', 'reviewer');
    renderDoc(harness, doc.id, { layout: 'compact' });
    await findPane('README.md');
    fireEvent.click(screen.getByRole('button', { name: /comments & history/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Agents/ }));
    fireEvent.click(screen.getByTitle('Open thread'));
    expect(harness.navigateCalls.at(-1)).toEqual({ method: 'toThread', threadId: 'thread-9' });
    expect(screen.queryByTestId('plugin-thread-chat')).toBeNull();
  });

  it('prefills the side panel composer so the user picks the harness', async () => {
    const harness = createHarness({ panelAgent: true });
    const doc = simpleDoc(harness);
    renderDoc(harness, doc.id, { path: 'api.md' });
    await findPane('api.md');
    const ask = () => fireEvent.click(screen.getByRole('button', { name: /Ask agent/, expanded: false }));

    ask();
    expect(screen.getByText('Ask an agent')).toBeTruthy();
    // Away from the entry file, the request focuses on the open file.
    expect((screen.getByRole('checkbox', { name: /Focus on/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('menuitem', { name: /^Review/ }));
    await waitFor(() => expect(screen.queryByText('Ask an agent')).toBeNull());
    const [review] = harness.navigateCalls as Array<{ method: string; options: { draft: { prompt: string; projectId?: string }; title: string } }>;
    // The doc id names the view, so the conversation joins this doc's Agents list.
    expect(review).toMatchObject({ method: 'openPanelAgent', options: { draft: { projectId: 'p1', view: doc.id }, title: 'Simple' } });
    expect(review!.options.draft.prompt).toContain(`id ${doc.id}`);
    expect(review!.options.draft.prompt).toContain('Focus on api.md.');
    // Nothing starts until the user sends from the composer.
    expect(harness.spawn).not.toHaveBeenCalled();

    ask();
    fireEvent.click(screen.getByRole('checkbox', { name: /Focus on/ }));
    const prompt = screen.getByPlaceholderText(/^Or describe what you want/);
    fireEvent.change(prompt, { target: { value: 'Compare caching strategies' } });
    fireEvent.keyDown(prompt, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(harness.navigateCalls).toHaveLength(2));
    const custom = (harness.navigateCalls[1] as { options: { draft: { prompt: string } } }).options.draft.prompt;
    expect(custom).toContain('Compare caching strategies');
    expect(custom).not.toContain('Focus on');
    expect(harness.spawn).not.toHaveBeenCalled();
  });

  it('starts the agent itself when the host has no side panel composer', async () => {
    const harness = createHarness();
    const doc = simpleDoc(harness);
    renderDoc(harness, doc.id, { path: 'api.md' });
    await findPane('api.md');
    const ask = () => fireEvent.click(screen.getByRole('button', { name: /Ask agent/, expanded: false }));

    ask();
    fireEvent.click(screen.getByRole('menuitem', { name: /^Review/ }));
    await waitFor(() => expect(harness.spawn).toHaveBeenCalledTimes(1));
    const [review] = harness.spawn.mock.calls[0] as unknown as [{ projectId: string; prompt: string; title: string }];
    expect(review).toMatchObject({ projectId: 'p1', title: 'Review · Simple' });
    expect(review.prompt).toContain('api.md');
    expect(harness.navigateCalls.at(-1)).toEqual({ method: 'toThread', threadId: 'thread-1' });
    expect(harness.toasts.at(-1)).toEqual({ message: 'Agent started on “Simple”. Its edits appear here live.', kind: 'info' });
    await waitFor(() => expect(screen.queryByText('Ask an agent')).toBeNull());
    expect(harness.store.get(doc.id).threads[0]).toMatchObject({ threadId: 'thread-1', role: 'reviewer' });

    ask();
    fireEvent.click(screen.getByRole('checkbox', { name: /Focus on/ }));
    const prompt = screen.getByPlaceholderText(/^Or describe what you want/);
    expect((screen.getByRole('button', { name: 'Start' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(prompt, { target: { value: 'Compare caching strategies' } });
    fireEvent.keyDown(prompt, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(harness.spawn).toHaveBeenCalledTimes(2));
    const [custom] = harness.spawn.mock.calls[1] as unknown as [{ prompt: string; title: string }];
    expect(custom.title).toBe('Design doc · Simple');
    expect(custom.prompt).toContain('Compare caching strategies');

    harness.fail('askAgent', 'no provider');
    ask();
    fireEvent.change(screen.getByPlaceholderText(/^Or describe what you want/), { target: { value: 'Again' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(harness.toasts).toContainEqual({ message: 'Could not start the agent: no provider', kind: 'error' }));
    expect(screen.getByText('Ask an agent')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Ask an agent')).toBeNull();
  });

  it('runs a global doc\'s agent in the Default Project unless another is chosen', async () => {
    const harness = createHarness({ projects: [{ id: 'p1', name: 'App' }, { id: 'quick', name: 'Default Project', quickAgent: true }] });
    const doc = simpleDoc(harness, 'Glossary', null);
    renderDoc(harness, doc.id);
    await findPane('README.md');
    fireEvent.click(screen.getByRole('button', { name: /Ask agent/ }));
    const runIn = await screen.findByRole('combobox');
    await waitFor(() => expect((runIn as HTMLSelectElement).value).toBe('quick'));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Fill the gaps/ }));
    await waitFor(() => expect(harness.spawn).toHaveBeenCalledTimes(1));
    expect((harness.spawn.mock.calls[0] as unknown as [{ projectId: string }])[0].projectId).toBe('quick');
  });

  it('asks which project runs the agent for a global doc', async () => {
    const harness = createHarness();
    const doc = simpleDoc(harness, 'Glossary', null);
    renderDoc(harness, doc.id, { contextProjectId: 'p2' });
    await findPane('README.md');
    fireEvent.click(screen.getByRole('button', { name: /Ask agent/ }));
    const runIn = await screen.findByRole('combobox');
    await waitFor(() => expect((runIn as HTMLSelectElement).value).toBe('p2'));
    expect(screen.queryByRole('checkbox', { name: /Focus on/ })).not.toBeNull();
    fireEvent.change(runIn, { target: { value: 'p1' } });
    fireEvent.click(screen.getByRole('menuitem', { name: /^Fill the gaps/ }));
    await waitFor(() => expect(harness.spawn).toHaveBeenCalledTimes(1));
    expect((harness.spawn.mock.calls[0] as unknown as [{ projectId: string }])[0].projectId).toBe('p1');
  });

  it('refuses to start an agent for a global doc without projects', async () => {
    const harness = createHarness({ projects: [] });
    const doc = simpleDoc(harness, 'Glossary', null);
    renderDoc(harness, doc.id);
    await findPane('README.md');
    fireEvent.click(screen.getByRole('button', { name: /Ask agent/ }));
    expect(await screen.findByRole('option', { name: 'No projects' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: /^Add diagrams/ }));
    expect(harness.toasts).toContainEqual({ message: 'Add a project first: agents run inside a project.', kind: 'error' });
    expect(harness.spawn).not.toHaveBeenCalled();
  });
});

describe('layout', () => {
  it('toggles the rail in the workbench', async () => {
    const harness = createHarness();
    const doc = simpleDoc(harness);
    renderDoc(harness, doc.id);
    await findPane('README.md');
    fireEvent.click(screen.getByRole('button', { name: 'Hide comments & history' }));
    expect(screen.queryByRole('complementary', { name: 'Comments, history and agents' })).toBeNull();
    expect(localStorage.getItem('zcc.design-docs.rail')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Show comments & history' }));
    expect(screen.getByRole('complementary', { name: 'Comments, history and agents' })).toBeTruthy();
  });

  it('fits the tree and rail to the width the doc has', async () => {
    const observers: Array<{ callback: ResizeObserverCallback; disconnect: ReturnType<typeof vi.fn> }> = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        disconnect = vi.fn();
        constructor(public callback: ResizeObserverCallback) {
          observers.push(this);
        }
        observe() {}
      }
    );
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 900 } as DOMRect);
    const resize = (width: number) =>
      act(() => observers.at(-1)!.callback([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver));
    try {
      const harness = createHarness();
      const doc = simpleDoc(harness);
      renderDoc(harness, doc.id);
      await findPane('README.md');

      // Room for the tree but not the rail: the rail floats, closed until asked for.
      expect(tree()).toBeTruthy();
      expect(screen.queryByRole('complementary')).toBeNull();
      expect(document.querySelector('.dd-doc')!.className).toContain('dd-rail-floating');
      fireEvent.click(screen.getByRole('button', { name: 'Show comments & history' }));
      fireEvent.click(within(screen.getByRole('complementary')).getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('complementary')).toBeNull();
      expect(localStorage.getItem('zcc.design-docs.rail-compact')).toBe('false');

      resize(500);
      expect(screen.queryByRole('navigation', { name: 'Files' })).toBeNull();
      expect(screen.getByTitle('Files in this doc')).toBeTruthy();

      // Wide again: both columns come back, and the inline rail kept its own state.
      resize(1300);
      expect(tree()).toBeTruthy();
      expect(screen.getByRole('complementary', { name: 'Comments, history and agents' })).toBeTruthy();
      expect(within(screen.getByRole('complementary')).queryByRole('button', { name: 'Close' })).toBeNull();
      expect(document.querySelector('.dd-doc')!.className).not.toContain('dd-rail-floating');

      // A zero width (hidden panel) is unmeasured, which keeps the wide layout.
      resize(0);
      expect(tree()).toBeTruthy();
    } finally {
      rect.mockRestore();
    }
  });

  it('collapses the header on a phone-width doc, with the summary and tags behind a toggle', async () => {
    const observers: Array<{ callback: ResizeObserverCallback }> = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        disconnect = vi.fn();
        constructor(public callback: ResizeObserverCallback) {
          observers.push(this);
        }
        observe() {}
      }
    );
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 390 } as DOMRect);
    const resize = (width: number) =>
      act(() => observers.at(-1)!.callback([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver));
    try {
      const harness = createHarness();
      const doc = simpleDoc(harness);
      renderDoc(harness, doc.id);
      await findPane('README.md');

      const header = () => document.querySelector('.dd-doc-header')!;
      expect(document.querySelector('.dd-doc')!.className).toContain('dd-doc-narrow');
      expect(header().className).toContain('dd-doc-header-compact');
      expect(screen.queryByTitle('Edit summary')).toBeNull();
      expect(screen.queryByRole('button', { name: /Tag/ })).toBeNull();
      expect(document.querySelector('.dd-ask-compact')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Show summary and tags' }));
      expect(screen.getByTitle('Edit summary')).toBeTruthy();
      expect(screen.getByRole('button', { name: /Tag/ })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Hide summary and tags' }));
      expect(screen.queryByTitle('Edit summary')).toBeNull();

      // Wide enough for the full header: no toggle, everything shown.
      resize(600);
      expect(document.querySelector('.dd-doc')!.className).not.toContain('dd-doc-narrow');
      expect(header().className).not.toContain('dd-doc-header-compact');
      expect(screen.getByTitle('Edit summary')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Show summary and tags' })).toBeNull();
      expect(document.querySelector('.dd-ask-compact')).toBeNull();
    } finally {
      rect.mockRestore();
    }
  });

  it('uses a file switcher and a closable rail in the compact layout', async () => {
    const harness = createHarness();
    const doc = simpleDoc(harness);
    const { opened } = renderDoc(harness, doc.id, { layout: 'compact' });
    await findPane('README.md');
    expect(screen.queryByRole('navigation', { name: 'Files' })).toBeNull();
    expect(screen.queryByRole('complementary')).toBeNull();

    fireEvent.click(screen.getByTitle('Files in this doc'));
    expect(screen.getByTitle('Files in this doc').textContent).toContain('2 files');
    fireEvent.click(treeFile('api.md'));
    await waitFor(() => expect(opened).toEqual([['api.md', undefined]]));
    expect(screen.queryByRole('navigation', { name: 'Files' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show comments & history' }));
    fireEvent.click(within(screen.getByRole('complementary')).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary')).toBeNull();
  });
});

describe('draftDocAgent', () => {
  const doc = { id: 'doc-1', title: 'Spec' };

  it('returns false without a side panel composer', () => {
    expect(draftDocAgent({} as never, doc, { action: 'review' })).toBe(false);
  });

  it('drafts an action brief with the project, or a bare prompt without one', () => {
    const openPanelAgent = vi.fn(() => true);
    expect(draftDocAgent({ openPanelAgent } as never, doc, { action: 'review', path: 'a.md', projectId: 'p1' })).toBe(true);
    expect(openPanelAgent.mock.calls[0]![0]).toMatchObject({ draft: { view: 'doc-1', projectId: 'p1' }, title: 'Spec' });
    expect((openPanelAgent.mock.calls[0]![0] as { draft: { prompt: string } }).draft.prompt).toContain('a.md');

    expect(draftDocAgent({ openPanelAgent } as never, doc, { action: null, prompt: 'Explain it' })).toBe(true);
    const draft = (openPanelAgent.mock.calls[1]![0] as { draft: Record<string, unknown> }).draft;
    expect(draft).not.toHaveProperty('projectId');
    expect(draft.prompt).toContain('Explain it');
  });
});
