// @vitest-environment happy-dom
// Branch coverage for DocHeader editing guards and FileTree menu/upload edge cases.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UI_USER } from '../server/rpc.js';
import { DocHeader } from './DocHeader.js';
import { FileTree } from './FileTree.js';
import { createHarness, type Harness } from './test-harness.js';

function makeDoc(harness: Harness, files = [{ path: 'README.md', content: 'hi' }, { path: 'api.md', content: 'x' }]) {
  return harness.store.create({ title: 'Doc', projectId: null, files }, UI_USER);
}

const updates = (harness: Harness) => harness.rpcCalls.filter((call) => call.method === 'update');
const writes = (harness: Harness) => harness.rpcCalls.filter((call) => call.method === 'writeFile');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DocHeader editing guards', () => {
  const header = (harness: Harness, doc: ReturnType<typeof makeDoc>) =>
    harness.render(<DocHeader doc={doc} projects={[]} compact={false} onDeleted={() => undefined} />);

  it('saves once when Enter and blur both fire, and ignores other keys', async () => {
    const harness = createHarness();
    header(harness, makeDoc(harness));
    fireEvent.click(screen.getByTitle('Edit title'));
    const input = screen.getByRole('textbox', { name: 'Title' });
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.keyDown(input, { key: 'a' });
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.blur(input);
    });
    await waitFor(() => expect(updates(harness)).toHaveLength(1));
    expect(updates(harness)[0].input).toMatchObject({ title: 'Renamed' });
  });

  it('keeps the multiline summary open on Shift+Enter and cancels on Escape', () => {
    const harness = createHarness();
    header(harness, makeDoc(harness));
    fireEvent.click(screen.getByTitle('Edit summary'));
    const input = screen.getByRole('textbox', { name: 'Summary' });
    fireEvent.change(input, { target: { value: 'draft text' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(screen.getByRole('textbox', { name: 'Summary' })).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Summary' })).toBeNull();
    expect(updates(harness)).toHaveLength(0);
  });

  it('does not save an emptied title', () => {
    const harness = createHarness();
    header(harness, makeDoc(harness));
    fireEvent.click(screen.getByTitle('Edit title'));
    const input = screen.getByRole('textbox', { name: 'Title' });
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(updates(harness)).toHaveLength(0);
  });

  it('adds no tag for an empty entry and cancels on Escape', () => {
    const harness = createHarness();
    header(harness, makeDoc(harness));
    fireEvent.click(screen.getByRole('button', { name: 'Tag' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Add tags' }), { key: 'Enter' });
    expect(screen.queryByRole('textbox', { name: 'Add tags' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tag' }));
    const input = screen.getByRole('textbox', { name: 'Add tags' });
    fireEvent.change(input, { target: { value: 'ignored' } });
    fireEvent.keyDown(input, { key: 'x' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Add tags' })).toBeNull();
    expect(updates(harness)).toHaveLength(0);
  });

  it('hides the add-tag button at the tag limit', () => {
    const harness = createHarness();
    const doc = { ...makeDoc(harness), tags: Array.from({ length: 12 }, (_, index) => `t${index}`) };
    header(harness, doc);
    expect(screen.queryByRole('button', { name: 'Tag' })).toBeNull();
  });

  it('closes the status menu on a second click and ignores re-selecting the current status', () => {
    const harness = createHarness();
    const doc = makeDoc(harness);
    header(harness, doc);
    const button = screen.getByTitle('Change status');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('menuitem', { name: /Draft/ }));
    expect(updates(harness)).toHaveLength(0);
  });

  it('toggles the more-actions menu closed from its button', () => {
    const harness = createHarness();
    header(harness, makeDoc(harness));
    const button = screen.getByRole('button', { name: 'More actions' });
    fireEvent.click(button);
    expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0);
    fireEvent.click(button);
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
  });
});

describe('FileTree edge cases', () => {
  const tree = (harness: Harness, doc: ReturnType<typeof makeDoc>, onOpen = vi.fn()) =>
    harness.render(<FileTree doc={doc} activePath={null} onOpen={onOpen} onPathChanged={() => undefined} />);

  it('pluralizes the open-comment badge and closes a row menu from its button', () => {
    const harness = createHarness();
    const doc = makeDoc(harness);
    harness.store.addComment(doc.id, { body: 'one', path: 'api.md', quote: 'x' }, UI_USER);
    harness.store.addComment(doc.id, { body: 'two', path: 'api.md', quote: 'x' }, UI_USER);
    harness.store.addComment(doc.id, { body: 'solo', path: 'README.md', quote: 'hi' }, UI_USER);
    tree(harness, harness.store.get(doc.id));
    expect(screen.getByTitle('2 open comments')).toBeTruthy();
    expect(screen.getByTitle('1 open comment')).toBeTruthy();
    const actions = screen.getByRole('button', { name: 'Actions for api.md' });
    fireEvent.click(actions);
    expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0);
    fireEvent.click(actions);
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
  });

  it('creates a file once when Enter and blur both fire, and Escape cancels', async () => {
    const harness = createHarness();
    const onOpen = vi.fn();
    tree(harness, makeDoc(harness), onOpen);
    fireEvent.click(screen.getByRole('button', { name: 'New file' }));
    const input = screen.getByPlaceholderText(/path\/name/);
    fireEvent.change(input, { target: { value: 'notes' } });
    fireEvent.keyDown(input, { key: 'a' });
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.blur(input);
    });
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('notes.md'));
    expect(writes(harness)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'New file' }));
    fireEvent.keyDown(screen.getByPlaceholderText(/path\/name/), { key: 'Escape' });
    expect(screen.queryByPlaceholderText(/path\/name/)).toBeNull();
  });

  const upload = (files: unknown) => {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: files });
    fireEvent.change(input);
  };

  it('tolerates an empty file selection', () => {
    const harness = createHarness();
    tree(harness, makeDoc(harness));
    upload(null);
    expect(writes(harness)).toHaveLength(0);
  });

  it('reports a failed read, and writes empty content when the reader yields no result', async () => {
    const harness = createHarness();
    tree(harness, makeDoc(harness));
    class FailingReader {
      error: Error | null = null;
      result: string | null = null;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      readAsText() {
        queueMicrotask(() => this.onerror?.());
      }
      readAsDataURL() {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('FileReader', FailingReader);
    upload([new File(['abc'], 'bad.md')]);
    await waitFor(() => expect(harness.toasts.some((toast) => /Could not add bad\.md: could not read the file/.test(toast.message))).toBe(true));

    class EmptyReader extends FailingReader {
      override readAsText() {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('FileReader', EmptyReader);
    upload([new File(['abc'], 'empty.md')]);
    await waitFor(() => expect(writes(harness)).toHaveLength(1));
    expect(writes(harness)[0].input).toMatchObject({ path: 'empty.md', content: '' });
  });

  it('survives unmount while an upload is in flight', async () => {
    const harness = createHarness();
    const view = tree(harness, makeDoc(harness));
    upload([new File(['abc'], 'late.md')]);
    view.unmount();
    await waitFor(() => expect(writes(harness)).toHaveLength(1));
  });

  it('deletes via the row menu when several files exist', async () => {
    const harness = createHarness();
    const onPathChanged = vi.fn();
    const doc = makeDoc(harness);
    harness.render(<FileTree doc={doc} activePath={null} onOpen={() => undefined} onPathChanged={onPathChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for api.md' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onPathChanged).toHaveBeenCalledWith('api.md', null));
  });
});
