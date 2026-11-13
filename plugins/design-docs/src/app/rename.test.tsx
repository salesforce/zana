// @vitest-environment happy-dom
// Rename entry points: header pencil, More-actions Rename, F2, and the list row's inline rename.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UI_USER } from '../server/rpc.js';
import { DocHeader } from './DocHeader.js';
import { isStaleHead } from './DocActions.js';
import { ProjectTab } from './slots.js';
import { AGENT, createHarness, type Harness } from './test-harness.js';

const STALE = 'design doc head changed; re-read the doc before updating metadata';

function makeDoc(harness: Harness, title = 'Simple') {
  return harness.store.create({ template: 'blank', title, projectId: 'p1' }, UI_USER);
}

function renderHeader(harness: Harness, doc: ReturnType<typeof makeDoc>, extra: Partial<Parameters<typeof DocHeader>[0]> = {}) {
  return harness.render(<DocHeader doc={doc} projects={[]} compact={false} onDeleted={() => undefined} {...extra} />);
}

const titleInput = () => screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement;
const updates = (harness: Harness) => harness.rpcCalls.filter((call) => call.method === 'update').map((call) => call.input);

describe('header rename entry points', () => {
  it('pencil enters edit mode with the text selected, and Enter saves through update', async () => {
    const harness = createHarness();
    const doc = makeDoc(harness);
    renderHeader(harness, doc);
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = titleInput();
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('Simple'.length);
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(updates(harness)).toEqual([{ doc: doc.id, title: 'Renamed', expectedHead: doc.head }]));
    expect(harness.store.summary(doc.id).title).toBe('Renamed');
  });

  it('More actions > Rename (F2 hint) closes the menu and edits the title', () => {
    const harness = createHarness();
    renderHeader(harness, makeDoc(harness));
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    const item = screen.getByRole('menuitem', { name: /Rename/ });
    expect(item.textContent).toContain('F2');
    expect(screen.getAllByRole('separator').length).toBeGreaterThan(1);
    fireEvent.click(item);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(titleInput());
  });

  it('F2 starts a rename but is ignored while typing in an input, textarea or select', () => {
    const harness = createHarness();
    renderHeader(harness, makeDoc(harness));
    fireEvent.click(screen.getByTitle('Edit summary'));
    const summary = screen.getByRole('textbox', { name: 'Summary' });
    fireEvent.keyDown(summary, { key: 'F2' });
    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();
    fireEvent.keyDown(summary, { key: 'Escape' });
    fireEvent.keyDown(document.body, { key: 'F2', ctrlKey: true });
    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();
    fireEvent.keyDown(document.body, { key: 'F2' });
    expect(document.activeElement).toBe(titleInput());
    // Already typing in the title: F2 does nothing more.
    fireEvent.keyDown(titleInput(), { key: 'F2' });
    expect(document.activeElement).toBe(titleInput());
  });

  it('Escape cancels, an unchanged blur does not save, and a changed blur does', async () => {
    const harness = createHarness();
    const doc = makeDoc(harness);
    renderHeader(harness, doc);
    fireEvent.click(screen.getByTitle('Edit title'));
    fireEvent.change(titleInput(), { target: { value: 'Typed' } });
    fireEvent.keyDown(titleInput(), { key: 'Escape' });
    expect(screen.getByTitle('Edit title').textContent).toBe('Simple');
    fireEvent.click(screen.getByTitle('Edit title'));
    fireEvent.blur(titleInput());
    fireEvent.click(screen.getByTitle('Edit title'));
    fireEvent.change(titleInput(), { target: { value: 'Blurred' } });
    fireEvent.blur(titleInput());
    await waitFor(() => expect(harness.store.summary(doc.id).title).toBe('Blurred'));
    expect(updates(harness)).toHaveLength(1);
  });

  it('shows an accessible alert for an empty title on Enter and stays editing; blur cancels', () => {
    const harness = createHarness();
    renderHeader(harness, makeDoc(harness));
    fireEvent.click(screen.getByTitle('Edit title'));
    fireEvent.change(titleInput(), { target: { value: '   ' } });
    fireEvent.keyDown(titleInput(), { key: 'Enter' });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Title can’t be empty');
    expect(titleInput().getAttribute('aria-describedby')).toBe(alert.id);
    expect(titleInput().getAttribute('aria-invalid')).toBe('true');
    expect(updates(harness)).toEqual([]);
    fireEvent.change(titleInput(), { target: { value: 'x' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.change(titleInput(), { target: { value: '' } });
    fireEvent.blur(titleInput());
    expect(screen.getByTitle('Edit title').textContent).toBe('Simple');
    expect(updates(harness)).toEqual([]);
  });

  it('a failed update keeps the error toast and restores the old title', async () => {
    const harness = createHarness({ rpcOverrides: { update: async () => { throw new Error('disk full'); } } });
    renderHeader(harness, makeDoc(harness));
    fireEvent.click(screen.getByTitle('Edit title'));
    fireEvent.change(titleInput(), { target: { value: 'Nope' } });
    fireEvent.keyDown(titleInput(), { key: 'Enter' });
    await waitFor(() => expect(harness.toasts).toHaveLength(1));
    expect(harness.toasts[0]).toMatchObject({ kind: 'error', message: expect.stringContaining('disk full') });
    expect(screen.getByTitle('Edit title').textContent).toBe('Simple');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('never overwrites a title renamed elsewhere: offers Keep yours / Use theirs', async () => {
    const harness = createHarness();
    const doc = makeDoc(harness);
    harness.store.update(doc.id, { title: 'Theirs' }, UI_USER);
    renderHeader(harness, { ...doc, head: 'old-head' });
    fireEvent.click(screen.getByTitle('Edit title'));
    fireEvent.change(titleInput(), { target: { value: 'Mine' } });
    fireEvent.keyDown(titleInput(), { key: 'Enter' });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Title changed on another computer to Theirs');
    expect(harness.store.summary(doc.id).title).toBe('Theirs');
    expect(harness.toasts).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Use theirs' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(harness.store.summary(doc.id).title).toBe('Theirs');
  });

  it('Keep yours writes the title against the newer head', async () => {
    const harness = createHarness();
    const doc = makeDoc(harness);
    harness.store.update(doc.id, { title: 'Theirs' }, UI_USER);
    renderHeader(harness, { ...doc, head: 'old-head' });
    fireEvent.click(screen.getByTitle('Edit title'));
    fireEvent.change(titleInput(), { target: { value: 'Mine' } });
    fireEvent.keyDown(titleInput(), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('button', { name: 'Keep yours' }));
    await waitFor(() => expect(harness.store.summary(doc.id).title).toBe('Mine'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Keep yours that fails again toasts and clears the choice', async () => {
    let calls = 0;
    const harness = createHarness({ rpcOverrides: { update: async () => { calls += 1; throw new Error(STALE); } } });
    const doc = makeDoc(harness);
    harness.store.update(doc.id, { title: 'Theirs' }, UI_USER);
    renderHeader(harness, { ...doc, head: 'old-head' });
    fireEvent.click(screen.getByTitle('Edit title'));
    fireEvent.change(titleInput(), { target: { value: 'Mine' } });
    fireEvent.keyDown(titleInput(), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('button', { name: 'Keep yours' }));
    await waitFor(() => expect(harness.toasts).toHaveLength(1));
    expect(calls).toBe(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a stale head with the title unchanged is an error, never retried against the newer head', async () => {
    const harness = createHarness();
    const doc = makeDoc(harness);
    renderHeader(harness, { ...doc, head: 'old-head' });
    fireEvent.click(screen.getByTitle('Edit title'));
    fireEvent.change(titleInput(), { target: { value: 'Mine' } });
    fireEvent.keyDown(titleInput(), { key: 'Enter' });
    await waitFor(() => expect(harness.toasts).toHaveLength(1));
    expect(harness.toasts[0]!.message).toMatch(/head changed/);
    expect(updates(harness)).toHaveLength(1);
    expect(harness.store.summary(doc.id).title).toBe('Simple');
  });

  it('treats a stale save whose title already matches as saved, and toasts when the re-read fails', async () => {
    const harness = createHarness();
    const doc = makeDoc(harness);
    harness.store.update(doc.id, { title: 'Same' }, UI_USER);
    const view = renderHeader(harness, { ...doc, head: 'old-head' });
    fireEvent.click(screen.getByTitle('Edit title'));
    fireEvent.change(titleInput(), { target: { value: 'Same' } });
    fireEvent.keyDown(titleInput(), { key: 'Enter' });
    await waitFor(() => expect(updates(harness)).toHaveLength(1));
    expect(harness.toasts).toEqual([]);
    expect(screen.queryByRole('alert')).toBeNull();
    view.unmount();

    const failing = createHarness({ rpcOverrides: { get: async () => { throw new Error('gone'); } } });
    const other = makeDoc(failing);
    failing.store.update(other.id, { title: 'Theirs' }, UI_USER);
    renderHeader(failing, { ...other, head: 'old-head' });
    fireEvent.click(screen.getByTitle('Edit title'));
    fireEvent.change(titleInput(), { target: { value: 'Mine' } });
    fireEvent.keyDown(titleInput(), { key: 'Enter' });
    await waitFor(() => expect(failing.toasts).toHaveLength(1));
    expect(failing.toasts[0]!.message).toContain('gone');
  });

  it('renames a template through the template path and has no More-actions menu', async () => {
    const harness = createHarness();
    const template = harness.store.templateNew({ label: 'Personal template' }, UI_USER);
    renderHeader(harness, template as never, { template: true });
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(titleInput(), { target: { value: 'Team template' } });
    fireEvent.keyDown(titleInput(), { key: 'Enter' });
    await waitFor(() => expect(harness.rpcCalls.some((call) => call.method === 'templateUpdateMeta')).toBe(true));
  });
});

describe('list row rename', () => {
  const rowButton = (title: string) => screen.getByText(title, { selector: '.dd-doc-row-title' }).closest('button')!;
  const rowInput = () => screen.getByRole('textbox', { name: 'Rename design doc' }) as HTMLInputElement;

  async function startRowRename(harness: Harness, title: string) {
    await screen.findByText(title, { selector: '.dd-doc-row-title' });
    fireEvent.contextMenu(rowButton(title), { clientX: 40, clientY: 60 });
    const menu = screen.getByRole('menu', { name: `Actions for ${title}` });
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Rename/ }));
  }

  it('renames in place without opening the doc; clicks in the editor do not open it', async () => {
    const harness = createHarness();
    const doc = makeDoc(harness, 'Payments API');
    makeDoc(harness, 'Glossary');
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    await startRowRename(harness, 'Payments API');
    expect(document.activeElement).toBe(rowInput());
    expect(rowInput().value).toBe('Payments API');
    expect(screen.queryByTitle('Edit title')).toBeNull();
    fireEvent.click(rowInput());
    expect(screen.queryByTitle('Edit title')).toBeNull();
    fireEvent.contextMenu(rowInput());
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.change(rowInput(), { target: { value: 'Payments v2' } });
    fireEvent.keyDown(rowInput(), { key: 'Enter' });
    await waitFor(() => expect(harness.store.summary(doc.id).title).toBe('Payments v2'));
    await screen.findByText('Payments v2', { selector: '.dd-doc-row-title' });
    expect(screen.queryByRole('textbox', { name: 'Rename design doc' })).toBeNull();
    expect(screen.queryByTitle('Edit title')).toBeNull();
    expect(updates(harness)).toEqual([{ doc: doc.id, title: 'Payments v2', expectedHead: doc.head }]);
  });

  it('Escape and an unchanged blur cancel; a changed blur saves; an empty blur cancels', async () => {
    const harness = createHarness();
    const doc = makeDoc(harness, 'Payments API');
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    await startRowRename(harness, 'Payments API');
    fireEvent.change(rowInput(), { target: { value: 'Typed' } });
    fireEvent.keyDown(rowInput(), { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Rename design doc' })).toBeNull();
    expect(rowButton('Payments API')).toBeTruthy();

    await startRowRename(harness, 'Payments API');
    fireEvent.blur(rowInput());
    expect(screen.queryByRole('textbox', { name: 'Rename design doc' })).toBeNull();

    await startRowRename(harness, 'Payments API');
    fireEvent.change(rowInput(), { target: { value: '' } });
    fireEvent.blur(rowInput());
    expect(screen.queryByRole('textbox', { name: 'Rename design doc' })).toBeNull();
    expect(updates(harness)).toEqual([]);

    await startRowRename(harness, 'Payments API');
    fireEvent.change(rowInput(), { target: { value: 'By blur' } });
    fireEvent.blur(rowInput());
    await waitFor(() => expect(harness.store.summary(doc.id).title).toBe('By blur'));
  });

  it('an empty Enter shows an alert and keeps the editor open', async () => {
    const harness = createHarness();
    makeDoc(harness, 'Payments API');
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    await startRowRename(harness, 'Payments API');
    fireEvent.change(rowInput(), { target: { value: '  ' } });
    fireEvent.keyDown(rowInput(), { key: 'Enter' });
    const alert = screen.getByRole('alert');
    expect(rowInput().getAttribute('aria-describedby')).toBe(alert.id);
    expect(updates(harness)).toEqual([]);
    fireEvent.change(rowInput(), { target: { value: 'Back' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the draft when the list refreshes underneath the editor', async () => {
    const harness = createHarness();
    const doc = makeDoc(harness, 'Payments API');
    const other = makeDoc(harness, 'Glossary');
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    await startRowRename(harness, 'Payments API');
    fireEvent.change(rowInput(), { target: { value: 'My draft' } });
    // Another doc changes (and sorts first), so the list reloads and may re-order rows.
    await harness.asAgent((store) => store.update(other.id, { title: 'Glossary 2' }, AGENT));
    await screen.findByText('Glossary 2', { selector: '.dd-doc-row-title' });
    expect(rowInput().value).toBe('My draft');
    // Even the renamed doc itself changing elsewhere keeps the typed text (the row's title input stays, draft intact).
    await harness.asAgent((store) => store.update(doc.id, { title: 'Payments (agent)' }, AGENT));
    await screen.findByText('Glossary 2', { selector: '.dd-doc-row-title' });
    expect(rowInput().value).toBe('My draft');
  });

  it('offers Keep yours / Use theirs when the head is stale and keeps the row open', async () => {
    const calls: unknown[] = [];
    const harness = createHarness({
      rpcOverrides: {
        update: async (args) => {
          calls.push(args);
          if (calls.length === 1) throw new Error(STALE);
          return {};
        }
      }
    });
    const doc = makeDoc(harness, 'Payments API');
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    await startRowRename(harness, 'Payments API');
    harness.store.update(doc.id, { title: 'Theirs' }, UI_USER);
    fireEvent.change(rowInput(), { target: { value: 'Mine' } });
    fireEvent.keyDown(rowInput(), { key: 'Enter' });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Title changed on another computer to Theirs');
    // Blurring onto the choice buttons must not trigger another save.
    fireEvent.blur(rowInput());
    expect(calls).toHaveLength(1);
    expect(rowInput()).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep yours' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toMatchObject({ title: 'Mine' });
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Rename design doc' })).toBeNull());
  });

  it('Use theirs closes the editor without writing', async () => {
    const harness = createHarness({ rpcOverrides: { update: async () => { throw new Error(STALE); } } });
    const doc = makeDoc(harness, 'Payments API');
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    await startRowRename(harness, 'Payments API');
    harness.store.update(doc.id, { title: 'Theirs' }, UI_USER);
    fireEvent.change(rowInput(), { target: { value: 'Mine' } });
    fireEvent.keyDown(rowInput(), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('button', { name: 'Use theirs' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Rename design doc' })).toBeNull());
    expect(harness.store.summary(doc.id).title).toBe('Theirs');
  });

  it('a failed row rename toasts and restores the row', async () => {
    const harness = createHarness({ rpcOverrides: { update: async () => { throw new Error('boom'); } } });
    makeDoc(harness, 'Payments API');
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    await startRowRename(harness, 'Payments API');
    fireEvent.change(rowInput(), { target: { value: 'Nope' } });
    fireEvent.keyDown(rowInput(), { key: 'Enter' });
    await waitFor(() => expect(harness.toasts).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Rename design doc' })).toBeNull());
    expect(rowButton('Payments API')).toBeTruthy();
  });
});

describe('isStaleHead', () => {
  it('recognises the head-moved errors only', () => {
    expect(isStaleHead(new Error(STALE))).toBe(true);
    expect(isStaleHead(new Error('doc changed since revision 3'))).toBe(true);
    expect(isStaleHead(new Error('disk full'))).toBe(false);
    expect(vi.isMockFunction(isStaleHead)).toBe(false);
  });
});
