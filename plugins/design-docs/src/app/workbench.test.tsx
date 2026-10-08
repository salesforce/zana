// @vitest-environment happy-dom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { collectTestPluginApp } from '@zana-ai/zcc-plugin-sdk/testing/app';
import { UI_USER } from '../server/rpc.js';
import type { DesignDocStore } from '../server/store.js';
import { NavPanel, ProjectTab } from './slots.js';
import { projectOptions } from './Workbench.js';
import { AGENT, createHarness, type Harness } from './test-harness.js';

export function seed(store: DesignDocStore, input: { title: string; projectId?: string | null; summary?: string; tags?: string[]; status?: 'draft' | 'archived' }) {
  return store.create({ template: 'blank', ...input, projectId: input.projectId ?? null }, UI_USER);
}

function openInProjectTab(harness: Harness, docId: string, projectId = 'p1') {
  localStorage.setItem(`zcc.design-docs.project-location:${projectId}`, JSON.stringify(docId));
  return harness.render(<ProjectTab pluginId="design-docs" projectId={projectId} />);
}

async function newDocDialog() {
  fireEvent.click(screen.getAllByRole('button', { name: 'New' })[0]!);
  const dialog = screen.getByRole('dialog', { name: 'New design doc' });
  await within(dialog).findAllByRole('radio');
  return dialog;
}

function pick(filter: 'status' | 'project', option: string | RegExp) {
  fireEvent.click(screen.getByRole('button', { name: `Filter by ${filter}` }));
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: option }));
}

function menuItem(name: string | RegExp) {
  return screen.getByRole('menuitem', { name });
}

describe('plugin app', () => {
  it('registers every slot and injects its stylesheet once', async () => {
    createHarness();
    const module = await import('../../app.tsx');
    const app = collectTestPluginApp(module.default, 'design-docs', 1);
    expect(app.navPanels.map((slot) => slot.id)).toEqual(['design-docs']);
    expect(app.projectTabs.map((slot) => slot.id)).toEqual(['design']);
    expect(app.messageDirectives.map((slot) => slot.id)).toEqual(['design-doc']);
    expect(app.threadPanelActions.map((slot) => slot.id)).toEqual(['design-doc']);
    expect(app.messageActions.map((slot) => slot.id)).toEqual(['save-design-doc']);
    module.injectStyles();
    expect(document.querySelectorAll('#design-docs-plugin-styles')).toHaveLength(1);
    expect(document.getElementById('design-docs-plugin-styles')!.textContent).toContain('.dd-root');
  });
});

describe('creating docs', () => {
  it('starts on the landing page and creates a doc from a template', async () => {
    const harness = createHarness();
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    expect(await screen.findByText('Design docs your agents work on with you')).toBeTruthy();
    expect(await screen.findByText('No design docs yet.')).toBeTruthy();

    const landing = screen.getByText('Start from a template').parentElement!;
    fireEvent.click(await within(landing).findByRole('radio', { name: /Decision record/ }));
    const dialog = screen.getByRole('dialog', { name: 'New design doc' });
    expect((await within(dialog).findByRole('radio', { name: /Decision record/ })).getAttribute('aria-checked')).toBe('true');
    const create = within(dialog).getByRole('button', { name: 'Create' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.change(within(dialog).getByPlaceholderText('e.g. Offline sync for the mobile app'), { target: { value: 'Use SQLite' } });
    fireEvent.change(within(dialog).getByPlaceholderText(/One line agents see/), { target: { value: 'Storage choice' } });
    fireEvent.change(within(dialog).getByPlaceholderText('sync, mobile'), { target: { value: 'Storage, , DB' } });
    fireEvent.click(create);

    expect(await screen.findByRole('button', { name: 'Use SQLite' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'New design doc' })).toBeNull();
    const [doc] = harness.store.list({});
    expect(doc).toMatchObject({ title: 'Use SQLite', summary: 'Storage choice', projectId: 'p1', tags: ['storage', 'db'] });
    expect(harness.store.get(doc!.id).files.map((file) => file.path)).toEqual(['README.md']);
    expect(await screen.findByRole('navigation', { name: 'Files' })).toBeTruthy();
    expect(localStorage.getItem('zcc.design-docs.project-location:p1')).toBe(JSON.stringify(doc!.id));
  });

  it('creates a doc and starts an agent drafting it from the brief', async () => {
    const harness = createHarness();
    harness.render(<ProjectTab pluginId="design-docs" projectId="p2" />);
    const dialog = await newDocDialog();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Product spec/ }));
    fireEvent.change(within(dialog).getByPlaceholderText('e.g. Offline sync for the mobile app'), { target: { value: 'Offline sync' } });
    fireEvent.change(within(dialog).getByPlaceholderText(/Describe the problem/), { target: { value: 'Phones lose signal in tunnels.' } });
    expect(within(dialog).getByText('An agent starts a new thread to draft it.')).toBeTruthy();
    // Enter in a field submits the form too.
    fireEvent.submit(dialog.querySelector('form')!);

    await waitFor(() => expect(harness.spawn).toHaveBeenCalledTimes(1));
    const [spawned] = harness.spawn.mock.calls[0] as unknown as [{ projectId: string; prompt: string; pluginMetadata: { designDocId: string } }];
    expect(spawned.projectId).toBe('p2');
    expect(spawned.prompt).toContain('Phones lose signal in tunnels.');
    const doc = harness.store.list({})[0]!;
    expect(spawned.pluginMetadata.designDocId).toBe(doc.id);
    expect(harness.navigateCalls).toEqual([
      { method: 'openThreadPanel', options: { actionId: 'design-doc', title: 'Offline sync', params: { docId: doc.id }, threadId: 'thread-1' } },
      { method: 'toThread', threadId: 'thread-1' }
    ]);
    expect(harness.toasts.at(-1)!.message).toContain('An agent is drafting “Offline sync”');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New design doc' })).toBeNull());
  });

  it('creates a global doc without drafting when there is no project to run in', async () => {
    const harness = createHarness({ projects: [] });
    harness.render(<NavPanel pluginId="design-docs" subPath="" />);
    const dialog = await newDocDialog();
    expect(within(dialog).getByRole('option', { name: 'Global (all projects)' })).toBeTruthy();
    fireEvent.change(within(dialog).getByPlaceholderText('e.g. Offline sync for the mobile app'), { target: { value: 'Shared glossary' } });
    fireEvent.change(within(dialog).getByPlaceholderText(/Describe the problem/), { target: { value: 'Terms' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create & draft with agent' }));
    await waitFor(() => expect(harness.toasts).toContainEqual({ message: 'Doc created. Add a project to let an agent draft it.', kind: 'error' }));
    expect(harness.spawn).not.toHaveBeenCalled();
    const doc = harness.store.list({})[0]!;
    expect(doc.projectId).toBeNull();
    expect(harness.navigateCalls).toEqual([{ method: 'toPluginPanel', path: 'design-docs', options: { subPath: doc.id } }]);
  });

  it('keeps the dialog open when creating fails, and closes on Cancel', async () => {
    const harness = createHarness();
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    const dialog = await newDocDialog();
    harness.fail('create', 'disk full');
    fireEvent.change(within(dialog).getByPlaceholderText('e.g. Offline sync for the mobile app'), { target: { value: 'Nope' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(harness.toasts).toContainEqual({ message: 'Could not create the doc: disk full', kind: 'error' }));
    expect(screen.getByRole('dialog', { name: 'New design doc' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'New design doc' })).toBeNull();
  });
});

describe('doc list', () => {
  it("lists a project's docs plus global ones, and searches and filters them", async () => {
    const harness = createHarness();
    seed(harness.store, { title: 'Payments API', projectId: 'p1', summary: 'Charge flow', tags: ['billing'] });
    seed(harness.store, { title: 'Glossary', projectId: null });
    seed(harness.store, { title: 'Marketing site', projectId: 'p2' });
    seed(harness.store, { title: 'Old idea', projectId: 'p1', status: 'archived' });
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);

    expect(await screen.findByText('Payments API')).toBeTruthy();
    expect(screen.getByText('Charge flow')).toBeTruthy();
    expect(screen.getByText('Glossary')).toBeTruthy();
    expect(screen.getByText('Global')).toBeTruthy();
    expect(screen.queryByText('Marketing site')).toBeNull();
    expect(screen.queryByText('Old idea')).toBeNull();

    const search = screen.getByRole('textbox', { name: 'Search design docs' });
    fireEvent.change(search, { target: { value: 'zzz-nothing' } });
    expect(await screen.findByText('No docs match.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(await screen.findByText('Payments API')).toBeTruthy();

    const statusPicker = screen.getByRole('button', { name: 'Filter by status' });
    expect(statusPicker.textContent).toBe('Active');
    expect(screen.queryByRole('button', { name: 'Filter by project' })).toBeNull();
    pick('status', 'Archived');
    expect(await screen.findByText('Old idea')).toBeTruthy();
    expect(screen.queryByText('Payments API')).toBeNull();
    expect(statusPicker.textContent).toBe('Archived');
    expect(statusPicker.classList.contains('on')).toBe(true);
    pick('status', 'All statuses');
    expect(await screen.findByText('Payments API')).toBeTruthy();
    expect(screen.getByText('Old idea')).toBeTruthy();
    expect(localStorage.getItem('zcc.design-docs.list-status')).toBe('"all"');

    fireEvent.click(screen.getByText('Payments API'));
    expect(await screen.findByTitle('Edit title')).toBeTruthy();
    expect(screen.getByText('Payments API', { selector: '.dd-doc-row-title' }).closest('button')!.getAttribute('aria-current')).toBe('page');
  });

  it('opens a menu of doc actions on right click', async () => {
    const harness = createHarness();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const open = seed(harness.store, { title: 'Payments API', projectId: 'p1' });
    const other = seed(harness.store, { title: 'Glossary', projectId: 'p1' });
    const spare = seed(harness.store, { title: 'Scratch', projectId: 'p1' });
    openInProjectTab(harness, open.id);
    await screen.findByTitle('Edit title');
    const row = (title: string) => screen.getByText(title, { selector: '.dd-doc-row-title' }).closest('button')!;
    const rightClick = (title: string) => fireEvent.contextMenu(row(title), { clientX: 40, clientY: 60 });

    // The open doc offers no Open; the menu marks its row and takes focus.
    rightClick('Payments API');
    const menu = screen.getByRole('menu', { name: 'Actions for Payments API' });
    expect(within(menu).queryByRole('menuitem', { name: 'Open' })).toBeNull();
    expect(row('Payments API').classList.contains('dd-doc-row-menu')).toBe(true);
    expect(document.activeElement).toBe(within(menu).getAllByRole('menuitem')[0]);
    fireEvent.click(menuItem(/Copy chat reference/));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`::design-doc{id="${open.id}"}`));
    expect(screen.queryByRole('menu')).toBeNull();

    rightClick('Glossary');
    fireEvent.click(menuItem('Archive'));
    await waitFor(() => expect(harness.store.get(other.id).status).toBe('archived'));
    expect(screen.getByTitle('Edit title').textContent).toBe('Payments API');

    // Deleting another doc keeps the open one; deleting the open one leaves it.
    rightClick('Scratch');
    fireEvent.click(menuItem('Delete…'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete design doc' })).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(harness.store.find(spare.id)).toBeNull());
    expect(screen.getByTitle('Edit title').textContent).toBe('Payments API');

    await waitFor(() => expect(screen.queryByText('Glossary', { selector: '.dd-doc-row-title' })).toBeNull());
    const extra = seed(harness.store, { title: 'Later', projectId: 'p1' });
    harness.emit({ docId: extra.id });
    await screen.findByText('Later', { selector: '.dd-doc-row-title' });
    rightClick('Later');
    fireEvent.click(menuItem('Open'));
    await waitFor(() => expect(screen.getByTitle('Edit title').textContent).toBe('Later'));

    rightClick('Later');
    fireEvent.click(menuItem('Move to project…'));
    fireEvent.change(within(screen.getByRole('dialog', { name: 'Move design doc' })).getByRole('combobox'), { target: { value: '' } });
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Move design doc' })).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(harness.store.get(extra.id).projectId).toBeNull());

    rightClick('Later');
    fireEvent.click(menuItem('Delete…'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete design doc' })).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Design docs your agents work on with you')).toBeTruthy();
  });

  it('downloads a doc as a zip from the right-click menu and the header menu', async () => {
    const harness = createHarness();
    const blobs: Blob[] = [];
    const saved: string[] = [];
    const urls = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
    Object.assign(URL, { createObjectURL: (blob: Blob) => (blobs.push(blob), 'blob:zip'), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download);
    });
    try {
      const doc = seed(harness.store, { title: 'Payments API', projectId: 'p1' });
      openInProjectTab(harness, doc.id);
      await screen.findByTitle('Edit title');

      fireEvent.contextMenu(screen.getByText('Payments API', { selector: '.dd-doc-row-title' }).closest('button')!);
      fireEvent.click(menuItem(/Download \.zip/));
      await waitFor(() => expect(saved).toEqual([`${doc.slug}.zip`]));
      expect(blobs[0]!.type).toBe('application/zip');
      const bytes = new Uint8Array(await blobs[0]!.arrayBuffer());
      expect(new TextDecoder().decode(bytes)).toContain(`${doc.slug}/README.md`);

      harness.fail('siteFiles', 'disk on fire');
      fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
      fireEvent.click(menuItem(/Download \.zip/));
      await waitFor(() => expect(harness.toasts.at(-1)).toEqual({ message: 'Could not download the doc: disk on fire', kind: 'error' }));
      expect(saved).toHaveLength(1);
    } finally {
      click.mockRestore();
      Object.assign(URL, urls);
    }
  });

  it('shows every project in the nav panel with a project filter, and navigates by URL', async () => {
    const harness = createHarness();
    const payments = seed(harness.store, { title: 'Payments API', projectId: 'p1' });
    seed(harness.store, { title: 'Glossary', projectId: null });
    seed(harness.store, { title: 'Orphan', projectId: 'gone' });
    harness.render(<NavPanel pluginId="design-docs" subPath="" />);

    expect(await screen.findByText('Payments API')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('App')).toBeTruthy());
    expect(screen.getByText('Unknown project')).toBeTruthy();
    expect(screen.getByText('Global')).toBeTruthy();

    // Only projects with docs are offered, each with its count.
    fireEvent.click(screen.getByRole('button', { name: 'Filter by project' }));
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['All projects3', 'Global docs1', 'App1']);
    expect(options[0]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(options[1]!);
    await waitFor(() => expect(screen.queryByText('Payments API')).toBeNull());
    expect(screen.getByText('Glossary')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Filter by project' }).textContent).toBe('Global docs');
    pick('project', /^App/);
    expect(await screen.findByText('Payments API')).toBeTruthy();
    expect(screen.queryByText('Glossary')).toBeNull();
    pick('project', /^All projects/);

    fireEvent.click(screen.getByText('Payments API'));
    expect(harness.navigateCalls.at(-1)).toEqual({ method: 'toPluginPanel', path: 'design-docs', options: { subPath: payments.id } });
  });

  it('opens the doc and file named in the nav sub-path', async () => {
    const harness = createHarness();
    const doc = harness.store.create(
      { title: 'Search', files: [{ path: 'README.md', content: 'Intro' }, { path: 'api.md', content: 'Endpoints' }] },
      UI_USER
    );
    harness.render(<NavPanel pluginId="design-docs" subPath={`${doc.id}/api.md`} />);
    expect(await screen.findByText('Endpoints')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /README\.md/ }));
    expect(harness.navigateCalls.at(-1)).toEqual({
      method: 'toPluginPanel',
      path: 'design-docs',
      options: { subPath: `${doc.id}/README.md`, replace: true }
    });
  });

  it('keeps the picked project offered when it has no docs left', () => {
    const projects = [
      { id: 'p1', name: 'App' },
      { id: 'p2', name: 'Site' }
    ];
    const labels = (selected: string) => projectOptions([], projects, selected).map((option) => option.label);
    expect(labels('')).toEqual(['All projects']);
    expect(labels('p2')).toEqual(['All projects', 'Site']);
    expect(labels('__global__')).toEqual(['All projects', 'Global docs']);
  });

  it('shows list errors', async () => {
    const harness = createHarness();
    harness.fail('list', 'database locked');
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    expect(await screen.findByText('database locked')).toBeTruthy();
  });

  it('collapses to a rail and remembers it', async () => {
    const harness = createHarness();
    seed(harness.store, { title: 'Payments API', projectId: 'p1' });
    const glossary = seed(harness.store, { title: 'Glossary', projectId: null });
    await harness.asAgent((store) => store.writeFile(glossary.id, { path: 'README.md', content: 'Terms' }, AGENT));
    const view = harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);

    await screen.findByText('Payments API');
    expect(screen.getByTitle('2 docs').textContent).toBe('2');
    expect(screen.getByTitle('Global').textContent).toBe('Global');
    expect(screen.getByTitle('Last edited by an agent')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search design docs'), { target: { value: 'Payments' } });
    expect(await screen.findByTitle('1 doc')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Hide doc list' }));
    expect(screen.queryByText('Payments API')).toBeNull();
    expect(localStorage.getItem('zcc.design-docs.list-open')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'New design doc' }));
    expect(screen.getByRole('dialog', { name: 'New design doc' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    view.unmount();
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show doc list' }));
    expect(await screen.findByText('Payments API')).toBeTruthy();
    expect(localStorage.getItem('zcc.design-docs.list-open')).toBe('true');
  });
});

describe('doc header', () => {
  it('edits the title and summary in place', async () => {
    const harness = createHarness();
    const doc = seed(harness.store, { title: 'Draft', projectId: 'p1' });
    openInProjectTab(harness, doc.id);

    fireEvent.click(await screen.findByTitle('Edit title'));
    const title = screen.getByRole('textbox', { name: 'Title' });
    fireEvent.change(title, { target: { value: 'Event bus' } });
    fireEvent.keyDown(title, { key: 'Enter' });
    expect(await screen.findByTitle('Edit title')).toBeTruthy();
    await waitFor(() => expect(harness.store.get(doc.id).title).toBe('Event bus'));
    await waitFor(() => expect(screen.getByTitle('Edit title').textContent).toBe('Event bus'));

    fireEvent.click(screen.getByTitle('Edit title'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Discarded' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Title' }), { key: 'Escape' });
    expect(screen.getByTitle('Edit title').textContent).toBe('Event bus');

    fireEvent.click(screen.getByTitle('Edit summary'));
    const summary = screen.getByRole('textbox', { name: 'Summary' });
    fireEvent.change(summary, { target: { value: 'Pub/sub for services' } });
    fireEvent.blur(summary);
    await waitFor(() => expect(harness.store.get(doc.id).summary).toBe('Pub/sub for services'));

    harness.fail('update', 'read-only');
    fireEvent.click(await screen.findByTitle('Edit title'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Rejected' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Title' }), { key: 'Enter' });
    await waitFor(() => expect(harness.toasts).toContainEqual({ message: 'Could not update the doc: read-only', kind: 'error' }));
    await waitFor(() => expect(screen.getByTitle('Edit title').textContent).toBe('Event bus'));
  });

  it('changes status and tags', async () => {
    const harness = createHarness();
    const doc = seed(harness.store, { title: 'Tagged', projectId: 'p1', tags: ['old'] });
    openInProjectTab(harness, doc.id);

    fireEvent.click(await screen.findByTitle('Change status'));
    fireEvent.click(menuItem('In review'));
    await waitFor(() => expect(harness.store.get(doc.id).status).toBe('review'));

    fireEvent.click(screen.getByRole('button', { name: 'Tag' }));
    const input = screen.getByRole('textbox', { name: 'Add tags' });
    fireEvent.change(input, { target: { value: 'Alpha, old, beta' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(harness.store.get(doc.id).tags).toEqual(['old', 'alpha', 'beta']));
    // Wait for the refreshed tags before removing one, or the click acts on stale ones.
    await screen.findByRole('button', { name: 'Remove tag beta' });
    fireEvent.click(await screen.findByRole('button', { name: 'Remove tag old' }));
    await waitFor(() => expect(harness.store.get(doc.id).tags).toEqual(['alpha', 'beta']));

    fireEvent.click(await screen.findByRole('button', { name: 'Tag' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Add tags' }), { target: { value: 'ignored' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Add tags' }), { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Add tags' })).toBeNull();
    expect(harness.store.get(doc.id).tags).toEqual(['alpha', 'beta']);
  });

  it('archives, moves, copies references and deletes from the actions menu', async () => {
    const harness = createHarness();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const doc = seed(harness.store, { title: 'Lifecycle', projectId: 'p1' });
    openInProjectTab(harness, doc.id);
    await screen.findByTitle('Edit title');
    const more = () => fireEvent.click(screen.getByRole('button', { name: 'More actions' }));

    more();
    fireEvent.click(menuItem(/Copy chat reference/));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`::design-doc{id="${doc.id}"}`));
    expect(harness.toasts.at(-1)).toEqual({ message: 'Copied reference', kind: 'info' });
    writeText.mockRejectedValueOnce(new Error('denied'));
    more();
    fireEvent.click(menuItem(/Copy id/));
    await waitFor(() => expect(harness.toasts.at(-1)).toEqual({ message: 'Could not copy id', kind: 'error' }));

    more();
    fireEvent.click(menuItem('Archive'));
    await waitFor(() => expect(harness.store.get(doc.id).status).toBe('archived'));
    more();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Unarchive' }));
    await waitFor(() => expect(harness.store.get(doc.id).status).toBe('draft'));

    more();
    fireEvent.click(menuItem('Move to project…'));
    const move = screen.getByRole('dialog', { name: 'Move design doc' });
    const moveButton = within(move).getByRole('button', { name: 'Move' }) as HTMLButtonElement;
    expect(moveButton.disabled).toBe(true);
    fireEvent.change(within(move).getByRole('combobox'), { target: { value: '' } });
    fireEvent.click(moveButton);
    await waitFor(() => expect(harness.store.get(doc.id).projectId).toBeNull());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Move design doc' })).toBeNull());

    more();
    fireEvent.click(menuItem('Delete…'));
    const confirm = screen.getByRole('dialog', { name: 'Delete design doc' });
    expect(confirm.textContent).toContain('with its 1 file');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Design docs your agents work on with you')).toBeTruthy();
    expect(harness.store.find(doc.id)).toBeNull();
    expect(harness.toasts.at(-1)).toEqual({ message: 'Deleted “Lifecycle”', kind: 'info' });
  });

  it('reports a failed delete and keeps the doc', async () => {
    const harness = createHarness();
    const doc = seed(harness.store, { title: 'Sticky', projectId: 'p1' });
    openInProjectTab(harness, doc.id);
    await screen.findByTitle('Edit title');
    harness.fail('remove', 'locked');
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(menuItem('Delete…'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete design doc' })).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(harness.toasts).toContainEqual({ message: 'Could not delete: locked', kind: 'error' }));
    expect(harness.store.find(doc.id)).not.toBeNull();
    expect(screen.getByTitle('Edit title')).toBeTruthy();
  });
});
